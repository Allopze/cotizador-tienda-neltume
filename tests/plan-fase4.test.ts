import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import type { Cotizacion } from '../src/negocio/estado';
import { fechaLocal } from '../src/negocio/vigencia';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { guardarCatalogo, RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { Servicio } from '../src/servidor/servicio';

// Plan de trabajo, fase 4 (docs/revision-2026-10-11.md §4): filtros del Historial (4.10) y papelera de
// borradores y planilla anterior (4.11), sobre el almacén y el repositorio con una SQLite temporal.

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const puerta = (codigo: string, modelo: string, precioNeto = 100_000): Producto => ({
  codigo,
  modelo,
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto,
  descripcion: modelo,
  filaOrigen: 4,
});
const catalogo: Catalogo = {
  fuente: 'test',
  sha256: 'test',
  fecha: '2026-01-01',
  productos: [puerta('MOL-O-3-A', 'MOLCO')],
};
const pedido: SolicitudItem = {
  modelo: 'MOLCO',
  madera: 'PINO OREGON',
  ancho: 0.82,
  alto: 2,
  medida: null,
  cantidad: 2,
  tipoMedida: 'hoja',
};

const dirs: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

type Ref = Pick<Cotizacion, 'id' | 'actualizada'>;
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-plan-fase4-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const llm = {
    interpretar: vi.fn().mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { items: [pedido], cliente: { ...clienteVacio(), nombre: 'Ana Soto' } },
    }),
  };
  const servicio = new Servicio(catalogo, llm, almacen, { nombre: 'Paula', email: 'paula@neltume.cl' });
  const crear = async () => (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza MOLCO' })).cotizacion;
  const sobre = (q: Ref, extra: Record<string, unknown>) =>
    servicio.ejecutar({ ...extra, id: q.id, actualizada: q.actualizada } as never);
  const ir = async (q: Ref, extra: Record<string, unknown>) => (await sobre(q, extra)).cotizacion;
  const emitida = async () => ir(await crear(), { tipo: 'emitir' });
  const aprobada = async () => ir(await emitida(), { tipo: 'aprobar' });
  const pagar = (q: Ref, monto: number) => ir(q, { tipo: 'pago', monto, fecha: '2026-10-01' });
  const db = almacen.baseDatos();
  return { dir, almacen, db, servicio, crear, sobre, ir, emitida, aprobada, pagar };
}

/** Fecha de Santiago a `n` días de hoy, como la compara el filtro. */
const enDias = (n: number) => {
  const d = new Date(`${fechaLocal(new Date())}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const ids = (cotizaciones: { id: string }[]) => cotizaciones.map((c) => c.id).sort();

describe('4.10 · filtros del Historial', () => {
  it('«Vencen pronto» trae solo las emitidas vigentes que vencen en los próximos días', async () => {
    const t = await setup();
    const vence = (q: Cotizacion, fecha: string) =>
      t.db.prepare('UPDATE cotizaciones SET vence = ? WHERE id = ?').run(fecha, q.id);
    const pronto = await t.emitida();
    vence(pronto, enDias(3));
    const hoy = await t.emitida();
    vence(hoy, enDias(0));
    const lejos = await t.emitida();
    vence(lejos, enDias(30));
    const vencida = await t.emitida();
    vence(vencida, enDias(-1));
    const aprobada = await t.aprobada();
    vence(aprobada, enDias(3));
    await t.crear();

    const r = t.almacen.listar({ vencenPronto: true });
    expect(ids(r.cotizaciones)).toEqual(ids([pronto, hoy]));
    expect(r.total).toBe(2);
    expect(r.cotizaciones.every((c) => c.estado === 'emitida' && !c.vencida)).toBe(true);
    // Sin el filtro aparecen todas.
    expect(t.almacen.listar().total).toBe(6);
  });

  it('«Con saldo pendiente» trae solo las aprobadas a las que les falta pagar', async () => {
    const t = await setup();
    const sinPagos = await t.aprobada();
    const parcial = await t.pagar(await t.aprobada(), 1000);
    const completa = await t.aprobada();
    await t.pagar(completa, completa.montos.total);
    await t.emitida();
    const anulada = await t.pagar(await t.aprobada(), 1000);
    await t.ir(anulada, { tipo: 'anular' });
    await t.crear();

    const r = t.almacen.listar({ saldoPendiente: true });
    expect(ids(r.cotizaciones)).toEqual(ids([sinPagos, parcial]));
    expect(r.total).toBe(2);
    const fila = r.cotizaciones.find((c) => c.id === parcial.id)!;
    expect(fila).toMatchObject({ pagado: 1000, saldoPendiente: parcial.montos.total - 1000 });
    // Se combina con la búsqueda y con el otro filtro.
    expect(
      t.almacen.listar({ saldoPendiente: true, q: String(parcial.numero) }).cotizaciones.map((c) => c.id),
    ).toEqual([parcial.id]);
    expect(t.almacen.listar({ saldoPendiente: true, vencenPronto: true }).total).toBe(0);
  });
});

describe('4.11 · papelera de borradores', () => {
  it('eliminar un borrador lo deja en la papelera y restaurar_borrador lo devuelve igual', async () => {
    const t = await setup();
    const q = await t.ir(await t.crear(), {
      tipo: 'editar',
      cliente: { telefono: '+56 9 1234 5678' },
      observaciones: 'Obra en Osorno',
    });
    const antes = t.almacen.obtener(q.id)!;
    expect(await t.sobre(q, { tipo: 'eliminar' })).toMatchObject({ eliminada: true });
    expect(t.almacen.obtener(q.id)).toBeNull();
    expect(t.almacen.listar().total).toBe(0);
    expect(t.db.prepare('SELECT tipo, id FROM papelera').all()).toEqual([{ tipo: 'borrador', id: q.id }]);

    // Con otra versión no se restaura.
    await expect(
      t.servicio.ejecutar({ tipo: 'restaurar_borrador', id: q.id, actualizada: '2020-01-01T00:00:00.000Z' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(t.almacen.obtener(q.id)).toBeNull();

    const r = await t.sobre(q, { tipo: 'restaurar_borrador' });
    expect(r.avisos).toEqual([]);
    expect(r.cotizacion).toMatchObject({
      id: q.id,
      estado: 'borrador',
      numero: null,
      cliente: antes.cliente,
      observaciones: 'Obra en Osorno',
      solicitudes: antes.solicitudes,
      montos: antes.montos,
    });
    expect(Date.parse(r.cotizacion.actualizada)).toBeGreaterThan(Date.parse(antes.actualizada));
    expect(t.almacen.obtener(q.id)).toMatchObject({
      id: q.id,
      cliente: antes.cliente,
      solicitudes: antes.solicitudes,
    });
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM papelera').get()).toEqual({ n: 0 });
    expect(t.almacen.eventos(q.id).at(-1)).toMatchObject({
      tipo: 'modificada',
      usuario: 'Paula',
      detalle: 'Borrador restaurado de la papelera',
    });
    // Ya no está en la papelera; el borrador restaurado se usa como cualquier otro.
    await expect(t.sobre(q, { tipo: 'restaurar_borrador' })).rejects.toMatchObject({ status: 404 });
    expect((await t.ir(r.cotizacion, { tipo: 'emitir' })).numero).toBe(323);
  });
});

describe('4.11 · volver a la planilla anterior', () => {
  const planilla = (costoMolco: number, extra: Producto[] = []): Catalogo => ({
    fuente: 'COTIZADOR.xlsx',
    sha256: `planilla-${costoMolco}`,
    fecha: '2026-01-01T00:00:00.000Z',
    productos: [puerta('MOL-O-3-A', 'MOLCO', costoMolco), puerta('RAN-O-3-A', 'RANCO'), ...extra],
  });

  it('restaurarImportacion vuelve el catálogo anterior y rechaza una versión vieja', async () => {
    const { db } = await setup();
    guardarCatalogo(db, planilla(100_000));
    const primera = new RepositorioCatalogoSqlite(db);
    // Sin una importación anterior no hay a qué volver.
    expect(() => primera.restaurarImportacion('principal', primera.version!)).toThrow(
      expect.objectContaining({
        name: 'ErrorUsuarioCatalogo',
        message: expect.stringMatching(/planilla anterior/),
      }),
    );
    expect(new RepositorioCatalogoSqlite(db).metadataOrigen('principal')).toMatchObject({
      sha256: 'planilla-100000',
    });
    const v1 = primera.version!;

    guardarCatalogo(db, planilla(120_000, [puerta('PAN-O-3-A', 'PANGUIPULLI')]));
    const segunda = new RepositorioCatalogoSqlite(db);
    const v2 = segunda.version!;
    expect(segunda.buscarPorCodigo('MOL-O-3-A')?.precioNeto).toBe(120_000);
    // Una vista previa abierta antes de la última importación no puede restaurar.
    expect(() => segunda.restaurarImportacion('principal', v1)).toThrow(
      expect.objectContaining({
        status: 409,
        codigo: 'version_obsoleta',
        message: expect.stringMatching(/cambió/),
      }),
    );
    expect(new RepositorioCatalogoSqlite(db).buscarPorCodigo('MOL-O-3-A')?.precioNeto).toBe(120_000);

    segunda.restaurarImportacion('principal', v2);
    const restaurado = new RepositorioCatalogoSqlite(db);
    expect(restaurado.buscarPorCodigo('MOL-O-3-A')?.precioNeto).toBe(100_000);
    // Vuelve la planilla completa, aunque tenga menos productos que la última (sin el control del 90 %).
    expect(restaurado.buscarPorCodigo('PAN-O-3-A')).toBeFalsy();
    expect(
      restaurado
        .importados('principal')
        .map((p) => p.codigo)
        .sort(),
    ).toEqual(['MOL-O-3-A', 'RAN-O-3-A']);
    expect(restaurado.metadataOrigen('principal')).toMatchObject({
      sha256: 'planilla-100000',
      cantidadProductos: 2,
    });
    expect(restaurado.metadata).toMatchObject({ cantidadProductos: 2 });
    expect(restaurado.version).not.toBe(v2);
    // La versión de antes de restaurar ya quedó vieja.
    expect(() => restaurado.restaurarImportacion('principal', v2)).toThrow(
      expect.objectContaining({ status: 409, codigo: 'version_obsoleta' }),
    );
    expect(new RepositorioCatalogoSqlite(db).buscarPorCodigo('MOL-O-3-A')?.precioNeto).toBe(100_000);
  });
});

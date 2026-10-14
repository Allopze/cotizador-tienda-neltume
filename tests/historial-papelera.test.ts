import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import type { ProductoAdministrable } from '../src/app/contrato';
import { cambiosDe, campos } from '../src/app/gestion-manuales';
import { parametros } from '../src/app/historial';

// Historial → Papelera sobre una base propia, con la sesión simulada.
vi.mock('../src/servidor/acceso-autenticado', () => ({
  exigirSesion: vi.fn(async () => ({
    ok: true,
    usuario: { id: 'u1', email: 'paula@neltume.test', nombre: 'Paula', rol: 'admin' },
  })),
}));
vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const molco: Producto = {
  codigo: 'MOL-O-3-A',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100_000,
  descripcion: 'MOLCO',
  filaOrigen: 4,
};
const catalogo: Catalogo = { fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos: [molco] };
const pedido: SolicitudItem = { modelo: 'MOLCO', madera: 'PINO OREGON', ancho: 0.82, alto: 2, medida: null, cantidad: 2, tipoMedida: 'hoja' };

let directorio: string | undefined;
afterEach(async () => {
  if (directorio) (await import('../src/servidor/almacen')).cerrarAlmacen();
  vi.unstubAllEnvs();
  vi.resetModules();
  if (directorio) await rm(directorio, { recursive: true, force: true });
  directorio = undefined;
});

async function montar() {
  directorio = await mkdtemp(join(tmpdir(), 'neltume-papelera-'));
  vi.stubEnv('NELTUME_DATA_DIR', directorio);
  vi.stubEnv('NELTUME_DB_PATH', join(directorio, 'cotizador.sqlite'));
  const { GET } = await import('../src/app/api/accion/route');
  const { Almacen } = await import('../src/servidor/almacen');
  const { Servicio } = await import('../src/servidor/servicio');
  const almacen = new Almacen();
  const llm = {
    interpretar: vi.fn().mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { items: [pedido], cliente: { ...clienteVacio(), nombre: 'Ana Soto', comuna: 'Osorno' } },
    }),
  };
  const servicio = new Servicio(catalogo, llm, almacen, { nombre: 'Paula', email: 'paula@neltume.test' });
  const papelera = async (consulta = 'papelera=1') => {
    const r = await GET(new Request(`http://127.0.0.1:3000/api/accion?${consulta}`));
    return { status: r.status, cuerpo: await r.json(), cache: r.headers.get('cache-control') };
  };
  return { almacen, servicio, papelera };
}

describe('Historial → Papelera', () => {
  it('lista los borradores eliminados con cliente e ítems, y al restaurarlos salen de la papelera', async () => {
    const m = await montar();
    const q = (await m.servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza 2 MOLCO para Ana Soto' })).cotizacion;
    expect((await m.papelera()).cuerpo).toEqual({ borradores: [] });
    await m.servicio.ejecutar({ tipo: 'eliminar', id: q.id, actualizada: q.actualizada });

    const r = await m.papelera();
    expect(r.status).toBe(200);
    expect(r.cache).toBe('no-store');
    expect(r.cuerpo.borradores).toEqual([
      {
        id: q.id,
        actualizada: q.actualizada,
        eliminada: expect.any(String),
        creada: q.creada,
        creadaPor: 'Paula',
        cliente: { nombre: 'Ana Soto', comuna: 'Osorno', proyecto: null },
        items: 1,
        productos: '2 × MOLCO PINO OREGON',
        origen: null,
        total: q.montos.total,
      },
    ]);
    // Una entrada ilegible no se puede restaurar: no se lista.
    m.almacen
      .baseDatos()
      .prepare("INSERT INTO papelera VALUES ('borrador', 'roto', '{no es json', ?)")
      .run(new Date().toISOString());
    expect((await m.papelera()).cuerpo.borradores.map((b: { id: string }) => b.id)).toEqual([q.id]);

    const [b] = r.cuerpo.borradores;
    const restaurada = await m.servicio.ejecutar({ tipo: 'restaurar_borrador', id: b.id, actualizada: b.actualizada });
    expect(restaurada.cotizacion.cliente.nombre).toBe('Ana Soto');
    expect((await m.papelera()).cuerpo.borradores).toEqual([]);
    expect(m.almacen.listar().cotizaciones.map((c) => c.id)).toEqual([q.id]);
  });

  it('un valor distinto de papelera=1 es una solicitud inválida', async () => {
    const m = await montar();
    expect(await m.papelera('papelera=si')).toMatchObject({ status: 400, cuerpo: { codigo: 'solicitud_invalida' } });
  });
});

describe('filtros del historial', () => {
  const filtros = { q: '', desde: '', hasta: '' };
  it('«Vencen pronto» y «Con saldo pendiente» piden sus filtros al servidor; la papelera no filtra el listado', () => {
    expect(parametros({ ...filtros, estado: 'vencen' }).toString()).toBe('vencenPronto=true');
    expect(parametros({ ...filtros, estado: 'saldo' }).toString()).toBe('saldoPendiente=true');
    expect(parametros({ ...filtros, estado: 'emitida', q: 'N° 323' }).toString()).toBe('q=323&estado=emitida');
    expect(parametros({ ...filtros, estado: 'papelera' }).toString()).toBe('');
    expect(parametros({ ...filtros, estado: 'todas' }).toString()).toBe('');
  });
});

describe('Gestionar → Editar: largo según la familia', () => {
  const puerta: ProductoAdministrable = { ...molco, fuente: 'planilla', creada: null, creadaPor: null, actualizada: null };
  const moldura: ProductoAdministrable = {
    ...puerta,
    codigo: 'GUAR-O',
    modelo: 'GUARDAPOLVO',
    familia: 'MOLDURA',
    medida: '1X3',
    anchoMin: null,
    anchoMax: null,
    largo: 3.2,
  };

  it('una puerta acepta hasta 3 m de alto y un accesorio hasta 6 m de largo, como el servidor', () => {
    expect(cambiosDe(puerta, { ...campos(puerta), largo: '4' }).errores.largo).toBe('El alto debe estar entre 0,3 y 3 m.');
    expect(cambiosDe(puerta, { ...campos(puerta), largo: '3,5' }).errores.largo).toBe('El alto debe estar entre 0,3 y 3 m.');
    expect(cambiosDe(puerta, { ...campos(puerta), largo: '2,4' }).cambios).toEqual({ largo: 2.4 });
    // En centímetros, como en el alta.
    expect(cambiosDe(puerta, { ...campos(puerta), largo: '240' }).cambios).toEqual({ largo: 2.4 });
    expect(cambiosDe(moldura, { ...campos(moldura), largo: '5,5' }).cambios).toEqual({ largo: 5.5 });
    expect(cambiosDe(moldura, { ...campos(moldura), largo: '7' }).errores.largo).toBe(
      'El largo debe estar entre 0,3 y 6 m.',
    );
    // Pasar a puerta un accesorio de 3,2 m deja el largo fuera de rango: se avisa antes de enviarlo.
    expect(cambiosDe(moldura, { ...campos(moldura), familia: 'PUERTA' }).errores.largo).toBe(
      'El alto debe estar entre 0,3 y 3 m.',
    );
  });

  it('un producto de la planilla fuera de rango se puede corregir en lo demás sin tocar su largo', () => {
    const largo = { ...puerta, largo: 3.4 };
    expect(cambiosDe(largo, { ...campos(largo), precio: '120.000' })).toEqual({
      cambios: { precioNeto: 120000 },
      errores: {},
    });
  });
});

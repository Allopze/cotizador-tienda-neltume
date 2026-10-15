import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import type { Cotizacion } from '../src/negocio/estado';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import {
  configuracionNegocioPredeterminada,
  configuracionNegocioSchema,
  guardarConfiguracionNegocio,
  leerConfiguracionNegocio,
} from '../src/servidor/configuracion-negocio';
import { guardarCatalogo, RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { Servicio } from '../src/servidor/servicio';

// Plan de trabajo, fase 1 (docs/revision-2026-10-11.md §4): tareas 1.4, 1.5 y 1.6 sobre el servicio y una
// SQLite temporal. La 1.2 (clave de IA ilegible) se prueba por la ruta en plan-rutas.test.ts.

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
/** La planilla con el costo de MOLCO que se indique; cada costo es una importación distinta. */
const planilla = (costoMolco: number): Catalogo => ({
  fuente: 'COTIZADOR.xlsx',
  sha256: `planilla-${costoMolco}`,
  fecha: '2026-01-01T00:00:00.000Z',
  productos: [puerta('MOL-O-3-A', 'MOLCO', costoMolco), puerta('RAN-O-3-A', 'RANCO')],
});
const item = (modelo: string, cantidad = 2): SolicitudItem => ({
  modelo,
  madera: 'PINO OREGON',
  ancho: 0.82,
  alto: 2,
  medida: null,
  cantidad,
  tipoMedida: 'hoja',
});
const respuesta = (items: SolicitudItem[]) => ({
  name: 'actualizar_cotizacion',
  input: { items, cliente: clienteVacio() },
});

const dirs: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

async function setup(items: SolicitudItem[] = [item('MOLCO'), item('RANCO')]) {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-plan-fase1-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const db = almacen.baseDatos();
  guardarCatalogo(db, planilla(100_000));
  const llm = { interpretar: vi.fn().mockResolvedValue(respuesta(items)) };
  /** Como en cada petición: el servicio recibe el catálogo vigente de la base. */
  const servicio = () =>
    new Servicio(new RepositorioCatalogoSqlite(db), llm, almacen, {
      nombre: 'Paula',
      email: 'paula@neltume.cl',
    });
  const conPedido = async () => (await servicio().ejecutar({ tipo: 'chat', mensaje: 'cotiza' })).cotizacion;
  const accion = (q: Pick<Cotizacion, 'id' | 'actualizada'>, extra: Record<string, unknown>) =>
    servicio().ejecutar({ ...extra, id: q.id, actualizada: q.actualizada } as never);
  return { dir, almacen, db, llm, servicio, conPedido, accion };
}

describe('1.4 · descuento máximo de Ajustes acotado a 50 %', () => {
  const conMaximo = (
    descuentoMaximo: number,
    tramos: { desdePuertas: number; porcentaje: number }[] = [],
  ) => {
    const base = configuracionNegocioPredeterminada();
    return { ...base, reglas: { ...base.reglas, descuentoMaximo, descuentosPorCantidad: tramos } };
  };

  it('guardar una configuración con descuentoMaximo 60 se rechaza y no escribe nada', async () => {
    const { db } = await setup();
    expect(configuracionNegocioSchema.safeParse(conMaximo(60)).success).toBe(false);
    expect(() => guardarConfiguracionNegocio(conMaximo(60), db)).toThrow();
    expect(db.prepare("SELECT 1 FROM ajustes WHERE clave = 'negocio'").get()).toBeUndefined();
    // 50 sigue siendo válido.
    expect(guardarConfiguracionNegocio(conMaximo(50), db).reglas.descuentoMaximo).toBe(50);
  });

  it('una configuración guardada con 60 se lee recortada a 50 junto con sus tramos, sin perder el resto', async () => {
    const { db, conPedido, accion, llm } = await setup();
    const base = configuracionNegocioPredeterminada();
    const guardada = {
      ...base,
      transportistas: ['Starken', 'Camión de Juan'],
      reglas: {
        ...base.reglas,
        vigenciaDiasHabiles: 15,
        descuentoMaximo: 60,
        descuentosPorCantidad: [
          { desdePuertas: 20, porcentaje: 55 },
          { desdePuertas: 10, porcentaje: 20 },
        ],
      },
    };
    // Así quedó en la base antes del arreglo: Ajustes permitía hasta 100 %.
    db.prepare("INSERT INTO ajustes (clave, valor_json, actualizada) VALUES ('negocio', ?, ?)").run(
      JSON.stringify(guardada),
      new Date().toISOString(),
    );
    const leida = leerConfiguracionNegocio(db);
    expect(leida.reglas.descuentoMaximo).toBe(50);
    expect(leida.reglas.descuentosPorCantidad).toEqual([
      { desdePuertas: 10, porcentaje: 20 },
      { desdePuertas: 20, porcentaje: 50 },
    ]);
    // No es el valor por omisión: lo demás de la fila se conserva.
    expect(leida.reglas.vigenciaDiasHabiles).toBe(15);
    expect(leida.transportistas).toEqual(['Starken', 'Camión de Juan']);

    // Una cotización nueva congela el máximo recortado: 55 % se rechaza con un mensaje y no con un 500 de SQLite.
    const q = await conPedido();
    expect(q.reglas).toMatchObject({ descuentoMaximo: 50 });
    await expect(accion(q, { tipo: 'editar', descuento: 55 })).rejects.toMatchObject({
      name: 'ErrorUsuario',
      status: 400,
      message: expect.stringContaining('entre 0 % y 50 %'),
    });
    // El tramo de 55 % se aplica como 50 % y se guarda.
    llm.interpretar.mockResolvedValueOnce(respuesta([item('MOLCO', 25)]));
    const grande = await conPedido();
    expect(grande.descuento).toBe(50);
  });

  it('un borrador que congeló un máximo de 60 % no revienta al guardar un descuento de 55 %', async () => {
    const { almacen, db, conPedido, accion } = await setup();
    let q = await conPedido();
    // Reglas congeladas antes del arreglo, con el máximo y un tramo por encima del CHECK de la base.
    db.prepare('UPDATE cotizaciones SET reglas_json = ? WHERE id = ?').run(
      JSON.stringify({
        ...q.reglas,
        descuentoMaximo: 60,
        descuentosPorCantidad: [{ desdePuertas: 10, porcentaje: 55 }],
      }),
      q.id,
    );
    q = almacen.obtener(q.id)!;
    expect(q.reglas?.descuentoMaximo).toBe(60);
    const r = await accion(q, { tipo: 'editar', descuento: 55 });
    expect(r.cotizacion).toMatchObject({ descuento: 50, reglas: { descuentoMaximo: 50 } });
    expect(r.cotizacion.reglas?.descuentosPorCantidad).toEqual([{ desdePuertas: 10, porcentaje: 50 }]);
    expect(r.avisos).toEqual(
      expect.arrayContaining([
        'El descuento máximo del borrador se ajustó a 50 %.',
        'Descuento 55 % → 50 % por el máximo permitido.',
      ]),
    );
    expect(almacen.obtener(q.id)).toMatchObject({ descuento: 50, reglas: { descuentoMaximo: 50 } });
  });
});

describe('1.5 · precio escrito fuera de rango tras reimportar la planilla', () => {
  const PREGUNTA =
    'El precio $55.000 queda fuera del rango permitido (−50 % a 500 % sobre el costo $120.000). Corrígelo o quita el ítem.';

  /** Borrador con MOLCO a $55.000 escrito a mano (−45 % sobre $100.000) y la planilla reimportada con costo $120.000. */
  async function reimportado() {
    const t = await setup();
    let q = await t.conPedido();
    q = (await t.accion(q, { tipo: 'editar', items: [{ indice: 0, cambios: { precioUnitario: 55_000 } }] }))
      .cotizacion;
    expect(q.incompletos).toEqual([]);
    expect(q.montos.lineas.map((l) => [l.producto.codigo, l.precioUnitario])).toEqual([
      ['MOL-O-3-A', 55_000],
      ['RAN-O-3-A', expect.any(Number)],
    ]);
    guardarCatalogo(t.db, planilla(120_000));
    return { ...t, q };
  }

  it('el ítem queda pendiente con la pregunta, y editar el cliente y quitar otro ítem siguen funcionando', async () => {
    const t = await reimportado();
    const conCliente = await t.accion(t.q, { tipo: 'editar', cliente: { nombre: 'Ana Soto' } });
    expect(conCliente.cotizacion.cliente.nombre).toBe('Ana Soto');
    expect(conCliente.cotizacion.incompletos).toEqual([
      {
        indice: 0,
        rechazo: { tipo: 'faltan_datos', campos: ['precio'], disponibles: {} },
        pregunta: PREGUNTA,
      },
    ]);
    expect(conCliente.cotizacion.montos.lineas.map((l) => l.producto.codigo)).toEqual(['RAN-O-3-A']);

    const quitada = (await t.accion(conCliente.cotizacion, { tipo: 'quitar', indice: 1 })).cotizacion;
    expect(quitada.solicitudes.map((s) => s.modelo)).toEqual(['MOLCO']);
    expect(quitada.incompletos).toMatchObject([{ indice: 0, pregunta: PREGUNTA }]);
    expect(quitada.montos.lineas).toEqual([]);
    expect(t.almacen.obtener(t.q.id)).toMatchObject({
      solicitudes: [{ modelo: 'MOLCO', precioUnitario: 55_000 }],
    });
    // Sigue sin poder emitirse hasta corregir el precio; corregido, se cotiza.
    await expect(t.accion(quitada, { tipo: 'emitir' })).rejects.toThrow(/pendientes/);
    const corregida = (
      await t.accion(quitada, {
        tipo: 'editar',
        items: [{ indice: 0, cambios: { precioUnitario: 130_000 } }],
      })
    ).cotizacion;
    expect(corregida.incompletos).toEqual([]);
    expect(corregida.montos.lineas.map((l) => l.precioUnitario)).toEqual([130_000]);
  });

  it('lo mismo al deshacer con restaurar_items, también con un descuento en monto mayor que el precio', async () => {
    const t = await reimportado();
    const items = structuredClone(t.q.solicitudes);
    const restaurada = await t.accion(t.q, { tipo: 'restaurar_items', items });
    expect(restaurada.cotizacion.incompletos).toMatchObject([{ indice: 0, pregunta: PREGUNTA }]);
    expect(restaurada.cotizacion.montos.lineas.map((l) => l.producto.codigo)).toEqual(['RAN-O-3-A']);
    // Un descuento por ítem en monto mayor que su precio tampoco deja la línea en $0: queda pendiente.
    const conDescuento = items.map((s, i) =>
      i === 1 ? { ...s, descuento: { tipo: 'monto' as const, valor: 9_999_999 } } : s,
    );
    const r = await t.accion(restaurada.cotizacion, { tipo: 'restaurar_items', items: conDescuento });
    expect(r.cotizacion.incompletos.map((p) => p.indice)).toEqual([0, 1]);
    expect(r.cotizacion.incompletos[1].pregunta).toMatch(/descuento del ítem 2 .*supera su precio unitario/);
    expect(r.cotizacion.montos.lineas).toEqual([]);
    expect(t.almacen.obtener(t.q.id)!.incompletos.map((p) => p.indice)).toEqual([0, 1]);
  });
});

describe('1.6 · duplicar con un descuento mayor al máximo vigente', () => {
  it('la copia recorta el descuento manual al máximo actual y lo avisa; la original no cambia', async () => {
    const { almacen, db, conPedido, accion, servicio } = await setup();
    const origen = (await accion(await conPedido(), { tipo: 'editar', descuento: 40 })).cotizacion;
    expect([origen.descuento, origen.descuentoManual]).toEqual([40, true]);
    const base = configuracionNegocioPredeterminada();
    guardarConfiguracionNegocio({ ...base, reglas: { ...base.reglas, descuentoMaximo: 30 } }, db);

    const r = await servicio().ejecutar({ tipo: 'duplicar', id: origen.id });
    expect(r.cotizacion.id).not.toBe(origen.id);
    expect(r.cotizacion).toMatchObject({
      descuento: 30,
      descuentoManual: true,
      reglas: { descuentoMaximo: 30 },
    });
    expect(r.avisos).toEqual(expect.arrayContaining([expect.stringMatching(/^Descuento 40 % → 30 %/)]));
    expect(r.cotizacion.montos.descuento).toBeGreaterThan(0);
    expect(almacen.obtener(r.cotizacion.id)).toMatchObject({ descuento: 30 });
    expect(almacen.obtener(origen.id)).toMatchObject({ descuento: 40 });
    // Dentro del máximo, la copia conserva el descuento sin avisos de descuento.
    const dentro = (await accion(await conPedido(), { tipo: 'editar', descuento: 20 })).cotizacion;
    const copia = await servicio().ejecutar({ tipo: 'duplicar', id: dentro.id });
    expect(copia.cotizacion.descuento).toBe(20);
    expect(copia.avisos ?? []).not.toEqual(expect.arrayContaining([expect.stringMatching(/^Descuento /)]));
  });
});

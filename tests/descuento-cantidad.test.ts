import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { contextoSeguro } from '../src/asistente/llm';
import { Totales } from '../src/app/panel-totales';
import { resumenTexto } from '../src/app/formato';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import {
  contarPuertas,
  descuentoAutomatico,
  descuentoEsManual,
  errorTramos,
  etiquetaDescuento,
  problemaTramos,
  siguienteTramo,
  tramoAplicable,
} from '../src/negocio/descuento-cantidad';
import type { Cotizacion } from '../src/negocio/estado';
import { REGLAS, type TramoDescuento } from '../src/negocio/precios';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { abrirBaseDatos, VERSION_ESQUEMA } from '../src/servidor/base-datos';
import {
  configuracionNegocioPredeterminada,
  configuracionNegocioSchema,
  guardarConfiguracionNegocio,
  leerConfiguracionNegocio,
} from '../src/servidor/configuracion-negocio';
import { ErrorUsuario } from '../src/servidor/errores';
import { completarEstadoLegado } from '../src/servidor/persistencia-esquemas';
import { plantilla } from '../src/servidor/pdf';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const producto = (p: Partial<Producto> = {}): Producto => ({
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
  ...p,
});
const accesorio = (familia: Producto['familia'], modelo: string, medida: string, codigo: string): Producto =>
  producto({
    codigo,
    modelo,
    familia,
    tipo: null,
    medida,
    anchoMin: null,
    anchoMax: null,
    largo: 2.1,
    precioNeto: 20_000,
    descripcion: modelo,
  });
const catalogo = (): Catalogo => ({
  fuente: 'test',
  sha256: 'descuento-cantidad',
  fecha: '2026-01-01',
  productos: [
    producto(),
    accesorio('MARCO', 'MARCO', '2X4', 'MAR-O-2X4-B'),
    accesorio('PIEZAS_T', 'PIEZAS T', '2X4', 'PT-O-2X4-B'),
    accesorio('MOLDURA', 'ENDOLADO', '6X1', 'ENDO-O-6X1-B'),
  ],
});
const puertas = (cantidad: number | null): SolicitudItem => ({
  modelo: 'MOLCO',
  madera: 'PINO OREGON',
  ancho: 0.82,
  alto: 2,
  medida: null,
  cantidad,
});
const marcos = (cantidad: number): SolicitudItem => ({
  modelo: 'MARCO',
  madera: 'PINO OREGON',
  ancho: null,
  alto: 2.1,
  medida: '2x4',
  cantidad,
});
const piezasT = (cantidad: number): SolicitudItem => ({
  modelo: 'PIEZAS T',
  madera: 'PINO OREGON',
  ancho: null,
  alto: 2.1,
  medida: '2x4',
  cantidad,
});
const molduras = (cantidad: number): SolicitudItem => ({
  modelo: 'ENDOLADO',
  madera: 'PINO OREGON',
  ancho: null,
  alto: 2.1,
  medida: '6x1',
  cantidad,
});
/** Un modelo que el catálogo no conoce: queda pendiente y no tiene línea valorizada. */
const pendiente = (cantidad: number): SolicitudItem => ({
  modelo: 'Inexistente',
  madera: 'PINO OREGON',
  ancho: 0.82,
  alto: 2,
  medida: null,
  cantidad,
});
const actualizar = (items: SolicitudItem[]) => ({
  name: 'actualizar_cotizacion',
  input: { items, cliente: clienteVacio() },
});

const TRAMOS: TramoDescuento[] = [
  { desdePuertas: 10, porcentaje: 5 },
  { desdePuertas: 20, porcentaje: 10 },
];
const dirs: string[] = [];

async function setup(tramos: TramoDescuento[] | null = TRAMOS) {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-descuento-cantidad-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const llm = { interpretar: vi.fn().mockResolvedValue(actualizar([puertas(3)])) };
  const servicio = new Servicio(catalogo(), llm, almacen, { nombre: 'Paula', email: 'paula@neltume.cl' });
  const configurar = (nuevos: TramoDescuento[], extra: Record<string, number> = {}) => {
    const db = almacen.baseDatos();
    const actual = leerConfiguracionNegocio(db);
    guardarConfiguracionNegocio(
      { ...actual, reglas: { ...actual.reglas, ...extra, descuentosPorCantidad: nuevos } },
      db,
    );
  };
  if (tramos) configurar(tramos);
  /** Borrador nuevo con ese pedido, como si la persona lo escribiera en el chat. */
  const conPedido = async (items: SolicitudItem[]) => {
    llm.interpretar.mockResolvedValueOnce(actualizar(items));
    return (await servicio.ejecutar({ tipo: 'chat', mensaje: 'Cotiza' })).cotizacion;
  };
  /** Nuevo pedido completo sobre la misma cotización (la IA devuelve la lista entera). */
  const cambiarPedido = async (q: Cotizacion, items: SolicitudItem[]) => {
    llm.interpretar.mockResolvedValueOnce(actualizar(items));
    return (await servicio.ejecutar({ tipo: 'chat', id: q.id, actualizada: q.actualizada, mensaje: 'Ahora' }))
      .cotizacion;
  };
  const editar = async (q: Cotizacion, cambios: Record<string, unknown>) =>
    (await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, ...cambios } as never))
      .cotizacion;
  const detalles = (q: Cotizacion) => almacen.eventos(q.id).map((e) => e.detalle ?? '');
  const ultimo = (q: Cotizacion) => detalles(q).at(-1) ?? '';
  const emitida = async (items: SolicitudItem[]) => {
    const q = await conPedido(items);
    return (await servicio.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada })).cotizacion;
  };
  return {
    dir,
    almacen,
    llm,
    servicio,
    configurar,
    conPedido,
    cambiarPedido,
    editar,
    detalles,
    ultimo,
    emitida,
  };
}
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

describe('selección del tramo', () => {
  const desordenados: TramoDescuento[] = [
    { desdePuertas: 20, porcentaje: 10 },
    { desdePuertas: 10, porcentaje: 5 },
  ];
  it('bajo el primer tramo no hay descuento; en el umbral exacto, entre tramos y sobre el último rige el mayor alcanzado', () => {
    const pct = (n: number) => tramoAplicable(desordenados, n)?.porcentaje ?? 0;
    expect([0, 1, 9].map(pct)).toEqual([0, 0, 0]);
    expect([10, 11, 19].map(pct)).toEqual([5, 5, 5]);
    expect([20, 21, 100].map(pct)).toEqual([10, 10, 10]);
    expect(tramoAplicable(undefined, 50)).toBeNull();
    expect(tramoAplicable([], 50)).toBeNull();
  });

  it('el siguiente tramo es el menor umbral todavía no alcanzado', () => {
    expect(siguienteTramo(desordenados, 3)).toEqual({ desdePuertas: 10, porcentaje: 5 });
    expect(siguienteTramo(desordenados, 10)).toEqual({ desdePuertas: 20, porcentaje: 10 });
    expect(siguienteTramo(desordenados, 19)).toEqual({ desdePuertas: 20, porcentaje: 10 });
    expect(siguienteTramo(desordenados, 20)).toBeNull();
    expect(siguienteTramo(undefined, 1)).toBeNull();
  });

  it('solo cuentan las puertas: marcos, molduras y piezas T no', () => {
    const linea = (familia: Producto['familia'], cantidad: number) => ({ producto: { familia }, cantidad });
    expect(
      contarPuertas([
        linea('PUERTA', 4),
        linea('MARCO', 50),
        linea('PUERTA', 6),
        linea('MOLDURA', 30),
        linea('PIEZAS_T', 30),
      ]),
    ).toBe(10);
    expect(contarPuertas([])).toBe(0);
  });

  it('el porcentaje automático nunca pasa del descuento máximo de las reglas', () => {
    expect(descuentoAutomatico({ descuentoMaximo: 50, descuentosPorCantidad: TRAMOS }, 25)).toBe(10);
    expect(descuentoAutomatico({ descuentoMaximo: 8, descuentosPorCantidad: TRAMOS }, 25)).toBe(8);
    expect(descuentoAutomatico({ descuentoMaximo: 50 }, 25)).toBe(0);
  });

  it('el nombre del descuento en los documentos depende de quién lo fijó', () => {
    const reglas = { ...REGLAS, descuentosPorCantidad: TRAMOS };
    expect(etiquetaDescuento({ reglas })).toBe('Descuento por cantidad');
    expect(etiquetaDescuento({ reglas, descuentoManual: false })).toBe('Descuento por cantidad');
    expect(etiquetaDescuento({ reglas, descuentoManual: true })).toBe('Descuento');
    expect(etiquetaDescuento({ reglas: { ...REGLAS, descuentosPorCantidad: [] } })).toBe('Descuento');
    expect(etiquetaDescuento({ reglas: REGLAS })).toBe('Descuento');
    expect(etiquetaDescuento({})).toBe('Descuento');
    // En la caja de totales del PDF va la versión corta.
    expect(etiquetaDescuento({ reglas }, { corta: true })).toBe('Desc. por cantidad');
    expect(etiquetaDescuento({ reglas, descuentoManual: true }, { corta: true })).toBe('Descuento');
  });

  it('sin el dato de quién lo fijó, un descuento que ya existía es manual: una sola regla para todos', () => {
    expect(descuentoEsManual({ descuento: 7 })).toBe(true);
    expect(descuentoEsManual({ descuento: 0 })).toBe(false);
    expect(descuentoEsManual({})).toBe(false);
    expect(descuentoEsManual({ descuento: 7, descuentoManual: false })).toBe(false);
    expect(descuentoEsManual({ descuento: 0, descuentoManual: true })).toBe(true);
    // Y la etiqueta la respeta: un descuento antiguo con tramos hoy configurados no es «por cantidad».
    const reglas = { ...REGLAS, descuentosPorCantidad: TRAMOS };
    expect(etiquetaDescuento({ reglas, descuento: 7 })).toBe('Descuento');
  });
});

describe('configuración de los tramos', () => {
  const config = (tramos: unknown, descuentoMaximo = 50) => {
    const base = configuracionNegocioPredeterminada();
    return { ...base, reglas: { ...base.reglas, descuentoMaximo, descuentosPorCantidad: tramos } };
  };
  const mensaje = (tramos: unknown, maximo?: number) => {
    const r = configuracionNegocioSchema.safeParse(config(tramos, maximo));
    return r.success ? null : r.error.issues[0].message;
  };

  it('sin tramos por omisión: no se inventan valores', () => {
    expect(configuracionNegocioPredeterminada().reglas.descuentosPorCantidad).toEqual([]);
    const sinTramos: Record<string, unknown> = { ...config([]).reglas };
    delete sinTramos.descuentosPorCantidad;
    const r = configuracionNegocioSchema.parse({ ...config([]), reglas: sinTramos });
    expect(r.reglas.descuentosPorCantidad).toEqual([]);
  });

  it('se guardan de menor a mayor umbral', () => {
    const r = configuracionNegocioSchema.parse(
      config([
        { desdePuertas: 20, porcentaje: 10 },
        { desdePuertas: 10, porcentaje: 5.25 },
      ]),
    );
    expect(r.reglas.descuentosPorCantidad).toEqual([
      { desdePuertas: 10, porcentaje: 5.25 },
      { desdePuertas: 20, porcentaje: 10 },
    ]);
  });

  it('valida umbral entero de 2 o más, porcentaje mayor que 0 con dos decimales hasta el máximo y umbrales distintos', () => {
    expect(mensaje([{ desdePuertas: 1, porcentaje: 5 }])).toContain('de 2 a');
    expect(mensaje([{ desdePuertas: 2.5, porcentaje: 5 }])).toContain('número entero');
    expect(mensaje([{ desdePuertas: 10, porcentaje: 0 }])).toBe(
      'El porcentaje del tramo «desde 10 puertas» debe ser mayor que 0.',
    );
    expect(mensaje([{ desdePuertas: 10, porcentaje: -3 }])).toContain('mayor que 0');
    expect(mensaje([{ desdePuertas: 10, porcentaje: 5.123 }])).toContain('dos decimales');
    expect(mensaje([{ desdePuertas: 10, porcentaje: 51 }])).toBe(
      'El porcentaje del tramo «desde 10 puertas» no puede superar el descuento máximo (50 %).',
    );
    expect(mensaje([{ desdePuertas: 10, porcentaje: 25 }], 20)).toContain('descuento máximo (20 %)');
    expect(
      mensaje([
        { desdePuertas: 10, porcentaje: 5 },
        { desdePuertas: 10, porcentaje: 8 },
      ]),
    ).toBe('Hay más de un tramo «desde 10 puertas»: cada umbral debe ser distinto.');
    expect(mensaje([{ desdePuertas: 10, porcentaje: 'x' }])).toContain('porcentaje');
    expect(mensaje(Array.from({ length: 11 }, (_, i) => ({ desdePuertas: i + 2, porcentaje: 1 })))).toContain(
      'hasta 10',
    );
    expect(mensaje([{ desdePuertas: 10, porcentaje: 50 }])).toBeNull();
    // La misma validación corre en la pantalla de Ajustes antes de enviar.
    expect(errorTramos([{ desdePuertas: Number.NaN, porcentaje: 5 }], 50)).toBe(
      'Completa «Desde» y el porcentaje de cada tramo.',
    );
    expect(errorTramos(TRAMOS, 50)).toBeNull();
  });

  it('indica la fila y el campo con el problema, para marcarlos en la pantalla', () => {
    const fila = (desdePuertas: number, porcentaje: number) => ({ desdePuertas, porcentaje });
    expect(problemaTramos([fila(10, 5), fila(Number.NaN, 5)], 50)).toMatchObject({
      indice: 1,
      campo: 'desdePuertas',
    });
    expect(problemaTramos([fila(10, 5), fila(20, Number.NaN)], 50)).toMatchObject({
      indice: 1,
      campo: 'porcentaje',
    });
    expect(problemaTramos([fila(10, 5), fila(20, 60)], 50)).toMatchObject({ indice: 1, campo: 'porcentaje' });
    expect(problemaTramos([fila(10, 5), fila(10, 8)], 50)).toMatchObject({
      indice: 1,
      campo: 'desdePuertas',
    });
    expect(problemaTramos([fila(10, 5)], 50)).toBeNull();
    expect(
      problemaTramos(
        Array.from({ length: 11 }, (_, i) => fila(i + 2, 1)),
        50,
      )?.indice,
    ).toBeUndefined();
  });

  it('se guarda y se lee; una configuración guardada antes de esta regla carga sin tramos', async () => {
    const { almacen, configurar } = await setup(null);
    const db = almacen.baseDatos();
    configurar([
      { desdePuertas: 20, porcentaje: 10 },
      { desdePuertas: 10, porcentaje: 5 },
    ]);
    expect(leerConfiguracionNegocio(db).reglas.descuentosPorCantidad).toEqual(TRAMOS);
    // Como la guardaba la versión anterior: reglas sin el campo.
    const guardada = JSON.parse(
      (db.prepare("SELECT valor_json FROM ajustes WHERE clave = 'negocio'").get() as { valor_json: string })
        .valor_json,
    );
    delete guardada.reglas.descuentosPorCantidad;
    db.prepare("UPDATE ajustes SET valor_json = ? WHERE clave = 'negocio'").run(JSON.stringify(guardada));
    expect(leerConfiguracionNegocio(db).reglas.descuentosPorCantidad).toEqual([]);
  });

  it('una configuración con tramos que superan el máximo no se guarda', async () => {
    const { almacen } = await setup(null);
    expect(() =>
      guardarConfiguracionNegocio(
        config([{ desdePuertas: 10, porcentaje: 30 }], 20) as never,
        almacen.baseDatos(),
      ),
    ).toThrow(/descuento máximo/);
  });
});

describe('descuento automático en la cotización', () => {
  it('sin tramos configurados nada cambia: sin descuento por más puertas que haya', async () => {
    const { conPedido } = await setup(null);
    const q = await conPedido([puertas(50)]);
    expect([q.descuento, q.descuentoManual, q.montos.descuento]).toEqual([0, false, 0]);
    expect(q.reglas!.descuentosPorCantidad).toEqual([]);
  });

  it('por el chat: bajo el primer tramo no hay descuento y al agregar puertas se aplica y queda explicado en la actividad', async () => {
    const { conPedido, cambiarPedido, ultimo, detalles } = await setup();
    let q = await conPedido([puertas(9)]);
    expect([q.descuento, q.descuentoManual, q.montos.descuento]).toEqual([0, false, 0]);
    expect(detalles(q).at(-1)).not.toContain('Descuento');
    q = await cambiarPedido(q, [puertas(10)]);
    expect(q.descuento).toBe(5);
    expect(q.descuentoManual).toBe(false);
    // 10 × (100.000 + 85 %) = 1.850.000; 5 % = 92.500.
    expect([q.montos.subtotal, q.montos.descuentoPorcentaje, q.montos.descuento, q.montos.neto]).toEqual([
      1_850_000, 5, 92_500, 1_757_500,
    ]);
    expect(ultimo(q)).toContain('Descuento por cantidad 0 % → 5 % (10 puertas)');
    q = await cambiarPedido(q, [puertas(19)]);
    expect(q.descuento).toBe(5);
    expect(ultimo(q)).not.toContain('Descuento');
    q = await cambiarPedido(q, [puertas(20)]);
    expect(q.descuento).toBe(10);
    expect(ultimo(q)).toContain('Descuento por cantidad 5 % → 10 % (20 puertas)');
    q = await cambiarPedido(q, [puertas(4)]);
    expect(q.descuento).toBe(0);
    expect(ultimo(q)).toContain('Descuento por cantidad 10 % → 0 % (4 puertas)');
  });

  it('un borrador que nace con el pedido ya completo registra el descuento en su creación', async () => {
    const { conPedido, almacen } = await setup();
    const q = await conPedido([puertas(12)]);
    expect(q.descuento).toBe(5);
    expect(almacen.eventos(q.id).find((e) => e.tipo === 'creada')!.detalle).toContain(
      'Descuento por cantidad 0 % → 5 % (12 puertas)',
    );
  });

  it('solo cuentan las puertas valorizadas: ni marcos, molduras y piezas T, ni los ítems pendientes', async () => {
    const { conPedido, cambiarPedido } = await setup();
    let q = await conPedido([puertas(9), marcos(30), piezasT(30), molduras(30), pendiente(5)]);
    expect(q.montos.lineas).toHaveLength(4);
    expect(q.incompletos).toHaveLength(1);
    expect(contarPuertas(q.montos.lineas)).toBe(9);
    expect(q.descuento).toBe(0);
    // Una puerta más alcanza el umbral; los accesorios y lo pendiente no aportan ni quitan.
    q = await cambiarPedido(q, [puertas(10), marcos(1), pendiente(50)]);
    expect(contarPuertas(q.montos.lineas)).toBe(10);
    expect(q.descuento).toBe(5);
    // Las puertas de varias líneas suman.
    q = await cambiarPedido(q, [puertas(6), { ...puertas(4), ancho: 0.83 }, marcos(99)]);
    expect(contarPuertas(q.montos.lineas)).toBe(10);
    expect(q.descuento).toBe(5);
    // Una línea pendiente con cantidad de puertas no cuenta hasta que se resuelve.
    q = await cambiarPedido(q, [puertas(5), pendiente(100)]);
    expect(q.descuento).toBe(0);
  });

  it('editar cantidades y quitar líneas recalculan el descuento automático y lo registran', async () => {
    const { conPedido, editar, servicio, ultimo } = await setup();
    let q = await conPedido([puertas(3), marcos(2)]);
    expect(q.descuento).toBe(0);
    q = await editar(q, { cantidades: [{ indice: 0, cantidad: 10 }] });
    expect(q.descuento).toBe(5);
    expect(q.descuentoManual).toBe(false);
    expect(ultimo(q)).toContain('Descuento por cantidad 0 % → 5 % (10 puertas)');
    // Los totales salen del mismo descuento: subtotal de puertas y marcos menos el 5 %.
    expect(q.montos.descuentoPorcentaje).toBe(5);
    expect(q.montos.descuento).toBe(Math.round((q.montos.subtotal * 5) / 100));
    // Cambiar solo el flete no toca el descuento ni deja ruido.
    q = await editar(q, { flete: 10_000 });
    expect(q.descuento).toBe(5);
    expect(ultimo(q)).toBe('Flete $0 → $10.000');
    const r = await servicio.ejecutar({ tipo: 'quitar', id: q.id, actualizada: q.actualizada, indice: 0 });
    expect(r.cotizacion.descuento).toBe(0);
    expect(r.cotizacion.montos.descuento).toBe(0);
    expect(ultimo(r.cotizacion)).toContain('Descuento por cantidad 5 % → 0 % (0 puertas)');
  });

  it('se guarda: al recargar sigue automático, con sus tramos congelados', async () => {
    const { conPedido, almacen } = await setup();
    const q = await conPedido([puertas(20)]);
    const leida = new Almacen(almacen.directorio).obtener(q.id)!;
    expect([leida.descuento, leida.descuentoManual, leida.montos.descuentoPorcentaje]).toEqual([
      10,
      false,
      10,
    ]);
    expect(leida.reglas!.descuentosPorCantidad).toEqual(TRAMOS);
  });
});

describe('descuento manual', () => {
  it('editarlo lo fija: no cambia al agregar puertas ni por el chat, y queda registrado', async () => {
    const { conPedido, cambiarPedido, editar, ultimo, almacen } = await setup();
    let q = await conPedido([puertas(10)]);
    expect(q.descuento).toBe(5);
    q = await editar(q, { descuento: 3 });
    expect([q.descuento, q.descuentoManual]).toEqual([3, true]);
    expect(ultimo(q)).toBe('Descuento 5 % → 3 % (manual)');
    // Más puertas por edición directa: sigue en 3 %.
    q = await editar(q, { cantidades: [{ indice: 0, cantidad: 25 }] });
    expect([q.descuento, q.descuentoManual]).toEqual([3, true]);
    expect(ultimo(q)).not.toContain('Descuento');
    // Y por el chat.
    q = await cambiarPedido(q, [puertas(40)]);
    expect([q.descuento, q.descuentoManual, q.montos.descuentoPorcentaje]).toEqual([3, true, 3]);
    expect(ultimo(q)).not.toContain('Descuento');
    // También tras recargar desde la base.
    const leida = new Almacen(almacen.directorio).obtener(q.id)!;
    expect([leida.descuento, leida.descuentoManual]).toEqual([3, true]);
  });

  it('fijar 0 también es una decisión: sin descuento aunque haya tramo', async () => {
    const { conPedido, editar, cambiarPedido, ultimo } = await setup();
    let q = await conPedido([puertas(10)]);
    q = await editar(q, { descuento: 0 });
    expect([q.descuento, q.descuentoManual, q.montos.descuento]).toEqual([0, true, 0]);
    expect(ultimo(q)).toBe('Descuento 5 % → 0 % (manual)');
    q = await cambiarPedido(q, [puertas(30)]);
    expect(q.descuento).toBe(0);
  });

  it('repetir el descuento automático actual no lo fija ni deja ruido', async () => {
    const { conPedido, editar, cambiarPedido } = await setup();
    let q = await conPedido([puertas(10)]);
    const despues = await editar(q, { descuento: 5 });
    expect(despues.actualizada).toBe(q.actualizada);
    expect(despues.descuentoManual).toBe(false);
    // Sigue el automático.
    q = await cambiarPedido(despues, [puertas(20)]);
    expect(q.descuento).toBe(10);
  });

  it('un manual repetido tampoco agrega registro', async () => {
    const { conPedido, editar, detalles } = await setup();
    let q = await conPedido([puertas(10)]);
    q = await editar(q, { descuento: 7.5 });
    const n = detalles(q).length;
    const version = q.actualizada;
    q = await editar(q, { descuento: 7.5 });
    expect([q.actualizada, detalles(q).length]).toEqual([version, n]);
  });

  it('respeta el descuento máximo de la cotización, con o sin tramos', async () => {
    const { conPedido, editar } = await setup();
    const q = await conPedido([puertas(10)]);
    await expect(editar(q, { descuento: 50.5 })).rejects.toBeInstanceOf(ErrorUsuario);
    await expect(editar(q, { descuento: 50.5 })).rejects.toThrow('El descuento debe estar entre 0 % y 50 %');
    await expect(editar(q, { descuento: 2.345 })).rejects.toThrow('hasta dos decimales');
    expect((await editar(q, { descuento: 50 })).descuento).toBe(50);
    // Un máximo menor congelado en la cotización también se exige al fijar a mano.
    const { conPedido: conMaximo, editar: editarMaximo, configurar } = await setup(null);
    configurar([{ desdePuertas: 10, porcentaje: 15 }], { descuentoMaximo: 20 });
    const c = await conMaximo([puertas(10)]);
    expect(c.descuento).toBe(15);
    await expect(editarMaximo(c, { descuento: 25 })).rejects.toThrow('entre 0 % y 20 %');
    expect((await editarMaximo(c, { descuento: 20 })).descuento).toBe(20);
  });
});

describe('restaurar el automático', () => {
  it('vuelve al tramo que corresponde a las puertas de ahora y lo registra', async () => {
    const { conPedido, editar, ultimo } = await setup();
    let q = await conPedido([puertas(10)]);
    q = await editar(q, { descuento: 3 });
    q = await editar(q, { cantidades: [{ indice: 0, cantidad: 20 }] });
    expect([q.descuento, q.descuentoManual]).toEqual([3, true]);
    q = await editar(q, { descuentoAutomatico: true });
    expect([q.descuento, q.descuentoManual]).toEqual([10, false]);
    expect(q.montos.descuentoPorcentaje).toBe(10);
    expect(ultimo(q)).toBe('Descuento automático restaurado: 3 % → 10 % (20 puertas)');
    // Y vuelve a seguir a las líneas.
    q = await editar(q, { cantidades: [{ indice: 0, cantidad: 12 }] });
    expect(q.descuento).toBe(5);
  });

  it('si el valor era el mismo, solo se registra que volvió a automático', async () => {
    const { conPedido, editar, ultimo } = await setup();
    let q = await conPedido([puertas(10)]);
    q = await editar(q, { descuento: 6 });
    q = await editar(q, { descuento: 5 });
    expect([q.descuento, q.descuentoManual]).toEqual([5, true]);
    q = await editar(q, { descuentoAutomatico: true });
    expect([q.descuento, q.descuentoManual]).toEqual([5, false]);
    expect(ultimo(q)).toBe('Descuento automático restaurado: 5 %');
  });

  it('restaurar cuando ya es automático no cambia nada', async () => {
    const { conPedido, editar } = await setup();
    const q = await conPedido([puertas(10)]);
    const r = await editar(q, { descuentoAutomatico: true });
    expect(r.actualizada).toBe(q.actualizada);
  });

  it('fijar un descuento y restaurar a la vez es un error', async () => {
    const { conPedido, editar } = await setup();
    const q = await conPedido([puertas(10)]);
    await expect(editar(q, { descuento: 4, descuentoAutomatico: true })).rejects.toBeInstanceOf(ErrorUsuario);
  });

  it('una cotización emitida se restaura en su revisión y la original no cambia', async () => {
    const { emitida, editar, almacen } = await setup();
    let e = await emitida([puertas(10)]);
    expect(e.estado).toBe('emitida');
    const manual = await editar(e, { descuento: 2 });
    expect([manual.estado, manual.origen, manual.descuento, manual.descuentoManual]).toEqual([
      'borrador',
      e.numero,
      2,
      true,
    ]);
    const restaurada = await editar(manual, { descuentoAutomatico: true });
    expect([restaurada.id, restaurada.descuento, restaurada.descuentoManual]).toEqual([manual.id, 5, false]);
    e = almacen.obtener(e.id)!;
    expect([e.descuento, e.descuentoManual]).toEqual([5, false]);
  });
});

describe('reglas congeladas y cotizaciones anteriores', () => {
  it('cambiar los tramos en Ajustes no toca las cotizaciones existentes, solo las nuevas', async () => {
    const { conPedido, cambiarPedido, configurar } = await setup();
    let vieja = await conPedido([puertas(3)]);
    configurar([
      { desdePuertas: 10, porcentaje: 8 },
      { desdePuertas: 30, porcentaje: 15 },
    ]);
    // La existente conserva sus tramos aunque se edite.
    vieja = await cambiarPedido(vieja, [puertas(10)]);
    expect(vieja.descuento).toBe(5);
    expect(vieja.reglas!.descuentosPorCantidad).toEqual(TRAMOS);
    // La nueva usa los vigentes.
    const nueva = await conPedido([puertas(10)]);
    expect(nueva.descuento).toBe(8);
    expect(nueva.reglas!.descuentosPorCantidad).toEqual([
      { desdePuertas: 10, porcentaje: 8 },
      { desdePuertas: 30, porcentaje: 15 },
    ]);
    // Quitar todos los tramos tampoco afecta a la que ya los congeló.
    configurar([]);
    const sin = await conPedido([puertas(50)]);
    expect(sin.descuento).toBe(0);
    const v2 = await cambiarPedido(vieja, [puertas(25)]);
    expect(v2.descuento).toBe(10);
  });

  it('duplicar copia el descuento manual y recalcula el automático con los tramos de la copia', async () => {
    const { conPedido, editar, servicio, configurar, almacen } = await setup();
    const automatica = await conPedido([puertas(10)]);
    const manual = await editar(await conPedido([puertas(10)]), { descuento: 2 });
    configurar([{ desdePuertas: 10, porcentaje: 8 }]);

    const copiaAuto = (await servicio.ejecutar({ tipo: 'duplicar', id: automatica.id })).cotizacion;
    expect([copiaAuto.descuento, copiaAuto.descuentoManual]).toEqual([8, false]);
    expect(almacen.eventos(copiaAuto.id).find((e) => e.tipo === 'duplicada')!.detalle).toBe(
      'Copia de un borrador · Descuento por cantidad 5 % → 8 % (10 puertas)',
    );
    const copiaManual = (await servicio.ejecutar({ tipo: 'duplicar', id: manual.id })).cotizacion;
    expect([copiaManual.descuento, copiaManual.descuentoManual]).toEqual([2, true]);
    expect(almacen.eventos(copiaManual.id).find((e) => e.tipo === 'duplicada')!.detalle).toBe(
      'Copia de un borrador',
    );
  });

  it('editar una emitida con descuento automático recalcula en la revisión sin tocar la original', async () => {
    const { emitida, editar, almacen } = await setup();
    const e = await emitida([puertas(10)]);
    const rev = await editar(e, { cantidades: [{ indice: 0, cantidad: 20 }] });
    expect([rev.estado, rev.origen, rev.descuento]).toEqual(['borrador', e.numero, 10]);
    expect(almacen.eventos(rev.id).at(-1)!.detalle).toContain(
      'Descuento por cantidad 5 % → 10 % (20 puertas)',
    );
    expect(almacen.obtener(e.id)!.descuento).toBe(5);
  });

  it('una cotización anterior, sin tramos en sus reglas, sigue igual aunque haya tramos configurados', async () => {
    const { conPedido, cambiarPedido, almacen } = await setup();
    let q = await conPedido([puertas(3)]);
    // Reglas congeladas como las dejaba la versión anterior: sin el campo.
    const db = almacen.baseDatos();
    db.prepare('UPDATE cotizaciones SET reglas_json = ? WHERE id = ?').run(
      JSON.stringify({ ...REGLAS, margenes: q.reglas!.margenes }),
      q.id,
    );
    q = almacen.obtener(q.id)!;
    expect(q.reglas!.descuentosPorCantidad).toBeUndefined();
    q = await cambiarPedido(q, [puertas(40)]);
    expect([q.descuento, q.descuentoManual, q.montos.descuento]).toEqual([0, false, 0]);
    // Un descuento manual de esas cotizaciones sigue funcionando como siempre.
    const r = await new Servicio(catalogo(), { interpretar: vi.fn() }, almacen).ejecutar({
      tipo: 'editar',
      id: q.id,
      actualizada: q.actualizada,
      descuento: 10,
    });
    expect([r.cotizacion.descuento, r.cotizacion.descuentoManual]).toEqual([10, true]);
  });

  it('tramos ilegibles en las reglas guardadas se descartan: sin tramos, nunca a medias', async () => {
    const { conPedido, almacen } = await setup();
    const q = await conPedido([puertas(3)]);
    const db = almacen.baseDatos();
    db.prepare('UPDATE cotizaciones SET reglas_json = ? WHERE id = ?').run(
      JSON.stringify({
        ...q.reglas,
        descuentosPorCantidad: [{ desdePuertas: 10, porcentaje: 5 }, { desdePuertas: 'x' }],
      }),
      q.id,
    );
    expect(almacen.obtener(q.id)!.reglas!.descuentosPorCantidad).toBeUndefined();
    // Un porcentaje fuera de rango o un umbral inválido también invalida la lista entera.
    for (const tramos of [
      [{ desdePuertas: 10, porcentaje: -5 }],
      [{ desdePuertas: 10, porcentaje: 150 }],
      [{ desdePuertas: 0, porcentaje: 5 }],
      [{ desdePuertas: 2.5, porcentaje: 5 }],
      'no es una lista',
    ]) {
      db.prepare('UPDATE cotizaciones SET reglas_json = ? WHERE id = ?').run(
        JSON.stringify({ ...q.reglas, descuentosPorCantidad: tramos }),
        q.id,
      );
      expect(almacen.obtener(q.id)!.reglas!.descuentosPorCantidad).toBeUndefined();
    }
  });

  it('un tramo guardado por encima del máximo de la cotización se acota en vez de fallar', async () => {
    const { conPedido, cambiarPedido, almacen } = await setup();
    let q = await conPedido([puertas(3)]);
    almacen
      .baseDatos()
      .prepare('UPDATE cotizaciones SET reglas_json = ? WHERE id = ?')
      .run(
        JSON.stringify({
          ...q.reglas,
          descuentoMaximo: 8,
          descuentosPorCantidad: [{ desdePuertas: 10, porcentaje: 25 }],
        }),
        q.id,
      );
    q = almacen.obtener(q.id)!;
    q = await cambiarPedido(q, [puertas(10)]);
    expect(q.descuento).toBe(8);
  });
});

describe('migración v15', () => {
  it('las cotizaciones con descuento quedan manuales y las demás automáticas; es idempotente', async () => {
    const { conPedido, editar, almacen, dir } = await setup(null);
    const conDescuento = await editar(await conPedido([puertas(10)]), { descuento: 10 });
    const sinDescuento = await conPedido([puertas(2)]);
    const ruta = join(dir, 'cotizador.sqlite');
    // Deja la base como estaba en v14: sin la columna y con reglas congeladas sin el campo de los tramos.
    const db = almacen.baseDatos();
    for (const q of [conDescuento, sinDescuento])
      db.prepare('UPDATE cotizaciones SET reglas_json = ? WHERE id = ?').run(
        JSON.stringify({ ...REGLAS, margenes: q.reglas!.margenes }),
        q.id,
      );
    db.exec('ALTER TABLE cotizaciones DROP COLUMN descuento_manual; PRAGMA user_version = 14;');
    cerrarAlmacen(ruta);

    const migrada = abrirBaseDatos(ruta, { cachear: false });
    try {
      expect(VERSION_ESQUEMA).toBeGreaterThanOrEqual(15);
      expect(migrada.pragma('user_version', { simple: true })).toBe(VERSION_ESQUEMA);
      const columnas = (migrada.pragma('table_info(cotizaciones)') as { name: string }[]).map((c) => c.name);
      expect(columnas).toContain('descuento_manual');
      const manual = (id: string) =>
        migrada.prepare('SELECT descuento, descuento_manual AS m FROM cotizaciones WHERE id = ?').get(id);
      expect(manual(conDescuento.id)).toEqual({ descuento: 10, m: 1 });
      expect(manual(sinDescuento.id)).toEqual({ descuento: 0, m: 0 });
      // Repetir la migración (columna ya creada) no vuelve a tocar los datos.
      migrada.prepare('UPDATE cotizaciones SET descuento_manual = 1 WHERE id = ?').run(sinDescuento.id);
      migrada.exec('PRAGMA user_version = 14');
    } finally {
      migrada.close();
    }
    const otra = abrirBaseDatos(ruta, { cachear: false });
    try {
      expect(
        otra.prepare('SELECT descuento_manual AS m FROM cotizaciones WHERE id = ?').get(sinDescuento.id),
      ).toEqual({ m: 1 });
      expect(otra.pragma('user_version', { simple: true })).toBe(VERSION_ESQUEMA);
      otra.prepare('UPDATE cotizaciones SET descuento_manual = 0 WHERE id = ?').run(sinDescuento.id);
    } finally {
      otra.close();
    }
    const recargada = new Almacen(dir);
    const servicio = new Servicio(catalogo(), { interpretar: vi.fn() }, recargada);
    const cargada = (q: Cotizacion) => recargada.obtener(q.id)!;
    expect(cargada(conDescuento)).toMatchObject({ descuento: 10, descuentoManual: true });
    expect(cargada(sinDescuento)).toMatchObject({ descuento: 0, descuentoManual: false });
    expect(cargada(sinDescuento).reglas!.descuentosPorCantidad).toBeUndefined();
    // Las migradas se editan como siempre: sus reglas no tienen tramos, así que más puertas no cambian el
    // descuento (el que tenía una persona sigue siendo suyo).
    for (const q of [conDescuento, sinDescuento]) {
      const actual = cargada(q);
      const r = await servicio.ejecutar({
        tipo: 'editar',
        id: q.id,
        actualizada: actual.actualizada,
        cantidades: [{ indice: 0, cantidad: 30 }],
      });
      expect(r.cotizacion.descuento).toBe(actual.descuento);
    }
  });

  it('el estado de un JSON anterior deriva el modo: con descuento es manual', () => {
    const estado = completarEstadoLegado({
      siguienteCotizacion: 323,
      siguienteNota: 1,
      cotizaciones: [{ descuento: 12 }, { descuento: 0 }, { descuento: 4, descuentoManual: false }],
    }) as { cotizaciones: { descuentoManual: boolean }[] };
    expect(estado.cotizaciones.map((q) => q.descuentoManual)).toEqual([true, false, false]);
  });
});

describe('con márgenes y precios manuales', () => {
  // Puertas: 100.000 + 85 % = 185.000; marco Pino Oregón: 20.000 + 85 % = 37.000.
  const pedido = [puertas(6), { ...puertas(4), ancho: 0.83 }, marcos(2)];
  const precios = (q: Cotizacion) => q.montos.lineas.map((l) => l.precioUnitario);

  it('el descuento recae sobre el subtotal ya con margen de la cotización, de la línea y precio manual', async () => {
    const { conPedido, editar, ultimo } = await setup();
    let q = await conPedido(pedido);
    expect([precios(q), q.descuento, contarPuertas(q.montos.lineas)]).toEqual([
      [185_000, 185_000, 37_000],
      5,
      10,
    ]);
    expect(q.montos.descuento).toBe(Math.round((q.montos.subtotal * 5) / 100));

    // El precio manual de la línea 0 y el margen de la línea 1 ganan al margen de la cotización (50 %).
    q = await editar(q, {
      margenCotizacion: 0.5,
      items: [
        { indice: 0, cambios: { precioUnitario: 120_000 } },
        { indice: 1, cambios: { margen: 0.3 } },
      ],
    });
    expect(precios(q)).toEqual([120_000, 130_000, 30_000]);
    // 6 × 120.000 + 4 × 130.000 + 2 × 30.000 = 1.300.000; 5 % = 65.000. Los márgenes no cambian el tramo.
    expect([q.montos.subtotal, q.descuento, q.descuentoManual, q.montos.descuento, q.montos.neto]).toEqual([
      1_300_000,
      5,
      false,
      65_000,
      1_235_000,
    ]);
    expect([q.montos.iva, q.montos.total]).toEqual([234_650, 1_469_650]);
    expect(ultimo(q)).not.toContain('Descuento');

    // Manual: 3 % del subtotal; un cambio posterior de margen lo recalcula en pesos pero no lo suelta.
    q = await editar(q, { descuento: 3 });
    expect([q.montos.descuento, q.montos.neto]).toEqual([39_000, 1_261_000]);
    q = await editar(q, { margenCotizacion: 0.1 });
    expect(precios(q)).toEqual([120_000, 130_000, 22_000]);
    expect([q.montos.subtotal, q.descuento, q.descuentoManual, q.montos.descuento]).toEqual([
      1_284_000,
      3,
      true,
      38_520,
    ]);
    expect(ultimo(q)).not.toContain('Descuento');

    // Restaurar: vuelve el 5 % del tramo, sobre los mismos precios.
    q = await editar(q, { descuentoAutomatico: true });
    expect([q.descuento, q.descuentoManual, q.montos.descuento]).toEqual([5, false, 64_200]);
    expect(precios(q)).toEqual([120_000, 130_000, 22_000]);
  });

  it('quitar el margen o el precio manual de una línea no toca el tramo ni el modo', async () => {
    const { conPedido, editar } = await setup();
    let q = await conPedido(pedido);
    q = await editar(q, { items: [{ indice: 0, cambios: { precioUnitario: 120_000 } }] });
    q = await editar(q, { items: [{ indice: 0, cambios: { precioUnitario: null } }] });
    expect([precios(q)[0], q.descuento, q.descuentoManual]).toEqual([185_000, 5, false]);
  });
});

describe('panel de totales', () => {
  const html = (q: Cotizacion, editable: boolean) =>
    renderToStaticMarkup(
      createElement(Totales, { actual: q, editable, guardando: null, editar: async () => true }),
    );

  it('explica el descuento automático con el tramo y el siguiente, en una región en vivo', async () => {
    const { conPedido } = await setup();
    const q = await conPedido([puertas(14)]);
    const h = html(q, true);
    expect(h).toContain('Descuento por cantidad: 14 puertas → 5 %');
    expect(h).toContain('Siguiente tramo: desde 20 puertas −10 %');
    expect(h).toContain('aria-live="polite"');
    expect(h).not.toContain('Restaurar automático');
    // Sin tramos en las reglas no se muestra nada de esto.
    const sin = await setup(null);
    expect(html(await sin.conPedido([puertas(14)]), true)).not.toContain('descuento-origen');
  });

  it('el descuento manual ofrece volver al automático solo si se puede editar', async () => {
    const { conPedido, editar } = await setup();
    const q = await editar(await conPedido([puertas(14)]), { descuento: 3 });
    const h = html(q, true);
    expect(h).toContain('Descuento manual: 3 %');
    expect(h).toContain('Restaurar automático');
    expect(h).toContain('Automático: 5 % con 14 puertas');
    const lectura = html(q, false);
    expect(lectura).toContain('Descuento manual: 3 %');
    expect(lectura).not.toContain('Restaurar automático');
  });

  it('sin fila de descuento (no editable y sin descuento) tampoco se muestra «Descuento manual: 0 %»', async () => {
    const { conPedido, editar } = await setup();
    const q = await editar(await conPedido([puertas(14)]), { descuento: 0 });
    expect(q.descuentoManual).toBe(true);
    expect(html(q, true)).toContain('Descuento manual: 0 %');
    const lectura = html(q, false);
    expect(lectura).not.toContain('Descuento manual');
    expect(lectura).not.toContain('Descuento');
  });
});

describe('documentos y nota de pedido', () => {
  it('la nota de pedido ignora el descuento por cantidad: precio de fábrica, sin descuento', async () => {
    const { emitida, servicio } = await setup();
    const e = await emitida([puertas(20)]);
    expect(e.descuento).toBe(10);
    expect(e.montos.descuento).toBeGreaterThan(0);
    let q = (await servicio.ejecutar({ tipo: 'aprobar', id: e.id, actualizada: e.actualizada })).cotizacion;
    q = (
      await servicio.ejecutar({
        tipo: 'pago',
        id: q.id,
        actualizada: q.actualizada,
        monto: Math.ceil(q.montos.total * 0.5),
      })
    ).cotizacion;
    const a = (await servicio.ejecutar({ tipo: 'generar_nota', id: q.id, actualizada: q.actualizada }))
      .cotizacion;
    expect(a.nota!.montos).toMatchObject({
      descuentoPorcentaje: 0,
      descuento: 0,
      flete: 0,
      subtotal: 20 * 100_000,
    });
    // La cotización conserva su descuento.
    expect([a.descuento, a.montos.descuento]).toEqual([10, e.montos.descuento]);
  });

  it('emitir conserva el descuento; si los precios del catálogo cambiaron, el borrador queda consistente con los montos nuevos', async () => {
    const { almacen, llm, conPedido, editar } = await setup();
    const automatica = await conPedido([puertas(10)]);
    const manual = await editar(await conPedido([puertas(10)]), { descuento: 3 });
    const nuevoCatalogo: Catalogo = {
      ...catalogo(),
      productos: catalogo().productos.map((p) =>
        p.familia === 'PUERTA' ? { ...p, precioNeto: p.precioNeto + 1000 } : p,
      ),
    };
    const otro = new Servicio(nuevoCatalogo, llm, almacen, { nombre: 'Paula', email: 'paula@neltume.cl' });
    // Cada puerta pasa de 185.000 a round(101.000 × 1,85) = 186.850: 10 puertas son 1.868.500.
    for (const [q, porcentaje, monto] of [
      [automatica, 5, 93_425],
      [manual, 3, 56_055],
    ] as const) {
      await expect(
        otro.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada }),
      ).rejects.toMatchObject({
        codigo: 'precios_cambiaron',
      });
      const revisada = almacen.obtener(q.id)!;
      expect(revisada.estado).toBe('borrador');
      expect([
        revisada.montos.subtotal,
        revisada.descuento,
        revisada.montos.descuentoPorcentaje,
        revisada.montos.descuento,
      ]).toEqual([1_868_500, porcentaje, porcentaje, monto]);
      const e = (await otro.ejecutar({ tipo: 'emitir', id: q.id, actualizada: revisada.actualizada }))
        .cotizacion;
      expect([e.estado, e.descuento, e.descuentoManual, e.montos.descuento]).toEqual([
        'emitida',
        porcentaje,
        q === manual,
        monto,
      ]);
    }
  });

  it('el texto copiado de la cotización rotula el descuento según quién lo fijó', async () => {
    const { conPedido, editar } = await setup();
    let q = await conPedido([puertas(10)]);
    expect(resumenTexto(q)).toContain('\nDescuento por cantidad 5%: −$92.500\n');
    q = await editar(q, { descuento: 3 });
    expect(resumenTexto(q)).toContain('\nDescuento 3%: −$55.500\n');
    expect(resumenTexto(q)).not.toContain('por cantidad');
    // Sin tramos configurados el texto es el de siempre.
    const sin = await setup(null);
    const d = await sin.editar(await sin.conPedido([puertas(10)]), { descuento: 10 });
    expect(resumenTexto(d)).toContain('\nDescuento 10%: −$185.000\n');
  });

  it('al emitir, el documento recibe el descuento y su origen (automático) y la cotización queda igual', async () => {
    const { emitida } = await setup();
    const e = await emitida([puertas(10)]);
    const [documento, datos] = vi.mocked(plantilla).mock.calls.at(-1)!;
    expect(documento.descuentoManual).toBe(false);
    expect(datos.montos.descuentoPorcentaje).toBe(5);
    expect(etiquetaDescuento(documento)).toBe('Descuento por cantidad');
    expect([e.descuento, e.descuentoManual]).toEqual([5, false]);
  });
});

describe('el asistente nunca toca el descuento', () => {
  const claves = (valor: unknown, acumulado: string[] = []): string[] => {
    if (Array.isArray(valor)) valor.forEach((v) => claves(v, acumulado));
    else if (valor && typeof valor === 'object')
      for (const [k, v] of Object.entries(valor)) {
        acumulado.push(k);
        claves(v, acumulado);
      }
    return acumulado;
  };

  it('el contexto que recibe la IA no trae descuento, tramos, montos ni reglas', async () => {
    const { conPedido, cambiarPedido, llm } = await setup();
    const q = await conPedido([puertas(10)]);
    expect(q.descuento).toBe(5);
    await cambiarPedido(q, [puertas(12)]);
    const contexto = llm.interpretar.mock.calls.at(-1)![0];
    const texto = JSON.stringify(contexto);
    expect(claves(contexto).filter((k) => /descuento|tramo|monto|regla|precio|total/i.test(k))).toEqual([]);
    expect(texto).not.toMatch(/descuento|tramo|%/i);
    // La proyección explícita, directamente.
    const directo = contextoSeguro('Cotiza Molco', q.solicitudes, q.cliente, ['MOLCO'], ['PINO OREGON']);
    expect(claves(directo).filter((k) => /descuento|tramo|monto|regla|precio/i.test(k))).toEqual([]);
  });

  it('una respuesta del modelo con descuento se rechaza y la cotización no cambia', async () => {
    const { conPedido, llm, servicio } = await setup();
    const q = await conPedido([puertas(10)]);
    let actual = q;
    for (const salida of [
      {
        name: 'actualizar_cotizacion',
        input: { items: [puertas(10)], cliente: clienteVacio(), descuento: 30 },
      },
      {
        name: 'actualizar_cotizacion',
        input: { items: [{ ...puertas(10), descuento: 30 }], cliente: clienteVacio() },
      },
      { name: 'modificar_cotizacion', input: { items: [{ indice: 0, cambios: { descuento: 30 } }] } },
      { name: 'modificar_cotizacion', input: { descuento: 30 } },
    ]) {
      llm.interpretar.mockResolvedValueOnce(salida);
      const r = await servicio.ejecutar({
        tipo: 'chat',
        id: actual.id,
        actualizada: actual.actualizada,
        mensaje: 'Dale 30 % de descuento',
      });
      actual = r.cotizacion;
      expect(actual.historial.at(-1)!.texto).toBe('No entendí, ¿puedes reformularlo?');
      expect([actual.descuento, actual.descuentoManual, actual.montos.descuentoPorcentaje]).toEqual([
        5,
        false,
        5,
      ]);
      expect(actual.solicitudes.map((s) => [s.modelo, s.cantidad])).toEqual([['MOLCO', 10]]);
    }
  });

  it('el texto libre del modelo con descuentos no llega a la persona', async () => {
    const { conPedido, llm, servicio } = await setup();
    const q = await conPedido([puertas(10)]);
    llm.interpretar.mockResolvedValueOnce({
      name: 'responder',
      input: { texto: 'Te aplico un descuento del 20 %.' },
    });
    const r = await servicio.ejecutar({
      tipo: 'chat',
      id: q.id,
      actualizada: q.actualizada,
      mensaje: 'Hola',
    });
    expect(r.cotizacion.historial.at(-1)!.texto).toMatch(/Los montos se muestran en la cotización/);
    expect(r.cotizacion.descuento).toBe(5);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Catalogo, Producto, SolicitudItem } from '../src/catalogo/tipos';
import {
  ahorroLinea,
  cotizar,
  descuentoPorUnidad,
  ErrorPrecio,
  precioConDescuento,
  REGLAS,
  resumenDescuentosItems,
} from '../src/negocio/precios';
import { avisoProductoCambiado, fusionarItems } from '../src/negocio/items';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { cotizacionSchema } from '../src/servidor/persistencia-esquemas';
import { Servicio } from '../src/servidor/servicio';
import { ErrorUsuario } from '../src/servidor/errores';
import { resumenTexto } from '../src/app/formato';
import { errorDescuentoItem } from '../src/app/descuento-item';
import { cantidadesDichas, cifrasDelTexto } from '../src/asistente/anclaje';
import { montoEscrito, porcentajeEscrito, porcentajesDelTexto, textosSinPorcentajes } from '../src/asistente/montos';
import { CAMPOS_ITEM, casoSchema, puntuar } from '../src/asistente/evaluacion';
import { SYSTEM } from '../src/asistente/llm';
import { clienteVacio } from '../src/catalogo/tipos';
import type { Cotizacion } from '../src/negocio/estado';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const producto = (overrides: Partial<Producto> = {}): Producto => ({
  codigo: 'HUI-M-3-A', modelo: 'Huilo Huilo', familia: 'PUERTA', tipo: 'PUERTA PANEL',
  madera: 'MARA', medida: '0,80 A 0,85', anchoMin: 0.8, anchoMax: 0.85,
  altoMin: 2.3, altoMax: 2.4, largo: 2.35, precioNeto: 100_000,
  descripcion: 'HUILO HUILO MARA 0,80 A 0,85 MT X 2,30 A 2,40 MT', filaOrigen: 7,
  ...overrides,
});
const rauli = producto({ codigo: 'HUI-R-3-A', madera: 'RAULI', descripcion: 'HUILO HUILO RAULI 0,80 A 0,85 MT X 2,30 A 2,40 MT' });
const SIN_MARGEN = { ...REGLAS, ajuste: 0.2 };

describe('cálculo del descuento especial por ítem', () => {
  it('descuenta por unidad solo en su línea: 15 % de $120.000 son $18.000 y la línea queda a $102.000', () => {
    const m = cotizar(
      [
        { producto: producto(), cantidad: 2, descuento: { tipo: 'porcentaje', valor: 15 } },
        { producto: rauli, cantidad: 1 },
      ],
      SIN_MARGEN,
    );
    const [solida, otra] = m.lineas;
    expect(solida).toMatchObject({ precioUnitario: 120_000, descuentoUnitario: 18_000, total: 204_000 });
    expect(precioConDescuento(solida)).toBe(102_000);
    expect(ahorroLinea(solida)).toBe(36_000);
    // La otra línea no cambia y no arrastra campos de descuento.
    expect(otra).toMatchObject({ precioUnitario: 120_000, total: 120_000 });
    expect(otra.descuentoItem).toBeUndefined();
    expect(m.subtotal).toBe(324_000);
    expect(resumenDescuentosItems(m)).toEqual({ ahorro: 36_000, subtotalOriginal: 360_000 });
    // El IVA sigue siendo sobre el neto (ya rebajado).
    expect(m.iva).toBe(Math.round(324_000 * 0.19));
    // El producto de catálogo no se toca.
    expect(solida.producto.precioNeto).toBe(100_000);
  });

  it('un monto fijo es por unidad; el descuento general se calcula sobre el subtotal ya rebajado (sin contar dos veces)', () => {
    const m = cotizar(
      [{ producto: producto(), cantidad: 3, descuento: { tipo: 'monto', valor: 20_000 } }],
      SIN_MARGEN,
      { descuento: 10, flete: 5_000 },
    );
    expect(m.lineas[0]).toMatchObject({ descuentoUnitario: 20_000, total: 300_000 });
    expect(m.subtotal).toBe(300_000);
    expect(m.descuento).toBe(30_000);
    expect(m.neto).toBe(300_000 - 30_000 + 5_000);
    expect(resumenDescuentosItems(m).ahorro).toBe(60_000);
  });

  it('redondea por unidad, admite 100 % y nunca deja precios negativos', () => {
    expect(descuentoPorUnidad(99_999, { tipo: 'porcentaje', valor: 33.33 })).toBe(33_330);
    expect(descuentoPorUnidad(1_500, { tipo: 'porcentaje', valor: 2.3 })).toBe(35);
    expect(descuentoPorUnidad(120_000, null)).toBe(0);
    const gratis = cotizar([{ producto: producto(), cantidad: 2, descuento: { tipo: 'porcentaje', valor: 100 } }], SIN_MARGEN);
    expect(gratis.lineas[0].total).toBe(0);
    // Un monto que quedó por encima del precio (el catálogo bajó) se limita al precio.
    const limitado = cotizar([{ producto: producto({ precioNeto: 10_000 }), cantidad: 1, descuento: { tipo: 'monto', valor: 50_000 } }], SIN_MARGEN);
    expect(limitado.lineas[0]).toMatchObject({ precioUnitario: 12_000, descuentoUnitario: 12_000, total: 0 });
  });

  it('rechaza descuentos negativos, sobre 100 %, con más de dos decimales o montos no enteros', () => {
    for (const descuento of [
      { tipo: 'porcentaje', valor: -5 },
      { tipo: 'porcentaje', valor: 100.01 },
      { tipo: 'porcentaje', valor: 1.234 },
      { tipo: 'monto', valor: -1 },
      { tipo: 'monto', valor: 10.5 },
      { tipo: 'otro', valor: 5 },
    ] as const)
      expect(() => cotizar([{ producto: producto(), cantidad: 1, descuento: descuento as never }])).toThrow(ErrorPrecio);
  });

  it('valida en la interfaz igual que el servidor, con el monto acotado al precio unitario', () => {
    expect(errorDescuentoItem('porcentaje', '15', 120_000)).toBeNull();
    expect(errorDescuentoItem('porcentaje', '15,5 %', 120_000)).toBeNull();
    expect(errorDescuentoItem('porcentaje', '', 120_000)).toBeNull();
    expect(errorDescuentoItem('porcentaje', '-5', 120_000)).toMatch(/positivo/);
    expect(errorDescuentoItem('porcentaje', '101', 120_000)).toMatch(/100 %/);
    expect(errorDescuentoItem('porcentaje', '1,234', 120_000)).toMatch(/dos decimales/);
    expect(errorDescuentoItem('monto', '$18.000', 120_000)).toBeNull();
    expect(errorDescuentoItem('monto', '-1000', 120_000)).toMatch(/positivo/);
    expect(errorDescuentoItem('monto', '120.001', 120_000)).toMatch(/precio unitario/);
  });
});

describe('fusión con lo que propone la IA', () => {
  const identidad = (s: SolicitudItem) => ({ modelo: (s.modelo ?? '').toUpperCase(), madera: (s.madera ?? '').toUpperCase() });
  const item = (madera: string, extra: Partial<SolicitudItem> = {}): SolicitudItem => ({
    modelo: 'Huilo Huilo', madera, ancho: 0.82, alto: 2.35, medida: null, cantidad: 1, ...extra,
  });

  it('el mismo ítem conserva su descuento; si cambia de producto, el monto fijo se descarta y el porcentaje no', () => {
    const previos = [
      item('Mara', { descuento: { tipo: 'porcentaje', valor: 15 } }),
      item('Rauli', { descuento: { tipo: 'monto', valor: 5_000 } }),
    ];
    const igual = fusionarItems(previos, [item('Mara', { cantidad: 4 }), item('Rauli')], identidad);
    expect(igual.items.map((s) => s.descuento)).toEqual(previos.map((s) => s.descuento));
    const cambiado = fusionarItems(previos, [item('Lenga'), item('Lenga')], identidad);
    expect(cambiado.items[0].descuento).toEqual({ tipo: 'porcentaje', valor: 15 });
    expect(cambiado.items[1].descuento).toBeUndefined();
    expect(cambiado.avisos).toEqual([avisoProductoCambiado(2, { precio: false, descuento: true })]);
    expect(cambiado.avisos[0]).toContain('se descartó su descuento especial en monto fijo');
  });
});

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

const CLIENTE = { nombre: 'Ana Soto', rut: null, giro: null, telefono: null, direccion: null, comuna: null, proyecto: null };
const catalogo: Catalogo = {
  fuente: 'test.xlsx', sha256: 'catalogo-descuento-item', fecha: '2026-01-01T00:00:00.000Z',
  productos: [producto(), rauli],
};
const itemsPedido: SolicitudItem[] = [
  { modelo: 'Huilo Huilo', madera: 'Mara', ancho: 83.5, alto: 236, medida: null, cantidad: 2, tipoMedida: 'hoja' },
  { modelo: 'Huilo Huilo', madera: 'Rauli', ancho: 83.5, alto: 236, medida: null, cantidad: 1, tipoMedida: 'hoja' },
];

async function preparar() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-descuento-item-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const llm = { interpretar: vi.fn().mockResolvedValue({ name: 'actualizar_cotizacion', input: { items: itemsPedido, cliente: CLIENTE } }) };
  const servicio = new Servicio(catalogo, llm, almacen);
  let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza Huilo Huilo en Mara y Raulí' })).cotizacion;
  const editar = async (cambios: Record<string, unknown>) => {
    const r = await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, ...cambios } as never);
    q = r.cotizacion;
    return r;
  };
  const descuento = (indice: number, valor: SolicitudItem['descuento']) => editar({ items: [{ indice, cambios: { descuento: valor } }] });
  const totales = () => q.montos.lineas.map((l) => l.total);
  const detalles = () => almacen.eventos(q.id).filter((e) => e.tipo === 'modificada').map((e) => e.detalle);
  return { dir, almacen, servicio, llm, editar, descuento, totales, detalles, get q() { return q; }, set q(v) { q = v; } };
}

describe('descuento especial por ítem en el servicio', () => {
  it('se aplica a un solo ítem, se guarda, se recupera, se modifica y se quita sin tocar los demás', async () => {
    const t = await preparar();
    // Margen de categoría 55 %: $155.000 por unidad.
    expect(t.totales()).toEqual([310_000, 155_000]);
    const totalAntes = t.q.montos.total;

    await t.descuento(0, { tipo: 'porcentaje', valor: 15 });
    expect(t.q.solicitudes[0].descuento).toEqual({ tipo: 'porcentaje', valor: 15 });
    expect(t.q.solicitudes[1].descuento).toBeUndefined();
    expect(t.q.montos.lineas[0]).toMatchObject({ precioUnitario: 155_000, descuentoUnitario: 23_250, total: 263_500 });
    expect(t.totales()[1]).toBe(155_000);
    expect(resumenDescuentosItems(t.q.montos)).toEqual({ ahorro: 46_500, subtotalOriginal: 465_000 });
    expect(t.q.montos.total).toBeLessThan(totalAntes);
    expect(t.detalles().at(-1)).toContain('Descuento especial de 2 × Huilo Huilo');
    expect(t.detalles().at(-1)).toContain('sin descuento → 15 %');

    // Al recuperarla desde la base sigue igual (solicitud y línea).
    const leida = new Almacen(t.dir).obtener(t.q.id)!;
    expect(leida.solicitudes[0].descuento).toEqual({ tipo: 'porcentaje', valor: 15 });
    expect(leida.montos.lineas[0]).toMatchObject({ descuentoItem: { tipo: 'porcentaje', valor: 15 }, descuentoUnitario: 23_250 });
    expect(leida.montos).toEqual(t.q.montos);

    // Cambiar la cantidad recalcula con el mismo descuento por unidad.
    await t.editar({ cantidades: [{ indice: 0, cantidad: 4 }] });
    expect(t.q.montos.lineas[0]).toMatchObject({ descuentoUnitario: 23_250, total: 4 * 131_750 });

    // Pasar a monto fijo y luego quitarlo (con 0 o con null).
    await t.descuento(0, { tipo: 'monto', valor: 5_000 });
    expect(t.q.montos.lineas[0]).toMatchObject({ descuentoUnitario: 5_000, total: 4 * 150_000 });
    expect(t.detalles().at(-1)).toContain('15 % → $5.000 c/u');
    await t.descuento(0, { tipo: 'monto', valor: 0 });
    expect(t.q.solicitudes[0]).not.toHaveProperty('descuento');
    expect(t.q.montos.lineas[0].descuentoItem).toBeUndefined();
    expect(t.totales()).toEqual([620_000, 155_000]);
    await t.descuento(1, { tipo: 'porcentaje', valor: 10 });
    await t.descuento(1, null);
    expect(t.q.solicitudes[1]).not.toHaveProperty('descuento');
    expect(resumenDescuentosItems(t.q.montos).ahorro).toBe(0);
  });

  it('repetir el mismo descuento no crea versión ni registro', async () => {
    const t = await preparar();
    await t.descuento(0, { tipo: 'porcentaje', valor: 15 });
    const antes = { version: t.q.actualizada, eventos: t.detalles().length };
    await t.descuento(0, { tipo: 'porcentaje', valor: 15 });
    expect([t.q.actualizada, t.detalles().length]).toEqual([antes.version, antes.eventos]);
  });

  it('rechaza descuentos inválidos o mayores que el precio, sin tocar la cotización', async () => {
    const t = await preparar();
    const version = t.q.actualizada;
    for (const valor of [
      { tipo: 'porcentaje', valor: 100.5 },
      { tipo: 'porcentaje', valor: -1 },
      { tipo: 'porcentaje', valor: 12.345 },
      { tipo: 'monto', valor: 1.5 },
      { tipo: 'monto', valor: 155_001 },
    ] as const)
      await expect(t.descuento(0, valor)).rejects.toBeInstanceOf(ErrorUsuario);
    // Escrito en el detalle se rechaza con el campo abierto; deshacer o el chat lo dejan pendiente.
    await expect(t.descuento(0, { tipo: 'monto', valor: 155_001 })).rejects.toThrow(/supera su precio unitario/);
    expect(new Almacen(t.dir).obtener(t.q.id)).toMatchObject({ actualizada: version });
    expect(new Almacen(t.dir).obtener(t.q.id)!.solicitudes[0].descuento).toBeUndefined();
    // Bajar el precio por debajo de un monto fijo ya aplicado también se rechaza.
    await t.descuento(0, { tipo: 'monto', valor: 140_000 });
    await expect(t.editar({ items: [{ indice: 0, cambios: { margen: 0.3 } }] })).rejects.toThrow(/supera su precio unitario/);
    // El 100 % deja la línea en $0, nunca en negativo.
    await t.descuento(1, { tipo: 'porcentaje', valor: 100 });
    expect(t.totales()[1]).toBe(0);
  });

  it('sobrevive al chat sin que la IA lo vea, y al emitir, revisar y duplicar', async () => {
    const t = await preparar();
    await t.descuento(0, { tipo: 'porcentaje', valor: 15 });
    t.q = (await t.servicio.ejecutar({ tipo: 'chat', id: t.q.id, actualizada: t.q.actualizada, mensaje: 'cotiza Huilo Huilo en Mara y Raulí' })).cotizacion;
    expect(t.q.solicitudes[0].descuento).toEqual({ tipo: 'porcentaje', valor: 15 });
    expect(JSON.stringify(t.llm.interpretar.mock.calls.at(-1)![0])).not.toMatch(/descuento|porcentaje/i);

    const emitida = (await t.servicio.ejecutar({ tipo: 'emitir', id: t.q.id, actualizada: t.q.actualizada })).cotizacion;
    expect(emitida.montos.lineas[0]).toMatchObject({ descuentoUnitario: 23_250 });
    // Editar la emitida abre una revisión con el descuento; la emitida no cambia.
    t.q = emitida;
    const revision = (await t.descuento(1, { tipo: 'monto', valor: 10_000 })).cotizacion;
    expect(revision).toMatchObject({ estado: 'borrador', origen: emitida.numero });
    expect(revision.solicitudes.map((s) => s.descuento)).toEqual([{ tipo: 'porcentaje', valor: 15 }, { tipo: 'monto', valor: 10_000 }]);
    expect(new Almacen(t.dir).obtener(emitida.id)!.solicitudes[1].descuento).toBeUndefined();
    const copia = (await t.servicio.ejecutar({ tipo: 'duplicar', id: emitida.id })).cotizacion;
    expect(copia.solicitudes[0].descuento).toEqual({ tipo: 'porcentaje', valor: 15 });
  });

  it('la nota de pedido sale a precio de fábrica, sin el descuento comercial', async () => {
    const t = await preparar();
    await t.descuento(0, { tipo: 'porcentaje', valor: 15 });
    let q = (await t.servicio.ejecutar({ tipo: 'emitir', id: t.q.id, actualizada: t.q.actualizada })).cotizacion;
    q = (await t.servicio.ejecutar({ tipo: 'aprobar', id: q.id, actualizada: q.actualizada })).cotizacion;
    q = (await t.servicio.ejecutar({ tipo: 'pago', id: q.id, actualizada: q.actualizada, monto: Math.ceil(q.montos.total * 0.5) })).cotizacion;
    q = (await t.servicio.ejecutar({ tipo: 'generar_nota', fabrica: 'panguipulli', id: q.id, actualizada: q.actualizada })).cotizacion;
    const nota = new Almacen(t.dir).obtener(q.id)!.notas[0];
    expect(nota.montos.lineas.map((l) => [l.precioUnitario, l.descuentoItem, l.total])).toEqual([
      [100_000, undefined, 200_000],
      [100_000, undefined, 100_000],
    ]);
    expect(q.montos.lineas[0].descuentoUnitario).toBe(23_250);
  });

  it('el resumen en texto muestra precio original, descuento, precio final y ahorro', async () => {
    const t = await preparar();
    await t.descuento(0, { tipo: 'porcentaje', valor: 15 });
    const texto = resumenTexto(t.q);
    expect(texto).toContain('$155.000 c/u, descuento especial 15 % → $131.750 c/u = $263.500 (ahorro $46.500)');
    expect(texto).toContain('Subtotal original: $465.000');
    expect(texto).toContain('Ahorro por descuentos especiales: −$46.500');
  });
});

describe('compatibilidad', () => {
  it('las cotizaciones guardadas sin descuento por ítem siguen siendo válidas y se calculan igual', () => {
    const fecha = '2026-01-01T00:00:00.000Z';
    const montos = cotizar([{ producto: producto(), cantidad: 1 }]);
    // Una línea antigua: sin `descuentoItem` ni `descuentoUnitario`.
    const linea = { ...montos.lineas[0] };
    delete linea.descuentoItem;
    delete linea.descuentoUnitario;
    expect(
      cotizacionSchema.safeParse({
        id: 'q', numero: null, estado: 'borrador', cliente: CLIENTE,
        solicitudes: [{ modelo: 'Huilo Huilo', madera: 'Mara', ancho: 0.82, alto: 2.35, medida: null, cantidad: 1 }],
        montos: { ...montos, lineas: [linea] }, incompletos: [], historial: [], creada: fecha, actualizada: fecha,
        pdf: null, vence: null, descuento: 0, flete: 0, creadaPor: null, emitidaPor: null, aprobadaPor: null,
        anuladaPor: null, fechaAnulacion: null, motivoAnulacion: null, reemplazadaPor: null, versionCatalogo: null, nota: null,
      }).success,
    ).toBe(true);
    expect(resumenDescuentosItems({ ...montos, lineas: [linea] })).toEqual({ ahorro: 0, subtotalOriginal: montos.subtotal });
    expect(precioConDescuento(linea)).toBe(linea.precioUnitario);
  });

  it('la migración agrega las columnas sin descuento para las filas existentes', async () => {
    const t = await preparar();
    const db = new Database(join(t.dir, 'cotizador.sqlite'), { readonly: true });
    try {
      for (const tabla of ['solicitudes', 'cotizacion_lineas', 'nota_lineas']) {
        const columnas = (db.pragma(`table_info(${tabla})`) as { name: string }[]).map((c) => c.name);
        expect(columnas).toEqual(expect.arrayContaining(['descuento_tipo', 'descuento_valor']));
      }
      expect(db.prepare('SELECT COUNT(*) AS n FROM solicitudes WHERE descuento_tipo IS NOT NULL').get()).toEqual({ n: 0 });
    } finally {
      db.close();
    }
  });
});

describe('lectura de porcentajes escritos', () => {
  it('lee «15 %», «15%», «12,5 %», «por ciento» en cifras y en palabras, y la cifra sola junto a «descuento»', () => {
    expect(porcentajesDelTexto('hazle 15% de descuento a las Molco')).toEqual([15]);
    expect(porcentajesDelTexto('12,5 % a la Huilo')).toEqual([12.5]);
    expect(porcentajesDelTexto('Descuento del 20 %')).toEqual([20]);
    expect(porcentajesDelTexto('15 por ciento')).toEqual([15]);
    expect(porcentajesDelTexto('un diez por ciento')).toEqual([10]);
    expect(porcentajesDelTexto('a las molco y diez por ciento')).toEqual([10]);
    expect(porcentajesDelTexto('treinta y cinco por ciento')).toEqual([35]);
    expect(porcentajesDelTexto('descuento de 15')).toEqual([15]);
    expect(porcentajesDelTexto('15 de descuento')).toEqual([15]);
  });

  it('un monto en pesos no es un porcentaje, ni uno sobre 100', () => {
    expect(porcentajesDelTexto('descuento de 15 mil')).toEqual([]);
    expect(porcentajesDelTexto('descuento de $15.000')).toEqual([]);
    expect(porcentajesDelTexto('$20.000 de descuento')).toEqual([]);
    expect(porcentajesDelTexto('150 %')).toEqual([]);
  });

  it('el porcentaje propuesto vale si está escrito; una fracción (0,15) vale como lo escrito (15 %)', () => {
    expect(porcentajeEscrito(15, ['con 15% de descuento'])).toBe(15);
    expect(porcentajeEscrito(0.15, ['con 15% de descuento'])).toBe(15);
    expect(porcentajeEscrito(20, ['con 15% de descuento'])).toBeNull();
    expect(porcentajeEscrito(15, null)).toBe(15);
  });

  it('un porcentaje no respalda un monto, una cantidad ni una medida', () => {
    expect(montoEscrito(15, textosSinPorcentajes(['15% de descuento']))).toMatchObject({ ok: false });
    expect(montoEscrito(20_000, textosSinPorcentajes(['rebájale 20 mil a cada una']))).toEqual({ ok: true, valor: 20_000 });
    expect(cantidadesDichas('hazle 15% de descuento a las 4 Molco')).toEqual([4]);
    expect(cifrasDelTexto('quince por ciento de descuento a las 4 molco')).toEqual([4]);
  });
});

describe('descuento especial pedido en el chat', () => {
  const MARA = '2 Huilo Huilo mara de 83,5 x 236 medida de hoja';
  const RAULI = '1 Huilo Huilo raulí de 83,5 x 236 medida de hoja';
  const huilo = (madera: string, cantidad: number, fuente: string, extra: Record<string, unknown> = {}) => ({
    modelo: 'Huilo Huilo', madera, ancho: 83.5, alto: 236, medida: null, cantidad, tipoMedida: 'hoja', fuente, ...extra,
  });
  const editar = (cambios: { indice: number; cambios: Record<string, unknown> }[]) => ({
    name: 'modificar_cotizacion',
    input: { items: cambios },
  });

  /** Chat con el anclaje de la aplicación (modelo real, modo «avisar»): la IA es un doble con su respuesta. */
  async function conversar() {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-descuento-chat-'));
    dirs.push(dir);
    const almacen = new Almacen(dir);
    const llm = { interpretar: vi.fn(), verificarCifras: true, anclaje: 'avisar' as const };
    const servicio = new Servicio(catalogo, llm, almacen);
    let q: Cotizacion | null = null;
    const enviar = async (mensaje: string, salida: unknown) => {
      llm.interpretar.mockResolvedValueOnce(salida);
      const r = await servicio.ejecutar(
        q ? { tipo: 'chat', id: q.id, actualizada: q.actualizada, mensaje } : { tipo: 'chat', mensaje },
      );
      q = r.cotizacion;
      return r;
    };
    const eventos = () => almacen.eventos(q!.id).map((e) => e.detalle ?? '');
    return { enviar, eventos, llm, get q() { return q!; } };
  }

  /** Pedido base: 2 Huilo Huilo en Mara y 1 en Raulí, a $155.000 c/u (margen de categoría 55 %). */
  async function conPedido() {
    const t = await conversar();
    const mensaje = `${MARA} y ${RAULI}`;
    const r = await t.enviar(mensaje, {
      name: 'modificar_cotizacion',
      input: { agregar: [huilo('Mara', 2, MARA), huilo('Rauli', 1, RAULI)] },
    });
    expect(r.avisos ?? []).toEqual([]);
    expect(t.q.montos.lineas.map((l) => l.total)).toEqual([310_000, 155_000]);
    return t;
  }

  it('el prompt enseña a registrar el descuento y deja de prohibirlo', () => {
    expect(SYSTEM).toMatch(/## Descuento/);
    expect(SYSTEM).toMatch(/el descuento de un producto \(ver Descuento\)/);
    expect(SYSTEM).toMatch(/«15 %» es 15 \(nunca 0.15\)/);
  });

  it('escrito junto al producto se aplica, se confirma con el precio original y el rebajado, y queda en la actividad', async () => {
    const t = await conversar();
    const fuente = `${MARA} con 15% de descuento`;
    const r = await t.enviar(fuente, {
      name: 'modificar_cotizacion',
      input: { agregar: [huilo('Mara', 2, fuente, { descuento: { tipo: 'porcentaje', valor: 15 } })] },
    });
    expect(t.q.solicitudes[0].descuento).toEqual({ tipo: 'porcentaje', valor: 15 });
    expect(t.q.solicitudes[0]).not.toHaveProperty('descuentoEscrito');
    expect(t.q.solicitudes[0].cantidad).toBe(2);
    expect(t.q.montos.lineas[0]).toMatchObject({ precioUnitario: 155_000, descuentoUnitario: 23_250, total: 263_500 });
    expect(r.avisos).toEqual([
      'Descuento especial de 15 % en el ítem 1 (Huilo Huilo): $155.000 → $131.750 c/u (ahorro $46.500).',
    ]);
    expect(t.q.historial.at(-1)!.texto).toContain('$155.000 → $131.750 c/u');
    expect(t.eventos().at(-1)).toMatch(/Descuento especial de 2 × Huilo Huilo .*: sin descuento → 15 %/);
    // Se guarda como el descuento del detalle: el PDF y el resumen muestran el precio tachado.
    expect(resumenTexto(t.q)).toContain('$155.000 c/u, descuento especial 15 % → $131.750 c/u');
  });

  it('pedido después, solo cambia el ítem nombrado; una fracción (0,15) se toma como el 15 % escrito', async () => {
    const t = await conPedido();
    const mensaje = 'a la de mara hazle un 15% de descuento';
    const r = await t.enviar(mensaje, editar([{ indice: 0, cambios: { descuento: { tipo: 'porcentaje', valor: 0.15 }, fuente: mensaje } }]));
    expect(t.q.solicitudes.map((s) => s.descuento)).toEqual([{ tipo: 'porcentaje', valor: 15 }, undefined]);
    expect(t.q.montos.lineas.map((l) => l.total)).toEqual([263_500, 155_000]);
    expect(r.avisos).toEqual([
      'Descuento especial de 15 % en el ítem 1 (Huilo Huilo): $155.000 → $131.750 c/u (ahorro $46.500).',
    ]);
  });

  it('el mismo descuento en todos los ítems («a todo»)', async () => {
    const t = await conPedido();
    const mensaje = 'hazle un 10 por ciento de descuento a todo';
    await t.enviar(mensaje, editar([0, 1].map((indice) => ({ indice, cambios: { descuento: { tipo: 'porcentaje', valor: 10 }, fuente: mensaje } }))));
    expect(t.q.montos.lineas.map((l) => [l.descuentoUnitario, l.total])).toEqual([[15_500, 279_000], [15_500, 139_500]]);
  });

  it('un monto por unidad, escrito en pesos', async () => {
    const t = await conPedido();
    const mensaje = 'a la de raulí rebájale 20 mil';
    const r = await t.enviar(mensaje, editar([{ indice: 1, cambios: { descuento: { tipo: 'monto', valor: 20_000 }, fuente: mensaje } }]));
    expect(t.q.solicitudes[1].descuento).toEqual({ tipo: 'monto', valor: 20_000 });
    expect(t.q.montos.lineas[1]).toMatchObject({ descuentoUnitario: 20_000, total: 135_000 });
    expect(r.avisos).toEqual(['Descuento especial de $20.000 c/u en el ítem 2 (Huilo Huilo): $155.000 → $135.000 c/u.']);
  });

  it('una cifra que no está escrita no se aplica: ni otro porcentaje, ni un porcentaje leído como pesos', async () => {
    const t = await conPedido();
    const mensaje = 'a la de mara hazle un 15% de descuento';
    let r = await t.enviar(mensaje, editar([{ indice: 0, cambios: { descuento: { tipo: 'porcentaje', valor: 20 }, fuente: mensaje } }]));
    expect(r.avisos).toEqual([
      'No apliqué el descuento del ítem 1 (Huilo Huilo): el porcentaje no aparece escrito en su línea del pedido.',
    ]);
    r = await t.enviar(mensaje, editar([{ indice: 0, cambios: { descuento: { tipo: 'monto', valor: 15 }, fuente: mensaje } }]));
    expect(r.avisos?.[0]).toBe('No apliqué el descuento del ítem 1 (Huilo Huilo): el monto no aparece escrito en su línea del pedido.');
    expect(t.q.solicitudes[0].descuento).toBeUndefined();
    expect(t.q.montos.lineas[0].total).toBe(310_000);
  });

  it('sin cifra pide cuánto; un porcentaje sobre 100 se rechaza', async () => {
    const t = await conPedido();
    const mensaje = 'hazle un descuento a la de mara';
    let r = await t.enviar(mensaje, editar([{ indice: 0, cambios: { descuento: { tipo: 'porcentaje', valor: null }, fuente: mensaje } }]));
    expect(r.avisos?.[0]).toMatch(/^Indica cuánto descuento quieres para el ítem 1 \(Huilo Huilo\)/);
    const mas = 'a la de mara un 120% de descuento';
    r = await t.enviar(mas, editar([{ indice: 0, cambios: { descuento: { tipo: 'porcentaje', valor: 120 }, fuente: mas } }]));
    expect(r.avisos?.[0]).toBe('No apliqué el descuento del ítem 1 (Huilo Huilo): debe ser un porcentaje mayor que 0 % y hasta 100 %.');
    expect(t.q.solicitudes[0].descuento).toBeUndefined();
  });

  it('se quita si el mensaje lo pide; un null de relleno al editar otro dato no lo borra', async () => {
    const t = await conPedido();
    const pide = 'a todas hazles 15% de descuento';
    await t.enviar(pide, editar([0, 1].map((indice) => ({ indice, cambios: { descuento: { tipo: 'porcentaje', valor: 15 }, fuente: pide } }))));
    // La IA rellena descuento: null al cambiar la cantidad: el mensaje no habla de descuento.
    const cantidad = 'que la de raulí sean 3';
    let r = await t.enviar(cantidad, editar([{ indice: 1, cambios: { cantidad: 3, descuento: null, fuente: cantidad } }]));
    expect(t.q.solicitudes[1]).toMatchObject({ cantidad: 3, descuento: { tipo: 'porcentaje', valor: 15 } });
    expect(r.avisos ?? []).toEqual([]);
    const quitar = 'a la de mara sácale el descuento';
    r = await t.enviar(quitar, editar([{ indice: 0, cambios: { descuento: null, fuente: quitar } }]));
    expect(t.q.solicitudes[0]).not.toHaveProperty('descuento');
    expect(t.q.solicitudes[1].descuento).toEqual({ tipo: 'porcentaje', valor: 15 });
    expect(r.avisos).toEqual(['Quité el descuento especial del ítem 1 (Huilo Huilo): vuelve a $155.000 c/u.']);
    expect(t.eventos().at(-1)).toMatch(/: 15 % → sin descuento/);
  });

  it('un monto mayor que el precio deja el ítem pendiente con su pregunta, sin confirmarlo', async () => {
    const t = await conPedido();
    const mensaje = 'a la de raulí descuéntale $200.000';
    const r = await t.enviar(mensaje, editar([{ indice: 1, cambios: { descuento: { tipo: 'monto', valor: 200_000 }, fuente: mensaje } }]));
    expect(t.q.incompletos).toEqual([expect.objectContaining({ indice: 1, pregunta: expect.stringMatching(/supera su precio unitario \(\$155\.000\)/) })]);
    expect((r.avisos ?? []).some((a) => a.startsWith('Descuento especial'))).toBe(false);
  });

  it('en un ítem incompleto se anota y se aplica cuando se completa', async () => {
    const t = await conversar();
    const fuente = '2 Huilo Huilo de 83,5 x 236 medida de hoja con 15% de descuento';
    const r = await t.enviar(fuente, {
      name: 'modificar_cotizacion',
      input: { agregar: [huilo(null as never, 2, fuente, { descuento: { tipo: 'porcentaje', valor: 15 } })] },
    });
    expect(r.avisos).toContain('Anoté un descuento especial de 15 % para el ítem 1 (Huilo Huilo): se aplica cuando el ítem esté completo.');
    await t.enviar('mara', editar([{ indice: 0, cambios: { madera: 'Mara', fuente: 'mara' } }]));
    expect(t.q.montos.lineas[0]).toMatchObject({ descuentoUnitario: 23_250, total: 263_500 });
  });
});

describe('evaluación de la IA con descuentos', () => {
  const caso = (descuento?: { tipo: 'porcentaje' | 'monto'; valor: number }) =>
    casoSchema.parse({
      id: 'd',
      descripcion: 'descuento',
      mensajes: ['x'],
      esperado: { items: [{ modelo: 'MOLCO', madera: 'LENGA', ancho: 0.8, alto: 2, medida: null, cantidad: 2, ...(descuento ? { descuento } : {}) }] },
    });
  const item = (descuento?: SolicitudItem['descuento']) => ({
    modelo: 'MOLCO', madera: 'LENGA', ancho: 0.8, alto: 2, medida: null, cantidad: 2, ...(descuento ? { descuento } : {}),
  });

  it('mide el descuento como un campo más: el que falta, el que sobra y el distinto son errores', () => {
    expect(CAMPOS_ITEM).toContain('descuento');
    const pct = { tipo: 'porcentaje', valor: 15 } as const;
    const medir = (esperado?: typeof pct, obtenido?: SolicitudItem['descuento']) =>
      puntuar(caso(esperado), { items: [item(obtenido)], cliente: clienteVacio() }).diferencias.map((d) => d.campo);
    expect(medir(pct, pct)).toEqual([]);
    expect(medir(undefined, undefined)).toEqual([]);
    expect(medir(pct, undefined)).toEqual(['descuento']);
    expect(medir(undefined, pct)).toEqual(['descuento']);
    expect(medir(pct, { tipo: 'monto', valor: 15 })).toEqual(['descuento']);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Catalogo, Producto, SolicitudItem } from '../src/catalogo/tipos';
import {
  errorMargenTexto,
  leerPorcentajeConSigno,
  margenAPorcentaje,
  porcentajeAMargen,
  redondearMargen,
} from '../src/negocio/cifras';
import {
  categoriaMargen,
  cotizar,
  ErrorPrecio,
  MARGENES_INICIALES,
  margenProducto,
  origenMargen,
  REGLAS,
  type CategoriaMargen,
} from '../src/negocio/precios';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { abrirBaseDatos, VERSION_ESQUEMA } from '../src/servidor/base-datos';
import {
  configuracionNegocioSchema,
  guardarConfiguracionNegocio,
  leerConfiguracionNegocio,
} from '../src/servidor/configuracion-negocio';
import { cotizacionSchema } from '../src/servidor/persistencia-esquemas';
import { Servicio } from '../src/servidor/servicio';
import { ErrorUsuario } from '../src/servidor/errores';

vi.mock('../src/servidor/pdf', () => ({
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
/** Accesorio del catálogo real: sin tipo y con la madera sola. */
const accesorio = (familia: Producto['familia'], madera: string, overrides: Partial<Producto> = {}): Producto =>
  producto({
    codigo: 'ACC-1', modelo: familia === 'MARCO' ? 'MARCO' : familia === 'MOLDURA' ? 'ENDOLADO' : 'PIEZAS T',
    familia, tipo: null, madera, medida: '2X4', anchoMin: null, anchoMax: null, altoMin: undefined, altoMax: undefined,
    largo: 2.4, descripcion: `${familia} ${madera} 2X4 CM X 2,4 MT`, ...overrides,
  });

describe('categorías de margen', () => {
  const categoria = (p: Producto) => categoriaMargen(p);

  it('puertas sólidas del catálogo: Mara y Lenga, Pino Oregón y Raulí tienen su categoría', () => {
    expect(categoria(producto({ madera: 'MARA' }))).toBe('puertas_solidas_mara_lenga');
    expect(categoria(producto({ madera: 'LENGA' }))).toBe('puertas_solidas_mara_lenga');
    expect(categoria(producto({ madera: 'PINO OREGON' }))).toBe('puertas_solidas_oregon');
    expect(categoria(producto({ madera: 'RAULI' }))).toBe('puertas_solidas_rauli');
    expect(categoria(producto({ madera: 'RAULÍ' }))).toBe('puertas_solidas_rauli');
    // Un tipo de puerta del catálogo real no cambia la categoría.
    for (const tipo of ['PUERTA BLOQUE', 'PUERTA ESPECIAL', 'PUERTA PANEL'])
      expect(categoria(producto({ madera: 'RAULI', tipo }))).toBe('puertas_solidas_rauli');
    expect(categoria(producto({ madera: 'CEDRO' }))).toBe('otros');
  });

  it('marcos, molduras y piezas T son de madera sólida salvo que sean enchapados, prepintados o finger', () => {
    // Regla negativa: una madera nueva del catálogo (Cedro) es sólida sin tocar el código.
    for (const familia of ['MARCO', 'MOLDURA', 'PIEZAS_T'] as const)
      for (const madera of ['LENGA', 'MARA', 'PINO OREGON', 'RAULI', 'CEDRO'])
        expect(categoria(accesorio(familia, madera))).toBe('accesorios_madera_solida');
    // Un accesorio enchapado, prepintado o finger (salvo el marco finger, que tiene sus categorías) cae en «otros».
    expect(categoria(accesorio('MARCO', 'MARA ENCHAPADA'))).toBe('otros');
    expect(categoria(accesorio('PIEZAS_T', 'MARA', { tipo: 'PIEZAS T ENCHAPADAS' }))).toBe('otros');
    expect(categoria(accesorio('MOLDURA', 'PREPINTADA'))).toBe('otros');
    expect(categoria(accesorio('MARCO', 'MARA', { descripcion: 'MARCO MARA PREPINTADO 2X4' }))).toBe('otros');
    expect(categoria(accesorio('MOLDURA', 'PINO FINGER'))).toBe('otros');
    expect(categoria(accesorio('PIEZAS_T', 'PINO FINGER ENCHAPADO MARA'))).toBe('otros');
  });

  it('el marco Pino Finger es desnudo salvo que el producto diga «enchapado»', () => {
    expect(categoria(accesorio('MARCO', 'PINO FINGER'))).toBe('marcos_finger_sin_enchape');
    expect(categoria(accesorio('MARCO', 'PINO FINGER', { descripcion: 'MARCO PINO FINGER DESNUDO 2X4' }))).toBe('marcos_finger_sin_enchape');
    expect(categoria(accesorio('MARCO', 'PINO FINGER', { descripcion: 'MARCO PINO FINGER SIN ENCHAPE 2X4' }))).toBe('marcos_finger_sin_enchape');
    expect(categoria(accesorio('MARCO', 'PINO FINGER ENCHAPADO MARA'))).toBe('marcos_finger_enchapados');
    expect(categoria(accesorio('MARCO', 'PINO FINGER', { tipo: 'MARCO ENCHAPADO' }))).toBe('marcos_finger_enchapados');
    expect(categoria(accesorio('MARCO', 'PINO FINGER', { descripcion: 'MARCO PINO FINGER ENCHAPADO 2X4' }))).toBe('marcos_finger_enchapados');
  });

  it('las puertas de la próxima importación: prepintadas y «MARA ENCHAPADA» nunca son Mara sólida', () => {
    expect(categoria(producto({ madera: 'PREPINTADA', tipo: 'PUERTA PREPINTADA' }))).toBe('puertas_prepintadas');
    expect(categoria(producto({ madera: 'PREPINTADA', tipo: null }))).toBe('puertas_prepintadas');
    expect(categoria(producto({ madera: 'MARA ENCHAPADA', tipo: 'PUERTA ENCHAPADA' }))).toBe('puertas_enchapadas_mara');
    expect(categoria(producto({ madera: 'MARA ENCHAPADA', tipo: null }))).toBe('puertas_enchapadas_mara');
    expect(categoria(producto({ madera: 'MARA ENCHAPADA' }))).not.toBe('puertas_solidas_mara_lenga');
    // Enchapada en otra madera no tiene categoría propia.
    expect(categoria(producto({ madera: 'LENGA ENCHAPADA', tipo: 'PUERTA ENCHAPADA' }))).toBe('otros');
    // Las de siempre siguen igual.
    expect(categoria(producto({ madera: 'MARA', tipo: 'PUERTA PREPINTADA' }))).toBe('puertas_prepintadas');
    expect(categoria(producto({ madera: 'MARA', tipo: 'PUERTA ENCHAPADA' }))).toBe('puertas_enchapadas_mara');
  });

  it('cada categoría cotiza con su margen inicial', () => {
    const reglas = { ...REGLAS, margenes: MARGENES_INICIALES };
    const casos: [Producto, CategoriaMargen, number][] = [
      [producto({ madera: 'MARA' }), 'puertas_solidas_mara_lenga', 0.55],
      [producto({ madera: 'LENGA' }), 'puertas_solidas_mara_lenga', 0.55],
      [producto({ madera: 'PINO OREGON' }), 'puertas_solidas_oregon', 0.85],
      [producto({ madera: 'RAULI' }), 'puertas_solidas_rauli', 0.25],
      [producto({ madera: 'PREPINTADA', tipo: 'PUERTA PREPINTADA' }), 'puertas_prepintadas', 1.4],
      [producto({ madera: 'MARA ENCHAPADA', tipo: 'PUERTA ENCHAPADA' }), 'puertas_enchapadas_mara', 0.75],
      [accesorio('MARCO', 'PINO FINGER'), 'marcos_finger_sin_enchape', 1],
      [accesorio('MARCO', 'PINO FINGER ENCHAPADO MARA'), 'marcos_finger_enchapados', 0.75],
      [accesorio('MARCO', 'RAULI'), 'accesorios_madera_solida', 0.25],
      [accesorio('PIEZAS_T', 'PINO OREGON'), 'accesorios_madera_solida', 0.25],
      [accesorio('MARCO', 'CEDRO'), 'accesorios_madera_solida', 0.25],
      [accesorio('MARCO', 'MARA ENCHAPADA'), 'otros', 0.25],
    ];
    for (const [p, esperada, margen] of casos) {
      expect(categoriaMargen(p)).toBe(esperada);
      expect(MARGENES_INICIALES[esperada]).toBe(margen);
      const linea = cotizar([{ producto: p, cantidad: 1 }], reglas).lineas[0];
      expect(linea.margen).toBe(margen);
      expect(linea.precioUnitario).toBe(Math.round(100_000 * (1 + margen)));
    }
    expect(Object.keys(MARGENES_INICIALES)).toHaveLength(9);
  });
});

describe('reglas congeladas antes de las categorías nuevas', () => {
  const LEGADO = {
    puertas_solidas_mara_lenga: 0.5, puertas_solidas_oregon: 0.8, puertas_prepintadas: 1.3,
    puertas_enchapadas_mara: 0.7, marcos_finger_sin_enchape: 0.9, marcos_finger_enchapados: 0.65, otros: 0.3,
  };

  it('una categoría que las reglas no traen usa el «otros» de la propia cotización, no el de la configuración', () => {
    const reglas = { ...REGLAS, margenes: LEGADO };
    expect(margenProducto(producto({ madera: 'RAULI' }), reglas)).toBe(0.3);
    expect(margenProducto(accesorio('MARCO', 'LENGA'), reglas)).toBe(0.3);
    expect(margenProducto(producto({ madera: 'MARA' }), reglas)).toBe(0.5);
    // Con la configuración actual distinta, la cotización congelada no se entera.
    const actual = { ...MARGENES_INICIALES, puertas_solidas_rauli: 0.9, otros: 0.1 };
    expect(margenProducto(producto({ madera: 'RAULI' }), { ...REGLAS, margenes: actual })).toBe(0.9);
    expect(margenProducto(producto({ madera: 'RAULI' }), reglas)).toBe(0.3);
  });

  it('sin «otros» en las reglas cae en el ajuste; sin márgenes por categoría, también', () => {
    const sinOtros: Partial<typeof LEGADO> = { ...LEGADO };
    delete sinOtros.otros;
    expect(margenProducto(producto({ madera: 'RAULI' }), { ajuste: 0.4, margenes: sinOtros })).toBe(0.4);
    expect(margenProducto(producto({ madera: 'MARA' }), { ajuste: 0.4 })).toBe(0.4);
    expect(margenProducto(producto({ madera: 'RAULI' }), { ajuste: 0.4, margenes: {} })).toBe(0.4);
  });

  it('el esquema de cotización acepta los siete márgenes antiguos y los nueve nuevos, y rechaza claves ajenas', () => {
    const base = cotizacionMinima();
    expect(cotizacionSchema.safeParse({ ...base, reglas: { ...REGLAS, margenes: LEGADO } }).success).toBe(true);
    expect(cotizacionSchema.safeParse({ ...base, reglas: { ...REGLAS, margenes: MARGENES_INICIALES } }).success).toBe(true);
    expect(cotizacionSchema.safeParse({ ...base, reglas: { ...REGLAS, margenes: { ...LEGADO, inventada: 1 } } }).success).toBe(false);
    expect(cotizacionSchema.safeParse({ ...base, margenCotizacion: 0.42, reglas: REGLAS }).success).toBe(true);
    expect(cotizacionSchema.safeParse({ ...base, margenCotizacion: null, reglas: REGLAS }).success).toBe(true);
    expect(cotizacionSchema.safeParse({ ...base, margenCotizacion: 7, reglas: REGLAS }).success).toBe(false);
  });

  it('la configuración guardada con siete márgenes recibe el valor inicial de las categorías nuevas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-margenes-'));
    dirs.push(dir);
    const db = abrirBaseDatos(join(dir, 'cotizador.sqlite'), { cachear: false, permitirJsonLegado: true });
    try {
      const guardada = {
        reglas: { ...REGLAS, margenes: { ...LEGADO, puertas_solidas_mara_lenga: 0.6 } },
      };
      db.prepare('INSERT INTO ajustes (clave, valor_json, actualizada) VALUES (?, ?, ?)').run(
        'negocio', JSON.stringify(guardada), new Date().toISOString(),
      );
      const { reglas } = leerConfiguracionNegocio(db);
      expect(reglas.margenes).toEqual({
        ...MARGENES_INICIALES, ...LEGADO, puertas_solidas_mara_lenga: 0.6,
        puertas_solidas_rauli: MARGENES_INICIALES.puertas_solidas_rauli,
        accesorios_madera_solida: MARGENES_INICIALES.accesorios_madera_solida,
      });
      // Un cliente antiguo que guarda solo los siete también obtiene los valores iniciales.
      const completa = leerConfiguracionNegocio(db);
      const enviada = { ...completa, reglas: { ...completa.reglas, margenes: LEGADO } };
      const valida = configuracionNegocioSchema.parse(enviada);
      expect(valida.reglas.margenes.puertas_solidas_rauli).toBe(MARGENES_INICIALES.puertas_solidas_rauli);
      expect(valida.reglas.margenes.accesorios_madera_solida).toBe(MARGENES_INICIALES.accesorios_madera_solida);
      const guardadaDeNuevo = guardarConfiguracionNegocio(enviada, db);
      expect(Object.keys(guardadaDeNuevo.reglas.margenes)).toHaveLength(9);
    } finally {
      db.close();
    }
  });
});

describe('margen especial de la cotización en el cálculo', () => {
  const reglas = { ...REGLAS, margenes: MARGENES_INICIALES };
  const mara = producto({ madera: 'MARA' });
  const rauli = producto({ codigo: 'HUI-R-3-A', madera: 'RAULI' });

  it('pasa por encima de la categoría y no marca las líneas como personalizadas', () => {
    const { lineas } = cotizar([{ producto: mara, cantidad: 1 }, { producto: rauli, cantidad: 2 }], reglas, { margenCotizacion: 0.42 });
    expect(lineas.map((l) => [l.margen, l.precioUnitario, l.precioFabrica, l.margenPersonalizado])).toEqual([
      [0.42, 142_000, 100_000, false],
      [0.42, 142_000, 100_000, false],
    ]);
  });

  it('el margen de la línea pasa por encima del de la cotización; el precio fijado, por encima de ambos', () => {
    const { lineas } = cotizar(
      [
        { producto: mara, cantidad: 1, margen: 0.3 },
        { producto: rauli, cantidad: 1 },
        { producto: mara, cantidad: 1, precioUnitario: 123_456 },
      ],
      reglas,
      { margenCotizacion: 0.42 },
    );
    expect(lineas.map((l) => [l.precioUnitario, l.margenPersonalizado])).toEqual([[130_000, true], [142_000, false], [123_456, false]]);
    expect(origenMargen(lineas[0], 0.42)).toBe('linea');
    expect(origenMargen(lineas[1], 0.42)).toBe('cotizacion');
    expect(origenMargen(lineas[2], 0.42)).toBe('precio');
    expect(origenMargen(lineas[1], null)).toBe('categoria');
    expect(origenMargen(lineas[1], undefined)).toBe('categoria');
  });

  it('sin margen especial (null o ausente) vuelve a la categoría; admite 0 % y márgenes negativos', () => {
    for (const extras of [{ margenCotizacion: null }, {}, { margenCotizacion: undefined }])
      expect(cotizar([{ producto: mara, cantidad: 1 }], reglas, extras).lineas[0].margen).toBe(0.55);
    expect(cotizar([{ producto: mara, cantidad: 1 }], reglas, { margenCotizacion: 0 }).lineas[0].precioUnitario).toBe(100_000);
    expect(cotizar([{ producto: mara, cantidad: 1 }], reglas, { margenCotizacion: -0.1 }).lineas[0].precioUnitario).toBe(90_000);
    expect(cotizar([{ producto: mara, cantidad: 1 }], reglas, { margenCotizacion: 0.07 }).lineas[0].precioUnitario).toBe(107_000);
  });

  it('rechaza un margen especial fuera de −50 %…500 % o con más de dos decimales', () => {
    for (const margenCotizacion of [-0.51, 5.01, 0.12345, Number.NaN, Infinity]) {
      const error = (() => {
        try {
          cotizar([{ producto: mara, cantidad: 1 }], reglas, { margenCotizacion });
        } catch (e) {
          return e;
        }
      })();
      expect(error).toBeInstanceOf(ErrorPrecio);
      expect((error as ErrorPrecio).codigo).toBe('margen_invalido');
    }
    expect(() => cotizar([{ producto: mara, cantidad: 1 }], reglas, { margenCotizacion: 0.1234 })).not.toThrow();
    expect(() => cotizar([{ producto: mara, cantidad: 1 }], reglas, { margenCotizacion: -0.5 })).not.toThrow();
    expect(() => cotizar([{ producto: mara, cantidad: 1 }], reglas, { margenCotizacion: 5 })).not.toThrow();
  });
});

describe('lectura del margen escrito en el formulario', () => {
  it('acepta coma o punto decimal, «%» y signo negativo', () => {
    expect(leerPorcentajeConSigno('42')).toBe(42);
    expect(leerPorcentajeConSigno(' 12,5 % ')).toBe(12.5);
    expect(leerPorcentajeConSigno('-10')).toBe(-10);
    expect(leerPorcentajeConSigno('\u221210,5')).toBe(-10.5);
    expect(Number.isNaN(leerPorcentajeConSigno('abc'))).toBe(true);
    expect(Number.isNaN(leerPorcentajeConSigno('--3'))).toBe(true);
  });

  it('sin ningún dígito no es un número: nunca se lee como 0 % (precio de fábrica)', () => {
    for (const texto of ['-', '\u2212', '- %', '%', ' % ', '-%', '\u2212 %', '', '  ', ',', '-,']) {
      expect(Number.isNaN(leerPorcentajeConSigno(texto)), JSON.stringify(texto)).toBe(true);
      expect(errorMargenTexto(texto), JSON.stringify(texto)).toBe('Escribe un número.');
    }
    // El cero escrito de verdad sí es válido.
    expect(leerPorcentajeConSigno('0')).toBe(0);
    expect(leerPorcentajeConSigno('-0')).toBe(-0);
    expect(errorMargenTexto('0')).toBeNull();
  });

  it('valida rango y decimales con un mensaje, y los acepta en el límite', () => {
    expect(errorMargenTexto('42')).toBeNull();
    expect(errorMargenTexto('-50')).toBeNull();
    expect(errorMargenTexto('500')).toBeNull();
    expect(errorMargenTexto('12,34 %')).toBeNull();
    expect(errorMargenTexto('-50,01')).toMatch(/entre -50 y 500/);
    expect(errorMargenTexto('500,01')).toMatch(/entre -50 y 500/);
    expect(errorMargenTexto('600')).toMatch(/entre -50 y 500/);
    expect(errorMargenTexto('1'.repeat(400))).toMatch(/entre -50 y 500/);
    expect(errorMargenTexto('12,345')).toBe('Usa como máximo dos decimales.');
    expect(errorMargenTexto('abc')).toBe('Escribe un número.');
  });

  it('convierte porcentaje y fracción sin ruido binario', () => {
    expect(porcentajeAMargen(7)).toBe(0.07);
    expect(porcentajeAMargen(57)).toBe(0.57);
    expect(porcentajeAMargen(14)).toBe(0.14);
    expect(porcentajeAMargen(-10.5)).toBe(-0.105);
    expect(Object.is(porcentajeAMargen(-0), 0)).toBe(true);
    expect(redondearMargen(0.07000000000000001)).toBe(0.07);
    expect(margenAPorcentaje(0.07)).toBe(7);
    expect(margenAPorcentaje(0.5699999999999999)).toBe(57);
    expect(margenAPorcentaje(0.2345)).toBe(23.45);
  });
});

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

function cotizacionMinima() {
  const fecha = '2026-01-01T00:00:00.000Z';
  return {
    id: 'q', numero: null, estado: 'borrador', cliente: { nombre: null, rut: null, giro: null, telefono: null, direccion: null, comuna: null, proyecto: null },
    solicitudes: [], montos: { lineas: [], subtotal: 0, descuentoPorcentaje: 0, descuento: 0, flete: 0, neto: 0, iva: 0, total: 0 },
    incompletos: [], historial: [], creada: fecha, actualizada: fecha, pdf: null, vence: null, descuento: 0, flete: 0,
    creadaPor: null, emitidaPor: null, aprobadaPor: null, anuladaPor: null, fechaAnulacion: null, motivoAnulacion: null,
    reemplazadaPor: null, versionCatalogo: null, nota: null,
  };
}

const CLIENTE = { nombre: 'Ana Soto', rut: null, giro: null, telefono: null, direccion: null, comuna: null, proyecto: null };
const catalogo: Catalogo = {
  fuente: 'test.xlsx', sha256: 'catalogo-margenes', fecha: '2026-01-01T00:00:00.000Z',
  productos: [producto({ madera: 'MARA' }), producto({ codigo: 'HUI-R-3-A', madera: 'RAULI', descripcion: 'HUILO HUILO RAULI 0,80 A 0,85 MT X 2,30 A 2,40 MT' })],
};
const itemsPedido: SolicitudItem[] = [
  { modelo: 'Huilo Huilo', madera: 'Mara', ancho: 83.5, alto: 236, medida: null, cantidad: 1 },
  { modelo: 'Huilo Huilo', madera: 'Rauli', ancho: 83.5, alto: 236, medida: null, cantidad: 2 },
];

async function preparar() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-margenes-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const llm = { interpretar: vi.fn().mockResolvedValue({ name: 'actualizar_cotizacion', input: { items: itemsPedido, cliente: CLIENTE } }) };
  const servicio = new Servicio(catalogo, llm, almacen);
  let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza Huilo Huilo en Mara y Raulí' })).cotizacion;
  const precios = () => q.montos.lineas.map((l) => l.precioUnitario);
  const editar = async (cambios: Record<string, unknown>) => {
    const r = await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, ...cambios } as never);
    q = r.cotizacion;
    return r;
  };
  const detalles = () => almacen.eventos(q.id).filter((e) => e.tipo === 'modificada').map((e) => e.detalle);
  return { dir, almacen, servicio, llm, editar, precios, detalles, get q() { return q; }, set q(v) { q = v; } };
}

describe('margen especial de la cotización en el servicio', () => {
  it('se edita, se persiste, deja registro y se restaura; el margen de la línea tiene prioridad', async () => {
    const t = await preparar();
    expect(t.q.margenCotizacion).toBeNull();
    // Categoría: Mara 55 %, Raulí 25 % (valor inicial de la categoría nueva).
    expect(t.precios()).toEqual([155_000, 125_000]);

    await t.editar({ margenCotizacion: 0.42 });
    expect(t.q.margenCotizacion).toBe(0.42);
    expect(t.precios()).toEqual([142_000, 142_000]);
    expect(t.q.montos.lineas.every((l) => l.margenPersonalizado === false)).toBe(true);
    expect(t.q.montos.subtotal).toBe(142_000 * 3);
    expect(new Almacen(t.dir).obtener(t.q.id)!.margenCotizacion).toBe(0.42);
    expect(t.detalles().at(-1)).toBe('Margen especial de la cotización: estándar de categoría → 42 %');

    // Una línea con margen propio gana al de la cotización.
    await t.editar({ items: [{ indice: 0, cambios: { margen: 0.3 } }] });
    expect(t.precios()).toEqual([130_000, 142_000]);
    expect(t.q.montos.lineas.map((l) => l.margenPersonalizado)).toEqual([true, false]);
    expect(t.detalles().at(-1)).toContain('42 % → 30 %');

    // Un porcentaje con ruido binario (7 / 100) es válido y el registro no lo arrastra.
    await t.editar({ margenCotizacion: 0.07 });
    expect(t.q.margenCotizacion).toBe(0.07);
    expect(t.precios()).toEqual([130_000, 107_000]);
    expect(t.detalles().at(-1)).toBe('Margen especial de la cotización: 42 % → 7 %');

    // Quitar el margen de la línea vuelve al de la cotización y el registro lo dice así.
    await t.editar({ items: [{ indice: 0, cambios: { margen: null } }] });
    expect(t.precios()).toEqual([107_000, 107_000]);
    expect(t.detalles().at(-1)).toContain('30 % → margen especial de la cotización');

    // Repetir el mismo valor no cambia la versión ni agrega registro.
    const antes = { version: t.q.actualizada, eventos: t.detalles().length };
    await t.editar({ margenCotizacion: 0.07 });
    expect([t.q.actualizada, t.detalles().length]).toEqual([antes.version, antes.eventos]);

    // Restaurar: vuelve la categoría.
    await t.editar({ margenCotizacion: null });
    expect(t.q.margenCotizacion).toBeNull();
    expect(t.precios()).toEqual([155_000, 125_000]);
    expect(t.detalles().at(-1)).toBe('Margen especial de la cotización: 7 % → estándar de categoría');
    expect(new Almacen(t.dir).obtener(t.q.id)!.margenCotizacion).toBeNull();
  });

  it('quitar el margen de una línea sin margen especial vuelve a la categoría; y una línea con margen 0 sigue siendo manual', async () => {
    const t = await preparar();
    await t.editar({ items: [{ indice: 0, cambios: { margen: 0.3 } }] });
    expect(t.precios()[0]).toBe(130_000);
    await t.editar({ items: [{ indice: 0, cambios: { margen: null } }] });
    expect(t.precios()[0]).toBe(155_000);
    expect(t.detalles().at(-1)).toContain('30 % → estándar de categoría');
    await t.editar({ margenCotizacion: 0.42, items: [{ indice: 1, cambios: { margen: 0 } }] });
    expect(t.precios()).toEqual([142_000, 100_000]);
    // 7 % como línea (antes se rechazaba por el error binario de 0,07 × 10.000).
    await t.editar({ items: [{ indice: 0, cambios: { margen: 0.07 } }] });
    expect(t.precios()[0]).toBe(107_000);
    expect(t.detalles().at(-1)).toContain('42 % → 7 %');
  });

  it('guarda el margen de una línea sin ruido binario y repetirlo no deja otra línea de registro', async () => {
    const t = await preparar();
    await t.editar({ items: [{ indice: 0, cambios: { margen: 0.07000000000000001 } }] });
    expect(t.q.solicitudes[0].margen).toBe(0.07);
    expect(t.precios()[0]).toBe(107_000);
    expect(t.detalles().at(-1)).toContain('55 % → 7 %');
    await t.editar({ items: [{ indice: 0, cambios: { margen: 0.07000000000000001 } }] });
    await t.editar({ items: [{ indice: 0, cambios: { margen: 0.07 } }] });
    expect(t.detalles().filter((d) => d?.includes('Margen de '))).toHaveLength(1);
    expect(t.q.solicitudes[0].margen).toBe(0.07);
  });

  it('valida el rango y los decimales, y una edición rechazada no toca la cotización', async () => {
    const t = await preparar();
    const version = t.q.actualizada;
    for (const margenCotizacion of [6, -0.51, 0.12345, 5.01]) {
      await expect(t.editar({ margenCotizacion })).rejects.toBeInstanceOf(ErrorUsuario);
      await expect(t.editar({ margenCotizacion })).rejects.toThrow(/margen especial de la cotización/);
    }
    expect(new Almacen(t.dir).obtener(t.q.id)).toMatchObject({ actualizada: version, margenCotizacion: null });
    await t.editar({ margenCotizacion: -0.5 });
    await t.editar({ margenCotizacion: 5 });
    expect(t.precios()).toEqual([600_000, 600_000]);
  });

  it('sobrevive a un mensaje del chat, y la IA nunca lo ve', async () => {
    const t = await preparar();
    await t.editar({ margenCotizacion: 0.42 });
    const r = await t.servicio.ejecutar({ tipo: 'chat', id: t.q.id, actualizada: t.q.actualizada, mensaje: 'cotiza Huilo Huilo en Mara y Raulí' });
    t.q = r.cotizacion;
    expect(t.q.margenCotizacion).toBe(0.42);
    expect(t.precios()).toEqual([142_000, 142_000]);
    const contexto = JSON.stringify(t.llm.interpretar.mock.calls.at(-1)![0]);
    expect(contexto).not.toMatch(/margen|0\.42|0,42|142/i);
  });

  it('una modificación parcial por chat (borrador y emitida) tampoco toca el margen especial', async () => {
    const t = await preparar();
    await t.editar({ margenCotizacion: 0.42 });
    const cambiar = (cantidad: number) => ({ name: 'modificar_cotizacion', input: { items: [{ indice: 1, cambios: { cantidad } }] } });
    // Borrador: cambia la cantidad de la segunda línea; el margen y los precios siguen.
    t.llm.interpretar.mockResolvedValueOnce(cambiar(4));
    let r = await t.servicio.ejecutar({ tipo: 'chat', id: t.q.id, actualizada: t.q.actualizada, objetivoId: t.q.id, objetivoActualizada: t.q.actualizada, mensaje: 'ahora 4 de Raulí' });
    t.q = r.cotizacion;
    expect(t.q).toMatchObject({ margenCotizacion: 0.42 });
    expect(t.q.montos.lineas.map((l) => [l.cantidad, l.precioUnitario])).toEqual([[1, 142_000], [4, 142_000]]);
    // Emitida: el cambio abre una revisión que conserva el margen; la emitida queda como estaba.
    const emitida = (await t.servicio.ejecutar({ tipo: 'emitir', id: t.q.id, actualizada: t.q.actualizada })).cotizacion;
    t.llm.interpretar.mockResolvedValueOnce(cambiar(2));
    r = await t.servicio.ejecutar({ tipo: 'chat', objetivoId: emitida.id, objetivoActualizada: emitida.actualizada, mensaje: `ahora 2 de Raulí en la ${emitida.numero}` });
    expect(r.cotizacion).toMatchObject({ estado: 'borrador', origen: emitida.numero, margenCotizacion: 0.42 });
    expect(r.cotizacion.montos.lineas.map((l) => [l.cantidad, l.precioUnitario])).toEqual([[1, 142_000], [2, 142_000]]);
    expect(new Almacen(t.dir).obtener(emitida.id)).toMatchObject({ margenCotizacion: 0.42 });
  });

  it('la nota de pedido sale a precio de fábrica con el margen especial y con márgenes de línea', async () => {
    const t = await preparar();
    await t.editar({ margenCotizacion: 0.42, items: [{ indice: 0, cambios: { margen: 0.3 } }] });
    expect(t.precios()).toEqual([130_000, 142_000]);
    let q = (await t.servicio.ejecutar({ tipo: 'emitir', id: t.q.id, actualizada: t.q.actualizada })).cotizacion;
    expect(q.margenCotizacion).toBe(0.42);
    expect(q.montos.lineas.map((l) => l.precioUnitario)).toEqual([130_000, 142_000]);
    q = (await t.servicio.ejecutar({ tipo: 'aprobar', id: q.id, actualizada: q.actualizada })).cotizacion;
    q = (await t.servicio.ejecutar({ tipo: 'pago', id: q.id, actualizada: q.actualizada, monto: Math.ceil(q.montos.total * 0.5), fecha: '2026-09-30' })).cotizacion;
    q = (await t.servicio.ejecutar({ tipo: 'generar_nota', id: q.id, actualizada: q.actualizada })).cotizacion;
    const nota = new Almacen(t.dir).obtener(q.id)!.nota!;
    expect(nota.montos.lineas.map((l) => [l.precioUnitario, l.precioFabrica, l.margen, l.margenPersonalizado])).toEqual([
      [100_000, 100_000, 0, false],
      [100_000, 100_000, 0, false],
    ]);
    expect(nota.montos.subtotal).toBe(100_000 * 3);
    // La cotización conserva lo vendido.
    expect(q.montos.lineas.map((l) => l.precioUnitario)).toEqual([130_000, 142_000]);
  });

  it('editar una cotización emitida abre una revisión que conserva el margen; duplicar también lo copia', async () => {
    const t = await preparar();
    await t.editar({ margenCotizacion: 0.42 });
    const emitida = (await t.servicio.ejecutar({ tipo: 'emitir', id: t.q.id, actualizada: t.q.actualizada })).cotizacion;
    const revision = (await t.servicio.ejecutar({ tipo: 'editar', id: emitida.id, actualizada: emitida.actualizada, margenCotizacion: 0.3 })).cotizacion;
    expect(revision).toMatchObject({ estado: 'borrador', origen: emitida.numero, margenCotizacion: 0.3 });
    expect(revision.montos.lineas.map((l) => l.precioUnitario)).toEqual([130_000, 130_000]);
    expect(new Almacen(t.dir).obtener(emitida.id)).toMatchObject({ margenCotizacion: 0.42 });
    expect(new Almacen(t.dir).obtener(emitida.id)!.montos.lineas.map((l) => l.precioUnitario)).toEqual([142_000, 142_000]);
    const copia = (await t.servicio.ejecutar({ tipo: 'duplicar', id: emitida.id })).cotizacion;
    expect(copia).toMatchObject({ estado: 'borrador', margenCotizacion: 0.42 });
    expect(copia.montos.lineas.map((l) => l.precioUnitario)).toEqual([142_000, 142_000]);
  });

  it('una cotización congelada con siete márgenes usa su propio «otros» aunque cambie la configuración', async () => {
    const t = await preparar();
    const LEGADO = {
      puertas_solidas_mara_lenga: 0.5, puertas_solidas_oregon: 0.8, puertas_prepintadas: 1.3,
      puertas_enchapadas_mara: 0.7, marcos_finger_sin_enchape: 0.9, marcos_finger_enchapados: 0.65, otros: 0.3,
    };
    await t.almacen.transaccion((u) => {
      const x = u.obtener(t.q.id)!;
      x.reglas = { ...x.reglas!, margenes: LEGADO };
      u.guardar(x);
    });
    // Se cambia la configuración actual: Raulí al 90 %.
    const db = t.almacen.baseDatos();
    const config = leerConfiguracionNegocio(db);
    guardarConfiguracionNegocio({ ...config, reglas: { ...config.reglas, margenes: { ...config.reglas.margenes, puertas_solidas_rauli: 0.9 } } }, db);
    const leida = new Almacen(t.dir).obtener(t.q.id)!;
    expect(leida.reglas?.margenes).toEqual(LEGADO);
    t.q = leida;
    // Mara 50 % (su regla congelada) y Raulí 30 % (su «otros» congelado), no el 25 % inicial ni el 90 % actual.
    await t.editar({ cantidades: [{ indice: 1, cantidad: 3 }] });
    expect(t.precios()).toEqual([150_000, 130_000]);
    // Una cotización nueva sí toma la configuración vigente.
    const nueva = (await t.servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza Huilo Huilo en Mara y Raulí' })).cotizacion;
    expect(nueva.montos.lineas.map((l) => l.precioUnitario)).toEqual([155_000, 190_000]);
    expect(Object.keys(nueva.reglas!.margenes!)).toHaveLength(9);
  });

  it('la migración agrega la columna sin tocar las cotizaciones existentes ni sus reglas congeladas', async () => {
    const t = await preparar();
    const LEGADO = {
      puertas_solidas_mara_lenga: 0.55, puertas_solidas_oregon: 0.85, puertas_prepintadas: 1.4,
      puertas_enchapadas_mara: 0.75, marcos_finger_sin_enchape: 1, marcos_finger_enchapados: 0.75, otros: 0.3,
    };
    const ruta = join(t.dir, 'cotizador.sqlite');
    const db = t.almacen.baseDatos();
    db.prepare('UPDATE cotizaciones SET reglas_json = ? WHERE id = ?').run(
      JSON.stringify({ ...REGLAS, margenes: LEGADO }), t.q.id,
    );
    // Deja la base como estaba en v12: sin la columna.
    db.exec('ALTER TABLE cotizaciones DROP COLUMN margen_cotizacion; PRAGMA user_version = 12;');
    cerrarAlmacen(ruta);

    const migrada = abrirBaseDatos(ruta, { cachear: false });
    try {
      expect(migrada.pragma('user_version', { simple: true })).toBe(VERSION_ESQUEMA);
      const columnas = (migrada.pragma('table_info(cotizaciones)') as { name: string }[]).map((c) => c.name);
      expect(columnas).toContain('margen_cotizacion');
      expect(migrada.prepare('SELECT margen_cotizacion AS m FROM cotizaciones WHERE id = ?').get(t.q.id)).toEqual({ m: null });
    } finally {
      migrada.close();
    }
    const recargada = new Almacen(t.dir).obtener(t.q.id)!;
    expect(recargada.margenCotizacion).toBeNull();
    expect(recargada.reglas?.margenes).toEqual(LEGADO);
    // La cotización migrada se puede editar con normalidad: Raulí usa el «otros» congelado (30 %).
    t.q = recargada;
    await t.editar({ cantidades: [{ indice: 1, cantidad: 3 }] });
    expect(t.precios()[1]).toBe(130_000);
    await t.editar({ margenCotizacion: 0.1 });
    expect(t.precios()).toEqual([110_000, 110_000]);
  });
});

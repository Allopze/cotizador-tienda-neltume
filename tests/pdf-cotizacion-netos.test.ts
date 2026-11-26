import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clienteVacio, type Producto } from '../src/catalogo/tipos';
import type { Cotizacion } from '../src/negocio/estado';
import { productoPersonalizado } from '../src/negocio/personalizados';
import { cotizar, montosVacios, pesos, REGLAS } from '../src/negocio/precios';
import { cerrarBaseDatos } from '../src/servidor/base-datos';
import { chromiumPath } from '../src/servidor/chromium';
import { cerrarNavegadorPdf, generarPdf, plantilla } from '../src/servidor/pdf';
import { ESTILOS_COTIZACION, etiquetaIva, etiquetaSubtotal, notaTabla, trasTabla, valoresNetos } from '../src/servidor/pdf-cotizacion-tabla';

// Cotización al cliente: sin número por fila, importes netos con «+ IVA» debajo y la nota de netos bajo la tabla
// (docs/estilo-documentos-v1.md, §5). La nota de pedido y la orden de trabajo no cambian (§8): se comprueba que no
// llevan nada de esto.

const FECHA = '2026-11-26T15:00:00.000Z';
const base = vi.hoisted(() => ({ dir: '' }));

const puerta: Producto = {
  codigo: 'MOL-O-3-A', modelo: 'MOLCO', familia: 'PUERTA', tipo: 'PUERTA PANEL', madera: 'PINO OREGON',
  medida: '0,80 A 0,85', anchoMin: 0.8, anchoMax: 0.85, largo: 2, precioNeto: 100000,
  descripcion: 'MOLCO PINO OREGON 0,80 A 0,85 MT X 2 MT', filaOrigen: 4,
};
const modelos = ['MOLCO', 'HUILO', 'RANCO', 'PALENA', 'ENCO', 'FUY', 'YELCHO', 'COCHAMO', 'ENSENADA', 'RUPANCO', 'PETROHUE', 'CALAFQUEN'];
const puertas: Producto[] = modelos.map((modelo, i) => ({
  ...puerta, codigo: `${modelo.slice(0, 3)}-O-3-A`, modelo, precioNeto: 90_000 + i * 7_500,
  descripcion: `${modelo} PINO OREGON 0,80 A 0,85 MT X 2 MT`, filaOrigen: 4 + i,
}));
const marco: Producto = {
  ...puerta, codigo: 'MAR-O-2X4-B', modelo: 'MARCO', familia: 'MARCO', tipo: 'MARCO', medida: '2X4',
  anchoMin: null, anchoMax: null, largo: 2.1, precioNeto: 38000, descripcion: 'MARCO PINO OREGON 2X4 X 2,10 MT',
};

const cotizacion = (descuento = 0, flete = 0): Cotizacion => ({
  id: 'x', numero: 325, estado: 'emitida',
  cliente: { ...clienteVacio(), nombre: 'Constructora Ejemplo SpA', rut: '76.543.210-3', giro: 'Construcción', proyecto: 'Edificio Los Robles' },
  solicitudes: [], montos: montosVacios(), incompletos: [], historial: [],
  creada: FECHA, actualizada: FECHA, pdf: null, fechaEmision: FECHA, origen: null, vence: '2026-12-10',
  descuento, flete, creadaPor: 'Paula Soto', emitidaPor: 'Paula Soto', aprobadaPor: null, anuladaPor: null,
  fechaAnulacion: null, motivoAnulacion: null, reemplazadaPor: null, versionCatalogo: null, notas: [],
});
const docCotizacion = (montos: ReturnType<typeof cotizar>, extra: { reglas?: typeof REGLAS } = {}) => ({
  tipo: 'cotizacion' as const, numero: 325, montos, fecha: FECHA, vence: '2026-12-10', autor: 'Paula Soto', ...extra,
});
const lineas = () => [
  { producto: puerta, cantidad: 2, anchoSolicitado: 0.82, altoSolicitado: 2, tipoMedida: 'hoja' as const },
  { producto: puertas[1], cantidad: 1, anchoSolicitado: 0.8, altoSolicitado: 2 },
];

beforeAll(async () => {
  base.dir = await mkdtemp(join(tmpdir(), 'neltume-cot-netos-'));
  vi.stubEnv('NELTUME_DB_PATH', join(base.dir, 'cotizador.sqlite'));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await cerrarNavegadorPdf();
  cerrarBaseDatos(join(base.dir, 'cotizador.sqlite'));
  await rm(base.dir, { recursive: true, force: true });
});

const tablaDe = (html: string) => html.match(/<table>[\s\S]*?<\/table>/)![0];
const cuerpoDe = (html: string) => html.match(/<tbody>[\s\S]*?<\/tbody>/)![0];

describe('Cotización: tabla, IVA y nota de netos (HTML)', () => {
  it('sin número por fila: la primera columna va sin título, con un guion en cada fila, y los importes dicen que son netos', async () => {
    const tabla = tablaDe(await plantilla(cotizacion(), docCotizacion(cotizar(lineas()))));
    expect(tabla).toContain('<thead><tr><th class="n"></th><th class="prod">Producto</th><th class="r cant">Cant.</th><th class="r unit">Precio unit. neto</th><th class="r tot">Total neto</th></tr></thead>');
    expect(tabla.match(/<td class="n">-<\/td>/g)).toHaveLength(2);
    expect(tabla).not.toMatch(/N\.º|Precio unitario|<th class="r tot">Total<\/th>|<td class="n">\d/);
  });

  it('«+ IVA» va bajo cada unitario y cada total, también en el flete; cada monto sigue siendo un solo fragmento', async () => {
    const montos = cotizar(lineas(), undefined, { flete: 15000 });
    const cuerpo = cuerpoDe(await plantilla(cotizacion(0, 15000), docCotizacion(montos)));
    expect(cuerpo.match(/<span class="iva">\+ IVA<\/span>/g)).toHaveLength(2 * 3);
    const [l1, l2] = montos.lineas;
    expect(cuerpo).toContain(`<td class="r unit">${pesos(l1.precioUnitario)}<span class="iva">+ IVA</span></td><td class="r tot">${pesos(l1.total)}<span class="iva">+ IVA</span></td>`);
    expect(cuerpo).toContain(`<td class="r unit">${pesos(l2.precioUnitario)}<span class="iva">+ IVA</span></td>`);
    expect(cuerpo).toMatch(/<td class="n">-<\/td><td class="prod"><b>Flete \/ despacho<\/b>.*<td class="r unit">\$15\.000<span class="iva">\+ IVA<\/span><\/td>/);
  });

  it('con descuento especial, el precio original queda tachado encima del vigente y el «+ IVA» va debajo del vigente', async () => {
    const montos = cotizar([{ producto: puerta, cantidad: 2, descuento: { tipo: 'porcentaje', valor: 15 } }]);
    const cuerpo = cuerpoDe(await plantilla(cotizacion(), docCotizacion(montos)));
    expect(cuerpo).toContain('<td class="r unit"><s class="original">$125.000</s><span class="rebajado">$106.250</span><span class="iva">+ IVA</span></td>');
    expect(cuerpo).toContain('<td class="r tot"><s class="original">$250.000</s><span class="rebajado">$212.500</span><span class="iva">+ IVA</span></td>');
  });

  it('la fila «Valores» del bloque de obra y la nota de netos usan la tasa de Ajustes, sin «19 %» escrito a mano', async () => {
    const reglas = { ...REGLAS, iva: 0.1 };
    const html = await plantilla(cotizacion(), docCotizacion(cotizar(lineas(), reglas), { reglas }));
    expect(html).toContain('<dt>Valores</dt><dd>Netos, + IVA 10 %</dd>');
    expect(html).toContain('no incluyen IVA (10 %).');
    expect(html).toContain('<dt>IVA (10 %)</dt>');
    expect(html).not.toMatch(/19 %/);
    const por19 = await plantilla(cotizacion(), docCotizacion(cotizar(lineas())));
    expect(por19).toContain('<dt>Valores</dt><dd>Netos, + IVA 19 %</dd>');
    expect(por19).toContain('<p class="nota-tabla">Todos los valores indicados son netos y no incluyen IVA (19 %).</p>');
  });

  it('la nota de netos va después de la tabla, antes del desglose, y con él en el mismo bloque', async () => {
    const html = await plantilla(cotizacion(), docCotizacion(cotizar(lineas())));
    const nota = html.indexOf('<p class="nota-tabla">');
    expect(nota).toBeGreaterThan(html.indexOf('</table>'));
    expect(nota).toBeLessThan(html.indexOf('<dl class="totales">'));
    expect(html).toContain('<div class="tras-tabla"><p class="nota-tabla">');
    expect(trasTabla(0.19, '<section>x</section>')).toBe('<div class="tras-tabla"><p class="nota-tabla">Todos los valores indicados son netos y no incluyen IVA (19 %).</p><section>x</section></div>');
  });

  it('el desglose de la cotización: «Neto» sin descuentos; con descuento, «Subtotal» antes del descuento y «Neto» después; «IVA (19 %)»', async () => {
    const sin = await plantilla(cotizacion(), docCotizacion(cotizar(lineas())));
    expect(sin).toContain('<dt>Neto</dt>');
    expect(sin).not.toContain('<dt>Subtotal</dt>');
    expect(sin).toContain('<dt>IVA (19 %)</dt>');
    const general = await plantilla(cotizacion(10), docCotizacion(cotizar(lineas(), undefined, { descuento: 10 }), {}));
    expect(general.match(/<dt>Subtotal<\/dt>/g)).toHaveLength(1);
    expect(general.match(/<dt>Neto<\/dt>/g)).toHaveLength(1);
    expect(general.indexOf('<dt>Subtotal</dt>')).toBeLessThan(general.indexOf('<dt>Neto</dt>'));
    const especial = await plantilla(cotizacion(), docCotizacion(cotizar([{ producto: puerta, cantidad: 2, descuento: { tipo: 'porcentaje', valor: 15 } }])));
    expect(especial).toContain('<dt>Subtotal original</dt>');
    expect(especial).toContain('<dt>Subtotal</dt>');
    expect(especial).not.toContain('<dt>Neto</dt>');
  });

  it('la nota de pedido y la orden de trabajo no cambian: sin «+ IVA», sin «Valores», sin nota de netos y con su tabla de siempre', async () => {
    const montos = cotizar(lineas(), { ajuste: 0, iva: 0.19 });
    const nota = await plantilla(cotizacion(), { tipo: 'nota', numero: 9, montos, fecha: FECHA, autor: 'Paula Soto', despacho: { direccion: 'Camino a Niebla km 3', transporte: 'Starken' } });
    const orden = await plantilla(cotizacion(), { tipo: 'nota', numero: 9, montos, fecha: FECHA, produccion: true });
    for (const html of [nota, orden]) {
      expect(html).not.toContain('+ IVA');
      expect(html).not.toContain('<dt>Valores</dt>');
      expect(html).not.toContain('nota-tabla');
      expect(html).not.toContain('tras-tabla');
      expect(html).not.toContain(ESTILOS_COTIZACION.trim().split('\n')[0]);
      expect(tablaDe(html).match(/<td class="n">–<\/td>/g)).toHaveLength(2);
    }
    expect(tablaDe(nota)).toContain('<thead><tr><th class="n"></th><th class="prod">Producto</th><th class="r cant">Cant.</th><th class="r unit">Precio fábrica</th><th class="r tot">Total</th><th class="listo">Listo</th></tr></thead>');
    expect(tablaDe(orden)).toContain('<thead><tr><th class="n"></th><th class="prod">Producto</th><th class="r cant">Cant.</th><th class="listo">Listo</th></tr></thead>');
    expect(nota).toContain('<dt>IVA 19 %</dt>');
    expect(nota).toContain('<dt>Neto</dt>');
  });

  it('en la nota, un pedido especial sin costo de fábrica va «Por definir» y no lleva «+ IVA»', async () => {
    const { producto: especial } = productoPersonalizado(
      { modelo: 'Puerta japonesa', madera: 'Roble', ancho: 1.9, alto: 2.2, medida: null, cantidad: 1, precioUnitario: 450000 },
      'PUERTA',
    ) as Extract<ReturnType<typeof productoPersonalizado>, { ok: true }>;
    const q = cotizacion();
    q.solicitudes = [
      { modelo: 'Puerta japonesa', madera: 'Roble', ancho: 1.9, alto: 2.2, medida: null, cantidad: 1, personalizado: { familia: 'PUERTA' } },
      { modelo: 'MOLCO', madera: 'PINO OREGON', ancho: 0.8, alto: 2, medida: null, cantidad: 2 },
    ];
    q.montos = cotizar([{ producto: especial, cantidad: 1, indice: 0 }, { producto: puerta, cantidad: 2, indice: 1 }]);
    const montos = cotizar([{ producto: puerta, cantidad: 2, indice: 1 }], { ajuste: 0, iva: 0.19 });
    const html = await plantilla(q, { tipo: 'nota', numero: 9, montos, fecha: FECHA });
    expect(html).toContain('<td class="r unit">Por definir</td><td class="r tot">Por definir</td>');
    expect(html).not.toContain('+ IVA');
  });
});

describe('Piezas de la tabla (funciones puras)', () => {
  it('las etiquetas y la fila de netos se derivan de la tasa que reciben', () => {
    expect(etiquetaIva(0.19)).toBe('IVA (19 %)');
    expect(etiquetaIva(0.1)).toBe('IVA (10 %)');
    expect(etiquetaSubtotal(false)).toBe('Neto');
    expect(etiquetaSubtotal(true)).toBe('Subtotal');
    expect(valoresNetos(0.21)).toBe('Netos, + IVA 21 %');
    expect(notaTabla(0.19)).toContain('no incluyen IVA (19 %).');
  });
});

/** Un fragmento de texto del PDF: lo que pdfjs entrega, con su posición (de arriba abajo, en pt). */
interface Fragmento { s: string; x: number; y: number; tam: number }
interface Leido { paginas: Fragmento[][] }
async function leer(ruta: string): Promise<Leido> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const carga = pdfjs.getDocument({ data: new Uint8Array(await readFile(ruta)), useSystemFonts: false });
  const documento = await carga.promise;
  const paginas: Fragmento[][] = [];
  for (let n = 1; n <= documento.numPages; n++) {
    const pagina = await documento.getPage(n);
    const vista = pagina.getViewport({ scale: 1 });
    const contenido = await pagina.getTextContent();
    paginas.push(
      contenido.items.flatMap((i) =>
        'str' in i && i.str.trim()
          ? [{ s: i.str, x: i.transform[4], y: vista.height - i.transform[5], tam: Math.hypot(i.transform[0], i.transform[1]) }]
          : [],
      ),
    );
  }
  await carga.destroy();
  return { paginas };
}
const misma = (a: Fragmento, b: Fragmento) => Math.abs(a.y - b.y) <= 3;
const CODIGO = /^(?=[A-Z0-9-]*[A-Z])[A-Z0-9]+-[A-Z0-9-]+$/;

describe.skipIf(!chromiumPath())('Cotización en el PDF real (Chromium + pdfjs)', () => {
  let sencilla: Leido;
  let larga: Leido;
  let nota: Leido;

  beforeAll(async () => {
    const montosSencilla = cotizar(puertas.slice(0, 4).map((p, i) => ({ producto: p, cantidad: i + 1, anchoSolicitado: 0.82, altoSolicitado: 2, tipoMedida: 'hoja' as const })));
    const extrasLarga = { descuento: 5, flete: 25000 };
    const montosLarga = cotizar(
      [
        ...Array.from({ length: 17 }, (_, i) => ({
          producto: puertas[i % puertas.length], cantidad: 1 + (i % 3), anchoSolicitado: 0.8 + (i % 5) * 0.01, altoSolicitado: 2,
          tipoMedida: i % 2 ? ('hoja' as const) : ('vano' as const),
        })),
        {
          producto: marco, cantidad: 3, observaciones: 'Abre hacia adentro', descuento: { tipo: 'porcentaje' as const, valor: 15 },
          descripcionDocumento: 'Puerta de baño con vidrio esmerilado, bisagras de acero inoxidable y cerradura de embutir para tabique de volcanita de 15 mm',
        },
      ],
      undefined,
      extrasLarga,
    );
    const pdfs = [
      ['sencilla.pdf', await plantilla(cotizacion(), docCotizacion(montosSencilla))],
      ['larga.pdf', await plantilla(cotizacion(extrasLarga.descuento, extrasLarga.flete), docCotizacion(montosLarga))],
      ['nota.pdf', await plantilla(cotizacion(), { tipo: 'nota', numero: 9, montos: montosSencilla, fecha: FECHA, autor: 'Paula Soto' })],
    ] as const;
    for (const [archivo, html] of pdfs) await generarPdf(base.dir, archivo, html);
    sencilla = await leer(join(base.dir, 'pdf', 'sencilla.pdf'));
    larga = await leer(join(base.dir, 'pdf', 'larga.pdf'));
    nota = await leer(join(base.dir, 'pdf', 'nota.pdf'));
  }, 120_000);

  it('los encabezados de los importes caben en una línea, en la de «Cant.», en cada página de la tabla', () => {
    for (const pagina of larga.paginas) {
      const cant = pagina.find((f) => f.s === 'Cant.');
      if (!cant) continue;
      for (const titulo of ['Precio unit. neto', 'Total neto']) {
        const encontrados = pagina.filter((f) => f.s === titulo);
        expect(encontrados, titulo).toHaveLength(1);
        expect(misma(encontrados[0], cant), titulo).toBe(true);
      }
    }
    expect(larga.paginas.length).toBeGreaterThan(1);
    expect(larga.paginas[1].some((f) => f.s === 'Precio unit. neto'), 'encabezado repetido').toBe(true);
  });

  it('cada fila lleva un guion en la primera columna y ningún número', () => {
    const filas = larga.paginas.flatMap((pagina) => {
      const cant = pagina.find((f) => f.s === 'Cant.');
      const producto = pagina.find((f) => f.s === 'Producto' && cant && misma(f, cant));
      return cant && producto ? pagina.filter((f) => f.s === '-' && f.y > cant.y && f.x < producto.x - 3) : [];
    });
    expect(filas).toHaveLength(19); // 18 líneas y el flete
    const numeros = larga.paginas.flatMap((p) => p.filter((f) => /^\d{1,2}$/.test(f.s) && f.x < 60 && f.y > 200));
    expect(numeros).toEqual([]);
  });

  it('«+ IVA» va en la línea del código en las filas sencillas: la fila no crece y las filas quedan a la misma distancia', () => {
    const pagina = sencilla.paginas[0];
    const iva = pagina.filter((f) => f.s === '+ IVA');
    expect(iva).toHaveLength(2 * 4);
    const codigos = pagina.filter((f) => CODIGO.test(f.s));
    expect(codigos).toHaveLength(4);
    for (const f of iva) {
      const cercano = codigos.reduce((a, c) => (Math.abs(c.y - f.y) < Math.abs(a.y - f.y) ? c : a));
      expect(Math.abs(cercano.y - f.y), `«+ IVA» frente a ${cercano.s}`).toBeLessThanOrEqual(3);
    }
    const guiones = pagina.filter((f) => f.s === '-').map((f) => f.y).sort((a, b) => a - b);
    const distancias = guiones.slice(1).map((y, i) => y - guiones[i]);
    expect(distancias).toHaveLength(3);
    for (const d of distancias) {
      expect(d, 'distancia entre filas sencillas').toBeLessThanOrEqual(33.5);
      expect(Math.abs(d - distancias[0])).toBeLessThan(0.5);
    }
  });

  it('el desglose dice «Subtotal», «Neto», «IVA (19 %)» y «Total», y la nota de netos queda en la misma página que el desglose', () => {
    const pagina = sencilla.paginas[0];
    expect(pagina.some((f) => f.s === 'Neto')).toBe(true);
    expect(pagina.some((f) => f.s === 'IVA (19 %)')).toBe(true);
    expect(pagina.some((f) => f.s === 'Total')).toBe(true);
    expect(pagina.some((f) => f.s.startsWith('Todos los valores indicados son netos'))).toBe(true);
    const nota = larga.paginas.findIndex((p) => p.some((f) => f.s.startsWith('Todos los valores indicados')));
    expect(nota, 'nota de netos en la cotización larga').toBeGreaterThanOrEqual(0);
    expect(larga.paginas[nota].some((f) => f.s === 'Neto' || f.s === 'Subtotal'), 'la nota y el desglose en la misma página').toBe(true);
  });

  it('la nota de pedido del PDF real no lleva «+ IVA» ni la fila «Valores»', () => {
    const textos = nota.paginas.flat().map((f) => f.s);
    expect(textos).not.toContain('+ IVA');
    expect(textos).not.toContain('Valores');
    expect(textos.some((s) => s.startsWith('Todos los valores indicados'))).toBe(false);
    expect(textos).toContain('Precio fábrica');
    expect(textos.filter((s) => s === '–')).toHaveLength(4);
  });
});

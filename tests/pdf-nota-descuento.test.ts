import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clienteVacio, type Producto } from '../src/catalogo/tipos';
import type { Cotizacion } from '../src/negocio/estado';
import {
  conDescuentoItem,
  cotizar,
  type ItemPrecio,
  montosVacios,
  pesos,
  precioConDescuento,
  REGLAS,
} from '../src/negocio/precios';
import { abrirBaseDatos, cerrarBaseDatos } from '../src/servidor/base-datos';
import { chromiumPath } from '../src/servidor/chromium';
import { cerrarNavegadorPdf, generarPdf, plantilla } from '../src/servidor/pdf';

// Ancla 8 de docs/estilo-documentos-v1.md (§8.2) en la nota de pedido con descuento especial por ítem. La fábrica lee cada
// ítem por posición: la cantidad y sus montos van en la misma línea base (±3 pt); el primero es el unitario y el último el
// total. Con descuento, la nota imprime solo el importe vigente: el original tachado, encima, dejaba el vigente fuera de
// esa línea. La cotización sí conserva el tachado. El PDF real necesita Chromium; las pruebas de HTML corren siempre.

const FECHA = '2026-11-20T12:00:00.000Z';
/** La nota de pedido va a precio de fábrica: ajuste 0 (ver precios.ts). */
const REGLAS_NOTA = { ...REGLAS, ajuste: 0 };
const MONTO = /^\$\d{1,3}(\.\d{3})*$/;
const CANTIDAD = /^\d{1,4}$/;
const misma = (a: { y: number }, b: { y: number }) => Math.abs(a.y - b.y) <= 3;
const veces = (texto: string, parte: string) => texto.split(parte).length - 1;

const producto = (modelo: string, precioNeto: number): Producto => ({
  codigo: `${modelo.slice(0, 3)}-O-3-A`,
  modelo,
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto,
  descripcion: `${modelo} PINO OREGON 0,80 A 0,85 MT X 2 MT`,
  filaOrigen: 4,
});
// Cuatro líneas con descuento especial (porcentajes y un monto fijo por unidad, una de ellas con cantidad 3). La de 80
// unidades tiene un total de 11 cifras y se achica en su celda. Las otras dos, sin descuento, son de cantidad 1 y 4.
const ITEMS: ItemPrecio[] = [
  { producto: producto('MOLCO', 100_000), cantidad: 2, descuento: { tipo: 'porcentaje', valor: 15 } },
  { producto: producto('RANCO', 110_000), cantidad: 1 },
  { producto: producto('HUILO', 120_000), cantidad: 3, descuento: { tipo: 'monto', valor: 5_000 } },
  { producto: producto('PALENA', 130_000), cantidad: 1, descuento: { tipo: 'porcentaje', valor: 10 } },
  { producto: producto('ENCO', 140_000), cantidad: 4 },
  { producto: producto('ENSENADA', 150_000), cantidad: 80, descuento: { tipo: 'porcentaje', valor: 5 } },
];
const MONTOS_NOTA = cotizar(ITEMS, REGLAS_NOTA);
const CON_DESCUENTO = MONTOS_NOTA.lineas.filter(conDescuentoItem).length;

const cotizacion = (): Cotizacion => ({
  id: 'x',
  numero: 325,
  estado: 'emitida',
  cliente: {
    ...clienteVacio(),
    nombre: 'Constructora Ejemplo SpA',
    rut: '76.543.210-3',
    proyecto: 'Edificio Los Robles',
    comuna: 'Valdivia',
  },
  solicitudes: [],
  montos: montosVacios(),
  incompletos: [],
  historial: [],
  creada: FECHA,
  actualizada: FECHA,
  pdf: null,
  fechaEmision: FECHA,
  origen: null,
  vence: '2026-12-04',
  descuento: 0,
  flete: 0,
  creadaPor: 'Paula',
  emitidaPor: 'Paula',
  aprobadaPor: null,
  anuladaPor: null,
  fechaAnulacion: null,
  motivoAnulacion: null,
  reemplazadaPor: null,
  versionCatalogo: null,
  notas: [],
});

let dir = '';
let db: Database.Database;
const notaHtml = () =>
  plantilla(
    cotizacion(),
    { tipo: 'nota', numero: 326, montos: MONTOS_NOTA, fecha: FECHA, fabrica: 'panguipulli', despacho: null },
    db,
  );

interface Fragmento {
  s: string;
  x: number;
  /** Línea base, medida desde el borde superior de la hoja. */
  y: number;
  tam: number;
}

/** Fragmentos de cada página, ordenados de arriba abajo y de izquierda a derecha, como los lee la fábrica. */
async function leer(ruta: string): Promise<Fragmento[][]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const carga = pdfjs.getDocument({ data: new Uint8Array(await readFile(ruta)), useSystemFonts: false });
  const documento = await carga.promise;
  const paginas: Fragmento[][] = [];
  for (let n = 1; n <= documento.numPages; n++) {
    const pagina = await documento.getPage(n);
    const { height } = pagina.getViewport({ scale: 1 });
    const contenido = await pagina.getTextContent();
    const frags = contenido.items.flatMap((i) =>
      'str' in i && i.str.trim()
        ? [
            {
              s: i.str,
              x: i.transform[4],
              y: height - i.transform[5],
              tam: Math.hypot(i.transform[0], i.transform[1]),
            },
          ]
        : [],
    );
    paginas.push(frags.sort((a, b) => a.y - b.y || a.x - b.x));
  }
  await carga.destroy();
  return paginas;
}

/** Filas de la nota: cada cantidad con los montos de su línea base, y los importes de la tabla que no van en ninguna. */
function filasDe(paginas: Fragmento[][]) {
  const filas: { cantidad: string; montos: string[] }[] = [];
  const sueltos: string[] = [];
  for (const frags of paginas) {
    const cant = frags.find((f) => f.s === 'Cant.');
    if (!cant) continue;
    const cantidades = frags.filter(
      (f) => CANTIDAD.test(f.s) && f.y > cant.y && Math.abs(f.x - cant.x) < 20 && f.tam > 8.5,
    );
    // Los totales van bajo la tabla: cualquier importe a la derecha de la cantidad, por encima de ellos, es de un ítem.
    const totales = frags.filter((f) => f.s === 'Subtotal original' || f.s === 'Neto').map((f) => f.y);
    const fin = totales.length ? Math.min(...totales) : Infinity;
    sueltos.push(
      ...frags
        .filter((f) => MONTO.test(f.s) && f.x > cant.x && f.y > cant.y && f.y < fin)
        .filter((m) => !cantidades.some((c) => misma(c, m)))
        .map((m) => m.s),
    );
    for (const c of cantidades)
      filas.push({
        cantidad: c.s,
        montos: frags
          .filter((f) => MONTO.test(f.s) && f.x > c.x && misma(f, c))
          .sort((a, b) => a.x - b.x)
          .map((f) => f.s),
      });
  }
  return { filas, sueltos };
}

/** Lo que queda a la derecha de la última etiqueta `texto` en su línea, unido: el valor que lee la fábrica. */
function aLaDerecha(frags: Fragmento[], texto: string) {
  const etiqueta = frags.filter((f) => f.s === texto).pop();
  if (!etiqueta) return '';
  return frags
    .filter((f) => f !== etiqueta && misma(f, etiqueta) && f.x > etiqueta.x)
    .sort((a, b) => a.x - b.x)
    .map((f) => f.s)
    .join(' ');
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'neltume-nota-descuento-'));
  vi.stubEnv('NELTUME_DB_PATH', join(dir, 'cotizador.sqlite'));
  db = abrirBaseDatos(join(dir, 'cotizador.sqlite'));
});

afterAll(async () => {
  await cerrarNavegadorPdf();
  cerrarBaseDatos(join(dir, 'cotizador.sqlite'));
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe('nota con descuento especial: HTML', () => {
  it('la nota imprime solo el importe vigente en las celdas de precio; el descuento sigue en la celda del producto', async () => {
    const html = await notaHtml();
    expect(html).not.toContain('<s class="original">');
    expect(html).not.toContain('class="rebajado"');
    expect(html).toContain('<td class="r unit">$85.000</td><td class="r tot">$170.000</td>');
    expect(html).toContain('<td class="r unit">$115.000</td><td class="r tot">$345.000</td>');
    expect(html).toContain('<td class="r unit">$117.000</td><td class="r tot">$117.000</td>');
    expect(html).toContain(
      '<td class="r unit">$142.500</td><td class="r tot"><span class="cifra-media">$11.400.000</span></td>',
    );
    expect(html).toContain(
      '<span class="descuento-item">Descuento especial 15 %: −$15.000 c/u · Ahorro $30.000</span>',
    );
  });

  it('la cotización con el mismo ítem conserva el original tachado encima del vigente', async () => {
    const montos = cotizar(ITEMS);
    const html = await plantilla(
      cotizacion(),
      { tipo: 'cotizacion', numero: 325, montos, fecha: FECHA, vence: '2026-12-04', autor: 'Paula' },
      db,
    );
    for (const l of montos.lineas.filter(conDescuentoItem))
      expect(html).toContain(
        `<s class="original">${pesos(l.precioUnitario)}</s><span class="rebajado">${pesos(precioConDescuento(l))}</span>`,
      );
    // Unitario y total de cada ítem descontado: dos tachados por ítem.
    expect(veces(html, '<s class="original">')).toBe(2 * CON_DESCUENTO);
    expect(veces(html, 'class="rebajado"')).toBe(2 * CON_DESCUENTO);
  });

  it('una fila sin descuento de la nota queda igual que antes del arreglo', async () => {
    expect(await notaHtml()).toContain(
      '<tr><td class="n">–</td><td class="prod"><b>Ranco Pino Oregon 0,80 a 0,85 m × 2 m</b><span class="cod">RAN-O-3-A</span></td><td class="r cant">1</td><td class="r unit">$110.000</td><td class="r tot">$110.000</td><td class="listo"><i></i></td></tr>',
    );
  });
});

describe.skipIf(!chromiumPath())('nota con descuento especial: PDF real (lo que lee la fábrica)', () => {
  let nota: Fragmento[][];

  beforeAll(async () => {
    await generarPdf(dir, 'nota.pdf', await notaHtml(), undefined, { logoDe: db });
    nota = await leer(join(dir, 'pdf', 'nota.pdf'));
  }, 120_000);

  it('cada ítem: la cantidad y sus montos van en la misma línea base; con descuento, solo el unitario y el total vigentes', () => {
    const { filas, sueltos } = filasDe(nota);
    expect(sueltos, 'importes de la tabla fuera de la línea de su ítem').toEqual([]);
    expect(filas.map((f) => f.cantidad)).toEqual(MONTOS_NOTA.lineas.map((l) => String(l.cantidad)));
    MONTOS_NOTA.lineas.forEach((l, i) =>
      expect(filas[i].montos, `montos de ${l.producto.modelo}`).toEqual([
        pesos(precioConDescuento(l)),
        pesos(l.total),
      ]),
    );
  });

  it('el total de la nota no cambia: Neto y Total son los del cálculo', () => {
    const ultima = nota[nota.length - 1];
    expect(aLaDerecha(ultima, 'Neto')).toBe(pesos(MONTOS_NOTA.subtotal));
    expect(aLaDerecha(ultima, 'Total')).toBe(pesos(MONTOS_NOTA.total));
  });

  it('el descuento especial sigue impreso en la celda del producto, una vez por ítem descontado', () => {
    const textos = nota.flat().filter((f) => f.s.startsWith('Descuento especial'));
    expect(textos.length).toBe(CON_DESCUENTO);
  });
});

// Libros .xlsx mínimos armados en memoria para las pruebas: nunca se versiona la planilla real.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';

/** Celda de error («#N/A») o con fórmula, con o sin el valor que Excel guardó al calcularla. */
export type CeldaEspecial = { error: string } | { formula: string; valor?: number };
export type Celdas = Record<string, string | number | CeldaEspecial>;
/** Nombre de hoja → celdas por referencia («B3»). */
export type Hojas = Record<string, Celdas>;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const indice = (col: string) => [...col].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

export function xlsxBytes(hojas: Hojas) {
  const nombres = Object.keys(hojas);
  const textos: string[] = [];
  const indices = new Map<string, number>();
  const compartido = (s: string) => {
    let i = indices.get(s);
    if (i === undefined) indices.set(s, (i = textos.push(s) - 1));
    return i;
  };
  const hoja = (celdas: Celdas) => {
    const filas = new Map<number, [string, Celdas[string]][]>();
    for (const [ref, valor] of Object.entries(celdas)) {
      const fila = Number(ref.replace(/[A-Z]/g, ''));
      filas.set(fila, [...(filas.get(fila) ?? []), [ref, valor]]);
    }
    const xml = [...filas.entries()]
      .sort(([a], [b]) => a - b)
      .map(([fila, cs]) => {
        const celdasFila = cs
          .sort(([a], [b]) => indice(a.replace(/\d/g, '')) - indice(b.replace(/\d/g, '')))
          .map(([ref, v]) =>
            typeof v === 'number'
              ? `<c r="${ref}"><v>${v}</v></c>`
              : typeof v === 'string'
                ? `<c r="${ref}" t="s"><v>${compartido(v)}</v></c>`
                : 'error' in v
                  ? `<c r="${ref}" t="e"><v>${esc(v.error)}</v></c>`
                  : `<c r="${ref}"><f>${esc(v.formula)}</f>${v.valor === undefined ? '' : `<v>${v.valor}</v>`}</c>`,
          )
          .join('');
        return `<row r="${fila}">${celdasFila}</row>`;
      })
      .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xml}</sheetData></worksheet>`;
  };
  const archivos: Record<string, Uint8Array> = {};
  nombres.forEach(
    (nombre, i) => (archivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(hoja(hojas[nombre]))),
  );
  archivos['[Content_Types].xml'] = strToU8(
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>',
  );
  archivos['xl/workbook.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nombres
      .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
  );
  archivos['xl/_rels/workbook.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${nombres
      .map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('')}</Relationships>`,
  );
  archivos['xl/sharedStrings.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${textos
      .map((t) => `<si><t xml:space="preserve">${esc(t)}</t></si>`)
      .join('')}</sst>`,
  );
  return zipSync(archivos);
}

/** Escribe un libro en un directorio temporal; `limpiar` lo borra. */
export async function escribirXlsx(hojas: Hojas, nombre = 'planilla.xlsx') {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-xlsx-'));
  const ruta = join(dir, nombre);
  await writeFile(ruta, xlsxBytes(hojas));
  return { ruta, limpiar: () => rm(dir, { recursive: true, force: true }) };
}

// Las columnas de venta, margen y «dcto. especial» llevan a propósito valores que darían precios absurdos:
// el importador no debe leerlas nunca.
const RUIDO = { E: 111, F: 9, G: 222, H: 9 };
const cabeceraPuerta = (r: number): Celdas => ({
  [`B${r}`]: 'RANGO ALTURA',
  [`C${r}`]: 'ANCHO',
  [`D${r}`]: 'VALOR COSTO  + IVA',
  [`E${r}`]: 'VALOR UNIDAD  VENTA CLIENTE           + IVA',
  [`F${r}`]: 'MARGEN',
  [`G${r}`]:
    'VALOR UNDIDAD-                             DCTO ESPECIAL                          CONST LINGUE + IVA',
  [`H${r}`]: 'MARGEN',
});
const cabeceraMarco = (r: number): Celdas => ({
  [`B${r}`]: 'MEDIDAS',
  [`C${r}`]: 'VALOR COSTO  + IVA',
  [`D${r}`]: 'VALOR UNIDAD  VENTA CLIENTE           + IVA',
  [`E${r}`]: 'MARGEN',
  [`F${r}`]:
    'VALOR UNDIDAD-                             DCTO ESPECIAL                          CONST LINGUE + IVA',
  [`G${r}`]: 'MARGEN',
});
/** Filas de puertas: [alto, ancho, costo neto]. */
export const filasPuerta = (desde: number, filas: [string, string, number | string][]): Celdas =>
  Object.assign(
    {},
    ...filas.map(([alto, ancho, costo], i) => ({
      [`B${desde + i}`]: alto,
      [`C${desde + i}`]: ancho,
      [`D${desde + i}`]: costo,
      [`E${desde + i}`]: RUIDO.E,
      [`F${desde + i}`]: RUIDO.F,
      [`G${desde + i}`]: RUIDO.G,
      [`H${desde + i}`]: RUIDO.H,
    })),
  );
/** Filas de marcos: [medida, costo neto]. */
export const filasMarco = (desde: number, filas: [string, number | string][]): Celdas =>
  Object.assign(
    {},
    ...filas.map(([medida, costo], i) => ({
      [`B${desde + i}`]: medida,
      [`C${desde + i}`]: costo,
      [`D${desde + i}`]: RUIDO.E,
      [`E${desde + i}`]: RUIDO.F,
      [`F${desde + i}`]: RUIDO.G,
      [`G${desde + i}`]: RUIDO.H,
    })),
  );
export const tituloPuerta = (r: number, titulo: string): Celdas => ({ [`B${r}`]: titulo });
export { cabeceraMarco, cabeceraPuerta };

const ALTOS = ['2,00 A 2,20 MTS', '2,21 A 2,40 MTS'];
/** Forma de la planilla de enchapadas, prepintadas y marcos Pino Finger, con pocos productos. */
export function planillaEnchapadas(): Hojas {
  return {
    'HUILO HUILO ENCHP': {
      B2: 'MODELO ',
      ...tituloPuerta(3, 'HUILO HUILO PREPINTADA'),
      ...cabeceraPuerta(4),
      ...filasPuerta(6, [
        [ALTOS[0], '0,70 MT', 35461],
        [ALTOS[0], '0,80 MT', 43416],
        [ALTOS[0], '0,90 MT', 43416],
      ]),
      ...filasPuerta(10, [
        [ALTOS[1], '0,70 MT', 45230],
        [ALTOS[1], '0,80 MT', 53840],
        [ALTOS[1], '0,90 MT', 53840],
      ]),
      ...tituloPuerta(14, 'HUILO HUILO ENCHAPE EN MARA'),
      ...cabeceraPuerta(15),
      ...filasPuerta(17, [
        [ALTOS[0], '0,70 MT', 78437],
        [ALTOS[0], '0,75 MT', 87384],
        [ALTOS[0], '0,80 MT', 88740],
        [ALTOS[0], '0,85 MT', 89994],
        [ALTOS[0], '0,90 MT', 91140],
      ]),
      ...filasPuerta(23, [
        [ALTOS[1], '0,70 MT', 90144],
        [ALTOS[1], '0,75 MT', 99230],
        [ALTOS[1], '0,80 MT', 100625],
        [ALTOS[1], '0,85 MT', 102019],
        [ALTOS[1], '0,90 MT', 104578],
      ]),
    },
    'LOS RIOS ENCHP': {
      B2: 'MODELO ',
      ...tituloPuerta(3, 'LOS RIOS PREPINTADA'),
      ...cabeceraPuerta(4),
      ...filasPuerta(6, [
        [ALTOS[0], '0,70 MT', 34230],
        [ALTOS[0], '0,75 MT', 42083],
      ]),
      ...tituloPuerta(9, 'LOS RIOS ENCHAPE EN MARA'),
      ...cabeceraPuerta(10),
      ...filasPuerta(12, [[ALTOS[0], '0,70 MT', 73660]]),
    },
    'MARCOS ': {
      B2: 'MODELO ',
      ...tituloPuerta(3, 'SET DE MARCO EN PINO FINGER DESNUDO'),
      ...cabeceraMarco(4),
      ...filasMarco(6, [
        ['SET DE MARCO 30X70 MM LARGO 2,20 MTS', 11190],
        ['SET DE MARCO 30X70 MM LARGO 2,40 MTS', 12295],
        ['SET DE MARCO 30X70 MM LARGO 2,50 MTS', 12785],
        ['SET DE MARCO 30X70 MM LARGO 3,00 MTS', 15240],
      ]),
      ...filasMarco(11, [['SET DE MARCO 30X90 MM LARGO 2,20 MTS', 14980]]),
      ...tituloPuerta(17, 'SET DE MARCO EN PINO FINGER ENCHAPADO EN MARA'),
      ...cabeceraMarco(18),
      ...filasMarco(20, [
        ['SET DE MARCO 30X70 MM LARGO 2,50 MTS', 38541],
        ['SET DE MARCO 30X70 MM LARGO 3,00 MTS', 46250],
      ]),
      ...filasMarco(23, [['SET DE MARCO 30X90 MM LARGO 2,50 MTS', 47870]]),
      ...tituloPuerta(28, 'SET ENDOLADO MDF ENCHAPADO EN MARA'),
      ...cabeceraMarco(29),
      ...filasMarco(30, [['SET ENDOLADO 15MMX130MM X 2,40 MTS', 34945]]),
    },
  };
}

/** Fila de la hoja Precio de la planilla principal: [código, modelo, tipo, medida, largo, madera, neto]. */
export type FilaPrecio = [string, string, string, string | number, number | string, string, number];
/**
 * Forma mínima de la planilla principal (Precio, Categorias y Cotización), con las tablas de códigos de
 * Categorias: modelo → abreviatura, medida → segmento y largo → letra.
 */
export function planillaPrincipal(
  filas: FilaPrecio[] = [
    ['LANC-L-070-A', 'LANCO', 'PUERTA', '70 A 80', 2, 'LENGA', 100000],
    ['LANC-L-070-B', 'LANCO', 'PUERTA', '70 A 80', 2.4, 'LENGA', 120000],
    ['LANC-R-090-A', 'LANCO', 'PUERTA', '0,90', 2, 'RAULI', 150000],
  ],
): Hojas {
  const precio: Celdas = {};
  filas.forEach(([codigo, modelo, tipo, medida, largo, madera, neto], i) => {
    const r = 4 + i;
    Object.assign(precio, {
      [`A${r}`]: codigo,
      [`B${r}`]: modelo,
      [`C${r}`]: tipo,
      [`D${r}`]: medida,
      [`F${r}`]: largo,
      [`G${r}`]: madera,
      [`O${r}`]: neto,
      [`P${r}`]: Math.round(neto * 1.19 * 100) / 100,
    });
  });
  return {
    Precio: precio,
    Categorias: {
      G4: 'LENGA',
      G5: 'RAULI',
      O4: 'LANCO',
      P4: 'LANC',
      R4: '70 A 80',
      S4: '070',
      R5: '0,90',
      S5: '090',
      U4: 2,
      V4: 'A',
      U5: 2.4,
      V5: 'B',
    },
    Cotización: { C8: 'Ítem' },
  };
}

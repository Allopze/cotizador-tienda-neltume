// Oráculo Excel: llena la hoja «Cotización» de una copia de la planilla con lo que escribiría un vendedor,
// la recalcula con Microsoft Excel (macOS, por AppleScript) y lee el resultado. Solo se leen las columnas
// B, M y O–S de «Cotización» (filas 8–36) de la copia y las columnas permitidas de «Precio» (A, B y D).
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { abrirXlsx } from '../../src/catalogo/xlsx';
import type { Producto } from '../../src/catalogo/tipos';

/** Filas de ítems de la plantilla. La 25 tiene P25 fijo (flete): se usa solo para el flete. */
export const FILAS = [...Array.from({ length: 17 }, (_, i) => 8 + i), ...Array.from({ length: 7 }, (_, i) => 26 + i)];
const FILA_FLETE = 25;
// Excel está en sandbox: su contenedor es la única carpeta que abre sin pedir permiso.
const CONTENEDOR = join(homedir(), 'Library/Containers/com.microsoft.Excel/Data');
const TRABAJO = join(CONTENEDOR, 'paridad-neltume-oraculo');

export interface LineaExcel {
  modelo: string;
  madera: string;
  medida: string;
  alto: number;
  cantidad: number;
  /** Columna Q como fracción; null la deja vacía (precio fábrica). */
  margen: number | null;
}
export interface CotizacionExcel {
  lineas: LineaExcel[];
  flete: number;
}
export interface FilaExcel {
  codigo: unknown;
  descripcion: unknown;
  fabrica: unknown;
  unitario: unknown;
  total: unknown;
}
export interface ResultadoExcel {
  /** Una por línea, en el orden de `lineas`. */
  filas: FilaExcel[];
  subtotal: number;
  iva: number;
  total: number;
}

const MADERA_EXCEL: Record<string, string> = { O: 'PINO OREGON', L: 'LENGA', M: 'MARA', R: 'RAULÍ' };

/** Devuelve cómo escribiría un vendedor cada producto de la planilla en la hoja Cotización. */
export async function entradasPlanilla(planilla: string) {
  const xlsx = await abrirXlsx(planilla);
  const precio = xlsx.leer('Precio', (c, r) => r >= 4 && ['A', 'B', 'D'].includes(c));
  const crudo = (c: string, r: number) => precio.get(`${c}${r}`)?.valor ?? null;
  return (p: Producto, cantidad: number, margen: number | null): LineaExcel => ({
    modelo: String(crudo('B', p.filaOrigen) ?? p.modelo).toUpperCase(),
    madera: MADERA_EXCEL[p.codigo.split('-')[1]],
    medida:
      p.familia === 'PUERTA'
        ? String(crudo('D', p.filaOrigen))
        : p.familia === 'MOLDURA'
          ? p.medida
          : `2x${crudo('D', p.filaOrigen)}`,
    alto: p.largo,
    cantidad,
    margen,
  });
}

const as = (v: string | number | null) =>
  v === null ? '""' : typeof v === 'number' ? String(v) : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function scriptExcel(lote: CotizacionExcel[], base: string, archivo: (i: number) => string) {
  const lineas = [
    'tell application "Microsoft Excel"',
    '  set display alerts to false',
    `  open workbook workbook file name (POSIX file ${as(base)} as text)`,
    '  set ws to worksheet "Cotización" of active workbook',
  ];
  lote.forEach((cotizacion, k) => {
    const porFila = new Map(FILAS.map((f, i) => [f, cotizacion.lineas[i]]));
    const columna = (f: (l: LineaExcel) => string | number | null) =>
      `{${Array.from({ length: 25 }, (_, i) => {
        const l = porFila.get(8 + i);
        return `{${as(l ? f(l) : null)}}`;
      }).join(', ')}}`;
    lineas.push(
      `  set value of range "D8:D32" of ws to ${columna((l) => l.modelo)}`,
      `  set value of range "F8:F32" of ws to ${columna((l) => l.madera)}`,
      `  set value of range "H8:H32" of ws to ${columna((l) => l.medida)}`,
      `  set value of range "J8:J32" of ws to ${columna((l) => l.alto)}`,
      `  set value of range "O8:O32" of ws to ${columna((l) => l.cantidad)}`,
      `  set value of range "Q8:Q32" of ws to ${columna((l) => l.margen)}`,
      `  set value of range "O${FILA_FLETE}" of ws to 1`,
      `  set value of range "P${FILA_FLETE}" of ws to ${cotizacion.flete}`,
      `  set value of range "Q${FILA_FLETE}" of ws to ""`,
      '  calculate',
      `  save workbook as active workbook filename (POSIX file ${as(archivo(k))} as text) file format Excel XML file format`,
      '  set ws to worksheet "Cotización" of active workbook',
    );
  });
  lineas.push('  close active workbook saving no', 'end tell');
  return lineas.join('\n');
}

async function leer(archivo: string, n: number): Promise<ResultadoExcel> {
  const x = await abrirXlsx(archivo);
  const h = x.leer('Cotización', (c, r) => r >= 8 && r <= 36 && ['B', 'M', 'P', 'R', 'S'].includes(c));
  const v = (ref: string) => h.get(ref)?.valor ?? null;
  const filas = FILAS.slice(0, n).map((f) => ({
    codigo: v(`B${f}`),
    descripcion: v(`M${f}`),
    fabrica: v(`P${f}`),
    unitario: v(`R${f}`),
    total: v(`S${f}`),
  }));
  return { filas, subtotal: Number(v('S33')), iva: Number(v('S35')), total: Number(v('S36')) };
}

/** Recalcula cada cotización en Excel, en lotes (una apertura de la planilla por lote). */
export async function recalcularEnExcel(
  planilla: string,
  cotizaciones: CotizacionExcel[],
  progreso?: (hechas: number, resultados: ResultadoExcel[]) => void,
  lote = 20,
): Promise<ResultadoExcel[]> {
  if (cotizaciones.some((c) => c.lineas.length > FILAS.length || !c.lineas.length))
    throw new Error(`Cada cotización debe tener entre 1 y ${FILAS.length} líneas.`);
  // Excel es uno solo: dos corridas a la vez se pisan la planilla activa y los archivos. La segunda espera.
  const soltar = await lockfile.lock(CONTENEDOR, {
    realpath: false,
    lockfilePath: join(CONTENEDOR, 'paridad-neltume.lock'),
    stale: 120_000,
    update: 30_000,
    retries: { retries: 600, minTimeout: 2000, maxTimeout: 5000 },
  });
  try {
    return await recalcular(planilla, cotizaciones, progreso, lote);
  } finally {
    await soltar();
  }
}

async function recalcular(
  planilla: string,
  cotizaciones: CotizacionExcel[],
  progreso: ((hechas: number, resultados: ResultadoExcel[]) => void) | undefined,
  lote: number,
): Promise<ResultadoExcel[]> {
  await rm(TRABAJO, { recursive: true, force: true });
  await mkdir(TRABAJO, { recursive: true });
  const base = join(TRABAJO, 'base.xlsx');
  await copyFile(planilla, base);
  const resultados: ResultadoExcel[] = [];
  try {
    for (let i = 0; i < cotizaciones.length; i += lote) {
      const parte = cotizaciones.slice(i, i + lote);
      const archivo = (k: number) => join(TRABAJO, `caso-${i + k}.xlsx`);
      const script = join(TRABAJO, 'lote.applescript');
      await writeFile(script, scriptExcel(parte, base, archivo));
      execFileSync('osascript', [script], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 600_000 });
      for (const [k, c] of parte.entries()) {
        resultados.push(await leer(archivo(k), c.lineas.length));
        await rm(archivo(k), { force: true });
      }
      progreso?.(resultados.length, resultados);
    }
  } finally {
    await rm(TRABAJO, { recursive: true, force: true });
  }
  return resultados;
}

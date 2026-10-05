// Prueba comparativa contra la planilla real: cada producto del catálogo se cotiza dos veces, una con el
// cotizador (resolverItem + cotizar) y otra con Microsoft Excel recalculando la hoja «Cotización» de una copia
// de la planilla, con las mismas entradas que escribiría un vendedor (modelo, madera, medida, alto, cantidad y %).
// Solo para macOS con Excel instalado. No modifica la planilla original ni la base de datos.
//
//   npm run paridad:excel -- [--semilla 1] [--limite 500] [--planilla ruta.xlsx]
//
// De la copia recalculada solo se leen las columnas B, M y O–S de «Cotización» (filas 8–36); de la planilla,
// las columnas permitidas de «Precio» (A, B y D). Los resultados detallados van a data/test-paridad-excel/.
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { abrirXlsx } from '../src/catalogo/xlsx';
import { importarPlanilla } from '../src/catalogo/planilla';
import { leerConfiguracionCatalogo } from '../src/catalogo/configuracion-archivo';
import { resolverItem } from '../src/catalogo/resolver';
import { cotizar, REGLAS, type ItemPrecio } from '../src/negocio/precios';
import type { Producto, SolicitudItem } from '../src/catalogo/tipos';

const argumentos = process.argv.slice(2);
const opcion = (nombre: string) => {
  const i = argumentos.indexOf(`--${nombre}`);
  return i >= 0 ? argumentos[i + 1] : undefined;
};
const planilla = resolve(opcion('planilla') ?? process.env.NELTUME_PLANILLA ?? 'datos-privados/COTIZADOR_2026.xlsx');
const semilla = Number(opcion('semilla') ?? 1);
const limite = opcion('limite') ? Number(opcion('limite')) : Infinity;
// Excel está en sandbox: su contenedor es la única carpeta que abre sin pedir permiso.
const trabajo = join(homedir(), 'Library/Containers/com.microsoft.Excel/Data/paridad-neltume');
const salida = resolve('data/test-paridad-excel');

// Filas de ítems de la plantilla. La 25 tiene P25 fijo (flete): se usa solo para el flete.
const FILAS = [...Array.from({ length: 17 }, (_, i) => 8 + i), ...Array.from({ length: 7 }, (_, i) => 26 + i)];
const FILA_FLETE = 25;

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const azar = mulberry32(semilla);
const entero = (min: number, max: number) => min + Math.floor(azar() * (max - min + 1));
const elegir = <T>(xs: readonly T[]) => xs[Math.floor(azar() * xs.length)];
const redondear = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

// ---------- Catálogo, tal como lo importa la aplicación ----------
const configuracion = await leerConfiguracionCatalogo();
const importado = await importarPlanilla(planilla, configuracion);
const catalogo = importado.catalogo;
const xlsx = await abrirXlsx(planilla);
const precio = xlsx.leer('Precio', (c, r) => r >= 4 && ['A', 'B', 'D'].includes(c));
const crudo = (c: string, r: number) => precio.get(`${c}${r}`)?.valor ?? null;

const MADERA_EXCEL: Record<string, string> = { O: 'PINO OREGON', L: 'LENGA', M: 'MARA', R: 'RAULÍ' };
const MADERA_PEDIDO: Record<string, string[]> = {
  O: ['pino oregón', 'oregón', 'PINO OREGON', 'Pino Oregon'],
  L: ['lenga', 'LENGA', 'Lenga'],
  M: ['mara', 'MARA', 'Mara'],
  R: ['raulí', 'rauli', 'RAULÍ', 'Raulí'],
};

/** Lo que un vendedor escribiría en la hoja Cotización para este producto. */
function entradaExcel(p: Producto) {
  const letra = p.codigo.split('-')[1];
  const modelo = String(crudo('B', p.filaOrigen) ?? p.modelo).toUpperCase();
  const medida =
    p.familia === 'PUERTA'
      ? String(crudo('D', p.filaOrigen))
      : p.familia === 'MOLDURA'
        ? p.medida
        : `2x${crudo('D', p.filaOrigen)}`;
  return { modelo, madera: MADERA_EXCEL[letra], medida, alto: p.largo };
}

/** Lo mismo pedido como lo haría una persona, en formatos variados (m, cm, «2x4», «6 x 4.5»…). */
function solicitudApp(p: Producto, cantidad: number): Partial<SolicitudItem> {
  const letra = p.codigo.split('-')[1];
  const modelo = elegir([p.modelo, p.modelo.toLowerCase(), p.modelo.toUpperCase()]);
  const madera = elegir(MADERA_PEDIDO[letra]);
  const enCm = azar() < 0.4;
  const alto = enCm ? redondear(p.largo * 100, 1) : p.largo;
  if (p.familia === 'PUERTA') {
    const min = p.anchoMin!,
      max = p.anchoMax!;
    const pasos = Math.round((max - min) / 0.01);
    const ancho = redondear(min + 0.01 * entero(0, pasos), 3);
    return { modelo, madera, ancho: enCm ? redondear(ancho * 100, 1) : ancho, alto, cantidad };
  }
  if (p.familia === 'MOLDURA') {
    const [a, b] = p.medida.split('X');
    const medida = elegir([p.medida, `${a} x ${b.replace(',', '.')}`, `${a}x${b}`.toLowerCase()]);
    return { modelo, madera, medida, alto, cantidad };
  }
  const escuadria = p.medida.split('X')[1];
  return { modelo, madera, medida: elegir([escuadria, `2x${escuadria}`, `2 x ${escuadria}`]), alto, cantidad };
}

const cantidadAzar = () => {
  const r = azar();
  return r < 0.7 ? entero(1, 10) : r < 0.9 ? entero(11, 100) : entero(101, 2000);
};
// Márgenes como fracción, con a lo más dos decimales en porcentaje (lo que acepta el cotizador).
const margenAzar = (): number | null => {
  const r = azar();
  if (r < 0.25) return null;
  if (r < 0.55) return elegir([0.25, 0.55, 0.85, 1.4, 0.75, 1, 0]);
  if (r < 0.85) return entero(-50, 300) / 100;
  return entero(-5000, 50000) / 10000;
};

// ---------- Casos: todos los productos, en cotizaciones de 1 a 24 líneas ----------
interface Linea {
  producto: Producto;
  cantidad: number;
  margen: number | null;
  solicitud: Partial<SolicitudItem>;
}
interface Caso {
  id: number;
  lineas: Linea[];
  flete: number;
  /** El mismo % en todas las líneas, aplicado en el cotizador como margen de la cotización. */
  margenCotizacion: number | null;
}
const productos = [...catalogo.productos];
for (let i = productos.length - 1; i > 0; i--) {
  const j = Math.floor(azar() * (i + 1));
  [productos[i], productos[j]] = [productos[j], productos[i]];
}
const seleccion = productos.slice(0, Math.min(limite, productos.length));
const casos: Caso[] = [];
for (let i = 0; i < seleccion.length; ) {
  const n = Math.min(azar() < 0.2 ? 1 : entero(2, FILAS.length), seleccion.length - i);
  const comun = azar() < 0.2 ? margenAzar() ?? 0.25 : null;
  const lineas = seleccion.slice(i, i + n).map((producto) => {
    const cantidad = cantidadAzar();
    return { producto, cantidad, margen: comun ?? margenAzar(), solicitud: solicitudApp(producto, cantidad) };
  });
  casos.push({ id: casos.length + 1, lineas, flete: azar() < 0.3 ? entero(5, 300) * 1000 : 0, margenCotizacion: comun });
  i += n;
}

// ---------- Excel ----------
const as = (v: string | number | null) =>
  v === null ? '""' : typeof v === 'number' ? String(v) : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const columna = (valores: (string | number | null)[]) => `{${valores.map((v) => `{${as(v)}}`).join(', ')}}`;
function scriptExcel(lote: Caso[], base: string) {
  const lineas = [
    'tell application "Microsoft Excel"',
    '  set display alerts to false',
    `  open workbook workbook file name (POSIX file ${as(base)} as text)`,
    '  set wb to active workbook',
    '  set ws to worksheet "Cotización" of wb',
  ];
  for (const caso of lote) {
    const porFila = new Map(FILAS.map((f, i) => [f, caso.lineas[i]]));
    const valores = (f: (l: Linea) => string | number | null) =>
      columna(Array.from({ length: 25 }, (_, i) => {
        const l = porFila.get(8 + i);
        return l ? f(l) : null;
      }));
    const e = new Map(caso.lineas.map((l) => [l, entradaExcel(l.producto)]));
    lineas.push(
      `  set value of range "D8:D32" of ws to ${valores((l) => e.get(l)!.modelo)}`,
      `  set value of range "F8:F32" of ws to ${valores((l) => e.get(l)!.madera)}`,
      `  set value of range "H8:H32" of ws to ${valores((l) => e.get(l)!.medida)}`,
      `  set value of range "J8:J32" of ws to ${valores((l) => e.get(l)!.alto)}`,
      `  set value of range "O8:O32" of ws to ${valores((l) => l.cantidad)}`,
      `  set value of range "Q8:Q32" of ws to ${valores((l) => l.margen)}`,
      `  set value of range "O${FILA_FLETE}" of ws to 1`,
      `  set value of range "P${FILA_FLETE}" of ws to ${caso.flete}`,
      `  set value of range "Q${FILA_FLETE}" of ws to ""`,
      '  calculate',
      `  save workbook as active workbook filename (POSIX file ${as(join(trabajo, `caso-${caso.id}.xlsx`))} as text) file format Excel XML file format`,
    );
  }
  lineas.push('  close active workbook saving no', 'end tell');
  return lineas.join('\n');
}

interface ResultadoExcel {
  filas: Map<number, { codigo: unknown; descripcion: unknown; fabrica: unknown; unitario: unknown; total: unknown }>;
  subtotal: number;
  iva: number;
  total: number;
}
async function leerExcel(caso: Caso): Promise<ResultadoExcel> {
  const archivo = join(trabajo, `caso-${caso.id}.xlsx`);
  const x = await abrirXlsx(archivo);
  const h = x.leer('Cotización', (c, r) => r >= 8 && r <= 36 && ['B', 'M', 'P', 'R', 'S'].includes(c));
  const v = (ref: string) => h.get(ref)?.valor ?? null;
  const filas: ResultadoExcel['filas'] = new Map();
  for (const f of FILAS)
    filas.set(f, { codigo: v(`B${f}`), descripcion: v(`M${f}`), fabrica: v(`P${f}`), unitario: v(`R${f}`), total: v(`S${f}`) });
  await rm(archivo, { force: true });
  return { filas, subtotal: Number(v('S33')), iva: Number(v('S35')), total: Number(v('S36')) };
}

// ---------- Comparación ----------
type Tipo =
  | 'excel_sin_precio'
  | 'excel_codigo_distinto_al_producto'
  | 'app_no_resuelve'
  | 'app_otro_producto'
  | 'precio_fabrica'
  | 'unitario'
  | 'total_linea'
  | 'subtotal'
  | 'iva'
  | 'total';
interface Diferencia {
  caso: number;
  fila?: number;
  tipo: Tipo;
  detalle: string;
}
const diferencias: Diferencia[] = [];
const stats = {
  casos: 0,
  lineas: 0,
  unidades: 0,
  descripcionIgual: 0,
  descripcionEquivalente: 0,
  lineaIgualAPesos: 0,
  totalIgualAPesos: 0,
  netoIgualAPesos: 0,
  maxDifLinea: 0,
  maxDifNeto: 0,
  maxDifTotal: 0,
  conFlete: 0,
  conMargenCotizacion: 0,
};
const ejemplosDescripcion: string[] = [];
/** Misma descripción salvo el formato de los números («0,80» = «0,8») y los espacios. */
const descripcionNormalizada = (s: string) =>
  s
    .replace(/\d+(?:,\d+)?/g, (n) => String(Number(n.replace(',', '.'))))
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

function comparar(caso: Caso, ex: ResultadoExcel) {
  stats.casos++;
  if (caso.flete) stats.conFlete++;
  if (caso.margenCotizacion !== null) stats.conMargenCotizacion++;
  const items: ItemPrecio[] = [];
  let esperadoSubtotal = 0,
    toleranciaSubtotal = 0,
    valido = true;
  caso.lineas.forEach((l, i) => {
    const fila = FILAS[i];
    const e = ex.filas.get(fila)!;
    const d = (tipo: Tipo, detalle: string) => diferencias.push({ caso: caso.id, fila, tipo, detalle });
    stats.lineas++;
    stats.unidades += l.cantidad;
    if (typeof e.fabrica !== 'number' || typeof e.unitario !== 'number') {
      d('excel_sin_precio', `${l.producto.codigo} (fila ${l.producto.filaOrigen}): Excel calcula ${String(e.codigo)} → ${String(e.fabrica)}`);
      valido = false;
      return;
    }
    if (String(e.codigo).toUpperCase() !== l.producto.codigo.toUpperCase())
      d('excel_codigo_distinto_al_producto', `producto ${l.producto.codigo}, Excel arma ${String(e.codigo)}`);
    const res = resolverItem(catalogo, l.solicitud);
    if (!res.ok) {
      d('app_no_resuelve', `${JSON.stringify(l.solicitud)} → ${res.rechazo.tipo}`);
      valido = false;
      return;
    }
    if (res.producto.codigo.toUpperCase() !== String(e.codigo).toUpperCase())
      d('app_otro_producto', `${JSON.stringify(l.solicitud)} → app ${res.producto.codigo}, Excel ${String(e.codigo)}`);
    if (Math.abs(res.producto.precioNeto - e.fabrica) > 0.00005 + 1e-9)
      d('precio_fabrica', `${res.producto.codigo}: app ${res.producto.precioNeto}, Excel ${e.fabrica}`);
    if (String(e.descripcion) === res.producto.descripcion) stats.descripcionIgual++;
    if (descripcionNormalizada(String(e.descripcion)) === descripcionNormalizada(res.producto.descripcion))
      stats.descripcionEquivalente++;
    else if (ejemplosDescripcion.length < 12) ejemplosDescripcion.push(`Excel «${String(e.descripcion)}» · app «${res.producto.descripcion}»`);
    esperadoSubtotal += l.cantidad * Math.round(e.unitario);
    toleranciaSubtotal += l.cantidad * 0.5;
    items.push({
      ...res,
      cantidad: l.cantidad,
      margen: caso.margenCotizacion !== null ? null : (l.margen ?? 0),
    });
  });
  if (!valido || items.length !== caso.lineas.length) return;
  const m = cotizar(items, REGLAS, {
    flete: caso.flete,
    margenCotizacion: caso.margenCotizacion,
    descuento: 0,
  });
  m.lineas.forEach((linea, i) => {
    const fila = FILAS[i];
    const e = ex.filas.get(fila)!;
    const unitarioExcel = e.unitario as number,
      totalExcel = e.total as number;
    const d = (tipo: Tipo, detalle: string) => diferencias.push({ caso: caso.id, fila, tipo, detalle });
    if (linea.precioUnitario !== Math.round(unitarioExcel))
      d('unitario', `${linea.producto.codigo}: app ${linea.precioUnitario}, Excel ${unitarioExcel} (≈${Math.round(unitarioExcel)})`);
    const dif = Math.abs(linea.total - totalExcel);
    stats.maxDifLinea = Math.max(stats.maxDifLinea, dif);
    if (linea.total === Math.round(totalExcel)) stats.lineaIgualAPesos++;
    if (dif > linea.cantidad * 0.5 + 1e-6)
      d('total_linea', `${linea.producto.codigo} × ${linea.cantidad}: app ${linea.total}, Excel ${totalExcel}`);
  });
  const difNeto = Math.abs(m.neto - ex.subtotal);
  stats.maxDifNeto = Math.max(stats.maxDifNeto, difNeto);
  if (m.neto === Math.round(ex.subtotal)) stats.netoIgualAPesos++;
  if (m.subtotal !== esperadoSubtotal)
    diferencias.push({ caso: caso.id, tipo: 'subtotal', detalle: `app ${m.subtotal}, Σ cant × round(R) ${esperadoSubtotal}` });
  if (difNeto > toleranciaSubtotal + 1e-6)
    diferencias.push({ caso: caso.id, tipo: 'subtotal', detalle: `neto app ${m.neto}, Excel S33 ${ex.subtotal} (tolerancia ${toleranciaSubtotal})` });
  if (m.iva !== Math.round(m.neto * 0.19) || Math.abs(m.iva - ex.iva) > toleranciaSubtotal * 0.19 + 0.5 + 1e-6)
    diferencias.push({ caso: caso.id, tipo: 'iva', detalle: `app ${m.iva}, Excel ${ex.iva}` });
  const difTotal = Math.abs(m.total - ex.total);
  stats.maxDifTotal = Math.max(stats.maxDifTotal, difTotal);
  if (m.total === Math.round(ex.total)) stats.totalIgualAPesos++;
  if (difTotal > toleranciaSubtotal * 1.19 + 0.5 + 1e-6)
    diferencias.push({ caso: caso.id, tipo: 'total', detalle: `app ${m.total}, Excel ${ex.total}` });
}

// ---------- Ejecución por lotes ----------
await rm(trabajo, { recursive: true, force: true });
await mkdir(trabajo, { recursive: true });
await mkdir(salida, { recursive: true });
const base = join(trabajo, 'base.xlsx');
await copyFile(planilla, base);
const LOTE = 20;
const inicio = Date.now();
console.log(`${seleccion.length} productos en ${casos.length} cotizaciones (semilla ${semilla}).`);
for (let i = 0; i < casos.length; i += LOTE) {
  const lote = casos.slice(i, i + LOTE);
  const script = join(trabajo, 'lote.applescript');
  await writeFile(script, scriptExcel(lote, base));
  execFileSync('osascript', [script], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 600_000 });
  for (const caso of lote) comparar(caso, await leerExcel(caso));
  const hechos = Math.min(i + LOTE, casos.length);
  console.log(
    `  ${hechos}/${casos.length} cotizaciones · ${diferencias.length} diferencias · ${Math.round((Date.now() - inicio) / 1000)} s`,
  );
}
await rm(trabajo, { recursive: true, force: true });

// ---------- Reporte ----------
const porTipo = new Map<Tipo, Diferencia[]>();
for (const d of diferencias) porTipo.set(d.tipo, [...(porTipo.get(d.tipo) ?? []), d]);
const pct = (n: number, d: number) => `${((100 * n) / Math.max(d, 1)).toFixed(1)} %`;
const reporte = [
  '# Paridad cotizador ↔ Excel',
  '',
  `Planilla: ${planilla} · semilla ${semilla} · ${new Date().toISOString()}`,
  '',
  `- Cotizaciones: ${stats.casos} (${stats.conFlete} con flete, ${stats.conMargenCotizacion} con margen de cotización)`,
  `- Líneas: ${stats.lineas} (${stats.unidades} unidades)`,
  `- Diferencias: ${diferencias.length}`,
  '',
  '| Tipo | Cantidad |',
  '|---|---:|',
  ...[...porTipo].map(([t, ds]) => `| ${t} | ${ds.length} |`),
  '',
  '## Redondeo (diferencia documentada: el cotizador redondea el unitario a pesos)',
  '',
  `- Total de línea igual al de Excel redondeado: ${pct(stats.lineaIgualAPesos, stats.lineas)}; diferencia máxima ${stats.maxDifLinea.toFixed(4)}`,
  `- Neto igual a S33 redondeado: ${pct(stats.netoIgualAPesos, stats.casos)}; diferencia máxima ${stats.maxDifNeto.toFixed(4)}`,
  `- Total igual a S36 redondeado: ${pct(stats.totalIgualAPesos, stats.casos)}; diferencia máxima ${stats.maxDifTotal.toFixed(4)}`,
  `- Descripción idéntica a la columna M: ${pct(stats.descripcionIgual, stats.lineas)}; equivalente salvo formato de números: ${pct(stats.descripcionEquivalente, stats.lineas)}`,
  ...ejemplosDescripcion.map((e) => `  - ${e}`),
  '',
  '## Diferencias (primeras 20 por tipo)',
  '',
  ...[...porTipo].flatMap(([t, ds]) => [
    `### ${t}`,
    '',
    ...ds.slice(0, 20).map((d) => `- caso ${d.caso}${d.fila ? `, fila ${d.fila}` : ''}: ${d.detalle}`),
    '',
  ]),
].join('\n');
await writeFile(join(salida, 'reporte.md'), reporte);
await writeFile(join(salida, 'diferencias.json'), JSON.stringify(diferencias, null, 2));
console.log(`\n${reporte}\n\nDetalle: ${join(salida, 'diferencias.json')}`);
const fallas = diferencias.filter((d) => d.tipo !== 'excel_sin_precio' && d.tipo !== 'excel_codigo_distinto_al_producto');
process.exitCode = fallas.length ? 1 : 0;

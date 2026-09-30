// Planilla de enchapadas, prepintadas y marcos Pino Finger. Se reconoce por la forma de sus hojas (bloques con
// título, encabezado de costo y filas de medidas), nunca por el nombre del archivo. Solo se leen las columnas
// B a D: medida y costo neto de fábrica. Las de venta, margen y «dcto. especial» no se leen; el precio sale
// del costo por los márgenes del cotizador.
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { abrirXlsx, type Xlsx } from './xlsx';
import {
  conMaderasEnchapadas,
  nombreCanonicoModelo,
  normalizarCatalogo,
  resolverMaderaConfigurada,
  validarConfiguracionCatalogo,
  type ConfiguracionCatalogo,
} from './configuracion';
import {
  descripcion,
  ErrorImportacion,
  lista,
  MAX_FILAS_INVALIDAS,
  MAX_PROPORCION_INVALIDAS,
  num,
  type Incidencia,
} from './importar';
import { metros } from './resolver';
import type { Catalogo, Producto } from './tipos';

const FILA_MAXIMA = 2000;
const FILA_ILEGIBLE = 'Fila ilegible: medida o costo neto con un formato que no se reconoce; no se importa.';
const COLUMNAS = ['B', 'C', 'D'] as const;
type Valor = string | number | null;
interface Fila {
  fila: number;
  B: Valor;
  C: Valor;
  D: Valor;
}
export interface Bloque {
  hoja: string;
  tipo: 'puerta' | 'marco';
  titulo: Fila | null;
  cabecera: Fila;
  /** El encabezado del costo dice «+ IVA»: el valor es neto y se puede importar. */
  costoNeto: boolean;
  filas: Fila[];
  /** Filas que siguen a un título sin encabezado propio: no se sabe de qué bloque son, así que no se leen. */
  huerfanas: Fila[];
}

const limpiar = (v: Valor) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
const sinTildes = (v: Valor) =>
  limpiar(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
const vacia = (v: Valor) => v === null || limpiar(v) === '';

function filasDeHoja(x: Xlsx, hoja: string): Fila[] {
  const celdas = x.leer(
    hoja,
    (col, fila) => (COLUMNAS as readonly string[]).includes(col) && fila <= FILA_MAXIMA,
  );
  const filas = new Map<number, Fila>();
  for (const [ref, celda] of celdas) {
    if (vacia(celda.valor)) continue;
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    if (!m || !(COLUMNAS as readonly string[]).includes(m[1])) continue;
    const fila = Number(m[2]);
    const actual = filas.get(fila) ?? { fila, B: null, C: null, D: null };
    actual[m[1] as (typeof COLUMNAS)[number]] = celda.valor;
    filas.set(fila, actual);
  }
  return [...filas.values()].sort((a, b) => a.fila - b.fila);
}

const costoEsNeto = (encabezado: Valor) => {
  const t = sinTildes(encabezado);
  return /COSTO/.test(t) && /\+\s*IVA|\bNETO\b/.test(t) && !/IVA INCLUIDO|CON IVA|BRUTO/.test(t);
};
const encabezadoDePrecio = (v: Valor) => /VALOR|COSTO|PRECIO/.test(sinTildes(v));
const cabeceraPuerta = (f: Fila) =>
  sinTildes(f.B) === 'RANGO ALTURA' && sinTildes(f.C) === 'ANCHO' && encabezadoDePrecio(f.D);
const cabeceraMarco = (f: Fila) => sinTildes(f.B) === 'MEDIDAS' && encabezadoDePrecio(f.C);
const soloTexto = (f: Fila | undefined) =>
  !!f && typeof f.B === 'string' && vacia(f.C) && vacia(f.D) && !cabeceraPuerta(f) && !cabeceraMarco(f);

/** Una fila con solo la medida (le falta el ancho o el costo) sigue siendo una fila de datos, no un título. */
const pareceFilaDeDatos = (f: Fila, tipo: Bloque['tipo']) =>
  tipo === 'puerta' ? leerMedida(f.B, true) !== null : RE_MARCO.test(sinTildes(f.B));

/**
 * Bloques de todas las hojas. Un bloque empieza en su encabezado; su título es la fila de solo texto que lo
 * precede y sus filas llegan hasta el título del bloque siguiente. Un título sin encabezado (por ejemplo,
 * si alguien borró esa fila) corta el bloque: lo que sigue queda como huérfano y no se asigna a ningún modelo.
 * Las hojas sin encabezado se ignoran.
 */
export function leerBloques(x: Xlsx): Bloque[] {
  const bloques: Bloque[] = [];
  for (const hoja of x.hojas) {
    const filas = filasDeHoja(x, hoja);
    const cabeceras: { i: number; tipo: Bloque['tipo'] }[] = [];
    filas.forEach((f, i) => {
      if (cabeceraPuerta(f)) cabeceras.push({ i, tipo: 'puerta' });
      else if (cabeceraMarco(f)) cabeceras.push({ i, tipo: 'marco' });
    });
    const inicios = cabeceras.map(({ i }) => (soloTexto(filas[i - 1]) ? i - 1 : i));
    cabeceras.forEach(({ i, tipo }, k) => {
      const cabecera = filas[i];
      const siguiente = inicios[k + 1] ?? filas.length;
      const corte = filas.findIndex(
        (f, j) => j > i && j < siguiente && soloTexto(f) && !pareceFilaDeDatos(f, tipo),
      );
      const fin = corte === -1 ? siguiente : corte;
      bloques.push({
        hoja,
        tipo,
        titulo: inicios[k] < i ? filas[inicios[k]] : null,
        cabecera,
        costoNeto: costoEsNeto(tipo === 'puerta' ? cabecera.D : cabecera.C),
        filas: filas.slice(i + 1, fin),
        huerfanas: filas.slice(fin, siguiente),
      });
    });
  }
  return bloques;
}

/** ¿El libro tiene al menos un bloque con la forma de esta planilla? */
export const esPlanillaEnchapadas = (x: Xlsx) => leerBloques(x).length > 0;

const NUMERO = String.raw`(\d+(?:[.,]\d+)?)`;
const UNIDAD = String.raw`(?:\s*(?:MTS?|METROS?|M)\.?)?`;
const RE_RANGO = new RegExp(`^${NUMERO}\\s*(?:A|-|–|—)\\s*${NUMERO}${UNIDAD}$`);
const RE_VALOR = new RegExp(`^${NUMERO}${UNIDAD}$`);
const RE_MARCO = new RegExp(`^SET DE MARCO (\\d+)\\s*X\\s*(\\d+)\\s*MM LARGO ${NUMERO}${UNIDAD}$`);
const RE_TITULO_PUERTA = /^(.+?) (PREPINTAD[AO]S?|ENCHAPE EN MARA|ENCHAPAD[AO]S? EN MARA)$/;
const RE_TITULO_FINGER = /^SET DE MARCO EN PINO FINGER(?: (DESNUDO|SIN ENCHAPE))?$/;
const RE_TITULO_FINGER_ENCHAPADO = /^SET DE MARCO EN PINO FINGER ENCHAPADO(?: EN)? MARA$/;

const aMetros = (s: string) => {
  const m = metros(Number(s.replace(',', '.')));
  return m === null ? null : num(m);
};
/** «2,00 A 2,20 MTS» o «0,70 MT» en metros; un valor solo vale como rango de un único punto. */
function leerMedida(v: Valor, admiteRango: boolean): { min: number; max: number } | null {
  if (typeof v === 'number') {
    const m = aMetros(String(v));
    return m === null ? null : { min: m, max: m };
  }
  if (typeof v !== 'string') return null;
  const t = limpiar(v);
  const rango = admiteRango ? RE_RANGO.exec(t) : null;
  if (rango) {
    const min = aMetros(rango[1]),
      max = aMetros(rango[2]);
    return min !== null && max !== null && min <= max ? { min, max } : null;
  }
  const valor = RE_VALOR.exec(t);
  const m = valor ? aMetros(valor[1]) : null;
  return m === null ? null : { min: m, max: m };
}
/** El costo debe ser un número (o dígitos enteros): «35.461» como texto se leería mal, así que no se adivina. */
function leerCosto(v: Valor) {
  const n =
    typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 100_000_000 ? num(n) : null;
}

type Terminacion = 'PREPINTADA' | 'MARA ENCHAPADA' | 'PINO FINGER' | 'PINO FINGER ENCHAPADO MARA';
interface Leido {
  hoja: string;
  fila: number;
  modelo: string;
  madera: Terminacion;
  tipo: string;
  familia: 'PUERTA' | 'MARCO';
  /** «0,70» o «30X70». */
  medida: string;
  ancho: number | null;
  altoMin: number | null;
  altoMax: number | null;
  largo: number;
  precioNeto: number;
  /** Medida para el código: ancho en cm («070») o escuadría en mm («30X70»). */
  segmento: string;
}
const cm = (m: number) => String(Math.round(m * 100));
const dosDecimales = (m: number) => m.toFixed(2).replace('.', ',');

function tituloDePuerta(titulo: Fila | null) {
  const m = titulo ? RE_TITULO_PUERTA.exec(limpiar(titulo.B)) : null;
  if (!m) return null;
  return {
    modelo: nombreCanonicoModelo(m[1]),
    madera: (/^PREPINTAD/.test(m[2]) ? 'PREPINTADA' : 'MARA ENCHAPADA') as Terminacion,
  };
}
function tituloDeMarco(titulo: Fila | null) {
  const t = titulo ? limpiar(titulo.B) : '';
  if (RE_TITULO_FINGER.test(t)) return { madera: 'PINO FINGER' as Terminacion, tipo: 'SET DE MARCO DESNUDO' };
  if (RE_TITULO_FINGER_ENCHAPADO.test(t))
    return { madera: 'PINO FINGER ENCHAPADO MARA' as Terminacion, tipo: 'SET DE MARCO ENCHAPADO' };
  return null;
}

type Lectura = Omit<Leido, 'hoja' | 'fila'>;
/** Intérprete de las filas de un bloque según su título; null si el título no es de esta planilla. */
function lectorDeBloque(bloque: Bloque): ((f: Fila) => Lectura | null) | null {
  if (bloque.tipo === 'puerta') {
    const titulo = tituloDePuerta(bloque.titulo);
    if (!titulo) return null;
    return (f) => {
      const alto = leerMedida(f.B, true),
        ancho = leerMedida(f.C, false),
        precioNeto = leerCosto(f.D);
      if (!alto || !ancho || precioNeto === null) return null;
      return {
        modelo: titulo.modelo,
        madera: titulo.madera,
        tipo: titulo.madera === 'PREPINTADA' ? 'PUERTA PREPINTADA' : 'PUERTA ENCHAPADA',
        familia: 'PUERTA',
        medida: dosDecimales(ancho.min),
        ancho: ancho.min,
        altoMin: alto.min,
        altoMax: alto.max,
        largo: alto.max,
        precioNeto,
        segmento: cm(ancho.min).padStart(3, '0'),
      };
    };
  }
  const titulo = tituloDeMarco(bloque.titulo);
  if (!titulo) return null;
  return (f) => {
    const m = RE_MARCO.exec(sinTildes(f.B));
    const largo = m ? aMetros(m[3]) : null,
      precioNeto = leerCosto(f.C);
    if (!m || largo === null || precioNeto === null) return null;
    const medida = `${Number(m[1])}X${Number(m[2])}`;
    return {
      modelo: 'MARCO',
      madera: titulo.madera,
      tipo: titulo.tipo,
      familia: 'MARCO',
      medida,
      ancho: null,
      altoMin: null,
      altoMax: null,
      largo,
      precioNeto,
      segmento: medida,
    };
  };
}

/** Abreviatura del modelo para el código: sus 4 primeras letras, más largas solo si dos modelos coinciden. */
function abreviaturas(modelos: string[]) {
  const nombres = [...new Set(modelos.map(normalizarCatalogo))];
  return new Map(
    nombres.map((nombre) => {
      let largo = Math.min(4, nombre.length);
      while (
        largo < nombre.length &&
        nombres.some((o) => o !== nombre && o.startsWith(nombre.slice(0, largo)))
      )
        largo++;
      return [nombre, nombre.slice(0, largo)];
    }),
  );
}

const claveProducto = (p: Producto) =>
  `${p.modelo}|${p.madera}|${p.medida}|${p.altoMin ?? p.largo}|${p.altoMax ?? p.largo}`;

/** Un costo que baja al crecer la medida dentro de un mismo grupo es casi seguro un error de digitación. */
function advertenciasDeCostos(productos: Producto[]) {
  const pesos = (n: number) => `$${n.toLocaleString('es-CL')}`;
  const m = (n: number | null | undefined) => String(n ?? '').replace('.', ',');
  const avisos: string[] = [];
  const revisar = (
    ps: Producto[],
    clave: (p: Producto) => string,
    orden: (p: Producto) => number,
    texto: (menor: Producto, mayor: Producto) => string,
  ) => {
    const grupos = new Map<string, Producto[]>();
    for (const p of ps) grupos.set(clave(p), [...(grupos.get(clave(p)) ?? []), p]);
    for (const grupo of grupos.values()) {
      grupo.sort((a, b) => orden(a) - orden(b));
      for (let i = 1; i < grupo.length; i++)
        if (grupo[i].precioNeto < grupo[i - 1].precioNeto) avisos.push(texto(grupo[i - 1], grupo[i]));
    }
  };
  const puertas = productos.filter((p) => p.familia === 'PUERTA');
  revisar(
    puertas,
    (p) => `${p.modelo}|${p.madera}|${p.altoMax}`,
    (p) => p.anchoMax ?? 0,
    (a, b) =>
      `${a.modelo} ${a.madera} hasta ${m(a.altoMax)} m: el costo baja al subir el ancho de ${a.medida} (${pesos(a.precioNeto)}) a ${b.medida} (${pesos(b.precioNeto)}).`,
  );
  revisar(
    puertas,
    (p) => `${p.modelo}|${p.madera}|${p.anchoMax}`,
    (p) => p.altoMax ?? p.largo,
    (a, b) =>
      `${a.modelo} ${a.madera} ancho ${a.medida}: el costo baja al subir el alto de ${m(a.altoMax)} (${pesos(a.precioNeto)}) a ${m(b.altoMax)} m (${pesos(b.precioNeto)}).`,
  );
  revisar(
    productos.filter((p) => p.familia === 'MARCO'),
    (p) => `${p.madera}|${p.medida}`,
    (p) => p.largo,
    (a, b) =>
      `Marco ${a.madera} ${a.medida}: el costo baja al subir el largo de ${m(a.largo)} (${pesos(a.precioNeto)}) a ${m(b.largo)} m (${pesos(b.precioNeto)}).`,
  );
  return avisos;
}

export async function importarEnchapadas(
  ruta: string,
  configEntrada?: ConfiguracionCatalogo,
  abierto?: Xlsx,
) {
  let configuracion: ConfiguracionCatalogo;
  try {
    configuracion = conMaderasEnchapadas(validarConfiguracionCatalogo(configEntrada ?? {}));
  } catch (error) {
    throw new ErrorImportacion(
      `La configuración del catálogo choca con las maderas de esta planilla: ${error instanceof Error ? error.message : 'revísala'}`,
    );
  }
  const x = abierto ?? (await abrirXlsx(ruta));
  const bloques = leerBloques(x);
  const incidencias: Incidencia[] = [];
  const leidos: Leido[] = [];
  const omitir = (bloque: Bloque, detalle: string) =>
    incidencias.push({
      fila: (bloque.titulo ?? bloque.cabecera).fila,
      hoja: bloque.hoja,
      accion: 'exclusion',
      detalle,
    });
  const nombreBloque = (b: Bloque) => `«${b.titulo ? limpiar(b.titulo.B) : 'sin título'}»`;

  for (const bloque of bloques) {
    if (bloque.huerfanas.length) {
      const [primera, ...resto] = bloque.huerfanas;
      incidencias.push({
        fila: primera.fila,
        hoja: bloque.hoja,
        accion: 'exclusion',
        detalle: `«${limpiar(primera.B)}» y las ${resto.length} fila(s) siguientes no tienen encabezado de costo: no se importan.`,
      });
    }
    const leer = lectorDeBloque(bloque);
    if (!leer) {
      omitir(
        bloque,
        `Bloque ${nombreBloque(bloque)} no reconocido: no se importa (${bloque.filas.length} fila(s)).`,
      );
      continue;
    }
    if (!bloque.costoNeto) {
      omitir(
        bloque,
        `El encabezado de costo del bloque ${nombreBloque(bloque)} no indica «+ IVA»: no se importa.`,
      );
      continue;
    }
    for (const f of bloque.filas) {
      const leido = leer(f);
      if (leido) leidos.push({ ...leido, hoja: bloque.hoja, fila: f.fila });
      else incidencias.push({ fila: f.fila, hoja: bloque.hoja, accion: 'exclusion', detalle: FILA_ILEGIBLE });
    }
  }

  const abreviatura = abreviaturas(leidos.map((l) => l.modelo));
  const codigoMadera = (madera: Terminacion) => {
    const nombre = resolverMaderaConfigurada(madera, configuracion);
    const codigo = configuracion.maderas.find((m) => m.nombre === nombre)?.codigo;
    if (!codigo) throw new ErrorImportacion(`Falta configurar la madera ${madera} en config/catalogo.json.`);
    return codigo.toUpperCase();
  };
  const candidatos = leidos.map((l): Producto => {
    const p: Producto = {
      codigo: `${abreviatura.get(normalizarCatalogo(l.modelo))}-${codigoMadera(l.madera)}-${l.segmento}-${cm(l.largo)}`,
      modelo: l.modelo,
      familia: l.familia,
      tipo: l.tipo,
      madera: resolverMaderaConfigurada(l.madera, configuracion) ?? l.madera,
      medida: l.medida,
      anchoMin: l.ancho,
      anchoMax: l.ancho,
      ...(l.altoMin !== null ? { altoMin: l.altoMin, altoMax: l.altoMax } : {}),
      largo: l.largo,
      precioNeto: l.precioNeto,
      descripcion: '',
      filaOrigen: l.fila,
    };
    p.descripcion = descripcion(p);
    return p;
  });
  const vistosC = new Map<string, { p: Producto; hoja: string }>(),
    vistosA = new Map<string, { p: Producto; hoja: string }>();
  const conflictos: string[] = [];
  const productos = candidatos.filter((p, i) => {
    const hoja = leidos[i].hoja;
    const previo = vistosC.get(p.codigo) ?? vistosA.get(claveProducto(p));
    if (previo) {
      // Un duplicado con otro costo no se resuelve eligiendo una fila: la planilla debe corregirse.
      if (previo.p.precioNeto !== p.precioNeto)
        conflictos.push(
          `${p.codigo} en ${previo.hoja.trim()} fila ${previo.p.filaOrigen} y ${hoja.trim()} fila ${p.filaOrigen} (${previo.p.precioNeto} y ${p.precioNeto})`,
        );
      incidencias.push({
        fila: p.filaOrigen,
        hoja,
        accion: 'exclusion',
        detalle: 'Código o atributos duplicados.',
      });
      return false;
    }
    vistosC.set(p.codigo, { p, hoja });
    vistosA.set(claveProducto(p), { p, hoja });
    return true;
  });
  if (conflictos.length)
    throw new ErrorImportacion(
      `La planilla repite ${conflictos.length} producto(s) con costos distintos: ${lista(conflictos)}. Deja una sola fila por producto.`,
    );
  const invalidas = incidencias.filter((i) => i.detalle === FILA_ILEGIBLE);
  const leidas = productos.length + invalidas.length;
  if (invalidas.length > Math.max(MAX_FILAS_INVALIDAS, leidas * MAX_PROPORCION_INVALIDAS))
    throw new ErrorImportacion(
      `${invalidas.length} de ${leidas} filas de medidas no se pueden leer (${lista(invalidas.map((i) => `${(i.hoja ?? '').trim()} fila ${i.fila}`))}). Revisa la planilla; el catálogo no se modificó.`,
    );
  if (!productos.length)
    throw new ErrorImportacion(
      'La planilla no trae ningún producto legible: revisa los títulos de cada bloque y que el costo diga «+ IVA». El catálogo no se modificó.',
    );

  const catalogo: Catalogo = {
    fuente: basename(ruta),
    sha256: createHash('sha256').update(x.bytes).digest('hex'),
    fecha: new Date().toISOString(),
    productos,
    origen: 'enchapadas',
  };
  const conteos = Object.fromEntries(
    ['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA'].map((f) => [
      f,
      productos.filter((p) => p.familia === f).length,
    ]),
  );
  const erroresPlantilla = advertenciasDeCostos(productos);
  const reporte = `# Reporte de importación (enchapadas, prepintadas y marcos finger)\n\nFuente: ${catalogo.fuente}\n\nSHA-256: ${catalogo.sha256}\n\nFecha: ${catalogo.fecha}\n\n${productos.length} productos · ${incidencias.length} exclusiones.\n\n| Familia | Productos |\n|---|---:|\n${Object.entries(
    conteos,
  )
    .map(([f, n]) => `| ${f} | ${n} |`)
    .join(
      '\n',
    )}\n\n## Incidencias\n\n| Hoja | Fila | Acción | Detalle |\n|---|---:|---|---|\n${incidencias.map((i) => `| ${(i.hoja ?? '').trim()} | ${i.fila} | ${i.accion} | ${i.detalle} |`).join('\n')}\n\n## Advertencias de costos\n\n${erroresPlantilla.map((e) => `- ${e}`).join('\n')}\n\n## Alcance de lectura\n\nSolo las columnas B a D de cada hoja (medida y costo neto). No se leen las de venta, margen ni descuento especial. El archivo original no se modifica.\n`;
  return { catalogo, reporte, incidencias, erroresPlantilla, conteos, configuracion };
}

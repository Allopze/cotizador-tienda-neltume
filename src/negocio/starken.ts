import type { Familia } from '../catalogo/tipos';
import type { ProductoDespacho } from './envios';
import { pesos } from './precios';

// Lógica pura de la integración con Starken (sin red ni base de datos): la comparten el servidor, que
// consulta las tarifas, y la interfaz, que muestra el bulto y decide si el botón se puede usar.

/** Las tarifas de Starken vienen con IVA (19 %): el despacho de la cotización es neto. */
export const IVA_STARKEN = 0.19;
/** Valor neto en pesos enteros de una tarifa con IVA incluido: 44.418 → 37.326. */
export const netoDesdeIva = (costoTotal: number) => Math.round(costoTotal / (1 + IVA_STARKEN));

/** El transportista de la cotización es Starken (sin distinguir mayúsculas ni espacios). */
export const esStarken = (transporte: string | null | undefined) =>
  (transporte ?? '').trim().toLowerCase() === 'starken';

/** Ciudad de Starken: el código de la ciudad es el que se usa para tarifar; las comunas solo ayudan a buscarla. */
export interface CiudadStarken {
  codigoCiudad: number;
  nombre: string;
  comunas: string[];
}
export interface CiudadRef {
  codigoCiudad: number;
  nombre: string;
}

// --- Bulto -------------------------------------------------------------------------------------------

export const FAMILIAS_ENVIO: readonly Familia[] = ['PUERTA', 'MARCO', 'MOLDURA', 'PIEZAS_T'];
export const ETIQUETA_FAMILIA: Record<Familia, string> = {
  PUERTA: 'Puertas',
  MARCO: 'Marcos',
  MOLDURA: 'Molduras',
  PIEZAS_T: 'Piezas T',
};
/** Peso por unidad (kg) y grosor (cm) de una familia. El catálogo no trae pesos: los define la empresa. */
export interface ParametrosFamilia {
  kg: number | null;
  espesorCm: number | null;
}
export type ParametrosPaquete = Record<Familia, ParametrosFamilia>;
export const parametrosVacios = (): ParametrosPaquete => ({
  PUERTA: { kg: null, espesorCm: null },
  MARCO: { kg: null, espesorCm: null },
  MOLDURA: { kg: null, espesorCm: null },
  PIEZAS_T: { kg: null, espesorCm: null },
});
const positivo = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;
export const parametrosCompletos = (p: Partial<ParametrosFamilia> | undefined) =>
  positivo(p?.kg) && positivo(p?.espesorCm);

/**
 * Medida escrita por una persona («4,5», «4.5», «25»): número positivo con coma o punto decimal. Vacío es
 * null (sin definir); cualquier otra cosa, NaN.
 */
export function leerMedida(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (!limpio) return null;
  return /^\d+(?:\.\d+)?$/.test(limpio) && Number(limpio) > 0 ? Number(limpio) : Number.NaN;
}
/** La medida como se escribe en un campo: 4.5 → «4,5»; sin definir → vacío. */
export const medidaATexto = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));

/**
 * Bulto equivalente de todo el pedido. Las dimensiones de Starken son totales: el pedido se apila, de modo que
 * el `alto` es el grosor sumado de todas las unidades y `ancho` y `largo` son los mayores (en cm); `kilos` es la suma.
 */
export interface Bulto {
  alto: number;
  ancho: number;
  largo: number;
  kilos: number;
  /** Unidades por familia. */
  unidades: Partial<Record<Familia, number>>;
  /** Líneas de la cotización: cada una es un bulto (una pila de unidades iguales). */
  bultos: number;
}
export type ResultadoBulto =
  | { ok: true; bulto: Bulto }
  | {
      ok: false;
      motivo: 'sin_productos' | 'sin_parametros' | 'sin_medidas';
      familias: Familia[];
      mensaje: string;
    };

export const MENSAJE_SIN_PARAMETROS = 'Configura peso y espesor en Ajustes';
const enCm = (metros: number) => Math.round(metros * 10000) / 100;
const redondear = (n: number) => Math.round(n * 100) / 100;
const mayor = (...valores: (number | null | undefined)[]) =>
  valores.reduce<number>((m, v) => (typeof v === 'number' && Number.isFinite(v) && v > m ? v : m), 0);

/** Familias de las líneas que no tienen peso y grosor configurados. */
export function familiasSinParametros(
  productos: readonly Pick<ProductoDespacho, 'producto'>[],
  parametros: Partial<Record<Familia, Partial<ParametrosFamilia>>> | null | undefined,
): Familia[] {
  const usadas = new Set(productos.map((p) => p.producto.familia));
  return FAMILIAS_ENVIO.filter((f) => usadas.has(f) && !parametrosCompletos(parametros?.[f]));
}

/**
 * Medidas de una unidad en cm. Puertas: ancho y alto mayores entre la medida pedida y la de la referencia del
 * catálogo. Marcos, molduras y piezas T: el largo es la medida mayor y la sección se toma cuadrada, del grosor
 * configurado. Sin medidas utilizables devuelve null.
 */
function unidad(p: ProductoDespacho, espesorCm: number) {
  const { producto } = p;
  const largo = enCm(mayor(p.altoSolicitado, producto.altoMax, producto.altoMin, producto.largo));
  if (producto.familia !== 'PUERTA') return largo > 0 ? { ancho: espesorCm, largo } : null;
  const ancho = enCm(mayor(p.anchoSolicitado, producto.anchoMax, producto.anchoMin));
  return ancho > 0 && largo > 0 ? { ancho, largo } : null;
}

export function calcularBulto(
  productos: readonly ProductoDespacho[],
  parametros: Partial<Record<Familia, Partial<ParametrosFamilia>>> | null | undefined,
): ResultadoBulto {
  const lineas = productos.filter((p) => p.cantidad > 0);
  if (!lineas.length)
    return {
      ok: false,
      motivo: 'sin_productos',
      familias: [],
      mensaje: 'La cotización no tiene productos para despachar.',
    };
  const faltan = familiasSinParametros(lineas, parametros);
  if (faltan.length)
    return { ok: false, motivo: 'sin_parametros', familias: faltan, mensaje: MENSAJE_SIN_PARAMETROS };
  const bulto: Bulto = { alto: 0, ancho: 0, largo: 0, kilos: 0, unidades: {}, bultos: lineas.length };
  for (const l of lineas) {
    const { kg, espesorCm } = parametros![l.producto.familia] as { kg: number; espesorCm: number };
    const medidas = unidad(l, espesorCm);
    if (!medidas)
      return {
        ok: false,
        motivo: 'sin_medidas',
        familias: [l.producto.familia],
        mensaje: `Falta la medida de ${l.producto.codigo} para calcular el bulto.`,
      };
    bulto.alto += l.cantidad * espesorCm;
    bulto.ancho = Math.max(bulto.ancho, medidas.ancho);
    bulto.largo = Math.max(bulto.largo, medidas.largo);
    bulto.kilos += l.cantidad * kg;
    bulto.unidades[l.producto.familia] = (bulto.unidades[l.producto.familia] ?? 0) + l.cantidad;
  }
  return {
    ok: true,
    bulto: {
      ...bulto,
      alto: redondear(bulto.alto),
      ancho: redondear(bulto.ancho),
      largo: redondear(bulto.largo),
      kilos: redondear(bulto.kilos),
    },
  };
}

const cifra = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 2 });
const NOMBRE_UNIDAD: Record<Familia, [string, string]> = {
  PUERTA: ['puerta', 'puertas'],
  MARCO: ['marco', 'marcos'],
  MOLDURA: ['moldura', 'molduras'],
  PIEZAS_T: ['pieza T', 'piezas T'],
};
/** «14 puertas · 3 bultos equivalentes: 84 × 90 × 240 cm, 420 kg» (grosor apilado × ancho × largo). */
export function textoBulto(b: Bulto) {
  const unidades = FAMILIAS_ENVIO.filter((f) => b.unidades[f])
    .map((f) => `${b.unidades[f]} ${NOMBRE_UNIDAD[f][b.unidades[f] === 1 ? 0 : 1]}`)
    .join(', ');
  const bultos = `${b.bultos} ${b.bultos === 1 ? 'bulto equivalente' : 'bultos equivalentes'}`;
  return `${unidades} · ${bultos}: ${cifra(b.alto)} × ${cifra(b.ancho)} × ${cifra(b.largo)} cm, ${cifra(b.kilos)} kg`;
}

// --- Destino -----------------------------------------------------------------------------------------

/** Minúsculas, sin tildes ni signos: «Ñuñoa», «ÑUÑOA.» y «nunoa» se comparan igual. */
export const normalizarNombre = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export type ResolucionDestino =
  | { estado: 'unica'; ciudad: CiudadStarken }
  | { estado: 'ambigua'; candidatas: CiudadStarken[] }
  | { estado: 'no_encontrada' };

type Coincidencia = { unica: CiudadStarken } | { ambigua: CiudadStarken[] } | null;

function coincidencia(candidatas: CiudadStarken[], nombre: string): Coincidencia {
  if (!candidatas.length) return null;
  if (candidatas.length === 1) return { unica: candidatas[0] };
  // Una comuna que figura en varias ciudades: la ciudad que se llama igual es la que corresponde.
  const homonimas = candidatas.filter((c) => normalizarNombre(c.nombre) === nombre);
  return homonimas.length === 1 ? { unica: homonimas[0] } : { ambigua: candidatas };
}

/** Ciudades cuyo nombre, o el de alguna de sus comunas, es exactamente `nombre` (ya normalizado). */
function ciudadesLlamadas(nombre: string, ciudades: readonly CiudadStarken[]) {
  if (!nombre) return [];
  const vistas = new Map<number, CiudadStarken>();
  for (const c of ciudades)
    if (normalizarNombre(c.nombre) === nombre || c.comunas.some((m) => normalizarNombre(m) === nombre))
      vistas.set(c.codigoCiudad, c);
  return [...vistas.values()];
}

function resolverTexto(texto: string, ciudades: readonly CiudadStarken[]): Coincidencia {
  const completo = normalizarNombre(texto);
  if (!completo) return null;
  const exacta = coincidencia(ciudadesLlamadas(completo, ciudades), completo);
  if (exacta) return exacta;
  // «Av. Alemania 123, Villarrica»: las direcciones terminan en la comuna, así que se prueba del final al inicio.
  const partes = texto
    .split(/[,;/|\n]|\s-\s/)
    .map(normalizarNombre)
    .filter(Boolean)
    .reverse();
  for (const parte of partes) {
    const c = coincidencia(ciudadesLlamadas(parte, ciudades), parte);
    if (c) return c;
  }
  // Último recurso: algún nombre de comuna o ciudad aparece dentro del texto; vale el más largo, si es único.
  const rodeado = ` ${completo} `;
  const nombres = new Map<string, CiudadStarken[]>();
  for (const c of ciudades)
    for (const n of [c.nombre, ...c.comunas].map(normalizarNombre))
      if (n.length >= 4 && rodeado.includes(` ${n} `)) nombres.set(n, [...(nombres.get(n) ?? []), c]);
  const masLargo = Math.max(0, ...[...nombres.keys()].map((n) => n.length));
  const finalistas = [...nombres].filter(([n]) => n.length === masLargo);
  if (finalistas.length !== 1)
    return finalistas.length ? { ambigua: finalistas.flatMap(([, cs]) => cs) } : null;
  const [nombre, candidatas] = finalistas[0];
  return coincidencia([...new Map(candidatas.map((c) => [c.codigoCiudad, c])).values()], nombre);
}

/**
 * Ciudad de destino de Starken a partir de los textos de la cotización, del más específico al menos: el destino
 * del despacho y la comuna del cliente. El primer texto que coincide con algo decide: si es único, esa es la
 * ciudad; si es dudoso, solo un texto posterior que caiga en una de las candidatas lo resuelve (no se cambia de
 * destino en silencio). Un texto sin ninguna coincidencia pasa al siguiente. Si queda duda o nada, la persona elige.
 */
export function resolverDestino(
  textos: readonly (string | null | undefined)[],
  ciudades: readonly CiudadStarken[],
): ResolucionDestino {
  const coincidencias = textos.map((t) => (t ? resolverTexto(t, ciudades) : null));
  const principal = coincidencias.findIndex((c) => c !== null);
  if (principal < 0) return { estado: 'no_encontrada' };
  const c = coincidencias[principal]!;
  if ('unica' in c) return { estado: 'unica', ciudad: c.unica };
  for (const otra of coincidencias.slice(principal + 1))
    if (otra && 'unica' in otra && c.ambigua.some((x) => x.codigoCiudad === otra.unica.codigoCiudad))
      return { estado: 'unica', ciudad: otra.unica };
  return { estado: 'ambigua', candidatas: c.ambigua };
}

/** Búsqueda de la lista de ciudades: por fragmento del nombre de la ciudad o de sus comunas, sin tildes. */
export function buscarCiudades(consulta: string, ciudades: readonly CiudadStarken[], limite = 50) {
  const q = normalizarNombre(consulta);
  if (!q) return ciudades.slice(0, limite);
  const puntaje = (c: CiudadStarken) => {
    const nombre = normalizarNombre(c.nombre);
    if (nombre === q) return 0;
    if (nombre.startsWith(q)) return 1;
    if (nombre.includes(q)) return 2;
    const comunas = c.comunas.map(normalizarNombre);
    if (comunas.includes(q)) return 3;
    if (comunas.some((m) => m.startsWith(q))) return 4;
    return comunas.some((m) => m.includes(q)) ? 5 : null;
  };
  return ciudades
    .map((c) => ({ c, p: puntaje(c) }))
    .filter((x): x is { c: CiudadStarken; p: number } => x.p !== null)
    .sort((a, b) => a.p - b.p || a.c.nombre.localeCompare(b.c.nombre, 'es'))
    .slice(0, limite)
    .map((x) => x.c);
}

// --- Tarifas -----------------------------------------------------------------------------------------

export interface TarifaStarken {
  tipoEntrega: string;
  servicio: string;
  dias: number;
  /** Pesos con IVA incluido, tal como los informa Starken. */
  costoTotal: number;
  /** Pesos netos: lo que se guarda como valor de despacho. */
  neto: number;
}

/** Tarifa elegida por la persona, que queda en la actividad de la cotización. */
export interface TarifaStarkenAplicada {
  tipoEntrega: string;
  servicio?: string;
  dias: number;
  costoTotal: number;
  ciudadDestino: string;
  codigoCiudadDestino: number;
}

const etiquetaEntrega = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t);

/** «Domicilio · 2 días · $44.418 IVA incl. ($37.326 neto)». */
export function textoTarifa(
  t: Pick<TarifaStarken, 'tipoEntrega' | 'dias' | 'costoTotal'> & { servicio?: string },
) {
  const servicio =
    t.servicio && t.servicio.toUpperCase() !== 'NORMAL' ? ` ${etiquetaEntrega(t.servicio)}` : '';
  const dias = `${t.dias} ${t.dias === 1 ? 'día' : 'días'}`;
  return `${etiquetaEntrega(t.tipoEntrega)}${servicio} · ${dias} · ${pesos(t.costoTotal)} IVA incl. (${pesos(netoDesdeIva(t.costoTotal))} neto)`;
}

/** Registro de actividad: «Tarifa Starken aplicada: Domicilio · 2 días · … · destino SAN CARLOS (ciudad 3)». */
export const textoTarifaAplicada = (t: TarifaStarkenAplicada) =>
  `Tarifa Starken aplicada: ${textoTarifa(t)} · destino ${t.ciudadDestino} (ciudad ${t.codigoCiudadDestino})`;

// --- Formas de la API (las usan el servidor y la interfaz) ------------------------------------------------

export interface ConfiguracionStarken {
  origen: CiudadRef | null;
  paquete: ParametrosPaquete;
}
export interface EstadoStarken {
  /** El entorno del servidor tiene las credenciales; sin ellas la función se ofrece como no disponible. */
  disponible: boolean;
  mensaje: string | null;
  configuracion: ConfiguracionStarken;
}
export type ResultadoEnvioStarken =
  | {
      estado: 'tarifas';
      bulto: Bulto;
      textoBulto: string;
      destino: CiudadRef;
      tarifas: TarifaStarken[];
    }
  | {
      /** El destino no se pudo fijar solo: la persona elige una ciudad (las candidatas, si las hay). */
      estado: 'elegir_ciudad';
      motivo: 'ambigua' | 'no_encontrada';
      candidatas: CiudadStarken[];
    };

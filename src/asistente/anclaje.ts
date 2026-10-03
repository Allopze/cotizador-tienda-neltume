import { metros, normalizar, normalizarMedida } from '../catalogo/resolver';
import type { SolicitudItem } from '../catalogo/tipos';

/**
 * Anclaje de cifras: la IA puede completar una cantidad o una medida que nadie escribió. Antes de aceptar
 * una cifra nueva, el servidor comprueba que aparezca en el texto de la conversación (en dígitos o en
 * palabras). Si no aparece, la deja pendiente: preguntar cuesta menos que cotizar un dato inventado.
 */

const UNIDADES: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  cien: 100,
  ciento: 100,
  // Agrupaciones habituales en un pedido.
  par: 2,
  docena: 12,
};
const DECENAS: Record<string, number> = {
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
};

const sinTildes = (s: string) => s.toLocaleLowerCase('es-CL').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Cifras que aparecen en el texto, en dígitos («80», «2,10», «10.000») y, con `palabras`, también escritas
 * («tres», «media docena»). Las palabras solo respaldan cantidades: nadie dicta un ancho como «ochenta».
 */
export function cifrasDelTexto(texto: string, palabras = true): number[] {
  const t = sinTildes(texto);
  const cifras: number[] = [];
  for (const [token] of t.matchAll(/\d+(?:[.,]\d+)*/g)) {
    // «10.000» es diez mil; «2.10» y «2,10» son decimales.
    if (/^\d{1,3}(\.\d{3})+$/.test(token)) cifras.push(Number(token.replace(/\./g, '')));
    const decimal = Number(token.replace(',', '.'));
    if (Number.isFinite(decimal)) cifras.push(decimal);
    // «80x210» llega separado por la x; «2,10x0,80» también: cada parte ya es un token.
  }
  if (!palabras) return cifras;
  const lista = t.split(/[^a-zñ]+/).filter(Boolean);
  lista.forEach((p, i) => {
    if (p in UNIDADES) cifras.push(UNIDADES[p]);
    if (p === 'media' && lista[i + 1] === 'docena') cifras.push(6);
    if (p in DECENAS) {
      cifras.push(DECENAS[p]);
      // «treinta y dos»
      const unidad = lista[i + 1] === 'y' ? UNIDADES[lista[i + 2]] : undefined;
      if (unidad !== undefined && unidad < 10) cifras.push(DECENAS[p] + unidad);
    }
  });
  return cifras;
}

type CampoCifra = 'cantidad' | 'ancho' | 'alto';
export const CAMPOS_CIFRA: readonly CampoCifra[] = ['cantidad', 'ancho', 'alto'];

/** ¿La cifra aparece en el texto? Las medidas se comparan en metros: «80» respalda un ancho de 0,8. */
export function cifraRespaldada(campo: CampoCifra, valor: number, cifras: number[]) {
  if (campo === 'cantidad') return cifras.some((c) => c === valor);
  const objetivo = metros(valor);
  return cifras.some(
    (c) => c === valor || (objetivo !== null && metros(c) !== null && Math.abs(metros(c)! - objetivo) < 5e-4),
  );
}

const etiqueta: Record<CampoCifra, string> = {
  cantidad: 'la cantidad',
  ancho: 'el ancho',
  alto: 'el alto o largo',
};
const mostrar = (campo: CampoCifra, valor: number) =>
  campo === 'cantidad' ? String(valor) : `${String(metros(valor) ?? valor).replace('.', ',')} m`;

/**
 * Deja en null las cifras nuevas que no aparecen en el texto. Una cifra que ya estaba en el borrador (en
 * cualquier ítem, para el mismo campo) se acepta: la persona puede pedir «otra igual» o reordenar.
 */
export function anclarCifras(items: SolicitudItem[], previos: SolicitudItem[], textos: string[]) {
  const conPalabras = textos.flatMap((t) => cifrasDelTexto(t));
  // Las cifras de la sección del propio ítem («12x2») no respaldan su largo: el 2 es parte de la sección.
  const digitosDe = (item: SolicitudItem) =>
    textos.flatMap((t) =>
      cifrasDelTexto(
        item.medida
          ? t.replace(/\d+(?:[.,]\d+)?\s*[x×*]\s*\d+(?:[.,]\d+)?/gi, (m) =>
              normalizarMedida(m) === normalizarMedida(item.medida!) ? ' ' : m,
            )
          : t,
        false,
      ),
    );
  const conocidas = (campo: CampoCifra) =>
    previos.flatMap((p) => (p[campo] === null || p[campo] === undefined ? [] : [p[campo]!]));
  const avisos: string[] = [];
  const anclados = items.map((item, i) => {
    let resultado = item;
    for (const campo of CAMPOS_CIFRA) {
      const valor = item[campo];
      if (valor === null || valor === undefined) continue;
      if (conocidas(campo).some((c) => c === valor || cifraRespaldada(campo, valor, [c]))) continue;
      if (cifraRespaldada(campo, valor, campo === 'cantidad' ? conPalabras : digitosDe(item))) continue;
      resultado = { ...resultado, [campo]: null };
      avisos.push(
        `El asistente propuso ${etiqueta[campo]} ${mostrar(campo, valor)} para el ítem ${i + 1}${item.modelo ? ` (${item.modelo})` : ''}, pero esa cifra no aparece en tu mensaje: quedó pendiente para que la confirmes.`,
      );
    }
    return resultado;
  });
  return { items: anclados, avisos };
}

type CampoNombre = 'modelo' | 'madera';
/** Partes de un nombre que bastan para reconocerlo: «MARA ENCHAPADA» aparece en «enchapada en mara». */
const partesNombre = (nombre: string) => [
  nombre,
  ...nombre.split(/\s+/).filter((p) => normalizar(p).length >= 4),
];

/** Cómo resolvería el catálogo lo que dijo el cliente: el nombre canónico, o null si no lo sabe o debe preguntar. */
export type ResolverNombre = (dicho: string) => string | null;

/**
 * Si el texto nombra `propuesto` escrito de otra forma («huillo», «wilo wilo»): alguna secuencia de palabras
 * enteras del texto la resuelve el catálogo, con sus mismas reglas, a ese nombre. Así el anclaje nunca acepta
 * lo que el resolver habría preguntado o dejado desconocido, y «amarradas» no contiene la madera «mara».
 */
function dichoComo(texto: string, resolver: ResolverNombre) {
  const palabras = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  let resueltos: Set<string> | null = null;
  return (propuesto: string) => {
    if (!resueltos) {
      resueltos = new Set();
      // Primero las secuencias más largas: una palabra dentro de una frase que ya nombró otra cosa no cuenta
      // («cunnco» dentro de «cunnco sur», «pinno» dentro de «pinno finger»).
      const usada = palabras.map(() => false);
      for (let largo = Math.min(4, palabras.length); largo >= 1; largo--)
        for (let i = 0; i + largo <= palabras.length; i++) {
          if (usada.slice(i, i + largo).some(Boolean)) continue;
          const nombre = resolver(palabras.slice(i, i + largo).join(' '));
          if (!nombre) continue;
          resueltos.add(normalizar(nombre));
          usada.fill(true, i, i + largo);
        }
    }
    return resueltos.has(normalizar(propuesto));
  };
}

/**
 * Lo mismo para los nombres: un modelo o una madera nueva debe aparecer en el texto, por su nombre, por una
 * de sus palabras o por un alias del catálogo. Así la IA no puede cambiar «Pillo» por otro modelo parecido.
 * Un nombre que ya estaba en el borrador se acepta («cámbialas todas a lenga» copia la madera).
 */
export function anclarNombres(
  items: SolicitudItem[],
  previos: SolicitudItem[],
  textos: string[],
  alias: Record<CampoNombre, Record<string, string[]>>,
  /** Resolución del catálogo: acepta un nombre dicho con otra forma solo si el catálogo lo lleva a ese nombre. */
  resolver?: Record<CampoNombre, ResolverNombre>,
) {
  const texto = normalizar(textos.join(' '));
  const dicho = resolver && { modelo: dichoComo(textos.join(' '), resolver.modelo), madera: dichoComo(textos.join(' '), resolver.madera) };
  const avisos: string[] = [];
  const anclados = items.map((item, i) => {
    let resultado = item;
    for (const campo of ['modelo', 'madera'] as const) {
      const valor = item[campo];
      if (!valor) continue;
      const clave = normalizar(valor);
      if (previos.some((p) => p[campo] && normalizar(p[campo]!) === clave)) continue;
      const alternativos = Object.entries(alias[campo]).flatMap(([nombre, lista]) =>
        normalizar(nombre) === clave ? lista : [],
      );
      const candidatos = [...partesNombre(valor), ...alternativos];
      if (candidatos.some((c) => !!normalizar(c) && texto.includes(normalizar(c))) || dicho?.[campo](valor)) continue;
      resultado = { ...resultado, [campo]: null };
      avisos.push(
        `El asistente interpretó ${campo === 'modelo' ? 'el modelo' : 'la madera'} del ítem ${i + 1} como «${valor}», pero ese nombre no aparece en tu mensaje: quedó pendiente para que lo indiques.`,
      );
    }
    return resultado;
  });
  return { items: anclados, avisos };
}

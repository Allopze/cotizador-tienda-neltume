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
/** Palabras que forman una cantidad escrita («treinta y dos», «media docena»). */
export const PALABRAS_NUMERO = new Set([...Object.keys(UNIDADES), ...Object.keys(DECENAS), 'media', 'y']);

/** Minúsculas sin tildes («Raulí» → «rauli»); conserva el largo de un texto en NFC. */
export const sinTildes = (s: string) => s.toLocaleLowerCase('es-CL').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Montos en pesos («$450.000», «450 mil», «2 lucas»), en un texto ya sin tildes: el precio de un producto va
 * en su misma frase, pero nunca es su cantidad ni una medida. Lo quitado deja un separador.
 */
const MONTOS_EN_PESOS = /\$\s*\d[\d.,]*|(?<![\d.,])\d[\d.,]*\s*(?:millon(?:es)?|mil|lucas?|k)(?![a-zñ])/g;
export const sinMontos = (t: string) => t.replace(MONTOS_EN_PESOS, ' ; ');

/**
 * Cifras que aparecen en el texto, en dígitos («80», «2,10», «10.000») y, con `palabras`, también escritas
 * («tres», «media docena»). Las palabras solo respaldan cantidades: nadie dicta un ancho como «ochenta».
 */
export function cifrasDelTexto(texto: string, palabras = true): number[] {
  const t = sinMontos(sinTildes(texto));
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

/**
 * La secuencia tal como se dijo y, después, con cada palabra en singular («3 marcos» nombra MARCO, «guardapolvos»
 * a GUARDAPOLVO). Solo se quita una «S» o «ES» final de palabras largas: «amarradas» sigue sin contener «mara».
 */
const FORMAS = [
  (p: string) => p,
  (p: string) => (p.length > 3 && p.endsWith('S') ? p.slice(0, -1) : p),
  (p: string) => (p.length > 4 && p.endsWith('ES') ? p.slice(0, -2) : p),
];
function singulares(palabras: string[]) {
  return [...new Set(FORMAS.map((forma) => palabras.map(forma).join(' ')))];
}

/** Cómo resolvería el catálogo lo que dijo el cliente: el nombre canónico, o null si no lo sabe o debe preguntar. */
export type ResolverNombre = (dicho: string) => string | null;

/** Palabras que pueden seguir a una madera sin cambiarla («pino medida 80», «mara unidades»). */
const NO_CALIFICAN = new Set([
  'MEDIDA', 'MEDIDAS', 'UNIDAD', 'UNIDADES', 'PUERTA', 'PUERTAS', 'MARCO', 'MARCOS', 'JUEGO', 'JUEGOS',
  'PIEZAS', 'PARA', 'CADA', 'AMBAS', 'AMBOS', 'TODAS', 'TODOS', 'TAMBIEN', 'SOLIDA', 'SOLIDAS', 'SOLIDO',
  'SOLIDOS', 'MACIZA', 'MACIZAS', 'MACIZO', 'MACIZOS', 'ESCUADRIA', 'PULGADAS', 'METROS', 'ALTO', 'ANCHO',
]);

/**
 * Nombres que el texto dice, ya resueltos por el catálogo (normalizado → canónico), y las palabras que no
 * nombran nada conocido. Un alias que abrevia el nombre («pino» por PINO OREGON) no cuenta si lo sigue otra
 * palabra que lo califica y el catálogo no conoce («pino radiata» es otra madera); `otro` reconoce las
 * palabras del otro campo («pino coscos» sigue siendo pino).
 */
export function nombresDichos(texto: string, resolver: ResolverNombre, otro?: ResolverNombre) {
  const palabras = sinTildes(texto)
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const resueltos = new Map<string, string>();
  const conocida = (p: string) => singulares([p]).some((s) => !!resolver(s) || !!otro?.(s));
  const califica = (p: string | undefined) =>
    !!p && /^[A-Z]{5,}$/.test(p) && !NO_CALIFICAN.has(p) && !conocida(p);
  // Primero las secuencias más largas: una palabra dentro de una frase que ya nombró otra cosa no cuenta
  // («cunnco» dentro de «cunnco sur», «pinno» dentro de «pinno finger»).
  const usada = palabras.map(() => false);
  for (let largo = Math.min(4, palabras.length); largo >= 1; largo--)
    for (let i = 0; i + largo <= palabras.length; i++) {
      if (usada.slice(i, i + largo).some(Boolean)) continue;
      const secuencia = palabras.slice(i, i + largo);
      const nombre = singulares(secuencia).reduce<string | null>((n, s) => n ?? resolver(s), null);
      if (!nombre) continue;
      if (nombre.trim().split(/\s+/).length > largo && califica(palabras[i + largo])) continue;
      resueltos.set(normalizar(nombre), nombre);
      usada.fill(true, i, i + largo);
    }
  // Lo desconocido se respalda literalmente, con palabras enteras y fuera de nombres ya resueltos.
  return { resueltos, literales: palabras.map((p, i) => (usada[i] ? '' : p)) };
}

/** Palabras que acompañan a un nombre sin cambiar el producto: conectores, unidades y lo que dice la medida. */
const ACOMPANAN = new Set([
  'PARA', 'CADA', 'TIPO', 'COLOR', 'HOJA', 'HOJAS', 'VANO', 'VANOS', 'UNID', 'UNIDS', 'UNDS', 'MEDIDA',
  'MEDIDAS', 'METRO', 'METROS', 'CENTIMETROS', 'MILIMETROS', 'PULGADA', 'PULGADAS', 'MADERA', 'MADERAS',
  'PUERTA', 'PUERTAS', 'IGUAL', 'IGUALES', 'OTRA', 'OTRAS', 'OTRO', 'OTROS', 'MISMA', 'MISMAS', 'MISMO',
  'MISMOS', 'LARGO', 'TAMBIEN',
]);

/**
 * Palabras de la frase de un ítem que el catálogo no conoce y pueden cambiar el producto: las que van entre
 * el modelo y la madera («huilo huilo encha en mara») o justo después de la madera («lenga natural»). Se
 * avisan para que la persona revise la línea; también muestran qué alias falta configurar.
 */
export function palabrasDesconocidas(frase: string, resolver: Record<CampoNombre, ResolverNombre>): string[] {
  const palabras = sinTildes(frase)
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  // `literales` deja vacía cada palabra que forma parte de un nombre resuelto.
  const esModelo = nombresDichos(frase, resolver.modelo, resolver.madera).literales.map((p) => !p);
  const esMadera = nombresDichos(frase, resolver.madera, resolver.modelo).literales.map((p) => !p);
  const desconocida = (p: string | undefined): p is string =>
    !!p &&
    /^[A-Z]{4,}$/.test(p) &&
    !NO_CALIFICAN.has(p) &&
    !ACOMPANAN.has(p) &&
    !singulares([p]).some((s) => !!resolver.modelo(s) || !!resolver.madera(s));
  const halladas = new Set<string>();
  let finModelo = -1;
  for (let i = 0; i < palabras.length; i++) {
    if (esModelo[i]) finModelo = i;
    if (!esMadera[i]) continue;
    if (finModelo >= 0) for (const p of palabras.slice(finModelo + 1, i)) if (desconocida(p)) halladas.add(p);
    finModelo = -1;
    while (esMadera[i + 1]) i++;
    if (desconocida(palabras[i + 1])) halladas.add(palabras[i + 1]);
  }
  return [...halladas].map((p) => p.toLowerCase());
}

/**
 * Si el texto nombra `propuesto` escrito de otra forma («huillo», «wilo wilo»): alguna secuencia de palabras
 * enteras del texto la resuelve el catálogo, con sus mismas reglas, a ese nombre. Así el anclaje nunca acepta
 * lo que el resolver habría preguntado o dejado desconocido, y «amarradas» no contiene la madera «mara».
 */
function dichoComo(texto: string, resolver: ResolverNombre, otro?: ResolverNombre) {
  let leido: ReturnType<typeof nombresDichos> | null = null;
  return (propuesto: string) => {
    leido ??= nombresDichos(texto, resolver, otro);
    const { resueltos, literales } = leido;
    const nombre = resolver(propuesto);
    if (nombre) return resueltos.has(normalizar(nombre));
    return partesNombre(propuesto).some((parte) => {
      const clave = normalizar(parte);
      // Cada palabra se lleva al singular antes de unirla: así el mínimo de letras vale por palabra («coz xs»).
      return !!clave && FORMAS.some((forma) => literales.some((p, i) => {
        let secuencia = p && forma(p);
        let fin = i + 1;
        while (secuencia && secuencia.length < clave.length && literales[fin]) secuencia += forma(literales[fin++]);
        return secuencia === clave;
      }));
    });
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
  const dicho = resolver && {
    modelo: dichoComo(textos.join(' '), resolver.modelo, resolver.madera),
    madera: dichoComo(textos.join(' '), resolver.madera, resolver.modelo),
  };
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
      if (dicho
        ? dicho[campo](valor)
        : candidatos.some((c) => !!normalizar(c) && texto.includes(normalizar(c)))) continue;
      resultado = { ...resultado, [campo]: null };
      avisos.push(
        `El asistente interpretó ${campo === 'modelo' ? 'el modelo' : 'la madera'} del ítem ${i + 1} como «${valor}», pero ese nombre no aparece en tu mensaje: quedó pendiente para que lo indiques.`,
      );
    }
    return resultado;
  });
  return { items: anclados, avisos };
}

const metrosAviso = (v: number) => `${String(metros(v) ?? v).replace('.', ',')} m`;

/**
 * ¿El texto dice la sección? Escrita tal cual («6x1», «30x70») o, en la escuadría 2xN, por su N («de 4»,
 * «4 pulgadas»). Un formato que no se sabe leer no se juzga.
 */
function medidaRespaldada(medida: string, texto: string) {
  const m = normalizarMedida(medida);
  if ([...texto.matchAll(SECCION)].some((s) => normalizarMedida(s[0]) === m)) return true;
  const numeros = m.split('X').map((n) => Number(n.replace(',', '.')));
  if (!numeros.length || numeros.some((n) => !Number.isFinite(n))) return true;
  const cifras = cifrasDelTexto(texto, false);
  return (/^2X/.test(m) ? numeros.slice(1) : numeros).every((n) => cifras.includes(n));
}

/**
 * La palabra que ocupa el lugar del modelo, justo después de la cantidad («3 Pillo oregón 80x210» → «Pillo»), si
 * el catálogo no la conoce; null si no hay una.
 */
function palabraDelModelo(frase: string, resolver: Record<CampoNombre, ResolverNombre>) {
  const palabras = sinTildes(frase)
    .split(/[^a-zñ0-9]+/)
    .filter(Boolean);
  const inicio = palabras.findIndex((p) => /^\d+$/.test(p) || p in UNIDADES);
  const p = inicio >= 0 ? palabras[inicio + 1] : undefined;
  if (!p || !/^[a-zñ]{3,}$/.test(p) || PALABRAS_NUMERO.has(p)) return null;
  const mayusculas = p.toUpperCase();
  if (NO_CALIFICAN.has(mayusculas) || ACOMPANAN.has(mayusculas) || /^UN(D|DS|ID|IDS)$/.test(mayusculas)) return null;
  if (singulares([mayusculas]).some((s) => !!resolver.modelo(s) || !!resolver.madera(s))) return null;
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/** Texto comparable: sin tildes, en minúsculas y con un solo espacio entre palabras. */
const plano = (s: string) => sinTildes(s).replace(/[^a-z0-9ñ.,x×*]+/g, ' ').trim();
/** ¿La frase está tal cual en el mensaje, sin contar tildes, mayúsculas ni puntuación? */
export const fraseDelMensaje = (frase: string, mensaje: string) =>
  !!plano(frase) && plano(mensaje).includes(plano(frase));

/** Sección de un accesorio escrita en el texto («2x5», «6 x 4,5», «30x70»); no las medidas de una puerta («80x210»). */
export const SECCION = /(?<![\d.,])\d{1,2}\s*[x×*]\s*\d{1,2}(?:[.,]\d)?(?![\d.,]*\d)/g;

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const UNIDAD_MEDIDA = String.raw`(?:m|mt|mts|mtrs|metros?|cm|mm|"|”|pulg(?:adas?)?)(?![a-z])`;
/** Par de medidas «80 x 210», «0,82 m por 2,4», «1230 x 2600 mm». */
const PAR_MEDIDAS = new RegExp(
  String.raw`(${NUM})\s*(?:${UNIDAD_MEDIDA})?\s*(?:x|×|\*|por)\s*(${NUM})(?:\s*${UNIDAD_MEDIDA})?`,
  'g',
);
/** Separa una cifra de la palabra pegada a ella («210cm» → «210 cm»). */
const separado = (s: string) => sinTildes(s).replace(/(\d)([a-z"”])/g, '$1 $2');

/**
 * Cantidades que dice una frase: cifras y palabras («tres», «media docena» = 6, «un par» = 2), sin las que son
 * medidas (pares «80 x 210», cifras con unidad, «de 2,5», decimales). «5 unidades» gana a cualquier otra.
 */
export function cantidadesDichas(frase: string): number[] {
  // Lo quitado deja un separador: «alto 2,5 m 11 marcos» no debe dejar «alto 11» pegado.
  const t = sinMontos(separado(frase))
    .replace(PAR_MEDIDAS, ' ; ')
    .replace(new RegExp(String.raw`${NUM}\s*${UNIDAD_MEDIDA}`, 'g'), ' ; ')
    .replace(new RegExp(String.raw`\b(?:de|alto|ancho|largo|medida|mide|miden)\s+${NUM}`, 'g'), ' ; ');
  const fuertes = [...t.matchAll(/(?<![\d.,])(\d+)\s*(?:unidades|unidad|uds?|u|juegos|piezas)\b/g)].map((m) => Number(m[1]));
  if (fuertes.length) return [...new Set(fuertes)];
  const cifras = [...t.matchAll(/(?<![\d.,])\d+(?![\d.,]*\d)/g)].map((m) => Number(m[0]));
  const palabras = t.split(/[^a-z]+/).filter(Boolean);
  for (let i = 0; i < palabras.length; i++) {
    const p = palabras[i],
      siguiente = palabras[i + 1];
    if (p === 'media' && siguiente === 'docena') {
      cifras.push(6);
      i++;
    } else if ((p === 'un' || p === 'una') && (siguiente === 'docena' || siguiente === 'par')) {
      cifras.push(UNIDADES[siguiente]);
      i++;
    } else if (p in DECENAS) {
      const unidad = siguiente === 'y' ? UNIDADES[palabras[i + 2]] : undefined;
      if (unidad !== undefined && unidad < 10) {
        cifras.push(DECENAS[p] + unidad);
        i += 2;
      } else cifras.push(DECENAS[p]);
    } else if (p in UNIDADES) cifras.push(UNIDADES[p]);
  }
  return [...new Set(cifras)];
}

/**
 * Cantidad escrita justo antes del modelo del ítem («7 unidades y 1 TOLTEN» → 1 para la Tolten; «un par de
 * ancacomoe» → 2): la señal más clara cuando la IA corta mal las frases de un pedido largo.
 */
export function cantidadAntesDelModelo(frase: string, modelo: string): number | null {
  const t = sinTildes(frase);
  const nombre = sinTildes(modelo).trim();
  const i = t.indexOf(nombre);
  // Con el modelo nombrado dos veces («39 marcos… 11 marcos») no hay una sola cifra que le corresponda.
  if (i <= 0 || t.indexOf(nombre, i + nombre.length) >= 0) return null;
  const m =
    /(?:^|[\s,;])((?:media|una?)\s+docena|un\s+par|\d+|[a-z]+)\s+(?:de\s+)?(?:(?:puertas?|unidades|juegos?(?:\s+de)?|piezas)\s+)?(?:de\s+)?$/.exec(
      t.slice(0, i),
    );
  const valor = m ? cantidadesDichas(m[1]) : [];
  return valor.length === 1 ? valor[0] : null;
}

/**
 * Medidas de puerta con su nombre: «240 de alto por 110 de ancho», «alto 2,1 ancho 0,8». Cada una vale solo si
 * se dice una vez.
 */
function medidasNombradas(frase: string): { ancho?: number; alto?: number } {
  const t = separado(frase);
  const leer = (campo: 'ancho' | 'alto') => {
    const valores = [
      ...t.matchAll(new RegExp(String.raw`(${NUM})\s*(?:m|mts?|cm|mm)?\s*de\s+${campo}\b`, 'g')),
      ...t.matchAll(new RegExp(String.raw`\b${campo}\s*(?:de\s+)?(${NUM})`, 'g')),
    ]
      .map((m) => metros(Number(m[1].replace(',', '.'))))
      .filter((m): m is number => m !== null);
    return new Set(valores).size === 1 ? valores[0] : undefined;
  };
  return { ancho: leer('ancho'), alto: leer('alto') };
}

/** Ancho y alto de una puerta escritos como un único par en la frase; el menor es el ancho. */
export function parMedidaPuerta(frase: string): { ancho: number; alto: number } | null {
  const nombradas = medidasNombradas(frase);
  if (nombradas.ancho !== undefined && nombradas.alto !== undefined)
    return { ancho: nombradas.ancho, alto: nombradas.alto };
  const pares = [...separado(frase).matchAll(PAR_MEDIDAS)].flatMap((m) => {
    const a = metros(Number(m[1].replace(',', '.'))),
      b = metros(Number(m[2].replace(',', '.')));
    return a !== null && b !== null ? [{ ancho: Math.min(a, b), alto: Math.max(a, b) }] : [];
  });
  return pares.length === 1 ? pares[0] : null;
}

/** Escuadría dicha en pulgadas («de 8 pulgadas», «6"»): en marcos y piezas T es la sección 2xN. */
const PULGADAS = /(?<![\d.,x×*])(\d{1,2})\s*(?:pulgadas?|pulg\.?|"|”)/g;

/** ¿El texto trae medidas de producto (un par «80 x 210» o una sección «2x4»)? Un pedido puede venir como pregunta. */
export const tieneMedidas = (texto: string) =>
  [...separado(texto).matchAll(PAR_MEDIDAS)].length > 0 || (sinTildes(texto).match(SECCION)?.length ?? 0) > 0;

/**
 * Cifras sueltas de la frase que pueden ser una medida: sin secciones, pulgadas, «N unidades» ni la cantidad
 * escrita en dígitos («5 marcos … de 240» deja el 240). Con la cantidad en palabras («dos piezas T … de 2»), el
 * 2 escrito sí es una medida.
 */
function medidasSueltas(frase: string, cantidad: number | null | undefined): number[] {
  const t = separado(frase)
    .replace(SECCION, ' ')
    .replace(PULGADAS, ' ')
    .replace(/(?<![\d.,])\d+\s*(?:unidades|unidad|uds?|u|juegos|piezas)\b/g, ' ');
  const cifras = [...t.matchAll(/(?<![\d.,])\d+(?:[.,]\d+)?(?![\d.,]*\d)/g)].map((m) => Number(m[0].replace(',', '.')));
  const cuenta = (lista: number[]) => lista.filter((c) => c === cantidad).length;
  const enPalabras = cantidad != null && cuenta(cifrasDelTexto(frase)) > cuenta(cifrasDelTexto(frase, false));
  const i = cantidad != null && !enPalabras ? cifras.indexOf(cantidad) : -1;
  if (i >= 0) cifras.splice(i, 1);
  return cifras;
}

/**
 * Anclaje por ítem: cada ítem trae la frase del pedido de la que salió (`fuente`). Su modelo, madera, medidas y
 * cantidad deben salir de esa frase o de lo que el mensaje dice para todo el pedido («todas en lenga»), nunca
 * de la frase de otro ítem: así la IA no puede cotizar «futrono pino oregón … y Los Lagos raulí» con la Futrono
 * en raulí, ni «lanco 5 unidades y 1 chauquen» con una sola Lanco. Lo que la frase dice sin ambigüedad corrige
 * a la IA: una sola madera, modelo o sección («marcos mara» leído como MARA ENCHAPADA, «marco 2x5» como 30x70),
 * una sola cantidad («media docena» leída como 0,5) o un solo par de medidas («1230 x 2600 mm» leído como
 * 12,3 m). Tampoco acepta como largo la cifra que solo es la cantidad («2 guardapolvos 12x1»).
 *
 * Solo revisa ítems cuya frase aparece tal cual en el mensaje; lo que ya estaba en el borrador o dijo antes la
 * persona se acepta. Una frase sin modelo («… y 2 de 70x210») continúa el ítem anterior y hereda lo que no dice,
 * igual que «otra igual» o «con su marco».
 */
export function anclarFrases(
  items: SolicitudItem[],
  previos: SolicitudItem[],
  mensaje: string,
  resolver: Record<CampoNombre, ResolverNombre>,
  /** Mensajes anteriores de la persona (no del asistente): lo que dijo antes también respalda. */
  anteriores: string[] = [],
  /** Familia del modelo en el catálogo; sin ella, un ítem sin sección se trata como puerta. */
  familia: (modelo: string) => string | null = () => null,
) {
  const texto = plano(mensaje);
  const antes = anteriores.join(' \n ');
  const frases = items.map((item) => {
    const f = item.fuente ? plano(item.fuente) : '';
    return f && texto.includes(f) ? f : null;
  });
  /** El mensaje sin las frases de los demás ítems (las que no contienen ni están contenidas en la propia). */
  const sinOtras = (i: number) =>
    frases.reduce<string>((t, f, j) => {
      const propia = frases[i]!;
      return j === i || !f || f.includes(propia) || propia.includes(f) ? t : t.split(f).join(' | ');
    }, texto);
  const conocida = (campo: 'modelo' | 'madera' | 'cantidad' | 'ancho' | 'alto', valor: string | number) =>
    previos.some((p) =>
      campo === 'madera' || campo === 'modelo'
        ? !!p[campo] && normalizar(p[campo]!) === normalizar(String(valor))
        : p[campo] === valor,
    );
  const conSuMarco = /\bcon (su |sus )?marcos?\b|\bcada (una|uno) con\b/.test(texto);
  const avisos: string[] = [];
  const anclados = items.map((item, i) => {
    const frase = frases[i];
    if (!frase) return item;
    let resultado = item;
    const etiquetaItem = `el ítem ${i + 1}${item.modelo ? ` (${item.modelo})` : ''}`;
    // Lo que la frase dice sin ambigüedad corrige a la IA, pero a la vista: un cambio de producto, cantidad o
    // medida no pasa en silencio.
    const corregido = (campo: string, propuesto: string, usado: string) =>
      avisos.push(
        `Revisa ${etiquetaItem}: el asistente leyó ${campo} ${propuesto}, pero tu pedido dice ${usado}; usé ${usado}.`,
      );
    const modelosFrase = nombresDichos(frase, resolver.modelo, resolver.madera).resueltos;
    // Lo que el ítem puede tomar de otro: continúa un ítem anterior, lo copia o es el marco de esas puertas.
    const continua = !modelosFrase.size || /\b(otr[oa]s?|igual(es)?|mism[oa]s?)\b/.test(frase);
    const delMarco = /\bmarcos?\b/.test(frase) && conSuMarco;
    const respaldo = (campo: 'ancho' | 'alto', v: number, t: string) => cifraRespaldada(campo, v, cifrasDelTexto(t, false));
    const deOtroItem = (campo: 'ancho' | 'alto', v: number) =>
      !continua &&
      !respaldo(campo, v, sinOtras(i)) &&
      !(antes && respaldo(campo, v, antes)) &&
      frases.some((f, j) => j !== i && !!f && respaldo(campo, v, f));

    // Modelo: si la frase nombra modelos y la IA propuso otro del catálogo, gana el de la frase.
    if (item.modelo && modelosFrase.size && !conocida('modelo', item.modelo)) {
      const propuesto = resolver.modelo(item.modelo);
      if (propuesto && !modelosFrase.has(normalizar(propuesto))) {
        const unico = modelosFrase.size === 1 ? [...modelosFrase.values()][0] : null;
        resultado = { ...resultado, modelo: unico };
        if (unico) corregido('el modelo', `«${item.modelo}»`, `«${unico}»`);
        else
          avisos.push(
            `El asistente interpretó el modelo del ${etiquetaItem.slice(3)} como «${item.modelo}», pero tu pedido nombra otro: quedó pendiente para que lo indiques.`,
          );
      }
    }
    // La IA cambió la palabra del lugar del modelo («3 Pillo oregón…») por un modelo del catálogo que la frase no
    // nombra (PILASTRA): se conserva lo escrito, y el sistema pregunta si es el modelo que se le parece.
    if (
      resultado.modelo &&
      !modelosFrase.size &&
      !conocida('modelo', resultado.modelo) &&
      resolver.modelo(resultado.modelo) &&
      !dichoComo(frase, resolver.modelo, resolver.madera)(resultado.modelo)
    ) {
      const escrito = palabraDelModelo(frase, resolver);
      if (escrito) {
        corregido('el modelo', `«${resultado.modelo}»`, `«${escrito}»`);
        resultado = { ...resultado, modelo: escrito };
      }
    }
    const maderasFrase = nombresDichos(frase, resolver.madera, resolver.modelo).resueltos;
    const desconocidas = palabrasDesconocidas(frase, resolver);
    if (desconocidas.length)
      avisos.push(
        `No reconocí ${desconocidas.map((p) => `«${p}»`).join(', ')} en ${etiquetaItem}: revisa que el producto sea el que se pidió.`,
      );
    if (!item.madera && maderasFrase.size === 1)
      // La IA dejó vacía la madera que la frase dice («marco oregon de 5 pulgadas…»).
      resultado = { ...resultado, madera: [...maderasFrase.values()][0] };
    else if (item.madera && !conocida('madera', item.madera)) {
      const propuesta = resolver.madera(item.madera);
      if (maderasFrase.size) {
        if (!propuesta || !maderasFrase.has(normalizar(propuesta))) {
          const unica = maderasFrase.size === 1 ? [...maderasFrase.values()][0] : null;
          resultado = { ...resultado, madera: unica };
          if (unica) corregido('la madera', `«${item.madera}»`, `«${unica}»`);
          else
            avisos.push(
              `El asistente interpretó la madera del ${etiquetaItem.slice(3)} como «${item.madera}», pero tu pedido nombra otra: quedó pendiente para que la indiques.`,
            );
        }
      } else if (
        !continua &&
        !dichoComo(sinOtras(i), resolver.madera, resolver.modelo)(item.madera) &&
        !(antes && dichoComo(antes, resolver.madera, resolver.modelo)(item.madera))
      ) {
        resultado = { ...resultado, madera: null };
        avisos.push(
          `El asistente interpretó la madera del ${etiquetaItem.slice(3)} como «${item.madera}», pero ese nombre corresponde a otro ítem del pedido: quedó pendiente para que la indiques.`,
        );
      }
    }
    const secciones = [
      ...new Set([
        ...[...frase.matchAll(SECCION)].map((m) => normalizarMedida(m[0])),
        ...[...frase.matchAll(PULGADAS)].map((m) => `2X${m[1]}`),
      ]),
    ];
    // Una sección que la conversación no dice (la IA leyó «Pillo» como una pilastra 6x1) no se cotiza: queda
    // pendiente, y el ítem vuelve a leerse como puerta si sus medidas son las de una.
    const medidaPropuesta = resultado.medida;
    if (
      medidaPropuesta &&
      secciones.length !== 1 &&
      !previos.some((p) => p.medida && normalizarMedida(p.medida) === normalizarMedida(medidaPropuesta)) &&
      ![texto, antes].some((t) => t && medidaRespaldada(medidaPropuesta, t))
    ) {
      resultado = { ...resultado, medida: null };
      avisos.push(
        `El asistente propuso la sección ${medidaPropuesta} para ${etiquetaItem}, pero no aparece en tu pedido: quedó pendiente para que la confirmes.`,
      );
    }
    const familiaItem = resultado.modelo ? familia(resultado.modelo) : null;
    const esPuerta = familiaItem ? familiaItem === 'PUERTA' : resultado.medida == null;
    const par = parMedidaPuerta(frase);
    // La sección escrita en la frase («marco 2x5 pino», «de 8 pulgadas») gana a otra que proponga la IA (30x70
    // de los finger) y completa la que dejó vacía.
    if (!esPuerta && resultado.ancho == null && secciones.length === 1) {
      const propia = resultado.medida ? normalizarMedida(resultado.medida) : null;
      const conocidaMedida = previos.some((p) => p.medida && normalizarMedida(p.medida) === propia);
      if (propia !== secciones[0] && !conocidaMedida && (propia || !par)) {
        resultado = { ...resultado, medida: secciones[0] };
        if (propia) corregido('la sección', `«${item.medida}»`, `«${secciones[0]}»`);
      }
    }

    const cantidad = item.cantidad;
    // «Con su marco» lleva la cantidad de sus puertas y viceversa; «una en lenga y otra en mara», una de cada una.
    // La frase del marco puede ser solo «su marco 2x8»: el «con su marco» se busca en todo el mensaje.
    const heredada =
      conSuMarco &&
      cantidad != null &&
      items.some(
        (otro, j) => j !== i && otro.cantidad === cantidad && (/\bmarcos?\b/.test(frase) || /\bmarcos?\b/.test(frases[j] ?? '')),
      );
    const otraUna = cantidad === 1 && /\b(otra|otro)\b/.test(frase);
    const invalida = cantidad != null && !(Number.isInteger(cantidad) && cantidad >= 1 && cantidad <= 10000);
    const ajena =
      cantidad != null &&
      !conocida('cantidad', cantidad) &&
      !heredada &&
      !otraUna &&
      !cifrasDelTexto(frase).includes(cantidad) &&
      !cifrasDelTexto(sinOtras(i)).includes(cantidad) &&
      !cifrasDelTexto(antes).includes(cantidad);
    // Una sola cantidad en la frase gana a la de la IA: «un par de» son 2 aunque la IA leyera «un». La escrita
    // justo antes del modelo manda sobre las demás.
    const antesDelModelo = resultado.modelo ? cantidadAntesDelModelo(frase, resultado.modelo) : null;
    const dichas = antesDelModelo !== null ? [antesDelModelo] : cantidadesDichas(frase);
    if (
      !heredada &&
      !otraUna &&
      dichas.length === 1 &&
      dichas[0] !== cantidad &&
      (cantidad == null || invalida || ajena || !conocida('cantidad', cantidad))
    ) {
      resultado = { ...resultado, cantidad: dichas[0] };
      if (cantidad != null && !invalida) corregido('la cantidad', String(cantidad), String(dichas[0]));
    } else if (ajena) {
      resultado = { ...resultado, cantidad: null };
      avisos.push(
        `El asistente propuso la cantidad ${cantidad} para ${etiquetaItem}, pero esa cifra corresponde a otro ítem del pedido: quedó pendiente para que la confirmes.`,
      );
    }

    if (esPuerta) {
      // Medidas de puerta: el par de la frase corrige una cifra mal leída o invertida; una tomada de otro ítem
      // queda pendiente.
      const { ancho, alto } = resultado;
      if (par && ancho != null && alto != null && Math.abs(ancho - par.alto) < 5e-4 && Math.abs(alto - par.ancho) < 5e-4)
        resultado = { ...resultado, ancho: par.ancho, alto: par.alto };
      // La IA dejó vacía una de las dos medidas del par que sí leyó («2 lipinza de 93 por 200» sin el ancho).
      const coincide = (campo: 'ancho' | 'alto', v: number | null | undefined) =>
        v != null && metros(v) !== null && Math.abs(metros(v)! - par![campo]) < 5e-4;
      if (par && ancho == null && coincide('alto', alto)) resultado = { ...resultado, ancho: par.ancho };
      if (par && alto == null && coincide('ancho', ancho)) resultado = { ...resultado, alto: par.alto };
      // Una sola medida suelta («media docena de Riñihue de 141»): hasta 1,6 m es el ancho; desde 1,8 m, el alto.
      if (!par && (resultado.ancho == null || resultado.alto == null)) {
        const sueltas = medidasSueltas(frase, resultado.cantidad)
          .map((n) => metros(n))
          .filter((m): m is number => m !== null);
        const [m] = sueltas;
        if (sueltas.length === 1 && resultado.ancho == null && m <= 1.6 && !(resultado.alto != null && Math.abs(resultado.alto - m) < 5e-4))
          resultado = { ...resultado, ancho: m };
        else if (sueltas.length === 1 && resultado.alto == null && m >= 1.8 && !(resultado.ancho != null && Math.abs(resultado.ancho - m) < 5e-4))
          resultado = { ...resultado, alto: m };
      }
      for (const campo of ['ancho', 'alto'] as const) {
        const v = resultado[campo];
        if (v == null || conocida(campo, v)) continue;
        if (metros(v) !== null && respaldo(campo, v, frase)) continue;
        if (par) {
          resultado = { ...resultado, [campo]: par[campo] };
          corregido(campo === 'ancho' ? 'el ancho' : 'el alto', metrosAviso(v), metrosAviso(par[campo]));
        } else if (deOtroItem(campo, v)) {
          resultado = { ...resultado, [campo]: null };
          avisos.push(
            `El asistente propuso ${campo === 'ancho' ? 'el ancho' : 'el alto'} ${String(metros(v) ?? v).replace('.', ',')} m para ${etiquetaItem}, pero esa medida corresponde a otro ítem del pedido: quedó pendiente para que la confirmes.`,
          );
        }
      }
    } else if (!delMarco && (resultado.alto == null || !conocida('alto', resultado.alto))) {
      // Largo de un accesorio: si la frase no lo respalda, se toma su única cifra suelta («5 marcos 2x8 para
      // puerta de 240» → 2,4 m; «marco de 8 pulgadas 2,2 m, 2 unidades» → 2,2 m). El marco de unas puertas
      // («con su marco») toma el alto de ellas.
      const alto = resultado.alto;
      const sinSeccion = separado(frase).replace(SECCION, ' ').replace(PULGADAS, ' ');
      if (!(alto != null && metros(alto) !== null && respaldo('alto', alto, sinSeccion))) {
        const sueltas = medidasSueltas(frase, resultado.cantidad)
          .map((n) => metros(n))
          .filter((m): m is number => m !== null);
        if (sueltas.length === 1) resultado = { ...resultado, alto: sueltas[0] };
        else if (alto != null && deOtroItem('alto', alto)) {
          resultado = { ...resultado, alto: null };
          avisos.push(
            `El asistente propuso el largo ${String(metros(alto) ?? alto).replace('.', ',')} m para ${etiquetaItem}, pero esa medida corresponde a otro ítem del pedido: quedó pendiente para que la confirmes.`,
          );
        }
      }
    }
    // «2 guardapolvos 12x1»: el 2 es la cantidad, no un largo de 2 m. Un largo que solo respalda la cifra de
    // la cantidad, escrita una vez, no se dijo.
    const alto = resultado.alto;
    if (alto != null && resultado.cantidad != null && !conocida('alto', alto)) {
      const cifras = cifrasDelTexto(frase.replace(SECCION, ' '), false);
      const respaldos = cifras.filter((c) => cifraRespaldada('alto', alto, [c]));
      // «tres guardapolvos … de 3 m»: con la cantidad en palabras, el 3 escrito es el largo.
      const cuenta = (lista: number[]) => lista.filter((c) => c === resultado.cantidad).length;
      const enPalabras = cuenta(cifrasDelTexto(frase)) > cuenta(cifrasDelTexto(frase, false));
      if (
        respaldos.length === 1 &&
        respaldos[0] === resultado.cantidad &&
        !enPalabras &&
        !cifrasDelTexto(antes, false).some((c) => cifraRespaldada('alto', alto, [c]))
      ) {
        resultado = { ...resultado, alto: null };
        avisos.push(
          `El asistente usó la cantidad ${resultado.cantidad} también como alto o largo del ${etiquetaItem.slice(3)}: quedó pendiente para que lo confirmes.`,
        );
      }
    }
    return resultado;
  });
  // «Cotiza 3 Huellahue … con marco 2x4»: el marco lleva la cantidad y el alto de su puerta si la IA los dejó
  // vacíos. Solo con una puerta en el pedido; con varias no se sabe de cuál es.
  const puertas = anclados.filter((it) => !!it.modelo && familia(it.modelo) === 'PUERTA');
  if (conSuMarco && puertas.length === 1) {
    const [puerta] = puertas;
    for (const [i, it] of anclados.entries()) {
      if (!frases[i] || !it.modelo || familia(it.modelo) !== 'MARCO') continue;
      anclados[i] = { ...it, cantidad: it.cantidad ?? puerta.cantidad, alto: it.alto ?? puerta.alto };
    }
  }
  return { items: anclados, avisos };
}

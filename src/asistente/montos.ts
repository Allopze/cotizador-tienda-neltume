import { sinPorcentajes, sinTildes } from './anclaje';

/**
 * Montos en pesos que escribe la persona en el chat (flete y precio de un producto). La IA los devuelve, pero
 * solo valen si están escritos en la conversación: una cifra que nadie escribió no se aplica.
 */

const MULTIPLICADORES: Record<string, number> = { mil: 1_000, luca: 1_000, lucas: 1_000, k: 1_000 };
/**
 * Una cifra completa, nunca cortada en un punto de miles («$1.250.000c/u» no es $1.250); con miles, la
 * pueden seguir centavos («$120.000,00»). Después, su multiplicador y lo que puede venir pegado: puntuación
 * («$350.000.», «$120.000, 1 …», «$450.000.-»), «c/u» o «x2», y la moneda o el impuesto sin espacio
 * («$35.000pesos», «$35.000clp», «$35.000iva», «$35.000neto», «120.000cu»).
 */
const MONTO =
  /(\d{1,3}(?:\.\d{3})*\.0{1,2}(?![.,]?\d)|\d{1,3}(?:\.\d{3})+(?!\.?\d)|\d+(?:[.,]\d+)?(?![.,]?\d))\s*(millon(?:es)?|mil|lucas?|k)?(?=c\/u|x\d|(?:pesos?|clp|iva|netos?|cu)(?![a-zñ])|(?![a-zñ]))/g;
/** En pesos el punto separa miles y no hay centavos: «$350.00» es $350.000 con un cero de menos, nunca $350. */
const MILES_INCOMPLETOS = /^\d{1,3}(?:\.\d{3})*\.0{1,2}$/;
const completarMiles = (cifra: string) =>
  Number(cifra.slice(0, cifra.lastIndexOf('.')).replace(/\./g, '')) * 1000;
/** Un monto bajo $1.000 casi siempre tiene ceros de menos («$350»): se aplica, pero se avisa. */
export const MONTO_BAJO = 1_000;
/** «$350.50»: no se sabe qué monto es. No respalda ninguno. */
const esAmbiguo = (cifra: string, unidad: string | undefined) =>
  !unidad && /^\d+\.\d{1,2}$/.test(cifra) && !MILES_INCOMPLETOS.test(cifra);

/** Montos con «$» que no son claros en pesos («$350.50»), tal como se escribieron; no las medidas («0.74x2.08»). */
export function montosAmbiguos(texto: string) {
  const t = sinTildes(texto);
  return [...t.matchAll(MONTO)]
    .filter((m) => esAmbiguo(m[1], m[2]) && t.slice(0, m.index).trimEnd().endsWith('$'))
    .map((m) => `$${m[1]}`);
}

/** Cada «$350.00» del texto con su lectura literal (350) y el monto que dice (350.000). */
const milesIncompletos = (texto: string) =>
  [...sinTildes(texto).matchAll(MONTO)]
    .filter((m) => !m[2] && MILES_INCOMPLETOS.test(m[1]))
    .map((m) => ({ literal: Number(m[1]), monto: completarMiles(m[1]) }));

const valores = (palabras: string, desde: number, paso = 1) =>
  Object.fromEntries(palabras.split(' ').map((p, i) => [p, desde + i * paso]));
/** Números en palabras, de uno a novecientos; «doscientas» se lee como «doscientos». */
const NUMEROS: Record<string, number> = {
  ...valores('uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince', 1),
  ...valores(
    'dieciseis diecisiete dieciocho diecinueve veinte veintiuno veintidos veintitres veinticuatro',
    16,
  ),
  ...valores('veinticinco veintiseis veintisiete veintiocho veintinueve', 25),
  ...valores('treinta cuarenta cincuenta sesenta setenta ochenta noventa', 30, 10),
  ...valores(
    'cien doscientos trescientos cuatrocientos quinientos seiscientos setecientos ochocientos novecientos',
    100,
    100,
  ),
  un: 1,
  una: 1,
  veintiun: 21,
  veintiuna: 21,
  ciento: 100,
};
const numero = (p: string | undefined) => (p ? NUMEROS[p.replace(/ientas$/, 'ientos')] : undefined);
const esMillon = (p: string | undefined) => !!p && /^millon(es)?$/.test(p);
/** Lo que puede seguir a un monto terminado en «mil»; otra palabra («cotiza mil puertas») lo descarta. */
const TRAS_MIL =
  /^(pesos?|lucas?|clp|netos?|mas|menos|iva|cada|por|para|con|sin|del|los|las|total|todo|hasta|aprox\w*|incluido)$/;

/**
 * Montos en palabras: «cien mil», «dos mil quinientos», «un millón quinientos mil», «medio millón», «un
 * millón y medio», «treinta lucas». Sin «mil», «millón» ni «lucas» no es un monto («dos puertas»); «350 mil»
 * lo lee MONTO.
 */
function montosEnPalabras(t: string): number[] {
  const palabras = t.match(/[a-zñ]+|\d[\d.,]*|\S/g) ?? [];
  const montos: number[] = [];
  for (let i = 0; i < palabras.length; i++) {
    const p = palabras[i];
    if (numero(p) === undefined && p !== 'mil' && !(p === 'medio' && esMillon(palabras[i + 1]))) continue;
    if (p === 'mil' && /^\d/.test(palabras[i - 1] ?? '')) continue;
    // `grupo` es lo que multiplica el próximo «mil» o «millón»; `ultimo`, la palabra anterior: «doscientos
    // cincuenta» suma, «dos tres» no.
    let total = 0,
      grupo = 0,
      ultimo = 0,
      escala = Infinity,
      j = i;
    for (; j < palabras.length; j++) {
      const q = palabras[j],
        v = numero(q);
      if (v !== undefined && (grupo === 0 || (ultimo >= 100 && v < 100))) {
        grupo += v;
        ultimo = v;
      } else if (q === 'y' && ultimo >= 30 && ultimo < 100 && (numero(palabras[j + 1]) ?? 10) < 10) {
        // «treinta y cinco»
        grupo += numero(palabras[++j])!;
        ultimo = 1;
      } else if (q === 'medio' && grupo === 0 && esMillon(palabras[j + 1])) grupo = 0.5;
      else if (q === 'mil' && escala > 1_000) {
        total += (grupo || 1) * 1_000;
        [grupo, ultimo, escala] = [0, 0, 1_000];
      } else if (esMillon(q) && escala > 1_000_000) {
        total = (total + grupo || 1) * 1_000_000;
        [grupo, ultimo, escala] = [0, 0, 1_000_000];
        if (palabras[j + 1] === 'y' && palabras[j + 2] === 'medio') [total, j] = [total + 500_000, j + 2];
      } else if (/^lucas?$/.test(q) && total + grupo > 0 && escala >= 1_000) {
        [total, grupo, escala] = [(total + grupo) * 1_000, 0, 1_000];
        j++;
        break;
      } else break;
    }
    const sustantivo =
      palabras[j - 1] === 'mil' && /^[a-zñ]{3,}$/.test(palabras[j] ?? '') && !TRAS_MIL.test(palabras[j]);
    if (escala !== Infinity && !sustantivo) montos.push(Math.round(total + grupo));
    i = j - 1;
  }
  return montos;
}

/**
 * Montos en pesos escritos en el texto: «$380.000», «380000», «380 mil», «380 lucas», «380k»,
 * «1,2 millones», «$350.00» (= $350.000) y en palabras («cien mil»). Con multiplicador solo cuenta el monto
 * completo: «380 mil» no respalda $380.
 */
export function montosDelTexto(texto: string): number[] {
  const montos: number[] = [];
  const t = sinTildes(texto);
  for (const [, cifra, unidad] of t.matchAll(MONTO)) {
    if (esAmbiguo(cifra, unidad)) continue;
    const base =
      !unidad && MILES_INCOMPLETOS.test(cifra)
        ? completarMiles(cifra)
        : /^\d{1,3}(?:\.\d{3})+$/.test(cifra)
          ? Number(cifra.replace(/\./g, ''))
          : /^\d{1,3}(?:,\d{3})+$/.test(cifra)
            ? Number(cifra.replace(/,/g, ''))
            : Number(cifra.replace(',', '.'));
    if (!Number.isFinite(base)) continue;
    const factor = unidad ? (unidad.startsWith('millon') ? 1_000_000 : MULTIPLICADORES[unidad]) : 1;
    montos.push(Math.round(base * factor));
  }
  return [...montos, ...montosEnPalabras(t)];
}

/**
 * El monto que propuso la IA, si está escrito en `textos` (sin `textos`, un doble de prueba, se acepta). Si la
 * IA leyó «$350.00» al pie de la letra ($350), vale lo escrito: $350.000. Si no está, `ambiguo` cita un monto
 * dudoso del texto («$350.50»), si lo hay, para pedir que se escriba completo.
 */
export function montoEscrito(
  valor: number,
  textos: string[] | null,
): { ok: true; valor: number } | { ok: false; ambiguo: string | null } {
  if (!Number.isFinite(valor) || valor <= 0) return { ok: false, ambiguo: null };
  if (!textos) return { ok: true, valor };
  const escrito = (v: number) => textos.some((t) => montosDelTexto(t).includes(v));
  if (escrito(valor)) return { ok: true, valor };
  const corregido = textos.flatMap(milesIncompletos).find((m) => m.literal === valor)?.monto;
  if (corregido !== undefined && escrito(corregido)) return { ok: true, valor: corregido };
  return { ok: false, ambiguo: textos.flatMap(montosAmbiguos)[0] ?? null };
}

/**
 * Lo que dice que un monto es el total de varias unidades: «en total», «total», «por todo», «por las dos», «las dos»
 * (no «las dos de 80x200»).
 */
const TOTAL =
  /\b(?:en total|el total|total|por todo|todo por|(?:por )?(?:las|los) (?:dos|tres|cuatro|cinco|seis|\d+)(?! de)|por (?:ambas|ambos|todas|todos))\b/;
/** Lo que dice que el monto es por unidad: gana a «total» en la misma parte («$200.000 c/u, $400.000 en total»). */
const POR_UNIDAD = /c\/u|\bcada (?:una|uno)\b|\bpor (?:unidad|puerta|pieza)\b|\bunitario\b|\bc\/?u\b/;

/**
 * ¿El texto dice que `valor` es un total y no el precio de una unidad («2 molco lenga 80x200 a $400.000 en
 * total»)? Se lee por partes (cortadas en líneas, «;» y «, »): vale si la parte con el monto dice «total» y no
 * «c/u», o si la que sigue solo dice «en total». No depende de cómo la IA llenó el precio.
 */
export function montoTotal(valor: number, textos: string[]): boolean {
  return textos.some((texto) => {
    const partes = sinTildes(texto).split(/\n|;|,(?=\s)/);
    return partes.some((parte, i) => {
      if (!montosDelTexto(parte).includes(valor) || POR_UNIDAD.test(parte)) return false;
      if (TOTAL.test(parte)) return true;
      const siguiente = partes[i + 1]?.trim() ?? '';
      return TOTAL.test(siguiente) && !montosDelTexto(siguiente).length;
    });
  });
}

/** «15», «12,5» o «12.5» (sin puntos de miles): un porcentaje tiene a lo más dos decimales. */
const PORCENTAJE = String.raw`(?<![\d.,$])(\d{1,3}(?:[.,]\d{1,2})?)(?![.,]?\d)`;
const PORCENTAJES = [
  // «15 %», «15%», «15 por ciento»
  new RegExp(String.raw`${PORCENTAJE}\s*(?:%|por\s*ciento|porciento)`, 'g'),
  // La cifra sola junto a «descuento»: nadie hace un descuento de $15. «Descuento de 15 mil» es un monto.
  new RegExp(String.raw`\bdescuento\s+(?:de\s+|del\s+)?${PORCENTAJE}(?!\s*(?:mil|lucas?|k|millon|pesos?|clp)(?![a-zñ]))`, 'g'),
  new RegExp(String.raw`${PORCENTAJE}\s+(?:de\s+)?descuento\b`, 'g'),
];

/**
 * Porcentajes escritos en el texto: «15 %», «12,5%», «15 por ciento», «quince por ciento», «treinta y cinco
 * por ciento», y la cifra sola junto a «descuento» («descuento de 15», «15 de descuento»). Hasta 100.
 */
export function porcentajesDelTexto(texto: string): number[] {
  const t = sinTildes(texto);
  const valores = PORCENTAJES.flatMap((re) => [...t.matchAll(re)].map((m) => Number(m[1].replace(',', '.'))));
  const palabras = t.split(/[^a-zñ]+/).filter(Boolean);
  palabras.forEach((p, i) => {
    if (!(p === 'porciento' || (p === 'por' && palabras[i + 1] === 'ciento'))) return;
    const v = numero(palabras[i - 1]);
    if (v === undefined) return;
    // «treinta y cinco por ciento»
    const decena = palabras[i - 2] === 'y' ? numero(palabras[i - 3]) : undefined;
    valores.push(decena !== undefined && decena >= 30 && decena < 100 && v < 10 ? decena + v : v);
  });
  return [...new Set(valores)].filter((v) => Number.isFinite(v) && v <= 100);
}

/**
 * El porcentaje que propuso la IA, si está escrito en `textos` (sin `textos`, un doble de prueba, se acepta). Si
 * la IA lo dio como fracción (0,15 por «15 %»), vale lo escrito.
 */
export function porcentajeEscrito(valor: number, textos: string[] | null): number | null {
  if (!Number.isFinite(valor) || valor <= 0) return null;
  if (!textos) return valor;
  const escritos = textos.flatMap(porcentajesDelTexto);
  if (escritos.includes(valor)) return valor;
  const fraccion = Math.round(valor * 10_000) / 100;
  return valor < 1 && escritos.includes(fraccion) ? fraccion : null;
}

/** Montos del texto sin sus porcentajes: «15 % de descuento» no respalda un descuento de $15. */
export const textosSinPorcentajes = (textos: string[] | null) => textos?.map((t) => sinPorcentajes(sinTildes(t))) ?? null;

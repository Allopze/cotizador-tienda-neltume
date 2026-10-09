import { sinTildes } from './anclaje';

/**
 * Montos en pesos que escribe la persona en el chat (flete y precio de un producto). La IA los devuelve, pero
 * solo valen si están escritos en la conversación: una cifra que nadie escribió no se aplica.
 */

const MULTIPLICADORES: Record<string, number> = { mil: 1_000, luca: 1_000, lucas: 1_000, k: 1_000 };
const MONTO =
  /(\d{1,3}(?:\.\d{3})*\.0{1,2}(?!\d)|\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*(millon(?:es)?|mil|lucas?|k)?(?![a-zñ])/g;
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

/**
 * Montos en pesos escritos en el texto: «$380.000», «380000», «380 mil», «380 lucas», «380k»,
 * «1,2 millones» y «$350.00» (= $350.000). Con multiplicador solo cuenta el monto completo: «380 mil» no
 * respalda $380.
 */
export function montosDelTexto(texto: string): number[] {
  const montos: number[] = [];
  const t = sinTildes(texto);
  for (const [, cifra, unidad] of t.matchAll(MONTO)) {
    if (esAmbiguo(cifra, unidad)) continue;
    const base =
      !unidad && MILES_INCOMPLETOS.test(cifra)
        ? completarMiles(cifra)
        : /^\d{1,3}(\.\d{3})+$/.test(cifra)
          ? Number(cifra.replace(/\./g, ''))
          : Number(cifra.replace(',', '.'));
    if (!Number.isFinite(base)) continue;
    const factor = unidad ? (unidad.startsWith('millon') ? 1_000_000 : MULTIPLICADORES[unidad]) : 1;
    montos.push(Math.round(base * factor));
  }
  return montos;
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

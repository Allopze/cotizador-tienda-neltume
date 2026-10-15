// Lectura de cifras escritas por personas, compartida por servidor e interfaz.
import { MARGEN_MAX, MARGEN_MIN } from './limites';

/**
 * Cifra con separadores chilenos: el punto separa miles y la coma decimales, pero una coma seguida de
 * exactamente tres dígitos (sin otro separador) también es de miles: «45,990» = 45990, «45,99» = 45,99.
 * Si aparecen ambos, el último es el decimal. «1.5» es decimal (no hay grupo de tres).
 */
export function interpretarCifra(cifra: string): number {
  const c = cifra.replace(/\s/g, '');
  const miles = (grupos: string[]) => grupos.slice(1).every((g) => g.length === 3);
  if (c.includes('.') && c.includes(',')) {
    const decimal = c.lastIndexOf('.') > c.lastIndexOf(',') ? '.' : ',';
    const otro = decimal === '.' ? ',' : '.';
    return Number(c.split(otro).join('').replace(decimal, '.'));
  }
  for (const sep of [',', '.']) {
    if (!c.includes(sep)) continue;
    const grupos = c.split(sep);
    if (miles(grupos)) return Number(grupos.join(''));
    return grupos.length === 2 ? Number(grupos.join('.')) : NaN;
  }
  return Number(c);
}

/** Monto en pesos escrito con o sin «$», puntos de miles o espacios: «$15.000» → 15000. */
export const leerPesos = (texto: string) => {
  const limpio = texto.replace(/[$\s]/g, '');
  return limpio ? interpretarCifra(limpio) : 0;
};

/**
 * Porcentaje con coma o punto decimal: «2,5», «2.5» y «2,5 %» → 2.5. Un porcentaje nunca lleva
 * separador de miles, así que el punto siempre es decimal.
 */
export const leerPorcentaje = (texto: string) => {
  const limpio = texto.replace(/[%\s]/g, '').replace(',', '.');
  if (!limpio) return 0;
  return /^\d+(?:\.\d+)?$/.test(limpio) ? Number(limpio) : NaN;
};

/**
 * Porcentaje con signo opcional («-10», «−10,5 %»), para márgenes que pueden ser negativos. Sin ningún
 * dígito («-», «%», «- %») no es un número: NaN, nunca 0.
 */
export const leerPorcentajeConSigno = (texto: string) => {
  const limpio = texto.trim();
  const negativo = /^[-\u2212]/.test(limpio);
  const cuerpo = negativo ? limpio.slice(1) : limpio;
  if (!/\d/.test(cuerpo)) return Number.NaN;
  const n = leerPorcentaje(cuerpo);
  return negativo ? -n : n;
};

/** Mensaje de error de un margen («ganancia» en pantalla) escrito en porcentaje (−50 %…500 %, dos decimales), o null. */
export function errorMargenTexto(texto: string): string | null {
  const n = leerPorcentajeConSigno(texto);
  if (Number.isNaN(n)) return 'Escribe un número.';
  if (n < MARGEN_MIN * 100 || n > MARGEN_MAX * 100)
    return `La ganancia debe estar entre ${MARGEN_MIN * 100} y ${MARGEN_MAX * 100} %.`;
  if (!conDosDecimales(n)) return 'Usa como máximo dos decimales.';
  return null;
}

/** Hasta dos decimales, tolerando el error binario de coma flotante (2,3 × 100 = 229,999…). */
export const conDosDecimales = (n: number) =>
  Number.isFinite(n) && Math.abs(Math.round(n * 100) - n * 100) < 1e-6;

/** Redondea a centésimas para guardar porcentajes sin arrastrar error binario. */
export const aCentesimas = (n: number) => Math.round(n * 100) / 100;

/** Margen (fracción) a cuatro decimales, sin el error binario de dividir un porcentaje por 100 (7 / 100). */
export const redondearMargen = (margen: number) => Math.round(margen * 10000) / 10000 + 0;
/** Porcentaje escrito por una persona → margen como fracción para guardar: 42 → 0,42. */
export const porcentajeAMargen = (porcentaje: number) => redondearMargen(porcentaje / 100);
/** Margen (fracción) → porcentaje sin ruido binario: 0,07 → 7 (no 7,000000000000001). */
export const margenAPorcentaje = (margen: number) => Math.round(margen * 10000) / 100 + 0;

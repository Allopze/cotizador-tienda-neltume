/**
 * Normalización compartida; no agrega cifras ni nombres que no escribió la persona. Solo pega la «x» entre cifras
 * («80 x 200» → «80x200»): «dúplex lenga» sigue siendo dos palabras. «×» y «*» son «x» solo entre cifras; fuera
 * de ellas son puntuación («*2 molco lenga 83x236*», negrita de WhatsApp).
 */
export const planoFrase = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/(\d)\s*[×*]\s*(?=\d)/g, '$1x')
    .replace(/(\d)\s+por\s+(?=\d)/g, '$1x')
    .replace(/(\d)\s*x\s*(?=\d)/g, '$1x')
    .replace(/[^a-z0-9ñ.,x]+/g, ' ')
    .trim();

/** Minúsculas sin tildes, letra por letra: las posiciones siguen valiendo en el texto recibido. */
const comparable = (s: string) =>
  s
    .replace(/[\s\S]/g, (c) => {
      const n = c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      return n.length === 1 ? n : ' ';
    })
    .replace(/(?<=\d\s*)[×*](?=\s*\d)/g, 'x');

/** Cada aparición de la frase en el texto, ignorando puntuación y el conector «en». */
export function ubicacionesFrase(texto: string, frase: string): [number, number][] {
  const partes =
    comparable(frase)
      .match(/[a-zñ]+|\d+/g)
      ?.filter((p) => p !== 'en') ?? [];
  if (!partes.length) return [];
  const patron = partes
    .map((p) => (p === 'por' || p === 'x' ? '(?:x|por)' : p))
    .join('(?:[^a-z0-9ñ]|\\ben\\b)*');
  // Una unidad pegada a la última cifra («83x236cm») también cierra la frase; otras letras pegadas, no.
  const fin = String.raw`(?=(?<=\d)(?:cm|mm|mts|mt|m)(?![a-z0-9ñ])|(?![a-z0-9ñ]))`;
  return [...comparable(texto).matchAll(new RegExp(`(?<![a-z0-9ñ])${patron}${fin}`, 'g'))].map(
    (m): [number, number] => [m.index, m.index + m[0].length],
  );
}

/**
 * Dónde está la frase en el texto. Repetida dice lo mismo: vale la primera aparición que no se cruza con
 * `tomados` (las de otros ítems) o, si todas se cruzan, la primera. null si no aparece.
 */
export function ubicarFrase(
  texto: string,
  frase: string,
  tomados: [number, number][] = [],
): [number, number] | null {
  const todas = ubicacionesFrase(texto, frase);
  return todas.find(([a, b]) => !tomados.some(([c, d]) => a < d && c < b)) ?? todas[0] ?? null;
}

/**
 * Parte del mensaje que vale para varios ítems: «ambas de 73x240», «las dos en 80x200», «cada una de 0,73 x 2,4»,
 * «todas de 70x210». Llega hasta la coma, el punto y coma o el final (una coma decimal no corta).
 */
export const PARTE_COMUN = /\b(?:ambas|ambos|las dos|los dos|cada una|cada uno|todas|todos)\b(?:[^,;]|,(?=\d))*/g;

/**
 * Dónde está la frase, también si la IA la armó con trozos del mensaje («una en lenga, ambas de 74x220» de «una en
 * lenga y otra en mara, ambas de 74x220»): cada trozo (cortado en «,» que no es decimal, «;», «...» o «…») debe
 * aparecer, en el mismo orden y sin cruzarse. Sin coma, el final de la frase puede venir de la parte común
 * («una en lenga de 74x220»). null si no aparece así.
 */
export function ubicarPartes(
  texto: string,
  frase: string,
  tomados: [number, number][] = [],
): [number, number][] | null {
  const entera = ubicarFrase(texto, frase, tomados);
  if (entera) return [entera];
  const partes = frase
    .split(/(?<!\d),|,(?!\d)|;|…|\.{2,}/)
    .map((p) => p.trim())
    .filter((p) => /[a-zñ0-9]/i.test(p));
  return (partes.length > 1 && enTrozos(texto, partes, tomados)) || conParteComun(texto, frase, tomados);
}

function enTrozos(texto: string, partes: string[], tomados: [number, number][]) {
  const tramos: [number, number][] = [];
  for (const parte of partes) {
    const desde = tramos.at(-1)?.[1] ?? 0;
    const siguientes = ubicacionesFrase(texto, parte).filter(([a]) => a >= desde);
    const libre = siguientes.find(([a, b]) => !tomados.some(([c, d]) => a < d && c < b)) ?? siguientes[0];
    if (!libre) return null;
    tramos.push(libre);
  }
  return tramos;
}

/**
 * «una en lenga de 80x200» de «… una en lenga y otra en mara, ambas de 80x200»: la IA pegó a la frase del ítem la
 * parte común, que vale para todos. El comienzo debe aparecer y el resto, después y dentro de una parte común.
 */
function conParteComun(texto: string, frase: string, tomados: [number, number][]): [number, number][] | null {
  const comunes = [...comparable(texto).matchAll(PARTE_COMUN)].map((m) => [m.index, m.index + m[0].length]);
  if (!comunes.length) return null;
  const palabras = frase.trim().split(/\s+/);
  for (let k = palabras.length - 1; k > 0; k--) {
    const inicio = ubicarFrase(texto, palabras.slice(0, k).join(' '), tomados);
    if (!inicio) continue;
    const resto = ubicacionesFrase(texto, palabras.slice(k).join(' ')).find(
      ([a, b]) => a >= inicio[1] && comunes.some(([c, d]) => c <= a && b <= d),
    );
    if (resto) return [inicio, resto];
  }
  return null;
}

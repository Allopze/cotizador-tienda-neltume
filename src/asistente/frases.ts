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
 * Dónde está la frase, también si la IA la armó con trozos del mensaje («una en lenga, ambas de 74x220» de «una en
 * lenga y otra en mara, ambas de 74x220»): cada trozo (cortado en «,» que no es decimal, «;», «...» o «…») debe
 * aparecer, en el mismo orden y sin cruzarse. null si no aparece así.
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
  if (partes.length < 2) return null;
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

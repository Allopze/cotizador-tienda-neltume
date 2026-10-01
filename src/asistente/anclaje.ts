import { metros } from '../catalogo/resolver';
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
  const conPalabras = textos.flatMap((t) => cifrasDelTexto(t)),
    soloDigitos = textos.flatMap((t) => cifrasDelTexto(t, false));
  const conocidas = (campo: CampoCifra) =>
    previos.flatMap((p) => (p[campo] === null || p[campo] === undefined ? [] : [p[campo]!]));
  const avisos: string[] = [];
  const anclados = items.map((item, i) => {
    let resultado = item;
    for (const campo of CAMPOS_CIFRA) {
      const valor = item[campo];
      if (valor === null || valor === undefined) continue;
      if (conocidas(campo).some((c) => c === valor || cifraRespaldada(campo, valor, [c]))) continue;
      if (cifraRespaldada(campo, valor, campo === 'cantidad' ? conPalabras : soloDigitos)) continue;
      resultado = { ...resultado, [campo]: null };
      avisos.push(
        `El asistente propuso ${etiqueta[campo]} ${mostrar(campo, valor)} para el ítem ${i + 1}${item.modelo ? ` (${item.modelo})` : ''}, pero esa cifra no aparece en tu mensaje: quedó pendiente para que la confirmes.`,
      );
    }
    return resultado;
  });
  return { items: anclados, avisos };
}

import type { Familia, Producto } from './tipos';

/** Holgura de una medida exacta del catálogo: el largo 2,1 acepta 2,095 a 2,105 m. */
const HOLGURA = 0.005;
/** Cómo calzó la medida pedida con la referencia: valor exacto, dentro del rango o siguiente medida. */
export type AjusteMedida = 'exacto' | 'rango' | 'siguiente';
export interface Escalon {
  min: number;
  max: number;
  exacto: boolean;
}
/** Medida de catálogo del producto: rango de ancho o de alto, o valor exacto. El alto sin rango es el largo. */
export function escalon(p: Producto, campo: 'ancho' | 'alto'): Escalon | null {
  const min = campo === 'ancho' ? p.anchoMin : (p.altoMin ?? p.largo);
  const max = campo === 'ancho' ? p.anchoMax : (p.altoMax ?? p.largo);
  if (min === null || max === null) return null;
  return { min, max, exacto: max - min < 1e-9 };
}
/** Marcos y piezas T bajo 3 m se venden como kit («PULG KIT»); desde 3 m, como pieza lineal («PULG X 3 MT»). */
export const LARGO_PIEZA = 3;
export const vieneEnKit = (f: Familia) => f === 'MARCO' || f === 'PIEZAS_T';
export const esKit = (p: Pick<Producto, 'familia' | 'largo'>) => vieneEnKit(p.familia) && p.largo < LARGO_PIEZA;
const holgura = (e: Escalon) => (e.exacto ? HOLGURA : 0);
export const enEscalon = (valor: number, e: Escalon) =>
  valor >= e.min - holgura(e) - 1e-9 && valor <= e.max + holgura(e) + 1e-9;
/** Nunca se baja de escalón: una medida pedida menor que la referencia significa que se usó la siguiente. */
export function ajusteMedida(valor: number, p: Producto, campo: 'ancho' | 'alto'): AjusteMedida | null {
  const e = escalon(p, campo);
  if (!e) return null;
  if (valor < e.min - holgura(e) - 1e-9) return 'siguiente';
  return e.exacto ? 'exacto' : 'rango';
}

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
const rango = (min: number | null | undefined, max: number | null | undefined) =>
  min != null && max != null && min <= max + 1e-9 ? { min, max, exacto: max - min < 1e-9 } : null;
/**
 * Medida de catálogo del producto: rango de ancho o de alto, o valor exacto. Un rango vale solo con sus dos
 * límites en orden; si no, el alto es el `largo` exacto y el ancho no existe.
 */
export function escalon(p: Producto, campo: 'alto'): Escalon;
export function escalon(p: Producto, campo: 'ancho' | 'alto'): Escalon | null;
export function escalon(p: Producto, campo: 'ancho' | 'alto'): Escalon | null {
  if (campo === 'ancho') return rango(p.anchoMin, p.anchoMax);
  return rango(p.altoMin, p.altoMax) ?? { min: p.largo, max: p.largo, exacto: true };
}
/** Marcos y piezas T bajo 3 m se venden como kit («PULG KIT»); desde 3 m, como pieza lineal («PULG X 3 MT»). */
export const LARGO_PIEZA = 3;
export const vieneEnKit = (f: Familia) => f === 'MARCO' || f === 'PIEZAS_T';
/** Un «SET DE MARCO» (marcos Pino Finger, medidos en mm) es un kit en cualquier largo, también a 3 m. */
export const esSetDeMarco = (p: Pick<Producto, 'familia'> & { tipo?: string | null }) =>
  p.familia === 'MARCO' && /^SET\b/i.test(p.tipo ?? '');
export const esKit = (p: Pick<Producto, 'familia' | 'largo'> & { tipo?: string | null }) =>
  vieneEnKit(p.familia) && (p.largo < LARGO_PIEZA || esSetDeMarco(p));
const holgura = (e: Escalon) => (e.exacto ? HOLGURA : 0);
export const enEscalon = (valor: number, e: Escalon) =>
  valor >= e.min - holgura(e) - 1e-9 && valor <= e.max + holgura(e) + 1e-9;
/** ¿Dos escalones comparten alguna medida? Una medida exacta cuenta con su holgura. */
export const escalonesSeTocan = (a: Escalon, b: Escalon) =>
  a.min - holgura(a) <= b.max + holgura(b) + 1e-9 && a.max + holgura(a) >= b.min - holgura(b) - 1e-9;
/** Nunca se baja de escalón: una medida pedida menor que la referencia significa que se usó la siguiente. */
export function ajusteMedida(valor: number, p: Producto, campo: 'ancho' | 'alto'): AjusteMedida | null {
  const e = escalon(p, campo);
  if (!e) return null;
  if (valor < e.min - holgura(e) - 1e-9) return 'siguiente';
  return e.exacto ? 'exacto' : 'rango';
}

/** «0,835», «2,40»: metros en formato chileno, hasta milímetros. Lo usan el panel y los avisos. */
export const metrosTexto = (n: number) =>
  n.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
/** «0,90–0,95 × 2,40 m» o «2,60 m»: la medida de catálogo de una referencia. */
export function medidaReferencia(p: Producto) {
  const texto = (e: Escalon | null) =>
    e && (e.exacto ? metrosTexto(e.min) : `${metrosTexto(e.min)}–${metrosTexto(e.max)}`);
  return `${[texto(escalon(p, 'ancho')), texto(escalon(p, 'alto'))].filter(Boolean).join(' × ')} m`;
}

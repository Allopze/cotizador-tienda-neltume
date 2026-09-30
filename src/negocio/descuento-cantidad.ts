import type { Producto } from '../catalogo/tipos';
import { aCentesimas, conDosDecimales } from './cifras';
import { porcentaje, type ReglasComerciales, type TramoDescuento } from './precios';

/**
 * Descuento por cantidad: un porcentaje sobre el precio según el total de PUERTAS de la cotización
 * (la suma de `cantidad` de las líneas valorizadas de familia PUERTA; marcos, molduras y piezas T no
 * cuentan, ni los ítems pendientes, que todavía no tienen línea). Se aplica el tramo de mayor umbral
 * alcanzado. Los tramos se configuran en Ajustes y cada cotización congela los vigentes al crearse.
 */
export const MAX_TRAMOS = 10;
export const MAX_DESDE_PUERTAS = 100_000;

type ConFamilia = { producto: { familia: Producto['familia'] }; cantidad: number };
type ReglasDescuento = Pick<ReglasComerciales, 'descuentoMaximo' | 'descuentosPorCantidad'>;

export const contarPuertas = (lineas: readonly ConFamilia[]) =>
  lineas.reduce((total, l) => (l.producto.familia === 'PUERTA' ? total + l.cantidad : total), 0);

/** El tramo de mayor umbral que no supera las puertas de la cotización; null si ninguno se alcanza. */
export function tramoAplicable(tramos: readonly TramoDescuento[] | undefined, puertas: number) {
  let elegido: TramoDescuento | null = null;
  for (const t of tramos ?? [])
    if (t.desdePuertas <= puertas && (!elegido || t.desdePuertas > elegido.desdePuertas)) elegido = t;
  return elegido;
}

/** El próximo tramo por alcanzar (menor umbral por encima de las puertas actuales), para sugerirlo en pantalla. */
export function siguienteTramo(tramos: readonly TramoDescuento[] | undefined, puertas: number) {
  let elegido: TramoDescuento | null = null;
  for (const t of tramos ?? [])
    if (t.desdePuertas > puertas && (!elegido || t.desdePuertas < elegido.desdePuertas)) elegido = t;
  return elegido;
}

/** Porcentaje automático de una cotización con `puertas` puertas; nunca pasa del descuento máximo de sus reglas. */
export function descuentoAutomatico(reglas: ReglasDescuento, puertas: number) {
  const tramo = tramoAplicable(reglas.descuentosPorCantidad, puertas);
  return tramo ? Math.min(aCentesimas(tramo.porcentaje), reglas.descuentoMaximo) : 0;
}

/** Primer problema de una lista de tramos: el mensaje y, si se sabe, la fila y el campo que lo causan. */
export interface ProblemaTramos {
  mensaje: string;
  indice?: number;
  campo?: 'desdePuertas' | 'porcentaje';
}
export function problemaTramos(
  tramos: readonly TramoDescuento[],
  descuentoMaximo: number,
): ProblemaTramos | null {
  if (tramos.length > MAX_TRAMOS) return { mensaje: `Puedes definir hasta ${MAX_TRAMOS} tramos.` };
  const vistos = new Set<number>();
  for (const [indice, t] of tramos.entries()) {
    const desde = (mensaje: string): ProblemaTramos => ({ mensaje, indice, campo: 'desdePuertas' });
    const porcentajeDe = (mensaje: string): ProblemaTramos => ({ mensaje, indice, campo: 'porcentaje' });
    const incompleto = 'Completa «Desde» y el porcentaje de cada tramo.';
    if (!Number.isFinite(t.desdePuertas)) return desde(incompleto);
    if (!Number.isFinite(t.porcentaje)) return porcentajeDe(incompleto);
    if (!Number.isInteger(t.desdePuertas) || t.desdePuertas < 2 || t.desdePuertas > MAX_DESDE_PUERTAS)
      return desde(`«Desde» debe ser un número entero de puertas, de 2 a ${MAX_DESDE_PUERTAS}.`);
    const tramo = `«desde ${t.desdePuertas} puertas»`;
    if (t.porcentaje <= 0) return porcentajeDe(`El porcentaje del tramo ${tramo} debe ser mayor que 0.`);
    if (!conDosDecimales(t.porcentaje))
      return porcentajeDe(`El porcentaje del tramo ${tramo} admite hasta dos decimales.`);
    if (t.porcentaje > descuentoMaximo)
      return porcentajeDe(
        `El porcentaje del tramo ${tramo} no puede superar el descuento máximo (${porcentaje(descuentoMaximo)}).`,
      );
    if (vistos.has(t.desdePuertas))
      return desde(`Hay más de un tramo ${tramo}: cada umbral debe ser distinto.`);
    vistos.add(t.desdePuertas);
  }
  return null;
}
/** Mensaje del primer problema de los tramos (para la persona), o null si la lista es válida. */
export const errorTramos = (tramos: readonly TramoDescuento[], descuentoMaximo: number) =>
  problemaTramos(tramos, descuentoMaximo)?.mensaje ?? null;

/** Tramos de menor a mayor umbral. */
export const ordenarTramos = <T extends TramoDescuento>(tramos: readonly T[]) =>
  [...tramos].sort((a, b) => a.desdePuertas - b.desdePuertas);

export const textoPuertas = (n: number) => `${n} ${n === 1 ? 'puerta' : 'puertas'}`;
/** «desde 20 puertas −10 %» */
export const textoTramo = (t: TramoDescuento) =>
  `desde ${t.desdePuertas} puertas −${porcentaje(t.porcentaje)}`;

type ConDescuento = {
  descuento?: number;
  descuentoManual?: boolean;
  reglas?: Pick<ReglasComerciales, 'descuentosPorCantidad'>;
};
/**
 * ¿Fijó el descuento una persona? Sin el dato (cotización guardada antes del descuento automático) lo que ya
 * había lo fijó una persona: `descuento > 0`. Es la única regla de ese valor por omisión, también en la base.
 */
export const descuentoEsManual = (q: Pick<ConDescuento, 'descuento' | 'descuentoManual'>) =>
  q.descuentoManual ?? (q.descuento ?? 0) > 0;
/** El descuento de la cotización sale de los tramos (no de una persona), y hay tramos que lo explican. */
export const descuentoPorCantidadActivo = (q: ConDescuento) =>
  !descuentoEsManual(q) && !!q.reglas?.descuentosPorCantidad?.length;
/**
 * Nombre del descuento en los documentos: «Descuento por cantidad» solo si lo aplicó un tramo. La versión
 * corta («Desc. por cantidad») es para la caja de totales del PDF, de 255 px: con el nombre completo y un
 * monto de mil millones la fila se partía en dos líneas.
 */
export const etiquetaDescuento = (q: ConDescuento, { corta = false }: { corta?: boolean } = {}) =>
  descuentoPorCantidadActivo(q) ? (corta ? 'Desc. por cantidad' : 'Descuento por cantidad') : 'Descuento';

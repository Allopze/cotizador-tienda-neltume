import type { Producto } from '../catalogo/tipos';
import { conDosDecimales } from './cifras';
/**
 * Reglas comerciales. Redondeo (siempre a pesos enteros, Math.round):
 * 1. precio unitario = round(precioNeto × (1 + ajuste)); total de línea = cantidad × unitario.
 * 2. subtotal = suma de líneas; descuento = round(subtotal × porcentaje / 100).
 * 3. neto = subtotal − descuento + flete (el flete ya es neto entero); IVA = round(neto × iva).
 * La nota de pedido usa ajuste 0, sin descuento ni flete.
 */
export interface ReglasComerciales {
  ajuste: number;
  iva: number;
  vigenciaDiasHabiles: number;
  descuentoMaximo: number;
}
export const REGLAS: ReglasComerciales = {
  ajuste: 0.25,
  iva: 0.19,
  vigenciaDiasHabiles: 10,
  descuentoMaximo: 50,
};
export class ErrorPrecio extends Error {
  constructor(
    public codigo:
      | 'sin_items'
      | 'cantidad_invalida'
      | 'precio_invalido'
      | 'ajuste_invalido'
      | 'iva_invalido'
      | 'descuento_invalido'
      | 'flete_invalido'
      | 'desbordamiento',
  ) {
    super(codigo);
    this.name = 'ErrorPrecio';
  }
}
/** Medidas pedidas por la persona (en metros), que la fábrica necesita aunque el producto sea un rango. */
export interface MedidasSolicitadas {
  indice?: number | null;
  anchoSolicitado?: number | null;
  altoSolicitado?: number | null;
  medidaSolicitada?: string | null;
}
export interface ItemPrecio extends MedidasSolicitadas {
  producto: Producto;
  cantidad: number;
  precioUnitario?: number | null;
}
export interface Linea {
  producto: Producto;
  cantidad: number;
  precioUnitario: number;
  /** Precio unitario fijado solo para esta cotización; null si viene de catálogo. */
  precioUnitarioPersonalizado?: number | null;
  total: number;
  /** Índice de la solicitud que originó la línea; null en registros anteriores. */
  indice: number | null;
  anchoSolicitado: number | null;
  altoSolicitado: number | null;
  medidaSolicitada: string | null;
}
export interface Montos {
  lineas: Linea[];
  /** Suma de líneas antes de descuento y flete. */
  subtotal: number;
  descuentoPorcentaje: number;
  descuento: number;
  flete: number;
  /** Base imponible: subtotal − descuento + flete. */
  neto: number;
  iva: number;
  total: number;
}
export interface Extras {
  descuento?: number;
  flete?: number;
}
export const montosVacios = (): Montos => ({
  lineas: [],
  subtotal: 0,
  descuentoPorcentaje: 0,
  descuento: 0,
  flete: 0,
  neto: 0,
  iva: 0,
  total: 0,
});
export const descuentoValido = (d: number, maximo = REGLAS.descuentoMaximo) =>
  Number.isFinite(d) && d >= 0 && d <= maximo && conDosDecimales(d);
export const fleteValido = (f: number) => Number.isSafeInteger(f) && f >= 0 && f <= 100_000_000;
export function cotizar(
  items: ItemPrecio[],
  reglas: Pick<ReglasComerciales, 'ajuste' | 'iva'> &
    Partial<Pick<ReglasComerciales, 'descuentoMaximo'>> = REGLAS,
  extras: Extras = {},
): Montos {
  if (!items.length) throw new ErrorPrecio('sin_items');
  if (!Number.isFinite(reglas.ajuste) || reglas.ajuste < -0.5 || reglas.ajuste > 1)
    throw new ErrorPrecio('ajuste_invalido');
  if (!Number.isFinite(reglas.iva) || reglas.iva < 0 || reglas.iva > 1) throw new ErrorPrecio('iva_invalido');
  const descuentoPorcentaje = extras.descuento ?? 0,
    flete = extras.flete ?? 0;
  if (!descuentoValido(descuentoPorcentaje, reglas.descuentoMaximo ?? REGLAS.descuentoMaximo))
    throw new ErrorPrecio('descuento_invalido');
  if (!fleteValido(flete)) throw new ErrorPrecio('flete_invalido');
  const lineas = items.map((item): Linea => {
    const { producto, cantidad } = item;
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10000)
      throw new ErrorPrecio('cantidad_invalida');
    if (!Number.isFinite(producto.precioNeto) || producto.precioNeto <= 0)
      throw new ErrorPrecio('precio_invalido');
    const precioUnitarioPersonalizado = item.precioUnitario ?? null;
    if (
      precioUnitarioPersonalizado !== null &&
      (!Number.isSafeInteger(precioUnitarioPersonalizado) ||
        precioUnitarioPersonalizado <= 0 ||
        precioUnitarioPersonalizado > 100_000_000)
    )
      throw new ErrorPrecio('precio_invalido');
    const precioUnitario =
      precioUnitarioPersonalizado ?? Math.round(producto.precioNeto * (1 + reglas.ajuste));
    return {
      producto,
      cantidad,
      precioUnitario,
      ...(precioUnitarioPersonalizado !== null ? { precioUnitarioPersonalizado } : {}),
      total: cantidad * precioUnitario,
      indice: item.indice ?? null,
      anchoSolicitado: item.anchoSolicitado ?? null,
      altoSolicitado: item.altoSolicitado ?? null,
      medidaSolicitada: item.medidaSolicitada ?? null,
    };
  });
  const subtotal = lineas.reduce((sum, l) => sum + l.total, 0),
    // En centésimas de punto: 2,3 % × 1.500 = 34,5 → 35 (en coma flotante daba 34,4999… → 34).
    descuento = Math.round((subtotal * Math.round(descuentoPorcentaje * 100)) / 10000),
    neto = subtotal - descuento + flete,
    iva = Math.round(neto * reglas.iva),
    total = neto + iva;
  if (
    ![subtotal, descuento, neto, iva, total, ...lineas.flatMap((l) => [l.total, l.precioUnitario])].every(
      Number.isSafeInteger,
    )
  )
    throw new ErrorPrecio('desbordamiento');
  return { lineas, subtotal, descuentoPorcentaje, descuento, flete, neto, iva, total };
}
export const pesos = (n: number) =>
  '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n);
export const porcentajeIva = (iva = REGLAS.iva) =>
  `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(iva * 100)} %`;
export const porcentaje = (n: number) =>
  `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(n)} %`;

import type { Producto } from '../catalogo/tipos';
export const REGLAS = { ajuste: 0.25, iva: 0.19 };
export class ErrorPrecio extends Error {
  constructor(
    public codigo:
      | 'sin_items'
      | 'cantidad_invalida'
      | 'precio_invalido'
      | 'ajuste_invalido'
      | 'iva_invalido'
      | 'desbordamiento',
  ) {
    super(codigo);
    this.name = 'ErrorPrecio';
  }
}
export interface ItemPrecio {
  producto: Producto;
  cantidad: number;
  ajuste?: number;
}
export interface Linea {
  producto: Producto;
  cantidad: number;
  precioUnitario: number;
  total: number;
}
export interface Montos {
  lineas: Linea[];
  neto: number;
  iva: number;
  total: number;
}
export const montosVacios = (): Montos => ({ lineas: [], neto: 0, iva: 0, total: 0 });
export function cotizar(items: ItemPrecio[], reglas = REGLAS): Montos {
  if (!items.length) throw new ErrorPrecio('sin_items');
  const validarAjuste = (a: number) => {
    if (!Number.isFinite(a) || a < -0.5 || a > 1) throw new ErrorPrecio('ajuste_invalido');
  };
  validarAjuste(reglas.ajuste);
  if (!Number.isFinite(reglas.iva) || reglas.iva < 0 || reglas.iva > 1) throw new ErrorPrecio('iva_invalido');
  const lineas = items.map(({ producto, cantidad, ajuste }) => {
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10000)
      throw new ErrorPrecio('cantidad_invalida');
    if (!Number.isFinite(producto.precioNeto) || producto.precioNeto <= 0)
      throw new ErrorPrecio('precio_invalido');
    const a = ajuste ?? reglas.ajuste;
    validarAjuste(a);
    const precioUnitario = Math.round(producto.precioNeto * (1 + a));
    return { producto, cantidad, precioUnitario, total: cantidad * precioUnitario };
  });
  const neto = lineas.reduce((sum, l) => sum + l.total, 0),
    iva = Math.round(neto * reglas.iva),
    total = neto + iva;
  if (![neto, iva, total, ...lineas.flatMap((l) => [l.total, l.precioUnitario])].every(Number.isSafeInteger))
    throw new ErrorPrecio('desbordamiento');
  return { lineas, neto, iva, total };
}
export const pesos = (n: number) =>
  '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n);
export const porcentajeIva = (iva = REGLAS.iva) =>
  `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(iva * 100)} %`;

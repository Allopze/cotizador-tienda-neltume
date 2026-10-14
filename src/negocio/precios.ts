import type { DescuentoItem, Producto } from '../catalogo/tipos';
import { describirProducto } from '../catalogo/escalones';
import { conDosDecimales } from './cifras';
import { AJUSTE_MAX, AJUSTE_MIN, MARGEN_MAX, MARGEN_MIN, precioEnRango } from './limites';
/**
 * Reglas comerciales. Redondeo (siempre a pesos enteros, Math.round):
 * 1. precio unitario = round(precioNeto × (1 + ajuste)); total de línea = cantidad × (unitario − descuento del ítem).
 *    El descuento especial de un ítem es por unidad: round(unitario × % / 100) o un monto fijo, nunca más que el
 *    unitario. Así el total de la línea siempre es cantidad × precio con descuento, sin centavos sueltos.
 * 2. subtotal = suma de líneas (ya con sus descuentos especiales); descuento = round(subtotal × porcentaje / 100). El porcentaje es el fijado a mano o,
 *    si no, el del tramo por cantidad de puertas (descuento-cantidad.ts): `cotizar` solo recibe el resultado.
 * 3. neto = subtotal − descuento + flete (el flete ya es neto entero); IVA = round(neto × iva).
 * La nota de pedido usa ajuste 0, sin descuento ni flete.
 */
export interface ReglasComerciales {
  /** Ajuste usado por instalaciones antiguas y para categorías todavía sin regla específica. */
  ajuste: number;
  iva: number;
  vigenciaDiasHabiles: number;
  descuentoMaximo: number;
  /**
   * Descuento automático por cantidad de puertas de la cotización (ver descuento-cantidad.ts). Congelado en
   * cada cotización; las guardadas antes de esta regla no lo traen y no tienen tramos.
   */
  descuentosPorCantidad?: TramoDescuento[];
  /**
   * Márgenes por categoría, expresados como fracción (0,55 = 55 %). Congelados en cada cotización: los
   * guardados antes de una categoría nueva no la traen y esa categoría usa el `otros` de la propia cotización.
   */
  margenes?: Partial<MargenesCategoria>;
}
/** «Desde `desdePuertas` puertas, `porcentaje` % de descuento»; el tramo aplicable es el mayor umbral alcanzado. */
export interface TramoDescuento {
  desdePuertas: number;
  porcentaje: number;
}
export type CategoriaMargen =
  | 'puertas_solidas_mara_lenga'
  | 'puertas_solidas_oregon'
  | 'puertas_solidas_rauli'
  | 'puertas_prepintadas'
  | 'puertas_enchapadas_mara'
  | 'marcos_finger_sin_enchape'
  | 'marcos_finger_enchapados'
  | 'marcos_solidos_oregon'
  | 'marcos_solidos_lenga'
  | 'accesorios_madera_solida'
  | 'otros';
export type MargenesCategoria = Record<CategoriaMargen, number>;
/** Valores comerciales iniciales. Se guardan en Ajustes y se copian a los borradores nuevos. */
export const MARGENES_INICIALES: MargenesCategoria = {
  puertas_solidas_mara_lenga: 0.55,
  puertas_solidas_oregon: 0.85,
  puertas_solidas_rauli: 0.55,
  puertas_prepintadas: 1.4,
  puertas_enchapadas_mara: 0.75,
  marcos_finger_sin_enchape: 1,
  marcos_finger_enchapados: 0.75,
  marcos_solidos_oregon: 0.85,
  marcos_solidos_lenga: 0.55,
  // Marcos, molduras y piezas T de madera sólida (ni enchapados, ni prepintados, ni finger).
  accesorios_madera_solida: 0.25,
  // Último recurso: conserva el ajuste histórico para lo que ninguna categoría describe.
  otros: 0.25,
};
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
      | 'margen_invalido'
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
  margen?: number | null;
  tipoMedida?: 'hoja' | 'vano' | 'no_especificado' | null;
  observaciones?: string | null;
  /** Texto escrito por la persona para los documentos; no cambia el producto ni su categoría de margen. */
  descripcionDocumento?: string | null;
  descuento?: DescuentoItem | null;
}
export interface Linea {
  producto: Producto;
  cantidad: number;
  precioUnitario: number;
  /** Snapshot explícito de precio fábrica → margen → precio cliente. */
  precioFabrica?: number;
  margen?: number;
  precioCliente?: number;
  margenPersonalizado?: boolean;
  tipoMedida?: 'hoja' | 'vano' | 'no_especificado' | null;
  observaciones?: string | null;
  /** Descripción para los documentos; null usa la del producto de catálogo. */
  descripcionDocumento?: string | null;
  /** Precio unitario fijado solo para esta cotización; null si viene de catálogo. */
  precioUnitarioPersonalizado?: number | null;
  /**
   * Descuento especial del ítem y lo que descuenta por unidad, en pesos. `precioUnitario` sigue siendo el
   * precio original; ausentes en las líneas sin descuento (y en las guardadas antes de existir).
   */
  descuentoItem?: DescuentoItem | null;
  descuentoUnitario?: number;
  /** cantidad × (precioUnitario − descuentoUnitario). */
  total: number;
  /** Índice de la solicitud que originó la línea; null en registros anteriores. */
  indice: number | null;
  anchoSolicitado: number | null;
  altoSolicitado: number | null;
  medidaSolicitada: string | null;
}
/**
 * Lo que muestran los documentos y el panel: la descripción escrita por la persona o, si no hay, el producto
 * con las medidas que se pidieron (no el rango del catálogo, que solo define el precio). Sin medidas
 * pedidas (registros antiguos), la descripción del catálogo.
 */
export const descripcionLinea = (
  l: Pick<Linea, 'producto' | 'descripcionDocumento'> &
    Partial<Pick<Linea, 'anchoSolicitado' | 'altoSolicitado'>>,
) =>
  l.descripcionDocumento ||
  (l.anchoSolicitado == null && l.altoSolicitado == null
    ? l.producto.descripcion
    : describirProducto(l.producto, { ancho: l.anchoSolicitado, alto: l.altoSolicitado }));
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
  /** Margen especial de toda la cotización (fracción): pasa por encima de la categoría y por debajo del margen de cada línea. */
  margenCotizacion?: number | null;
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
/** Descuento especial de un ítem: más de 0 y hasta 100 % con dos decimales, o un monto entero de pesos. */
export const descuentoItemValido = (d: DescuentoItem) =>
  d.tipo === 'porcentaje'
    ? Number.isFinite(d.valor) && d.valor > 0 && d.valor <= 100 && conDosDecimales(d.valor)
    : d.tipo === 'monto' && Number.isSafeInteger(d.valor) && d.valor > 0 && d.valor <= 100_000_000;
/**
 * Pesos que descuenta por unidad. En centésimas de punto, como el descuento general. Un monto fijo mayor que
 * el precio (el precio bajó después de fijarlo) se limita al precio: el resultado nunca es negativo.
 */
export function descuentoPorUnidad(precioUnitario: number, d: DescuentoItem | null | undefined) {
  if (!d) return 0;
  const monto = d.tipo === 'porcentaje' ? Math.round((precioUnitario * Math.round(d.valor * 100)) / 10000) : d.valor;
  return Math.min(monto, precioUnitario);
}
export const fleteValido = (f: number) => Number.isSafeInteger(f) && f >= 0 && f <= 100_000_000;
/** Margen manual (de una línea o de la cotización), como fracción: −50 %…500 % con hasta dos decimales. */
export const margenValido = (m: number) =>
  Number.isFinite(m) && m >= MARGEN_MIN && m <= MARGEN_MAX && conDosDecimales(m * 100);
export function cotizar(
  items: ItemPrecio[],
  reglas: Pick<ReglasComerciales, 'ajuste' | 'iva'> &
    Partial<Pick<ReglasComerciales, 'descuentoMaximo' | 'margenes'>> = REGLAS,
  extras: Extras = {},
): Montos {
  if (!items.length) throw new ErrorPrecio('sin_items');
  if (!Number.isFinite(reglas.ajuste) || reglas.ajuste < AJUSTE_MIN || reglas.ajuste > AJUSTE_MAX)
    throw new ErrorPrecio('ajuste_invalido');
  if (!Number.isFinite(reglas.iva) || reglas.iva < 0 || reglas.iva > 1) throw new ErrorPrecio('iva_invalido');
  const descuentoPorcentaje = extras.descuento ?? 0,
    flete = extras.flete ?? 0,
    margenCotizacion = extras.margenCotizacion ?? null;
  if (!descuentoValido(descuentoPorcentaje, reglas.descuentoMaximo ?? REGLAS.descuentoMaximo))
    throw new ErrorPrecio('descuento_invalido');
  if (!fleteValido(flete)) throw new ErrorPrecio('flete_invalido');
  if (margenCotizacion !== null && !margenValido(margenCotizacion)) throw new ErrorPrecio('margen_invalido');
  const lineas = items.map((item): Linea => {
    const { producto, cantidad } = item;
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10000)
      throw new ErrorPrecio('cantidad_invalida');
    if (!Number.isFinite(producto.precioNeto) || producto.precioNeto <= 0)
      throw new ErrorPrecio('precio_invalido');
    const precioUnitarioPersonalizado = item.precioUnitario ?? null;
    // Prioridad: margen de la línea > margen especial de la cotización > margen de la categoría.
    const margenManual = item.margen ?? margenCotizacion;
    const margenCalculado = margenManual ?? margenProducto(producto, reglas);
    if (
      precioUnitarioPersonalizado !== null &&
      (!Number.isSafeInteger(precioUnitarioPersonalizado) ||
        precioUnitarioPersonalizado <= 0 ||
        precioUnitarioPersonalizado > 100_000_000)
    )
      throw new ErrorPrecio('precio_invalido');
    if (!Number.isFinite(margenCalculado) || margenCalculado < MARGEN_MIN || margenCalculado > MARGEN_MAX || (margenManual !== null && !margenValido(margenManual)))
      throw new ErrorPrecio('margen_invalido');
    const precioUnitario = precioUnitarioPersonalizado ?? Math.round(producto.precioNeto * (1 + margenCalculado));
    const margen = precioUnitarioPersonalizado === null ? margenCalculado : precioUnitario / producto.precioNeto - 1;
    // El margen calculado ya se validó arriba; un precio escrito debe caer en el rango que deja ese margen.
    if (precioUnitarioPersonalizado !== null && !precioEnRango(precioUnitarioPersonalizado, producto.precioNeto))
      throw new ErrorPrecio('margen_invalido');
    const descuentoItem = item.descuento ?? null;
    if (descuentoItem && !descuentoItemValido(descuentoItem)) throw new ErrorPrecio('descuento_invalido');
    const descuentoUnitario = descuentoPorUnidad(precioUnitario, descuentoItem);
    return {
      producto,
      cantidad,
      precioUnitario,
      precioFabrica: producto.precioNeto,
      margen,
      precioCliente: precioUnitario,
      margenPersonalizado: item.margen !== null && item.margen !== undefined,
      tipoMedida: item.tipoMedida ?? 'no_especificado',
      observaciones: item.observaciones?.trim() || null,
      descripcionDocumento: item.descripcionDocumento?.trim() || null,
      ...(precioUnitarioPersonalizado !== null ? { precioUnitarioPersonalizado } : {}),
      ...(descuentoItem ? { descuentoItem, descuentoUnitario } : {}),
      total: cantidad * (precioUnitario - descuentoUnitario),
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

/** Precio unitario con el descuento especial del ítem (el original si no tiene). */
export const precioConDescuento = (l: Pick<Linea, 'precioUnitario' | 'descuentoUnitario'>) =>
  l.precioUnitario - (l.descuentoUnitario ?? 0);
/** Lo que el descuento especial ahorra en toda la línea (cantidad × descuento por unidad). */
export const ahorroLinea = (l: Pick<Linea, 'cantidad' | 'descuentoUnitario'>) => l.cantidad * (l.descuentoUnitario ?? 0);
/** La línea muestra precio original y rebajado: tiene un descuento que efectivamente descuenta. */
export const conDescuentoItem = (l: Pick<Linea, 'descuentoUnitario'>) => (l.descuentoUnitario ?? 0) > 0;
/**
 * Descuentos especiales de las líneas: el subtotal antes de ellos y el ahorro total. `subtotal` de los montos
 * ya los incluye (subtotalOriginal − ahorro), así que el descuento general nunca vuelve a contarlos.
 */
export function resumenDescuentosItems(m: Pick<Montos, 'lineas' | 'subtotal'>) {
  const ahorro = m.lineas.reduce((s, l) => s + ahorroLinea(l), 0);
  return { ahorro, subtotalOriginal: m.subtotal + ahorro };
}
/** «15 %» o «$5.000 c/u». */
export const textoDescuentoItem = (d: DescuentoItem) =>
  d.tipo === 'porcentaje' ? porcentaje(d.valor) : `${pesos(d.valor)} c/u`;

const textoNormalizado = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

/**
 * Categoría de margen de un producto de catálogo. Solo mira el producto, nunca la descripción escrita
 * para el documento. El orden importa: «MARA ENCHAPADA» es enchapada, jamás Mara sólida.
 */
export function categoriaMargen(producto: Producto): CategoriaMargen {
  const contexto = textoNormalizado(`${producto.modelo} ${producto.tipo ?? ''} ${producto.madera} ${producto.descripcion}`);
  const madera = textoNormalizado(producto.madera).replace(/\s+/g, ' ').trim();
  if (producto.familia === 'PUERTA') {
    if (/PREPINTAD/.test(contexto)) return 'puertas_prepintadas';
    if (/ENCHAPAD/.test(contexto))
      return madera.includes('MARA') ? 'puertas_enchapadas_mara' : 'otros';
    if (madera.includes('OREGON')) return 'puertas_solidas_oregon';
    if (madera.includes('MARA') || madera.includes('LENGA')) return 'puertas_solidas_mara_lenga';
    if (madera.includes('RAULI')) return 'puertas_solidas_rauli';
    return 'otros';
  }
  if (producto.familia === 'MARCO' && madera.includes('FINGER')) {
    // El marco Pino Finger base es «desnudo»: solo es enchapado si el producto lo dice.
    const enchapado = /ENCHAP/.test(contexto) && !/SIN\s*ENCHAP|DESNUD/.test(contexto);
    return enchapado ? 'marcos_finger_enchapados' : 'marcos_finger_sin_enchape';
  }
  if (producto.familia === 'MARCO' && !/ENCHAP|PREPINT/.test(contexto)) {
    if (madera.includes('OREGON')) return 'marcos_solidos_oregon';
    if (madera.includes('LENGA')) return 'marcos_solidos_lenga';
  }
  // Marcos, molduras y piezas T: madera sólida salvo que el producto sea enchapado, prepintado o finger.
  // Una madera nueva del catálogo (p. ej. Cedro) es sólida sin tocar esta regla.
  if (producto.familia === 'MARCO' || producto.familia === 'MOLDURA' || producto.familia === 'PIEZAS_T')
    return /ENCHAP|PREPINT|FINGER/.test(contexto) ? 'otros' : 'accesorios_madera_solida';
  return 'otros';
}

/**
 * Margen estándar de la categoría según las reglas de la cotización. Una categoría que esas reglas no
 * traen (guardadas antes de que existiera) usa el `otros` de la propia cotización y, sin márgenes por
 * categoría, su `ajuste`; nunca la configuración actual.
 */
export function margenProducto(
  producto: Producto,
  reglas: Pick<ReglasComerciales, 'ajuste'> & Partial<Pick<ReglasComerciales, 'margenes'>>,
) {
  const margenes = reglas.margenes;
  if (!margenes) return reglas.ajuste;
  return margenes[categoriaMargen(producto)] ?? margenes.otros ?? reglas.ajuste;
}

/** De dónde sale el margen aplicado a una línea, para explicarlo en la interfaz. */
export type OrigenMargen = 'linea' | 'precio' | 'cotizacion' | 'categoria';
export const origenMargen = (
  linea: Pick<Linea, 'margenPersonalizado' | 'precioUnitarioPersonalizado'>,
  margenCotizacion: number | null | undefined,
): OrigenMargen =>
  linea.margenPersonalizado
    ? 'linea'
    : linea.precioUnitarioPersonalizado !== undefined && linea.precioUnitarioPersonalizado !== null
      ? 'precio'
      : margenCotizacion !== null && margenCotizacion !== undefined
        ? 'cotizacion'
        : 'categoria';
export const pesos = (n: number) =>
  '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n);
export const porcentajeIva = (iva = REGLAS.iva) =>
  `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(iva * 100)} %`;
export const porcentaje = (n: number) =>
  `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(n)} %`;

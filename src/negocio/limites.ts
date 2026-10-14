// Límites de las reglas comerciales en un solo lugar: los usan el cálculo, las validaciones del servidor y la
// pantalla. Sin dependencias, para que también los importe el navegador. Ver docs/reglas-negocio.md.

export const DESCUENTO_MAXIMO = 50;
export const rangoMedidas = (familia: string) => ({ min: 0.3, max: familia === 'PUERTA' ? 3 : 6 });

/** Margen sobre el costo de fábrica, como fracción: de −50 % a 500 %. */
export const MARGEN_MIN = -0.5;
export const MARGEN_MAX = 5;
/** «−50 % a 500 %», para los mensajes. */
export const RANGO_MARGEN = `−${-MARGEN_MIN * 100} % a ${MARGEN_MAX * 100} %`;

/** Ajuste general sobre el precio neto, como fracción: de −50 % a 100 %. Es otra regla que el margen. */
export const AJUSTE_MIN = -0.5;
export const AJUSTE_MAX = 1;

/** Parte del total que debe estar pagada para habilitar la nota de pedido y la producción. */
export const ANTICIPO_MINIMO = 0.5;
/** «50 %», para los mensajes. */
export const ANTICIPO_TEXTO = `${ANTICIPO_MINIMO * 100} %`;

/**
 * Precios unitarios que admite un producto de costo de fábrica `costo`: los que dejan una ganancia dentro de
 * `MARGEN_MIN`–`MARGEN_MAX`. Lo usan el cálculo (`cotizar`) y la validación de los ítems (`itemsVigentes`).
 */
export const rangoPrecio = (costo: number) => ({ min: costo * (1 + MARGEN_MIN), max: costo * (1 + MARGEN_MAX) });
export const precioEnRango = (precio: number, costo: number) => {
  const { min, max } = rangoPrecio(costo);
  return precio >= min && precio <= max;
};
/** Un precio dentro del rango pero menor que el costo de fábrica: se vende con pérdida y se avisa (sin bloquear). */
export const bajoElCosto = (precio: number, costo: number) => precio < costo;

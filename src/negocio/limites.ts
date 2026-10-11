// Límites de las reglas comerciales en un solo lugar: los usan el cálculo, las validaciones del servidor y la
// pantalla. Sin dependencias, para que también los importe el navegador. Ver docs/reglas-negocio.md.

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

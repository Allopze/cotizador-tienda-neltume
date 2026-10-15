/**
 * Cada planilla de precios es un origen del catálogo: importarla reemplaza solo sus productos y deja
 * los de las otras planillas (y los agregados a mano) como estaban.
 */
export type OrigenCatalogo = 'principal' | 'enchapadas';
export const ORIGENES_CATALOGO: readonly OrigenCatalogo[] = ['principal', 'enchapadas'];
export const ETIQUETA_ORIGEN: Record<OrigenCatalogo, string> = {
  principal: 'Planilla de puertas sólidas',
  enchapadas: 'Planilla de enchapadas, prepintadas y marcos finger',
};

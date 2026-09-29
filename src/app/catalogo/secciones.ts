// Secciones del catálogo: el servidor valida `?seccion=` y el cliente arma la navegación lateral.
export const SECCIONES = [
  { id: 'consultar', titulo: 'Consultar', encabezado: 'Consultar el catálogo' },
  { id: 'agregar', titulo: 'Agregar producto', encabezado: 'Agregar un producto' },
] as const;
export type Seccion = (typeof SECCIONES)[number]['id'];

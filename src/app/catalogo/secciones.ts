// Secciones del catálogo: el servidor valida `?seccion=` y el cliente arma la navegación lateral.
export const SECCIONES = [
  { id: 'consultar', titulo: 'Consultar', encabezado: 'Consultar el catálogo' },
  { id: 'agregar', titulo: 'Agregar producto', encabezado: 'Agregar un producto' },
  { id: 'productos', titulo: 'Productos agregados', encabezado: 'Productos agregados fuera de la planilla' },
] as const;
export type Seccion = (typeof SECCIONES)[number]['id'];

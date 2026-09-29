// Secciones de «Catálogo y ajustes»: el servidor valida `?seccion=` y el cliente arma la navegación.
export const SECCIONES = [
  { id: 'catalogo', grupo: 'CATÁLOGO', titulo: 'Consultar', encabezado: 'Consultar el catálogo' },
  { id: 'agregar', grupo: 'CATÁLOGO', titulo: 'Agregar producto', encabezado: 'Agregar un producto' },
  { id: 'manuales', grupo: 'CATÁLOGO', titulo: 'Agregados a mano', encabezado: 'Productos agregados a mano' },
  { id: 'asistente', grupo: 'ASISTENTE', titulo: 'Modelo del asistente', encabezado: 'Modelo del asistente' },
] as const;
export type Seccion = (typeof SECCIONES)[number]['id'];

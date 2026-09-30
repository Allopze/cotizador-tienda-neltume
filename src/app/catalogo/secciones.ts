// Secciones del catálogo: el servidor valida `?seccion=` y el cliente arma la navegación lateral.
export const SECCIONES = [
  { id: 'consultar', titulo: 'Consultar', encabezado: 'Consultar el catálogo' },
  { id: 'importar', titulo: 'Importar', encabezado: 'Importar catálogo desde Excel' },
  { id: 'agregar', titulo: 'Agregar producto', encabezado: 'Agregar un producto' },
  { id: 'manuales', titulo: 'Gestionar catálogo', encabezado: 'Gestionar productos del catálogo' },
  { id: 'configuracion', titulo: 'Configuración', encabezado: 'Configuración del catálogo' },
] as const;
export type Seccion = (typeof SECCIONES)[number]['id'];

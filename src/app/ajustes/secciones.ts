// Secciones de «Ajustes»: el servidor valida `?seccion=` y el cliente arma la navegación lateral.
// Las marcadas `admin` solo se muestran (y se aceptan en la URL) a quien administra.
export const SECCIONES_AJUSTES = [
  { id: 'cuenta', titulo: 'Mi cuenta', encabezado: 'Mi cuenta', admin: false },
  { id: 'asistente', titulo: 'Asistente', encabezado: 'Asistente', admin: false },
  { id: 'empresa', titulo: 'Datos de la empresa', encabezado: 'Datos de la empresa', admin: false },
  { id: 'precios', titulo: 'Precios y descuentos', encabezado: 'Precios y descuentos', admin: false },
  { id: 'cotizaciones', titulo: 'Cotizaciones', encabezado: 'Vigencia y transportistas', admin: false },
  { id: 'starken', titulo: 'Starken', encabezado: 'Despacho con Starken', admin: false },
  { id: 'usuarios', titulo: 'Usuarios', encabezado: 'Usuarios', admin: true },
] as const;
export type SeccionAjustes = (typeof SECCIONES_AJUSTES)[number]['id'];

export const seccionesVisibles = (admin: boolean) => SECCIONES_AJUSTES.filter((s) => admin || !s.admin);

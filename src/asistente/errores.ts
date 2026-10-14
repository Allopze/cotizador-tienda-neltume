/** Mensaje para quien usa el cotizador: no revela variables de entorno ni rutas. */
export const MENSAJE_SIN_CONFIGURAR =
  'El asistente no está configurado. Pide a quien administra el cotizador que lo revise.';
export class ErrorIA extends Error {
  constructor(
    public codigo: string,
    mensaje: string,
    public status = 502,
    /** Detalle técnico solo para el registro del servidor; nunca se envía al navegador. */
    public tecnico?: string,
  ) {
    super(mensaje);
    this.name = 'ErrorIA';
  }
}
export function errorProveedor(status?: number): ErrorIA {
  if (status === 401)
    return new ErrorIA(
      'ia_autenticacion',
      MENSAJE_SIN_CONFIGURAR,
      502,
      'CommandCode rechazó la clave (401). Revisa o vuelve a guardar la clave API desde Ajustes.',
    );
  if (status === 402 || status === 403)
    return new ErrorIA(
      'ia_acceso',
      'El asistente no tiene acceso al modelo elegido. Revisa el modelo en Ajustes o vuelve a intentarlo más tarde.',
    );
  if (status === 400 || status === 404 || status === 422)
    return new ErrorIA(
      'ia_configuracion',
      'El modelo elegido no pudo procesar la solicitud. Pide a quien administra el cotizador que revise el modelo en Ajustes → Asistente (puede probarlo ahí).',
    );
  if (status === 429)
    return new ErrorIA(
      'ia_limite',
      'El asistente está temporalmente no disponible o alcanzó su límite. Espera un momento y vuelve a intentar.',
      503,
    );
  return new ErrorIA(
    'ia_no_disponible',
    'No pudimos obtener una respuesta del asistente. Reintenta en un momento; tu borrador está guardado.',
    503,
  );
}

export function errorTimeout(ms: number): ErrorIA {
  return new ErrorIA(
    'ia_timeout',
    `El asistente no respondió dentro de ${Math.ceil(ms / 1000)} ${ms === 1000 ? 'segundo' : 'segundos'}. Tu borrador está guardado: vuelve a enviar el mensaje. Si se repite, pide a quien administra el cotizador que revise el modelo en Ajustes → Asistente.`,
    504,
  );
}

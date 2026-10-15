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
/** Caracteres del cuerpo de un rechazo 4xx que se guardan para el registro del servidor. */
const LARGO_CUERPO_TECNICO = 300;

/**
 * Detalle técnico de un rechazo 4xx: el estado y el comienzo del cuerpo (que suele nombrar el modelo o la opción
 * rechazada). Nunca llega al navegador; sin él, un modelo mal escrito en Ajustes caía al respaldo sin rastro.
 */
function detalle4xx(status: number, cuerpo?: string) {
  const texto = cuerpo?.replace(/\s+/g, ' ').trim().slice(0, LARGO_CUERPO_TECNICO);
  return `HTTP ${status}${texto ? `: ${texto}` : ''}`;
}

/** `cuerpo`: el texto de la respuesta del proveedor; de un 4xx se guardan sus primeros 300 caracteres. */
export function errorProveedor(status?: number, cuerpo?: string): ErrorIA {
  if (status === 401)
    return new ErrorIA(
      'ia_autenticacion',
      MENSAJE_SIN_CONFIGURAR,
      502,
      `CommandCode rechazó la clave (401). Revisa o vuelve a guardar la clave API desde Ajustes. ${detalle4xx(401, cuerpo)}`,
    );
  if (status === 402 || status === 403)
    return new ErrorIA(
      'ia_acceso',
      'El asistente no tiene acceso al modelo elegido. Revisa el modelo en Ajustes o vuelve a intentarlo más tarde.',
      502,
      detalle4xx(status, cuerpo),
    );
  if (status === 400 || status === 404 || status === 422)
    return new ErrorIA(
      'ia_configuracion',
      'El modelo elegido no pudo procesar la solicitud. Pide a quien administra el cotizador que revise el modelo en Ajustes → Asistente (puede probarlo ahí).',
      502,
      detalle4xx(status, cuerpo),
    );
  if (status === 429)
    return new ErrorIA(
      'ia_limite',
      'El asistente está temporalmente no disponible o alcanzó su límite. Espera un momento y vuelve a intentar.',
      503,
      detalle4xx(429, cuerpo),
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

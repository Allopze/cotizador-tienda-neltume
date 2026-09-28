export class ErrorIA extends Error {
  constructor(
    public codigo: string,
    mensaje: string,
    public status = 502,
  ) {
    super(mensaje);
    this.name = 'ErrorIA';
  }
}
export function errorProveedor(status?: number): ErrorIA {
  if (status === 401)
    return new ErrorIA('ia_autenticacion', 'CommandCode rechazó la clave. Revisa CMD_API_KEY en .env.local.');
  if (status === 402 || status === 403)
    return new ErrorIA(
      'ia_acceso',
      'CommandCode no autorizó este modelo. Revisa el acceso de tu plan y el saldo disponible.',
    );
  if (status === 400 || status === 404 || status === 422)
    return new ErrorIA(
      'ia_configuracion',
      'CommandCode rechazó el modelo o el formato de la solicitud. Revisa el modelo en Configuración del asistente y su compatibilidad con herramientas.',
    );
  if (status === 429)
    return new ErrorIA(
      'ia_limite',
      'El modelo de CommandCode está temporalmente no disponible o alcanzó su límite. Espera un momento y vuelve a intentar.',
      503,
    );
  return new ErrorIA(
    'ia_no_disponible',
    'No pudimos obtener una respuesta de CommandCode. Reintenta en un momento; tu borrador está guardado.',
    503,
  );
}

export function errorTimeout(ms: number): ErrorIA {
  return new ErrorIA(
    'ia_timeout',
    `CommandCode no respondió dentro de ${ms / 1000} segundos. Tu borrador está guardado. Puedes reintentar o elegir otro modelo en Configuración del asistente.`,
    504,
  );
}

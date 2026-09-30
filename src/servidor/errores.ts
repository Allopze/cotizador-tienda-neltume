// Errores de la aplicación con estado HTTP y código estable para la interfaz.
export type CodigoError =
  | 'solicitud_invalida'
  | 'no_encontrada'
  | 'version_obsoleta'
  | 'no_editable'
  | 'estado_invalido'
  | 'incompleta'
  | 'revision_abierta'
  | 'serie_aprobada'
  | 'cotizacion_vencida'
  | 'precios_cambiaron'
  | 'ocupado'
  | 'mensaje_procesado'
  | 'pdf_no_disponible'
  | 'numero_invalido';

export class ErrorUsuario extends Error {
  constructor(
    mensaje: string,
    public codigo: CodigoError = 'solicitud_invalida',
    public status = 400,
    /** Datos adicionales seguros para el navegador (p. ej. el id de la revisión abierta). */
    public detalle?: Record<string, unknown>,
  ) {
    super(mensaje);
    this.name = 'ErrorUsuario';
  }
}

export class ErrorNoEncontrado extends ErrorUsuario {
  constructor(mensaje = 'No se encontró la cotización.') {
    super(mensaje, 'no_encontrada', 404);
    this.name = 'ErrorNoEncontrado';
  }
}

export class ErrorConflicto extends ErrorUsuario {
  constructor(mensaje: string, codigo: CodigoError = 'version_obsoleta', detalle?: Record<string, unknown>) {
    super(mensaje, codigo, 409, detalle);
    this.name = 'ErrorConflicto';
  }
}

export class ErrorPdf extends ErrorUsuario {
  constructor(public tecnico: string) {
    super(
      'No se pudo generar el PDF. Reintenta en un momento; la cotización se conserva.',
      'pdf_no_disponible',
      503,
    );
    this.name = 'ErrorPdf';
  }
}

/** Error de alta o mantención del catálogo que se muestra tal cual a quien lo pidió. */
export class ErrorUsuarioCatalogo extends ErrorUsuario {
  constructor(mensaje: string, codigo: CodigoError = 'solicitud_invalida', status = 400) {
    super(mensaje, codigo, status);
    this.name = 'ErrorUsuarioCatalogo';
  }
}

export const VERSION_OBSOLETA =
  'La cotización cambió desde que la abriste. Revisa el detalle actualizado y vuelve a intentarlo.';

/** Registra un fallo inesperado sin datos de la conversación ni credenciales. */
export function registrarError(origen: string, error: unknown) {
  const detalle =
    error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  console.error(`[${origen}] ${detalle}`);
}

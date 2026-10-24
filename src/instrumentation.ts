/**
 * Arranque del servidor de Next (se llama una vez por proceso). Solo en Node: retoma la entrega a la fábrica de lo
 * que quedó pendiente (reintentos, o un reinicio justo después de generar una nota) y la repite cada minuto. Sin
 * integración configurada no hace nada. Nunca impide que el servidor arranque.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { integracionConfigurada, iniciarIntegracion } = await import('./servidor/integracion-envio');
    if (!integracionConfigurada()) return;
    const { Almacen } = await import('./servidor/almacen');
    iniciarIntegracion(new Almacen());
  } catch (error) {
    console.error('[integracion] No se inició el envío a fábrica:', error instanceof Error ? error.message : error);
  }
}

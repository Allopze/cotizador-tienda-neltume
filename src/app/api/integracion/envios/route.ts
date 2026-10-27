import { exigirSesion } from '@/servidor/acceso-autenticado';
import { abrirBaseDatos } from '@/servidor/base-datos';
import { enviosDeCotizacion } from '@/servidor/integracion-bandeja';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };

/**
 * Estado de los envíos de una cotización a la fábrica, para el seguimiento. Solo lectura: la pantalla muestra si la
 * nota llegó, quedó pendiente o no salió (auditoría BUG-004). No entrega el contenido del pedido.
 */
export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  const id = new URL(req.url).searchParams.get('cotizacion');
  if (!id) return Response.json({ error: 'Indica la cotización.' }, { status: 400, headers: sinCache });
  try {
    return Response.json({ envios: enviosDeCotizacion(abrirBaseDatos(), id) }, { headers: sinCache });
  } catch {
    return Response.json({ error: 'No se pudo leer el estado de los envíos.' }, { status: 500, headers: sinCache });
  }
}

import { exigirSesion } from '@/servidor/acceso-autenticado';
import { obtenerCatalogoCommandCode } from '@/servidor/modelos-commandcode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  try {
    return Response.json(await obtenerCatalogoCommandCode(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('[ajustes/modelos] no se pudo leer CommandCode:', error instanceof Error ? error.message : 'desconocido');
    return Response.json({ error: 'No se pudo cargar el catálogo de modelos de CommandCode.' }, { status: 503 });
  }
}

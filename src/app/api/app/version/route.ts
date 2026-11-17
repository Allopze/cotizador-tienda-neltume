import { exigirSesion } from '@/servidor/acceso-autenticado';
import { leerVersionApp } from '@/servidor/app-movil';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };

/** Versión publicada de la app de Android (la consulta la app al abrirse). 404 si no hay una. */
export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  const version = await leerVersionApp();
  if (!version)
    return Response.json(
      { error: 'No hay una versión de la app publicada.', codigo: 'sin_app' },
      { status: 404, headers: sinCache },
    );
  return Response.json(version, { headers: sinCache });
}

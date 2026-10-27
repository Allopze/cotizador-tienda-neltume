import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/servidor/autenticacion';
import { esRutaAdminAuth, esRutaSesionesCruda, validarConfiguracionAutenticacion } from '@/servidor/autenticacion-config';
import { rechazoAcceso } from '@/servidor/acceso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = toNextJsHandler(auth);

function rutaBloqueada(req: Request) {
  const { pathname } = new URL(req.url);
  try {
    return (
      esRutaAdminAuth(pathname) ||
      esRutaAdminAuth(decodeURIComponent(pathname)) ||
      esRutaSesionesCruda(pathname) ||
      esRutaSesionesCruda(decodeURIComponent(pathname))
    );
  } catch {
    return true;
  }
}

async function ejecutar(req: Request, metodo: typeof handler.GET | typeof handler.POST) {
  const rechazo = rechazoAcceso(req, { escritura: req.method !== 'GET' && req.method !== 'HEAD' });
  if (rechazo) return rechazo;
  if (rutaBloqueada(req)) return Response.json({ error: 'No encontrado.' }, { status: 404 });
  try {
    validarConfiguracionAutenticacion();
    return await metodo(req);
  } catch (error) {
    console.error('[auth] fallo interno:', error instanceof Error ? error.message : 'desconocido');
    return Response.json({ error: 'No se pudo procesar la autenticación.' }, { status: 500 });
  }
}

export const GET = (req: Request) => ejecutar(req, handler.GET);
export const POST = (req: Request) => ejecutar(req, handler.POST);

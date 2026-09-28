import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/servidor/autenticacion';
import { validarConfiguracionAutenticacion } from '@/servidor/autenticacion-config';
import { rechazoAcceso } from '@/servidor/acceso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const handler = toNextJsHandler(auth);

async function ejecutar(req: Request, metodo: typeof handler.GET | typeof handler.POST) {
  const rechazo = rechazoAcceso(req, { escritura: req.method !== 'GET' && req.method !== 'HEAD' });
  if (rechazo) return rechazo;
  validarConfiguracionAutenticacion();
  return metodo(req);
}

export const GET = (req: Request) => ejecutar(req, handler.GET);
export const POST = (req: Request) => ejecutar(req, handler.POST);

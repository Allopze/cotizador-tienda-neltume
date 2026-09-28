import { auth } from './autenticacion';
import { validarConfiguracionAutenticacion } from './autenticacion-config';
import { rechazoAcceso } from './acceso';

export async function rechazoSesion(
  req: Request,
  opciones: { escritura?: boolean } = {},
): Promise<Response | null> {
  const rechazo = rechazoAcceso(req, opciones);
  if (rechazo) return rechazo;

  validarConfiguracionAutenticacion();
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return Response.json(
      { error: 'Debes iniciar sesión para continuar.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return null;
}

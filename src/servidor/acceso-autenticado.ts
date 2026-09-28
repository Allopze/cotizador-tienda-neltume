import { auth } from './autenticacion';
import { validarConfiguracionAutenticacion } from './autenticacion-config';
import { rechazoAcceso } from './acceso';

export interface UsuarioSesion {
  id: string;
  email: string;
  nombre: string;
  rol: string;
}

export type ResultadoSesion = { ok: true; usuario: UsuarioSesion } | { ok: false; respuesta: Response };

/** Valida Host/Origin y la sesión; con `rol: 'admin'` exige además ese rol (403 si no lo tiene). */
export async function exigirSesion(
  req: Request,
  opciones: { escritura?: boolean; rol?: 'admin' } = {},
): Promise<ResultadoSesion> {
  const rechazo = rechazoAcceso(req, opciones);
  if (rechazo) return { ok: false, respuesta: rechazo };

  validarConfiguracionAutenticacion();
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session)
    return {
      ok: false,
      respuesta: Response.json(
        { error: 'Debes iniciar sesión para continuar.' },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      ),
    };
  const { id, email, name } = session.user;
  const rol = (session.user as { role?: string | null }).role ?? 'user';
  if (opciones.rol && rol !== opciones.rol)
    return {
      ok: false,
      respuesta: Response.json(
        { error: 'Tu cuenta no tiene permiso para esta acción.' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      ),
    };
  return { ok: true, usuario: { id, email, nombre: name || email, rol } };
}

export async function rechazoSesion(
  req: Request,
  opciones: { escritura?: boolean; rol?: 'admin' } = {},
): Promise<Response | null> {
  const resultado = await exigirSesion(req, opciones);
  return resultado.ok ? null : resultado.respuesta;
}

import { rechazoAcceso } from '@/servidor/acceso';
import { validarConfiguracionAutenticacion } from '@/servidor/autenticacion-config';
import { comprobacionesBasicas, comprobacionesCompletas, todoBien } from './comprobaciones';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };

/** Solo una sesión de administración ve el detalle; sin sesión (el healthcheck) basta con saber si está bien. */
async function esAdministradora(req: Request) {
  if (!req.headers.get('cookie')) return false;
  try {
    validarConfiguracionAutenticacion();
    // Import diferido: si la base no abre, el módulo de autenticación falla al cargarse y la ruta debe poder
    // responder 503 igual.
    const { auth } = await import('@/servidor/autenticacion');
    const sesion = await auth.api.getSession({ headers: req.headers });
    return (sesion?.user as { role?: string | null } | undefined)?.role === 'admin';
  } catch {
    return false;
  }
}

/**
 * Estado del sistema. Sin sesión responde `{ ok }` con 200 o 503 (lo usa el healthcheck de Docker Compose). Con
 * sesión de administración agrega cada comprobación: base y versión de esquema, espacio libre, arranque de Chromium,
 * clave de IA legible (sin llamar a la IA), Starken, feriados y último respaldo.
 */
export async function GET(req: Request) {
  const rechazo = rechazoAcceso(req);
  if (rechazo) return rechazo;
  const admin = await esAdministradora(req);
  const comprobaciones = admin ? await comprobacionesCompletas() : await comprobacionesBasicas();
  const ok = todoBien(comprobaciones);
  return Response.json(admin ? { ok, comprobaciones } : { ok }, {
    status: ok ? 200 : 503,
    headers: sinCache,
  });
}

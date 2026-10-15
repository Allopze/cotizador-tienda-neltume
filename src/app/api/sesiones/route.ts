import { z } from 'zod';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { auth } from '@/servidor/autenticacion';
import { leerJson } from '@/servidor/cuerpo';
import { describirDispositivo } from '@/servidor/dispositivo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };

const accionSchema = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('cerrar'), id: z.string().min(1).max(200) }).strict(),
  z.object({ accion: z.literal('cerrar-demas') }).strict(),
]);

export interface SesionCuenta {
  id: string;
  creada: string;
  vence: string;
  dispositivo: string | null;
  ip: string | null;
  actual: boolean;
}

/**
 * Sesiones activas de la propia cuenta, con la API de sesiones de Better Auth (`listSessions`). Los tokens no salen
 * del servidor: el navegador solo recibe un id, y para cerrar una sesión el servidor busca su token entre las de la
 * misma cuenta.
 */
async function sesionesDe(headers: Headers) {
  const [actual, sesiones] = await Promise.all([
    auth.api.getSession({ headers }),
    auth.api.listSessions({ headers }),
  ]);
  return sesiones
    .map((s) => ({
      token: s.token,
      dato: {
        id: s.id,
        creada: new Date(s.createdAt).toISOString(),
        vence: new Date(s.expiresAt).toISOString(),
        dispositivo: describirDispositivo(s.userAgent),
        ip: s.ipAddress || null,
        actual: s.id === actual?.session.id,
      } satisfies SesionCuenta,
    }))
    .sort((a, b) => Number(b.dato.actual) - Number(a.dato.actual) || b.dato.creada.localeCompare(a.dato.creada));
}

const lista = async (headers: Headers) =>
  Response.json({ sesiones: (await sesionesDe(headers)).map((s) => s.dato) }, { headers: sinCache });

export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  try {
    return await lista(req.headers);
  } catch {
    return Response.json({ error: 'No se pudo leer las sesiones.' }, { status: 500, headers: sinCache });
  }
}

/** Cierra una sesión de la propia cuenta (`cerrar`, con su id) o todas menos la actual (`cerrar-demas`). */
export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = accionSchema.safeParse(cuerpo.valor);
  if (!parsed.success) return Response.json({ error: 'Acción inválida.' }, { status: 400, headers: sinCache });
  try {
    if (parsed.data.accion === 'cerrar-demas') {
      await auth.api.revokeOtherSessions({ headers: req.headers });
      return await lista(req.headers);
    }
    const id = parsed.data.id;
    const objetivo = (await sesionesDe(req.headers)).find((s) => s.dato.id === id);
    if (!objetivo)
      return Response.json(
        { error: 'Esa sesión ya no está abierta.', codigo: 'no_encontrada' },
        { status: 404, headers: sinCache },
      );
    await auth.api.revokeSession({ headers: req.headers, body: { token: objetivo.token } });
    // Si se cerró la propia sesión, la lista ya no se puede leer: el navegador vuelve al inicio de sesión.
    if (objetivo.dato.actual) return Response.json({ sesiones: [], cerradaActual: true }, { headers: sinCache });
    return await lista(req.headers);
  } catch {
    return Response.json({ error: 'No se pudo cerrar la sesión.' }, { status: 500, headers: sinCache });
  }
}

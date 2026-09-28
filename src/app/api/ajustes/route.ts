import { z } from 'zod';
import { ajustesIASchema } from '@/asistente/ajustes';
import { exigirSesion, type UsuarioSesion } from '@/servidor/acceso-autenticado';
import { ErrorMigracionRequerida } from '@/servidor/base-datos';
import { leerJson } from '@/servidor/cuerpo';
import { asistenteConfigurado, guardarAjustesIA, leerAjustesIA } from '@/servidor/ajustes-ia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const peticionSchema = z.object({ tipo: z.literal('guardar'), ajustes: ajustesIASchema }).strict();

// El modelo de IA es global: solo una cuenta administradora puede cambiarlo.
function estado(usuario: UsuarioSesion) {
  const ajustes = leerAjustesIA();
  return {
    ajustes,
    commandcodeClave: !!process.env.CMD_API_KEY,
    asistenteConfigurado: asistenteConfigurado(),
    puedeEditar: usuario.rol === 'admin',
  };
}

function falla(error: unknown) {
  if (error instanceof ErrorMigracionRequerida)
    return Response.json({ error: error.message }, { status: 503 });
  console.error('[ajustes] fallo interno:', error instanceof Error ? error.message : 'desconocido');
  return Response.json({ error: 'No se pudo leer ni guardar la configuración.' }, { status: 500 });
}

export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  try {
    return Response.json(estado(sesion.usuario), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return falla(error);
  }
}

export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true, rol: 'admin' });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = peticionSchema.safeParse(cuerpo.valor);
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Solicitud inválida.' },
      { status: 400 },
    );
  try {
    guardarAjustesIA(parsed.data.ajustes);
    return Response.json(estado(sesion.usuario), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return falla(error);
  }
}

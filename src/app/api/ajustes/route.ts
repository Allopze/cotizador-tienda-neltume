import { z } from 'zod';
import { ajustesIASchema } from '@/asistente/ajustes';
import { rechazoSesion } from '@/servidor/acceso-autenticado';
import { ErrorMigracionRequerida } from '@/servidor/base-datos';
import { asistenteConfigurado, guardarAjustesIA, leerAjustesIA } from '@/servidor/ajustes-ia';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const peticionSchema = z.object({ tipo: z.literal('guardar'), ajustes: ajustesIASchema }).strict();

function estado() {
  const ajustes = leerAjustesIA();
  return {
    ajustes,
    commandcodeClave: !!process.env.CMD_API_KEY,
    asistenteConfigurado: asistenteConfigurado(),
  };
}

function falla(error: unknown) {
  if (error instanceof ErrorMigracionRequerida)
    return Response.json({ error: error.message }, { status: 503 });
  return Response.json({ error: 'No se pudo leer ni guardar la configuración.' }, { status: 500 });
}

export async function GET(req: Request) {
  const rechazo = await rechazoSesion(req);
  if (rechazo) return rechazo;
  try {
    return Response.json(estado(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return falla(error);
  }
}

export async function POST(req: Request) {
  const rechazo = await rechazoSesion(req, { escritura: true });
  if (rechazo) return rechazo;
  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }
  const parsed = peticionSchema.safeParse(cuerpo);
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Solicitud inválida.' },
      { status: 400 },
    );
  try {
    guardarAjustesIA(parsed.data.ajustes);
    return Response.json(estado());
  } catch (error) {
    return falla(error);
  }
}

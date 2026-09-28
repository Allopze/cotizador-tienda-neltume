import { z } from 'zod';
import { crearLLM } from '@/servidor/ajustes-ia';
import { rechazoSesion } from '@/servidor/acceso-autenticado';
import { ErrorIA } from '@/asistente/errores';
import { ErrorCatalogo, cargarCatalogo } from '@/servidor/catalogo';
import { ErrorMigracionRequerida, abrirBaseDatos } from '@/servidor/base-datos';
import { ErrorUsuarioCatalogo, ServicioAltaCatalogo } from '@/servidor/alta-catalogo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const peticionSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('mensaje'), id: z.uuid().optional(), mensaje: z.string().trim().min(1).max(3000) }).strict(),
  z.object({ tipo: z.literal('confirmar'), id: z.uuid() }).strict(),
  z.object({ tipo: z.literal('cancelar'), id: z.uuid() }).strict(),
]);

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
  if (!parsed.success) return Response.json({ error: 'Solicitud inválida.' }, { status: 400 });
  try {
    const catalogo = await cargarCatalogo();
    const servicio = new ServicioAltaCatalogo(abrirBaseDatos(), catalogo, crearLLM());
    if (parsed.data.tipo === 'mensaje')
      return Response.json(await servicio.mensaje(parsed.data.id, parsed.data.mensaje));
    if (parsed.data.tipo === 'cancelar') {
      servicio.cancelar(parsed.data.id);
      return Response.json({ cancelado: true });
    }
    return Response.json({ producto: servicio.confirmar(parsed.data.id) });
  } catch (error) {
    if (error instanceof ErrorMigracionRequerida)
      return Response.json({ error: error.message }, { status: 503 });
    if (error instanceof ErrorIA)
      return Response.json({ error: error.message, codigo: error.codigo }, { status: error.status });
    if (error instanceof ErrorUsuarioCatalogo)
      return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof ErrorCatalogo)
      return Response.json({ error: error.message }, { status: 503 });
    return Response.json(
      { error: 'No se pudo completar el alta. El catálogo se conserva sin cambios.' },
      { status: 500 },
    );
  }
}

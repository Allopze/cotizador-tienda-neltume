import { ErrorIA } from '@/asistente/errores';
import { z } from 'zod';
import { Servicio, ErrorUsuario } from '@/servidor/servicio';
import { Almacen, ErrorOcupado } from '@/servidor/almacen';
import { cargarCatalogo, ErrorCatalogo } from '@/servidor/catalogo';
import { rechazoAcceso } from '@/servidor/acceso';
import { CommandCodeLLM, type LLM } from '@/asistente/llm';
import { ErrorMigracionRequerida } from '@/servidor/base-datos';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const accionSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('nueva') }),
  z
    .object({
      tipo: z.literal('chat'),
      id: z.uuid().optional(),
      mensaje: z.string().trim().min(1).max(6000),
      objetivoId: z.uuid().optional(),
      objetivoActualizada: z.iso.datetime().optional(),
    })
    .strict()
    .refine((a) => Boolean(a.objetivoId) === Boolean(a.objetivoActualizada)),
  z.object({ tipo: z.literal('quitar'), id: z.uuid(), indice: z.number().int().nonnegative() }),
  z.object({ tipo: z.enum(['emitir', 'aprobar']), id: z.uuid() }),
]);
const modoFijo = () => process.env.NELTUME_LLM === 'fijo' && process.env.NELTUME_TEST_MODE === '1';
export async function GET(req: Request) {
  const rechazo = rechazoAcceso(req);
  if (rechazo) return rechazo;
  try {
    const estado = await new Almacen().leer();
    return Response.json(
      { cotizaciones: estado.cotizaciones, asistenteConfigurado: !!process.env.CMD_API_KEY || modoFijo() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    if (e instanceof ErrorMigracionRequerida)
      return Response.json({ error: e.message }, { status: 503 });
    return Response.json({ error: 'No se pudo leer el estado guardado.' }, { status: 500 });
  }
}
export async function POST(req: Request) {
  const rechazo = rechazoAcceso(req, { escritura: true });
  if (rechazo) return rechazo;
  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return Response.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }
  const parsed = accionSchema.safeParse(cuerpo);
  if (!parsed.success) return Response.json({ error: 'Solicitud inválida.' }, { status: 400 });
  try {
    const catalogo = await cargarCatalogo();
    let llm: LLM = new CommandCodeLLM();
    if (modoFijo()) {
      const { LLMFijo } = await import('@/asistente/fijo');
      llm = new LLMFijo();
    }
    return Response.json(await new Servicio(catalogo, llm).ejecutar(parsed.data));
  } catch (e) {
    if (e instanceof ErrorMigracionRequerida)
      return Response.json({ error: e.message }, { status: 503 });
    if (e instanceof ErrorIA)
      return Response.json({ error: e.message, codigo: e.codigo }, { status: e.status });
    if (e instanceof ErrorUsuario) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof ErrorOcupado) return Response.json({ error: e.message }, { status: 409 });
    if (e instanceof ErrorCatalogo) return Response.json({ error: e.message }, { status: 503 });
    return Response.json(
      { error: 'No se pudo completar la operación. El estado guardado se conserva.' },
      { status: 500 },
    );
  }
}

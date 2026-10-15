import { z } from 'zod';
import { ErrorIA } from '@/asistente/errores';
import { CASOS_PRUEBA } from '@/asistente/prueba-modelo';
import { salidaSchema } from '@/asistente/esquemas';
import { CommandCodeLLM, type LLM } from '@/asistente/llm';
import { modelosCatalogo, normalizar } from '@/catalogo/resolver';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { leerClaveCommandCode } from '@/servidor/ajustes-ia';
import { cargarCatalogo } from '@/servidor/catalogo';
import { leerJson } from '@/servidor/cuerpo';
import { correrCaso } from '@/servidor/evaluar-caso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const peticionSchema = z
  .object({
    modelo: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[\w.:/@+-]+$/),
    caso: z.number().int().nonnegative(),
  })
  .strict();

/**
 * «Probar modelo»: corre un caso de prueba (uno por petición, para mostrar el avance y no rozar el plazo de un
 * proxy) con el modelo elegido, sin respaldo, en una base temporal. Informa si el modelo responde con la
 * herramienta (compatible), si acertó y cuánto tardó. Solo quien administra; consume la cuota del modelo.
 */
export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true, rol: 'admin' });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = peticionSchema.safeParse(cuerpo.valor);
  if (!parsed.success) return Response.json({ error: 'Solicitud inválida.' }, { status: 400 });
  try {
    const catalogo = await cargarCatalogo();
    // Solo los casos cuyos modelos están en el catálogo vigente.
    const vigentes = new Set(modelosCatalogo(catalogo).map(normalizar));
    const casos = CASOS_PRUEBA.filter((c) =>
      c.esperado.items.every((i) => !i.modelo || vigentes.has(normalizar(i.modelo))),
    );
    const caso = casos[parsed.data.caso];
    if (!caso) return Response.json({ error: 'No existe ese caso de prueba.' }, { status: 404 });
    const real = new CommandCodeLLM(parsed.data.modelo, leerClaveCommandCode());
    let compatible = false;
    const espia: LLM = {
      verificarCifras: true,
      // «Probar modelo» debe leer igual que el chat: con el mismo modo de anclaje.
      anclaje: real.anclaje,
      interpretar: async (contexto, opciones) => {
        const salida = await real.interpretar(contexto, opciones);
        if (salidaSchema.safeParse(salida).success) compatible = true;
        return salida;
      },
    };
    const r = await correrCaso(caso, espia, catalogo);
    return Response.json(
      {
        totalCasos: casos.length,
        caso: { id: caso.id, descripcion: caso.descripcion },
        correcto: !r.error && r.diferencias.length === 0,
        aciertos: r.aciertos,
        total: r.total,
        ms: r.ms,
        compatible,
        ...(r.error ? { error: r.error } : {}),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    // Una clave guardada que ya no se puede leer (otro secreto) u otra falla conocida del asistente: su mensaje dice
    // qué hacer, con su estado. El detalle técnico queda solo en el registro del servidor.
    if (error instanceof ErrorIA) {
      if (error.tecnico) console.error(`[ajustes/probar] ${error.codigo}: ${error.tecnico}`);
      return Response.json(
        { error: error.message, codigo: error.codigo },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    console.error('[ajustes/probar] fallo interno:', error instanceof Error ? error.message : 'desconocido');
    return Response.json({ error: 'No se pudo probar el modelo.' }, { status: 500 });
  }
}

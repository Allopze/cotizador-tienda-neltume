import { z } from 'zod';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { cargarCatalogo } from '@/servidor/catalogo';
import { leerJson } from '@/servidor/cuerpo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const configuracionSchema = z
  .object({
    maderas: z.array(
      z.object({ nombre: z.string().trim().min(1), codigo: z.string().trim().regex(/^[A-Za-z0-9]+$/), alias: z.array(z.string().trim().min(1)) }).strict(),
    ).min(1),
    familiasPorModelo: z.record(z.string(), z.enum(['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA'])),
    aliasModelos: z.record(z.string(), z.array(z.string().trim().min(1))),
    aliasPosiblesModelos: z.record(z.string(), z.array(z.string().trim().min(1))).default({}),
  })
  .strict();
const sinCache = { 'Cache-Control': 'no-store' };

export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  try {
    const catalogo = await cargarCatalogo();
    return Response.json({ configuracion: catalogo.configuracion, puedeEditar: sesion.usuario.rol === 'admin' }, { headers: sinCache });
  } catch {
    return Response.json({ error: 'No se pudo leer la configuración del catálogo.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true, rol: 'admin' });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = configuracionSchema.safeParse(cuerpo.valor);
  if (!parsed.success)
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Configuración inválida.' }, { status: 400, headers: sinCache });
  try {
    const catalogo = await cargarCatalogo();
    return Response.json({ configuracion: catalogo.guardarConfiguracion(parsed.data), puedeEditar: true }, { headers: sinCache });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'No se pudo guardar la configuración.' }, { status: 400, headers: sinCache });
  }
}

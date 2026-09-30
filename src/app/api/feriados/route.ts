import { z } from 'zod';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { leerJson } from '@/servidor/cuerpo';
import { abrirBaseDatos } from '@/servidor/base-datos';
import {
  eliminarFeriadoManual,
  feriadoManualSchema,
  guardarFeriadoManual,
  listarFeriadosManuales,
} from '@/servidor/feriados-manuales';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };
const peticionSchema = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('guardar'), ...feriadoManualSchema.shape }).strict(),
  z.object({ accion: z.literal('eliminar'), fecha: z.iso.date() }).strict(),
]);

export async function GET(req: Request) {
  const sesion = await exigirSesion(req, { rol: 'admin' });
  if (!sesion.ok) return sesion.respuesta;
  return Response.json({ feriados: listarFeriadosManuales(abrirBaseDatos()) }, { headers: sinCache });
}

export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true, rol: 'admin' });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = peticionSchema.safeParse(cuerpo.valor);
  if (!parsed.success)
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Feriado inválido.' }, { status: 400, headers: sinCache });
  const db = abrirBaseDatos();
  const feriados = parsed.data.accion === 'guardar'
    ? guardarFeriadoManual(db, parsed.data.fecha, parsed.data.nombre)
    : eliminarFeriadoManual(db, parsed.data.fecha);
  return Response.json({ feriados }, { headers: sinCache });
}

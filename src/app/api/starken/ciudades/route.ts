import { z } from 'zod';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { registrarError } from '@/servidor/errores';
import { ErrorStarken } from '@/servidor/starken';
import {
  crearClienteStarken,
  registrarFallaStarken,
  respuestaErrorStarken,
} from '@/servidor/starken-servicio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };
const consultaSchema = z.object({ tipo: z.enum(['origen', 'destino']) });

/** Ciudades de Starken (con sus comunas) para los selectores; el servidor las guarda 24 horas. */
export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  const consulta = consultaSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!consulta.success)
    return Response.json(
      { error: 'Solicitud inválida.', codigo: 'solicitud_invalida' },
      { status: 400, headers: sinCache },
    );
  try {
    const cliente = await crearClienteStarken();
    if (!cliente) throw new ErrorStarken('Starken no está configurado', 'no_configurado');
    return Response.json(
      { ciudades: await cliente.listarCiudades(consulta.data.tipo) },
      { headers: sinCache },
    );
  } catch (e) {
    if (e instanceof ErrorStarken) {
      registrarFallaStarken('api/starken/ciudades', e);
      return respuestaErrorStarken(e);
    }
    registrarError('api/starken/ciudades', e);
    return Response.json(
      { error: 'No se pudieron leer las ciudades de Starken.' },
      { status: 500, headers: sinCache },
    );
  }
}

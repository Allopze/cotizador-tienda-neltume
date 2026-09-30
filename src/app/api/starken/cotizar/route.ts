import { z } from 'zod';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { Almacen } from '@/servidor/almacen';
import { abrirBaseDatos } from '@/servidor/base-datos';
import { leerJson } from '@/servidor/cuerpo';
import { ErrorUsuario, registrarError } from '@/servidor/errores';
import { ErrorStarken } from '@/servidor/starken';
import { leerConfiguracionStarken } from '@/servidor/starken-configuracion';
import {
  cotizarEnvioStarken,
  crearClienteStarken,
  registrarFallaStarken,
  respuestaErrorStarken,
} from '@/servidor/starken-servicio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };
const cotizarSchema = z
  .object({ id: z.uuid(), codigoCiudad: z.number().int().positive().optional() })
  .strict();

/**
 * Consulta las tarifas de Starken para el bulto de una cotización. No modifica nada: aplicar una tarifa es
 * decisión de la persona y se hace con la acción `editar`, que deja la tarifa en la actividad.
 */
export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = cotizarSchema.safeParse(cuerpo.valor);
  if (!parsed.success)
    return Response.json(
      { error: 'Solicitud inválida.', codigo: 'solicitud_invalida' },
      { status: 400, headers: sinCache },
    );
  try {
    const cotizacion = new Almacen().obtener(parsed.data.id);
    if (!cotizacion)
      return Response.json(
        { error: 'No se encontró la cotización.', codigo: 'no_encontrada' },
        { status: 404, headers: sinCache },
      );
    const resultado = await cotizarEnvioStarken(
      cotizacion,
      parsed.data.codigoCiudad,
      leerConfiguracionStarken(abrirBaseDatos()),
      await crearClienteStarken(),
    );
    return Response.json(resultado, { headers: sinCache });
  } catch (e) {
    if (e instanceof ErrorStarken) {
      registrarFallaStarken('api/starken/cotizar', e);
      return respuestaErrorStarken(e);
    }
    if (e instanceof ErrorUsuario)
      return Response.json({ error: e.message, codigo: e.codigo }, { status: e.status, headers: sinCache });
    registrarError('api/starken/cotizar', e);
    return Response.json({ error: 'No se pudo cotizar con Starken.' }, { status: 500, headers: sinCache });
  }
}

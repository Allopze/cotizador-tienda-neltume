import { exigirSesion } from '@/servidor/acceso-autenticado';
import { abrirBaseDatos } from '@/servidor/base-datos';
import { leerJson } from '@/servidor/cuerpo';
import { ErrorUsuario, registrarError } from '@/servidor/errores';
import { ErrorStarken } from '@/servidor/starken';
import { configuracionStarkenSchema, mensajeErrorConfiguracion } from '@/servidor/starken-configuracion';
import {
  crearClienteStarken,
  estadoStarken,
  guardarAjustesStarken,
  registrarFallaStarken,
  respuestaErrorStarken,
} from '@/servidor/starken-servicio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };

/** Estado de la integración (sin credenciales) y los ajustes de bulto que define la empresa. */
export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  try {
    return Response.json(
      { ...estadoStarken(abrirBaseDatos()), puedeEditar: sesion.usuario.rol === 'admin' },
      { headers: sinCache },
    );
  } catch (e) {
    registrarError('api/starken', e);
    return Response.json(
      { error: 'No se pudo leer la configuración de Starken.' },
      { status: 500, headers: sinCache },
    );
  }
}

export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true, rol: 'admin' });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = configuracionStarkenSchema.safeParse(cuerpo.valor);
  if (!parsed.success)
    return Response.json(
      { error: mensajeErrorConfiguracion(parsed.error), codigo: 'solicitud_invalida' },
      { status: 400, headers: sinCache },
    );
  try {
    const db = abrirBaseDatos();
    await guardarAjustesStarken(parsed.data, db, await crearClienteStarken());
    return Response.json({ ...estadoStarken(db), puedeEditar: true }, { headers: sinCache });
  } catch (e) {
    if (e instanceof ErrorStarken) {
      registrarFallaStarken('api/starken', e);
      return respuestaErrorStarken(e);
    }
    if (e instanceof ErrorUsuario)
      return Response.json({ error: e.message, codigo: e.codigo }, { status: e.status, headers: sinCache });
    registrarError('api/starken', e);
    return Response.json(
      { error: 'No se pudo guardar la configuración de Starken.' },
      { status: 500, headers: sinCache },
    );
  }
}

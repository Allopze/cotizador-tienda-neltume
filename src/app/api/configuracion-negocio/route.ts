import { configuracionNegocioSchema, guardarConfiguracionNegocio, leerConfiguracionNegocio } from '@/servidor/configuracion-negocio';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { abrirBaseDatos } from '@/servidor/base-datos';
import { leerJson } from '@/servidor/cuerpo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };

export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  try {
    return Response.json(
      {
        configuracion: leerConfiguracionNegocio(abrirBaseDatos()),
        puedeEditar: sesion.usuario.rol === 'admin',
      },
      { headers: sinCache },
    );
  } catch {
    return Response.json({ error: 'No se pudo leer la configuración comercial.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true, rol: 'admin' });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = configuracionNegocioSchema.safeParse(cuerpo.valor);
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Configuración inválida.' },
      { status: 400, headers: sinCache },
    );
  try {
    return Response.json(
      {
        configuracion: guardarConfiguracionNegocio(parsed.data, abrirBaseDatos()),
        puedeEditar: true,
      },
      { headers: sinCache },
    );
  } catch {
    return Response.json({ error: 'No se pudo guardar la configuración comercial.' }, { status: 500 });
  }
}

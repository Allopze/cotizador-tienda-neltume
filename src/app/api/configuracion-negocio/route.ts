import {
  configuracionNegocioSchema,
  guardarConfiguracionNegocio,
  leerConfiguracionNegocio,
  versionConfiguracionNegocio,
} from '@/servidor/configuracion-negocio';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { abrirBaseDatos } from '@/servidor/base-datos';
import { leerJson } from '@/servidor/cuerpo';
import { ErrorUsuario, registrarError } from '@/servidor/errores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };

export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  try {
    const db = abrirBaseDatos();
    return Response.json(
      {
        configuracion: leerConfiguracionNegocio(db),
        // Versión que la pantalla debe devolver al guardar: si otra persona guardó entretanto, el POST da 409.
        actualizada: versionConfiguracionNegocio(db),
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
  // Versión que la persona vio (`If-Match`). Sin ella se acepta, pero la pantalla siempre la envía.
  // `get` da null sin la cabecera: se pasa como ausente, no como «la versión es null».
  const esperada = req.headers.get('if-match') ?? undefined;
  try {
    const db = abrirBaseDatos();
    return Response.json(
      {
        configuracion: guardarConfiguracionNegocio(parsed.data, db, esperada),
        actualizada: versionConfiguracionNegocio(db),
        puedeEditar: true,
      },
      { headers: sinCache },
    );
  } catch (e) {
    if (e instanceof ErrorUsuario)
      return Response.json({ error: e.message, codigo: e.codigo }, { status: e.status, headers: sinCache });
    registrarError('api/configuracion-negocio', e);
    return Response.json(
      { error: 'No se pudo guardar la configuración comercial.' },
      { status: 500, headers: sinCache },
    );
  }
}

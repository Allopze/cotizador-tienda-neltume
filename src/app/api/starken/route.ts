import { exigirSesion } from '@/servidor/acceso-autenticado';
import { abrirBaseDatos } from '@/servidor/base-datos';
import { leerJson } from '@/servidor/cuerpo';
import { registrarError } from '@/servidor/errores';
import { ErrorStarken } from '@/servidor/starken';
import {
  configuracionStarkenSchema,
  guardarConfiguracionStarken,
  leerConfiguracionStarken,
} from '@/servidor/starken-configuracion';
import {
  crearClienteStarken,
  estadoStarken,
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
      { error: parsed.error.issues[0]?.message ?? 'Configuración inválida.', codigo: 'solicitud_invalida' },
      { status: 400, headers: sinCache },
    );
  try {
    const db = abrirBaseDatos();
    const configuracion = parsed.data;
    const guardada = leerConfiguracionStarken(db).origen;
    // Un origen nuevo se toma de la lista de Starken (con su nombre oficial); uno ya guardado no la vuelve a pedir.
    if (configuracion.origen && configuracion.origen.codigoCiudad !== guardada?.codigoCiudad) {
      const cliente = await crearClienteStarken();
      if (!cliente) throw new ErrorStarken('Starken no está configurado', 'no_configurado');
      const ciudad = (await cliente.listarCiudades('origen')).find(
        (c) => c.codigoCiudad === configuracion.origen?.codigoCiudad,
      );
      if (!ciudad)
        return Response.json(
          {
            error: 'La ciudad de origen no está entre las ciudades de Starken.',
            codigo: 'solicitud_invalida',
          },
          { status: 400, headers: sinCache },
        );
      configuracion.origen = { codigoCiudad: ciudad.codigoCiudad, nombre: ciudad.nombre };
    }
    guardarConfiguracionStarken(configuracion, db);
    return Response.json({ ...estadoStarken(db), puedeEditar: true }, { headers: sinCache });
  } catch (e) {
    if (e instanceof ErrorStarken) {
      registrarFallaStarken('api/starken', e);
      return respuestaErrorStarken(e);
    }
    registrarError('api/starken', e);
    return Response.json(
      { error: 'No se pudo guardar la configuración de Starken.' },
      { status: 500, headers: sinCache },
    );
  }
}

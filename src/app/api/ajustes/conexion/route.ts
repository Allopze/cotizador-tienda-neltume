import { z } from 'zod';
import { nombreFabrica } from '@/negocio/estado';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { Almacen } from '@/servidor/almacen';
import { leerJson } from '@/servidor/cuerpo';
import { ErrorUsuario, registrarError } from '@/servidor/errores';
import { detalleConfiguracion, FABRICAS_INTEGRADAS } from '@/servidor/integracion-configuracion';
import { listarPruebas } from '@/servidor/integracion-prueba';
import { enviarPrueba } from '@/servidor/integracion-prueba-envio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };
const peticionSchema = z.object({ fabrica: z.string() }).strict();

/**
 * «Conexión con la fábrica» de Ajustes: qué falta de la configuración de cada fábrica integrada (sin mostrar el secreto)
 * y las últimas pruebas de conexión enviadas y recibidas. Solo quien administra.
 */
export async function GET(req: Request) {
  const sesion = await exigirSesion(req, { rol: 'admin' });
  if (!sesion.ok) return sesion.respuesta;
  try {
    const db = new Almacen().baseDatos();
    return Response.json(
      {
        fabricas: FABRICAS_INTEGRADAS.map((fabrica) => ({
          fabrica,
          nombre: nombreFabrica[fabrica],
          configuracion: detalleConfiguracion(fabrica),
          pruebas: listarPruebas(db, fabrica),
        })),
      },
      { headers: sinCache },
    );
  } catch (error) {
    registrarError('api/ajustes/conexion', error);
    return Response.json({ error: 'No se pudo leer la conexión con la fábrica.' }, { status: 500, headers: sinCache });
  }
}

/**
 * «Enviar PDF de prueba a la fábrica»: imprime el PDF, lo envía firmado (un intento, 15 s) y devuelve el resultado con
 * su diagnóstico y la lista actualizada. Solo quien administra; el PDF sale con el Chromium de los documentos.
 */
export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true, rol: 'admin' });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = peticionSchema.safeParse(cuerpo.valor);
  const fabrica = parsed.success ? FABRICAS_INTEGRADAS.find((f) => f === parsed.data.fabrica) : undefined;
  if (!fabrica) return Response.json({ error: 'Solicitud inválida.', codigo: 'solicitud_invalida' }, { status: 400, headers: sinCache });
  try {
    const almacen = new Almacen();
    const db = almacen.baseDatos();
    const prueba = await enviarPrueba(fabrica, sesion.usuario.email, { directorio: almacen.directorio, db });
    return Response.json({ prueba, pruebas: listarPruebas(db, fabrica) }, { headers: sinCache });
  } catch (error) {
    if (error instanceof ErrorUsuario)
      return Response.json({ error: error.message, codigo: error.codigo }, { status: error.status, headers: sinCache });
    registrarError('api/ajustes/conexion', error);
    return Response.json({ error: 'No se pudo enviar la prueba de conexión.' }, { status: 500, headers: sinCache });
  }
}

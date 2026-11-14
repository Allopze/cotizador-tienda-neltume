import { z } from 'zod';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { abrirBaseDatos } from '@/servidor/base-datos';
import { buscarClientes, directorioClientes } from '@/servidor/clientes';
import { crearClienteSchema, editarClienteSchema, eliminarClienteSchema } from '@/servidor/clientes-esquemas';
import { leerJson } from '@/servidor/cuerpo';
import { ErrorUsuario, registrarError } from '@/servidor/errores';
import {
  actualizarCliente,
  buscarClienteActivoPorRut,
  crearCliente,
  eliminarCliente,
  obtenerCliente,
} from '@/servidor/repositorio-clientes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };
const consultaSchema = z.object({
  q: z.string().max(100).optional(),
  /** Búsqueda exacta de cliente registrado activo por RUT (solo prefill estricto por RUT). */
  rut: z.string().max(30).optional(),
  /** Consulta puntual de una ficha registrada activa por ID. */
  id: z.uuid().optional(),
  /** Cotización abierta: no se sugiere su propio cliente. */
  excluir: z.uuid().optional(),
  /** `directorio=1`: la pantalla Clientes, paginada, con las cotizaciones de cada cliente. */
  directorio: z.literal('1').optional(),
  pagina: z.coerce.number().int().min(1).max(10000).optional(),
});

function responderErrorCliente(error: unknown, origen: string, mensajeGenerico: string) {
  if (error instanceof ErrorUsuario) {
    return Response.json(
      { error: error.message, codigo: error.codigo, ...(error.detalle ? { detalle: error.detalle } : {}) },
      { status: error.status, headers: sinCache },
    );
  }
  registrarError(origen, error);
  return Response.json({ error: mensajeGenerico, codigo: 'error_interno' }, { status: 500, headers: sinCache });
}

/**
 * Clientes para autocompletar (`GET /api/clientes?q=`), búsqueda exacta por RUT (`?rut=`), ficha por ID (`?id=`)
 * o el directorio de clientes con sus cotizaciones (`?directorio=1&q=&pagina=`).
 */
export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  const filtros = consultaSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!filtros.success)
    return Response.json(
      { error: 'Búsqueda inválida.', codigo: 'solicitud_invalida' },
      { status: 400, headers: sinCache },
    );
  try {
    const db = abrirBaseDatos();
    if (filtros.data.rut !== undefined) {
      return Response.json(
        { cliente: buscarClienteActivoPorRut(db, filtros.data.rut) },
        { headers: sinCache },
      );
    }
    if (filtros.data.id !== undefined) {
      const cliente = obtenerCliente(db, filtros.data.id);
      if (!cliente)
        return Response.json(
          { error: 'No se encontró el cliente.', codigo: 'no_encontrada' },
          { status: 404, headers: sinCache },
        );
      return Response.json({ cliente }, { headers: sinCache });
    }
    if (filtros.data.directorio)
      return Response.json(
        directorioClientes(db, { q: filtros.data.q, pagina: filtros.data.pagina }),
        { headers: sinCache },
      );
    const clientes = buscarClientes(db, filtros.data.q ?? '', { excluir: filtros.data.excluir });
    return Response.json({ clientes }, { headers: sinCache });
  } catch (error) {
    return responderErrorCliente(error, 'api/clientes GET', 'No se pudieron consultar los clientes.');
  }
}

export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = crearClienteSchema.safeParse(cuerpo.valor);
  if (!parsed.success)
    return Response.json(
      { error: 'Los datos del cliente no son válidos.', codigo: 'solicitud_invalida' },
      { status: 400, headers: sinCache },
    );
  try {
    const cliente = crearCliente(abrirBaseDatos(), parsed.data, sesion.usuario.email);
    return Response.json({ cliente }, { status: 201, headers: sinCache });
  } catch (error) {
    return responderErrorCliente(error, 'api/clientes POST', 'No se pudo guardar el cliente.');
  }
}

export async function PATCH(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = editarClienteSchema.safeParse(cuerpo.valor);
  if (!parsed.success)
    return Response.json(
      { error: 'Los datos del cliente no son válidos.', codigo: 'solicitud_invalida' },
      { status: 400, headers: sinCache },
    );
  const { id, actualizado, ...entrada } = parsed.data;
  try {
    const cliente = actualizarCliente(abrirBaseDatos(), id, entrada, sesion.usuario.email, { actualizado });
    return Response.json({ cliente }, { headers: sinCache });
  } catch (error) {
    return responderErrorCliente(error, 'api/clientes PATCH', 'No se pudo actualizar el cliente.');
  }
}

export async function DELETE(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true, rol: 'admin' });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = eliminarClienteSchema.safeParse(cuerpo.valor);
  if (!parsed.success)
    return Response.json(
      { error: 'Solicitud inválida para eliminar el cliente.', codigo: 'solicitud_invalida' },
      { status: 400, headers: sinCache },
    );
  try {
    const cliente = eliminarCliente(abrirBaseDatos(), parsed.data.id, sesion.usuario.email, {
      actualizado: parsed.data.actualizado,
    });
    return Response.json({ ok: true, cliente }, { headers: sinCache });
  } catch (error) {
    return responderErrorCliente(error, 'api/clientes DELETE', 'No se pudo eliminar el cliente.');
  }
}

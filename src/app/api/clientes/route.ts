import { z } from 'zod';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { abrirBaseDatos } from '@/servidor/base-datos';
import { buscarClientes } from '@/servidor/clientes';
import { registrarError } from '@/servidor/errores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };
const consultaSchema = z.object({
  q: z.string().max(100).optional(),
  /** Cotización abierta: no se sugiere su propio cliente. */
  excluir: z.uuid().optional(),
});

/** Clientes de cotizaciones anteriores para autocompletar el nombre o el RUT (`GET /api/clientes?q=`). */
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
    const clientes = buscarClientes(abrirBaseDatos(), filtros.data.q ?? '', { excluir: filtros.data.excluir });
    return Response.json({ clientes }, { headers: sinCache });
  } catch (error) {
    registrarError('api/clientes', error);
    return Response.json(
      { error: 'No se pudieron buscar clientes anteriores.' },
      { status: 500, headers: sinCache },
    );
  }
}

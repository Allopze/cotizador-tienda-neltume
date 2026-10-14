import { z } from 'zod';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { abrirBaseDatos } from '@/servidor/base-datos';
import { buscarClientes, directorioClientes } from '@/servidor/clientes';
import { registrarError } from '@/servidor/errores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };
const consultaSchema = z.object({
  q: z.string().max(100).optional(),
  /** Cotización abierta: no se sugiere su propio cliente. */
  excluir: z.uuid().optional(),
  /** `directorio=1`: la pantalla Clientes, paginada, con las cotizaciones de cada cliente. */
  directorio: z.literal('1').optional(),
  pagina: z.coerce.number().int().min(1).max(10000).optional(),
});

/**
 * Clientes de cotizaciones anteriores para autocompletar el nombre o el RUT (`GET /api/clientes?q=`), o el
 * directorio de clientes con sus cotizaciones (`GET /api/clientes?directorio=1&q=&pagina=`).
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
    if (filtros.data.directorio)
      return Response.json(
        directorioClientes(abrirBaseDatos(), { q: filtros.data.q, pagina: filtros.data.pagina }),
        { headers: sinCache },
      );
    const clientes = buscarClientes(abrirBaseDatos(), filtros.data.q ?? '', { excluir: filtros.data.excluir });
    return Response.json({ clientes }, { headers: sinCache });
  } catch (error) {
    registrarError('api/clientes', error);
    return Response.json(
      { error: 'No se pudieron buscar clientes anteriores.', codigo: 'error_interno' },
      { status: 500, headers: sinCache },
    );
  }
}

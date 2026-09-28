import { z } from 'zod';
import { crearLLM } from '@/servidor/ajustes-ia';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { leerJson } from '@/servidor/cuerpo';
import { ErrorIA } from '@/asistente/errores';
import { ErrorCatalogo, cargarCatalogo } from '@/servidor/catalogo';
import { ErrorMigracionRequerida, abrirBaseDatos } from '@/servidor/base-datos';
import { ServicioAltaCatalogo } from '@/servidor/alta-catalogo';
import { ErrorUsuario, registrarError } from '@/servidor/errores';
import { normalizarTexto } from '@/servidor/busqueda';
import { REGLAS } from '@/negocio/precios';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const codigo = z.string().trim().min(1).max(80);
const peticionSchema = z.discriminatedUnion('tipo', [
  z
    .object({
      tipo: z.literal('mensaje'),
      id: z.uuid().optional(),
      mensaje: z.string().trim().min(1).max(3000),
    })
    .strict(),
  z.object({ tipo: z.literal('confirmar'), id: z.uuid() }).strict(),
  z.object({ tipo: z.literal('cancelar'), id: z.uuid() }).strict(),
  z.object({ tipo: z.literal('listar_manuales') }).strict(),
  z
    .object({
      tipo: z.literal('editar'),
      codigo,
      cambios: z
        .object({
          precioNeto: z.number().positive().max(100_000_000).optional(),
          descripcion: z.string().trim().min(1).max(300).optional(),
          tipo: z.string().trim().max(120).nullable().optional(),
        })
        .strict()
        .refine((c) => Object.keys(c).length > 0),
    })
    .strict(),
  z.object({ tipo: z.literal('eliminar'), codigo }).strict(),
]);
const sinCache = { 'Cache-Control': 'no-store' };

const consultaSchema = z.object({
  q: z.string().max(100).optional(),
  familia: z.enum(['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA']).optional(),
});
const MAX_RESULTADOS = 300;

/** Consulta del catálogo vigente (importado y manual) con el precio unitario que usa la cotización. */
export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  const filtros = consultaSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!filtros.success)
    return Response.json({ error: 'Filtros inválidos.', codigo: 'solicitud_invalida' }, { status: 400 });
  try {
    const catalogo = await cargarCatalogo();
    const terminos = normalizarTexto(filtros.data.q ?? '')
      .split(' ')
      .filter(Boolean);
    const manuales = new Set(catalogo.listarManuales().map((p) => p.codigo));
    const coinciden = catalogo.todos().filter((p) => {
      if (filtros.data.familia && p.familia !== filtros.data.familia) return false;
      const texto = normalizarTexto(`${p.codigo} ${p.modelo} ${p.madera} ${p.tipo ?? ''} ${p.descripcion}`);
      return terminos.every((t) => texto.includes(t));
    });
    return Response.json(
      {
        total: coinciden.length,
        productos: coinciden.slice(0, MAX_RESULTADOS).map((p) => ({
          codigo: p.codigo,
          modelo: p.modelo,
          familia: p.familia,
          tipo: p.tipo,
          madera: p.madera,
          medida: p.medida,
          largo: p.largo,
          descripcion: p.descripcion,
          unitario: Math.round(p.precioNeto * (1 + REGLAS.ajuste)),
          manual: manuales.has(p.codigo),
        })),
      },
      { headers: sinCache },
    );
  } catch (error) {
    if (error instanceof ErrorMigracionRequerida || error instanceof ErrorCatalogo) {
      registrarError('api/catalogo', error);
      return Response.json(
        {
          error: 'El catálogo no está disponible. Pide a quien administra el cotizador que lo revise.',
          codigo: 'no_configurado',
        },
        { status: 503 },
      );
    }
    registrarError('api/catalogo', error);
    return Response.json({ error: 'No se pudo leer el catálogo.', codigo: 'error_interno' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = peticionSchema.safeParse(cuerpo.valor);
  if (!parsed.success)
    return Response.json({ error: 'Solicitud inválida.', codigo: 'solicitud_invalida' }, { status: 400 });
  const { id: usuarioId, nombre, email } = sesion.usuario;
  try {
    const catalogo = await cargarCatalogo();
    const peticion = parsed.data;
    if (peticion.tipo === 'listar_manuales')
      return Response.json({ productos: catalogo.listarManuales() }, { headers: sinCache });
    if (peticion.tipo === 'editar')
      return Response.json(
        { producto: catalogo.editarManual(peticion.codigo, peticion.cambios) },
        { headers: sinCache },
      );
    if (peticion.tipo === 'eliminar') {
      catalogo.eliminarManual(peticion.codigo);
      return Response.json({ eliminado: peticion.codigo }, { headers: sinCache });
    }
    const servicio = new ServicioAltaCatalogo(abrirBaseDatos(), catalogo, crearLLM());
    if (peticion.tipo === 'mensaje')
      return Response.json(await servicio.mensaje(peticion.id, peticion.mensaje, usuarioId), {
        headers: sinCache,
      });
    if (peticion.tipo === 'cancelar') {
      servicio.cancelar(peticion.id, usuarioId);
      return Response.json({ cancelado: true }, { headers: sinCache });
    }
    return Response.json(
      { producto: servicio.confirmar(peticion.id, usuarioId, nombre || email) },
      { headers: sinCache },
    );
  } catch (error) {
    if (error instanceof ErrorMigracionRequerida || error instanceof ErrorCatalogo) {
      registrarError('api/catalogo', error);
      return Response.json(
        {
          error: 'El catálogo no está disponible. Pide a quien administra el cotizador que lo revise.',
          codigo: 'no_configurado',
        },
        { status: 503 },
      );
    }
    if (error instanceof ErrorIA) {
      if (error.tecnico) registrarError('api/catalogo', `${error.codigo}: ${error.tecnico}`);
      return Response.json({ error: error.message, codigo: error.codigo }, { status: error.status });
    }
    if (error instanceof ErrorUsuario)
      return Response.json({ error: error.message, codigo: error.codigo }, { status: error.status });
    registrarError('api/catalogo', error);
    return Response.json(
      {
        error: 'No se pudo completar la operación. El catálogo se conserva sin cambios.',
        codigo: 'error_interno',
      },
      { status: 500 },
    );
  }
}

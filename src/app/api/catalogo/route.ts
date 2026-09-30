import { z } from 'zod';
import { crearLLM } from '@/servidor/ajustes-ia';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { leerJson } from '@/servidor/cuerpo';
import { ErrorIA } from '@/asistente/errores';
import { atributosProductoSchema } from '@/asistente/esquemas';
import { ErrorCatalogo, cargarCatalogo } from '@/servidor/catalogo';
import { ErrorMigracionRequerida, abrirBaseDatos } from '@/servidor/base-datos';
import { ServicioAltaCatalogo } from '@/servidor/alta-catalogo';
import { ErrorUsuario, registrarError } from '@/servidor/errores';
import { normalizarTexto } from '@/servidor/busqueda';
import { leerConfiguracionNegocio } from '@/servidor/configuracion-negocio';
import type { Producto } from '@/catalogo/tipos';

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
  z
    .object({
      tipo: z.literal('manual'),
      id: z.uuid().optional(),
      producto: atributosProductoSchema
        .extend({ precioNeto: z.number().positive().max(100_000_000).nullable() })
        .strict(),
    })
    .strict(),
  z.object({ tipo: z.literal('confirmar'), id: z.uuid() }).strict(),
  z.object({ tipo: z.literal('cancelar'), id: z.uuid() }).strict(),
  z.object({ tipo: z.literal('listar_manuales') }).strict(),
  z.object({ tipo: z.literal('listar_productos'), q: z.string().trim().max(120).optional() }).strict(),
  z
    .object({
      tipo: z.literal('editar'),
      codigo,
      cambios: z
        .object({
          modelo: z.string().trim().min(1).max(100).optional(),
          familia: z.enum(['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA']).optional(),
          madera: z.string().trim().min(1).max(80).optional(),
          medida: z.string().trim().min(1).max(60).optional(),
          anchoMin: z.number().finite().positive().nullable().optional(),
          anchoMax: z.number().finite().positive().nullable().optional(),
          largo: z.number().finite().positive().max(100).optional(),
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
const ORDEN_FAMILIAS: string[] = ['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA'];

/** Consulta del catálogo vigente (importado y manual) con el precio unitario que usa la cotización. */
export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  const filtros = consultaSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!filtros.success)
    return Response.json({ error: 'Filtros inválidos.', codigo: 'solicitud_invalida' }, { status: 400 });
  try {
    const catalogo = await cargarCatalogo();
    const consulta = normalizarTexto(filtros.data.q ?? '');
    const terminos = consulta.split(' ').filter(Boolean);
    const manuales = new Set(catalogo.listarManuales().map((p) => p.codigo));
    const coinciden = catalogo.todos().filter((p) => {
      if (filtros.data.familia && p.familia !== filtros.data.familia) return false;
      const texto = normalizarTexto(`${p.codigo} ${p.modelo} ${p.madera} ${p.tipo ?? ''} ${p.descripcion}`);
      return terminos.every((t) => texto.includes(t));
    });
    // Orden de lectura, no de código: modelo, madera, alto y luego ancho («CAL-O-1-B» no va tras «CAL-O-9-A»).
    const orden = new Intl.Collator('es-CL', { numeric: true, sensitivity: 'base' });
    const familia = (f: string) => {
      const i = ORDEN_FAMILIAS.indexOf(f);
      return i < 0 ? ORDEN_FAMILIAS.length : i;
    };
    // Quien busca un código lo busca a él: el exacto primero, después su prefijo, y el resto en orden
    // de lectura («HUIL-O-3-B» quedaba quinto de ocho, detrás de otras maderas del mismo modelo).
    const cercania = (p: Producto) => {
      if (!consulta) return 0;
      const codigo = normalizarTexto(p.codigo);
      if (codigo === consulta) return 0;
      return codigo.startsWith(consulta) ? 1 : 2;
    };
    coinciden.sort(
      (a, b) =>
        cercania(a) - cercania(b) ||
        familia(a.familia) - familia(b.familia) ||
        orden.compare(a.modelo, b.modelo) ||
        orden.compare(a.madera, b.madera) ||
        a.largo - b.largo ||
        orden.compare(a.medida, b.medida),
    );
    const ajuste = leerConfiguracionNegocio(abrirBaseDatos()).reglas.ajuste;
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
          unitario: Math.round(p.precioNeto * (1 + ajuste)),
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
    if ((peticion.tipo === 'listar_productos' || peticion.tipo === 'editar') && sesion.usuario.rol !== 'admin')
      return Response.json(
        { error: 'Solo quien administra el catálogo puede modificar productos importados.', codigo: 'sin_permiso' },
        { status: 403, headers: sinCache },
      );
    if (peticion.tipo === 'listar_manuales')
      return Response.json({ productos: catalogo.listarManuales() }, { headers: sinCache });
    if (peticion.tipo === 'listar_productos')
      return Response.json({ productos: catalogo.listarAdministrables(peticion.q) }, { headers: sinCache });
    if (peticion.tipo === 'editar')
      return Response.json(
        { producto: catalogo.editarProducto(peticion.codigo, peticion.cambios) },
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
    if (peticion.tipo === 'manual')
      return Response.json(servicio.proponerManual(peticion.id, peticion.producto, usuarioId), {
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

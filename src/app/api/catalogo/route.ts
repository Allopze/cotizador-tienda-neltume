import { z } from 'zod';
import { crearLLM } from '@/servidor/ajustes-ia';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { leerJson } from '@/servidor/cuerpo';
import { ErrorIA } from '@/asistente/errores';
import { atributosProductoSchema } from '@/asistente/esquemas';
import { ErrorCatalogo, cargarCatalogo } from '@/servidor/catalogo';
import { ErrorMigracionRequerida, abrirBaseDatos } from '@/servidor/base-datos';
import { ServicioAltaCatalogo } from '@/servidor/alta-catalogo';
import { Almacen } from '@/servidor/almacen';
import { ErrorUsuario, registrarError } from '@/servidor/errores';
import {
  coincideBusquedaCatalogo,
  normalizarTexto,
  terminosBusquedaCatalogo,
  textoBusquedaCatalogo,
} from '@/servidor/busqueda';
import { leerConfiguracionNegocio } from '@/servidor/configuracion-negocio';
import type { Producto } from '@/catalogo/tipos';
import { ORIGENES_CATALOGO, type OrigenCatalogo } from '@/catalogo/origenes';
import type { LLM } from '@/asistente/llm';
import { margenProducto } from '@/negocio/precios';
import { rangoMedidas } from '@/negocio/limites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const codigo = z.string().trim().min(1).max(80);
const FAMILIAS = ['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA'] as const;
/**
 * Topes del largo que se aceptan en la solicitud: los de `rangoMedidas`, del más corto al más largo de todas las
 * familias. El tope de la familia del producto (3 m en puertas) lo comprueba el repositorio, con su mensaje.
 */
const LARGO = {
  min: Math.min(...FAMILIAS.map((f) => rangoMedidas(f).min)),
  max: Math.max(...FAMILIAS.map((f) => rangoMedidas(f).max)),
};
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
          anchoMin: z.number().finite().positive().max(rangoMedidas('PUERTA').max).nullable().optional(),
          anchoMax: z.number().finite().positive().max(rangoMedidas('PUERTA').max).nullable().optional(),
          largo: z.number().finite().min(LARGO.min).max(LARGO.max).optional(),
          precioNeto: z.number().positive().max(100_000_000).optional(),
          descripcion: z.string().trim().min(1).max(300).optional(),
          tipo: z.string().trim().max(120).nullable().optional(),
        })
        .strict()
        .refine((c) => Object.keys(c).length > 0),
    })
    .strict(),
  z.object({ tipo: z.literal('eliminar'), codigo }).strict(),
  // Papelera de productos agregados a mano.
  z.object({ tipo: z.literal('listar_eliminados') }).strict(),
  z.object({ tipo: z.literal('restaurar'), codigo }).strict(),
  // Deshace la última importación de una planilla si el catálogo no cambió desde entonces (`versionCatalogo`).
  z
    .object({
      tipo: z.literal('volver_planilla'),
      origen: z.enum(ORIGENES_CATALOGO as [OrigenCatalogo, ...OrigenCatalogo[]]),
      versionCatalogo: z.string().min(1).max(300),
    })
    .strict(),
]);
const sinCache = { 'Cache-Control': 'no-store' };
/** Solo el alta asistida usa la IA: las demás acciones no dependen de que su clave se pueda leer. */
const sinIA: LLM = {
  interpretar: async () => {
    throw new Error('Esta acción no utiliza el asistente.');
  },
};

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
    const terminos = terminosBusquedaCatalogo(filtros.data.q ?? '');
    const manuales = new Set(catalogo.listarManuales().map((p) => p.codigo));
    const coinciden = catalogo.todos().filter((p) => {
      if (filtros.data.familia && p.familia !== filtros.data.familia) return false;
      const texto = textoBusquedaCatalogo([p.codigo, p.modelo, p.madera, p.tipo, p.medida, p.descripcion]);
      return coincideBusquedaCatalogo(texto, terminos);
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
    const reglas = leerConfiguracionNegocio(abrirBaseDatos()).reglas;
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
          anchoMin: p.anchoMin,
          anchoMax: p.anchoMax,
          largo: p.largo,
          altoMin: p.altoMin ?? null,
          altoMax: p.altoMax ?? null,
          descripcion: p.descripcion,
          unitario: Math.round(p.precioNeto * (1 + margenProducto(p, reglas))),
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
    if (
      (peticion.tipo === 'listar_productos' || peticion.tipo === 'editar') &&
      sesion.usuario.rol !== 'admin'
    )
      return Response.json(
        {
          error: 'Solo quien administra el catálogo puede modificar productos importados.',
          codigo: 'sin_permiso',
        },
        { status: 403, headers: sinCache },
      );
    if (peticion.tipo === 'volver_planilla' && sesion.usuario.rol !== 'admin')
      return Response.json(
        { error: 'Solo quien administra puede importar el catálogo.', codigo: 'sin_permiso' },
        { status: 403, headers: sinCache },
      );
    if (peticion.tipo === 'listar_manuales')
      return Response.json({ productos: catalogo.listarManuales() }, { headers: sinCache });
    if (peticion.tipo === 'listar_productos')
      return Response.json(catalogo.listarAdministrables(peticion.q), { headers: sinCache });
    if (peticion.tipo === 'editar')
      return Response.json(
        { producto: catalogo.editarProducto(peticion.codigo, peticion.cambios) },
        { headers: sinCache },
      );
    if (peticion.tipo === 'eliminar') {
      catalogo.eliminarManual(peticion.codigo);
      return Response.json({ eliminado: peticion.codigo }, { headers: sinCache });
    }
    if (peticion.tipo === 'listar_eliminados')
      return Response.json({ productos: catalogo.productosEliminados() }, { headers: sinCache });
    if (peticion.tipo === 'restaurar')
      return Response.json({ producto: catalogo.restaurarProducto(peticion.codigo) }, { headers: sinCache });
    if (peticion.tipo === 'volver_planilla') {
      // Con el bloqueo del almacén, como una importación: no cambia el catálogo en medio de una emisión.
      const anterior = await new Almacen().restaurarImportacion(peticion.origen, peticion.versionCatalogo);
      return Response.json(
        { restaurada: anterior, versionCatalogo: catalogo.version },
        { headers: sinCache },
      );
    }
    // La clave de la IA se lee solo para el alta asistida: si no se puede leer, el alta manual sigue funcionando.
    const servicio = new ServicioAltaCatalogo(
      abrirBaseDatos(),
      catalogo,
      peticion.tipo === 'mensaje' ? crearLLM() : sinIA,
    );
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

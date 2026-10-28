import { ErrorIA } from '@/asistente/errores';
import { z } from 'zod';
import { Servicio, type DiagnosticoTurno } from '@/servidor/servicio';
import { Almacen, DIAS_PAPELERA, type FiltrosListado } from '@/servidor/almacen';
import { csvCotizaciones, MAX_EXPORTACION, partesExportacion } from '@/servidor/exportar';
import { fechaLocal } from '@/negocio/vigencia';
import { FABRICAS } from '@/negocio/estado';
import { LARGO_OBSERVACION_ITEM, MARGEN_MAX, MARGEN_MIN, rangoMedidas } from '@/negocio/limites';
import { cargarCatalogo, ErrorCatalogo } from '@/servidor/catalogo';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { leerJson } from '@/servidor/cuerpo';
import type { LLM } from '@/asistente/llm';
import { asistenteConfigurado, crearLLM, llmFijoDePrueba } from '@/servidor/ajustes-ia';
import { ErrorMigracionRequerida } from '@/servidor/base-datos';
import { descuentoItemSchema } from '@/servidor/persistencia-esquemas';
import { ErrorPdf, ErrorUsuario, registrarError } from '@/servidor/errores';
import { ErrorPrecio } from '@/negocio/precios';
import {
  ESTADOS,
  etiquetaComercial,
  etiquetaOperativo,
  type EstadoComercial,
  type EstadoCotizacion,
  type EstadoOperativo,
  type ResumenCotizacion,
} from '@/negocio/estado';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Topes de las medidas que llegan ya en metros, de `rangoMedidas`: el ancho es siempre de puerta y el alto o largo
 * llega al de un accesorio. El servidor vuelve a revisarlas con la familia del producto (`metros`).
 */
const RANGO_ANCHO = rangoMedidas('PUERTA');
const RANGO_LARGO = rangoMedidas('MOLDURA');
const anchoMetros = z.number().finite().min(RANGO_ANCHO.min).max(RANGO_ANCHO.max);
const altoMetros = z.number().finite().min(RANGO_LARGO.min).max(RANGO_LARGO.max);
const version = z.iso.datetime();
/** Fábrica de cada ítem, por su índice; null la quita. */
const asignacionesSchema = z
  .array(z.object({ indice: z.number().int().nonnegative().max(99), fabrica: z.enum(FABRICAS).nullable() }).strict())
  .max(100);
const texto = (max: number) => z.string().max(max).nullable().optional();
const clienteParcial = z
  .object({
    nombre: texto(300),
    rut: texto(300),
    giro: texto(300),
    telefono: texto(300),
    direccion: texto(300),
    comuna: texto(300),
    proyecto: texto(300),
  })
  .strict();
/** Datos logísticos: los mismos en aprobar, editar, despacho y el paso «despachada». */
const despachoSchema = z
  .object({
    direccion: texto(300),
    transporte: texto(120),
    entregaComprometida: texto(120),
    destino: texto(300),
    // Se acepta aunque esté fijo desde la emisión: así el servicio responde con el motivo y no un 400 genérico.
    valor: z.number().int().min(0).max(100_000_000).nullable().optional(),
  })
  .strict();
/** Tarifa de Starken que la persona eligió; el servicio verifica su firma y que el valor de despacho sea su neto. */
const tarifaStarkenSchema = z
  .object({
    tipoEntrega: z.string().trim().min(1).max(40),
    servicio: z.string().trim().max(40).optional(),
    dias: z.number().int().min(0).max(365),
    costoTotal: z.number().int().positive().max(100_000_000),
    ciudadDestino: z.string().trim().min(1).max(120),
    codigoCiudadDestino: z.number().int().positive(),
    // La firma y su vencimiento los entrega el servidor con cada tarifa; se verifican antes de aplicarla.
    vence: z.iso.datetime(),
    firma: z.string().min(20).max(100),
    huellaBulto: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
/** Referencia ya subida con /api/referencias; el servicio comprueba que el archivo exista. */
const referenciaSchema = z
  .object({
    archivo: z.string().regex(/^[0-9a-f]{64}\.(jpg|png|webp|pdf)$/),
    nombre: z.string().trim().min(1).max(200),
    tipo: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    tamano: z.number().int().positive(),
    fecha: z.string().max(40),
  })
  .strict();
const referenciasSchema = z.array(referenciaSchema).max(10);
const familiaSchema = z.enum(['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA', 'OTRO']);
// Deshacer y Rehacer devuelven los ítems tal como se guardaron: también su identidad (BUG-001), su fábrica y el costo
// de un especial. Sin ellos en este esquema estricto, cualquier Deshacer respondía 400 y no cambiaba nada.
const solicitudRestaurarSchema = z.object({
  id: z.string().max(64).optional(),
  modelo: z.string().max(300).nullable(),
  madera: z.string().max(300).nullable(),
  ancho: z.number().finite().nullable(),
  alto: z.number().finite().nullable(),
  medida: z.string().max(300).nullable(),
  cantidad: z.number().int().min(1).max(10000).nullable(),
  precioUnitario: z.number().int().positive().max(100_000_000).nullable().optional(),
  margen: z.number().finite().min(MARGEN_MIN).max(MARGEN_MAX).nullable().optional(),
  tipoMedida: z.enum(['hoja', 'vano', 'no_especificado']).nullable().optional(),
  descripcion: texto(300),
  observaciones: texto(LARGO_OBSERVACION_ITEM),
  modeloOriginal: texto(300),
  coincidenciaModelo: z.enum(['canonico', 'alias', 'posible']).nullable().optional(),
  fuente: texto(300),
  medidaPorDefecto: z.boolean().optional(),
  personalizado: z.object({ familia: familiaSchema }).strict().nullable().optional(),
  referencias: referenciasSchema.optional(),
  descuento: descuentoItemSchema.nullable().optional(),
  costoFabrica: z.number().int().positive().max(100_000_000).nullable().optional(),
  fabrica: z.enum(FABRICAS).nullable().optional(),
}).strict();
const accionSchema = z.discriminatedUnion('tipo', [
  z
    .object({
      tipo: z.literal('agregar_producto'),
      id: z.uuid().optional(),
      actualizada: version.optional(),
      codigo: z.string().trim().min(1).max(80),
      cantidad: z.number().int().min(1).max(10000),
      ancho: anchoMetros.optional(),
      alto: altoMetros.optional(),
      tipoMedida: z.enum(['hoja', 'vano', 'no_especificado']).optional(),
    })
    .strict()
    .refine((a) => Boolean(a.id) === Boolean(a.actualizada)),
  z
    .object({
      tipo: z.literal('agregar_personalizado'),
      id: z.uuid().optional(),
      actualizada: version.optional(),
      item: z
        .object({
          nombre: z.string().trim().min(1).max(300),
          familia: familiaSchema,
          // Un ítem libre (familia OTRO) no tiene madera.
          madera: z.string().trim().max(300),
          descripcion: texto(300),
          ancho: anchoMetros.nullable().optional(),
          alto: altoMetros.nullable().optional(),
          tipoMedida: z.enum(['hoja', 'vano', 'no_especificado']).optional(),
          cantidad: z.number().int().min(1).max(10000),
          precioUnitario: z.number().int().positive().max(100_000_000),
          observaciones: texto(LARGO_OBSERVACION_ITEM),
          referencias: referenciasSchema.optional(),
        })
        .strict()
        .refine((item) => item.familia === 'OTRO' || item.madera.length > 0, { path: ['madera'] }),
    })
    .strict()
    .refine((a) => Boolean(a.id) === Boolean(a.actualizada)),
  z
    .object({
      tipo: z.literal('chat'),
      id: z.uuid().optional(),
      actualizada: version.optional(),
      mensaje: z.string().trim().min(1).max(6000),
      objetivoId: z.uuid().optional(),
      objetivoActualizada: version.optional(),
      nuevoId: z.uuid().optional(),
      contexto: z
        .array(
          z
            .object({ rol: z.enum(['usuario', 'asistente']), texto: z.string().max(6000) })
            .strict()
            // Un pedido largo de la persona debe llegar completo; la IA recorta lo suyo (MAX_TEXTO_HISTORIAL).
            .transform((m) => ({ ...m, texto: m.texto.slice(0, m.rol === 'usuario' ? 1500 : 500) })),
        )
        .max(12)
        .transform((ms) => ms.slice(-6))
        .optional(),
    })
    .strict()
    .refine((a) => Boolean(a.objetivoId) === Boolean(a.objetivoActualizada))
    .refine((a) => !a.id || Boolean(a.actualizada)),
  z
    .object({
      tipo: z.literal('quitar'),
      id: z.uuid(),
      actualizada: version,
      indice: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ tipo: z.literal('restaurar_borrador'), id: z.uuid(), actualizada: version }).strict(),
  z.object({ tipo: z.literal('desaprobar'), id: z.uuid(), actualizada: version }).strict(),
  z.object({ tipo: z.literal('regenerar_pdf'), id: z.uuid(), actualizada: version, documento: z.enum(['cotizacion', 'nota']), fabrica: z.enum(FABRICAS).optional() }).strict(),
  z.object({ tipo: z.literal('retroceder_operacion'), id: z.uuid(), actualizada: version, motivo: z.string().trim().min(1).max(300) }).strict(),
  z.object({
    tipo: z.literal('reordenar'),
    id: z.uuid(),
    actualizada: version,
    desde: z.number().int().nonnegative().max(99),
    hasta: z.number().int().nonnegative().max(99),
  }).strict(),
  z.object({
    tipo: z.literal('restaurar_items'),
    id: z.uuid(),
    actualizada: version,
    items: z.array(solicitudRestaurarSchema).max(100),
  }).strict(),
  z
    .object({
      tipo: z.literal('emitir'),
      id: z.uuid(),
      actualizada: version,
      numero: z.number().int().positive().max(1_000_000_000).optional(),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('aprobar'),
      id: z.uuid(),
      actualizada: version,
      confirmarVencida: z.boolean().optional(),
      despacho: despachoSchema.optional(),
    })
    .strict(),
  z.object({ tipo: z.literal('duplicar'), id: z.uuid(), nuevoId: z.uuid().optional() }).strict(),
  z.object({ tipo: z.literal('eliminar'), id: z.uuid(), actualizada: version }).strict(),
  z
    .object({
      tipo: z.literal('anular'),
      id: z.uuid(),
      actualizada: version,
      motivo: z.string().max(300).optional(),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('editar_pedido'),
      id: z.uuid(),
      actualizada: version,
      items: z
        .array(
          z
            .object({
              indice: z.number().int().nonnegative(),
              cambios: z
                .object({
                  cantidad: z.number().int().min(1).max(10000).optional(),
                  ancho: z.number().finite().nullable().optional(),
                  alto: z.number().finite().nullable().optional(),
                  medida: texto(300),
                  tipoMedida: z.enum(['hoja', 'vano', 'no_especificado']).nullable().optional(),
                  descripcion: texto(300),
                  observaciones: texto(LARGO_OBSERVACION_ITEM),
                })
                .strict(),
            })
            .strict(),
        )
        .min(1)
        .max(100),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('editar'),
      id: z.uuid(),
      actualizada: version,
      cliente: clienteParcial.optional(),
      cantidades: z
        .array(
          z
            .object({ indice: z.number().int().nonnegative(), cantidad: z.number().int().min(1).max(10000) })
            .strict(),
        )
        .max(100)
        .optional(),
      items: z
        .array(
          z
            .object({
              indice: z.number().int().nonnegative(),
              cambios: z
                .object({
                  modelo: texto(300),
                  madera: texto(300),
                  ancho: z.number().finite().nullable().optional(),
                  alto: z.number().finite().nullable().optional(),
                  medida: texto(300),
                  precioUnitario: z.number().int().positive().max(100_000_000).nullable().optional(),
                  margen: z.number().finite().min(MARGEN_MIN).max(MARGEN_MAX).nullable().optional(),
                  tipoMedida: z.enum(['hoja', 'vano', 'no_especificado']).nullable().optional(),
                  descripcion: texto(300),
                  observaciones: texto(LARGO_OBSERVACION_ITEM),
                  referencias: referenciasSchema.optional(),
                  // Monto 0 o null quitan el descuento; el servidor valida rangos y decimales con mensajes propios.
                  descuento: z
                    .object({ tipo: z.enum(['porcentaje', 'monto']), valor: z.number().finite().min(0).max(100_000_000) })
                    .strict()
                    .nullable()
                    .optional(),
                  // «Cotizar como especial»: sale del catálogo con su precio; null lo devuelve.
                  personalizado: z.object({ familia: familiaSchema }).strict().nullable().optional(),
                  costoFabrica: z.number().int().positive().max(100_000_000).nullable().optional(),
                })
                .strict(),
            })
            .strict(),
        )
        .max(100)
        .optional(),
      descuento: z.number().min(0).max(100).optional(),
      descuentoAutomatico: z.literal(true).optional(),
      flete: z.number().int().min(0).max(100_000_000).optional(),
      fleteLinea: z
        .object({
          descripcion: z.string().max(300).nullable().optional(),
          cantidad: z.number().int().min(1).max(10000).optional(),
          unitario: z.number().int().min(0).max(100_000_000).optional(),
        })
        .strict()
        .nullable()
        .optional(),
      margenCotizacion: z.number().finite().min(MARGEN_MIN).max(MARGEN_MAX).nullable().optional(),
      observaciones: z.string().max(2000).nullable().optional(),
      despacho: despachoSchema.nullable().optional(),
      tarifaStarken: tarifaStarkenSchema.optional(),
    })
    .strict(),
  z.object({
    tipo: z.literal('pago'), id: z.uuid(), actualizada: version,
    monto: z.number().int().positive().max(100_000_000), fecha: z.iso.date().optional(),
    observacion: z.string().max(500).nullable().optional(),
  }).strict(),
  z.object({
    tipo: z.literal('anular_pago'), id: z.uuid(), actualizada: version,
    pagoId: z.string().min(1).max(100), motivo: z.string().max(300).optional(),
  }).strict(),
  z.object({
    tipo: z.literal('despacho'), id: z.uuid(), actualizada: version,
    despacho: despachoSchema,
  }).strict(),
  z.object({ tipo: z.literal('comentario'), id: z.uuid(), actualizada: version, texto: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ tipo: z.literal('comercial'), id: z.uuid(), actualizada: version, estado: z.enum(['seguimiento', 'rechazada']) }).strict(),
  z.object({
    tipo: z.literal('generar_nota'), id: z.uuid(), actualizada: version, fabrica: z.enum(FABRICAS).optional(),
    asignaciones: asignacionesSchema.optional(),
  }).strict(),
  z.object({ tipo: z.literal('asignar_fabricas'), id: z.uuid(), actualizada: version, asignaciones: asignacionesSchema.min(1) }).strict(),
  z.object({
    tipo: z.literal('cambiar_numero'), id: z.uuid(), actualizada: version, documento: z.enum(['cotizacion', 'nota']),
    fabrica: z.enum(FABRICAS).optional(), numero: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }).strict(),
  z.object({
    tipo: z.literal('operacion'), id: z.uuid(), actualizada: version,
    paso: z.enum(['iniciar_produccion', 'produccion_terminada', 'lista_despacho', 'despachada', 'completada']),
    fabrica: z.enum(FABRICAS).optional(),
    despacho: despachoSchema.optional(),
  }).strict(),
  z.object({
    tipo: z.literal('facturacion'), id: z.uuid(), actualizada: version,
    estado: z.enum(['pendiente', 'facturada']), tipoDocumento: z.enum(['factura', 'boleta']).nullable().optional(),
    identificadorExterno: z.string().max(120).nullable().optional(),
    fecha: z.union([z.iso.date(), z.iso.datetime()]).nullable().optional(),
  }).strict(),
]);
const fecha = z.iso.date();
const listadoSchema = z.object({
  vencenPronto: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  saldoPendiente: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  q: z.string().max(200).optional(),
  estado: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(ESTADOS as [string, ...string[]])))
    .optional(),
  desde: fecha.optional(),
  hasta: fecha.optional(),
  comercial: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(Object.keys(etiquetaComercial) as [EstadoComercial, ...EstadoComercial[]])))
    .optional(),
  operativo: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(Object.keys(etiquetaOperativo) as [EstadoOperativo, ...EstadoOperativo[]])))
    .optional(),
  vendedora: z.string().trim().min(1).max(200).optional(),
  pagina: z.coerce.number().int().min(1).max(10000).optional(),
  porPagina: z.coerce.number().int().min(1).max(200).optional(),
  formato: z.literal('csv').optional(),
  /** Parte del CSV (1, 2…) cuando el listado pasa de `MAX_EXPORTACION` filas. */
  parte: z.coerce.number().int().min(1).max(1000).optional(),
});
const papeleraSchema = z.object({
  papelera: z.literal('1'),
  q: z.string().max(200).optional(),
  pagina: z.coerce.number().int().min(1).max(10000).optional(),
  porPagina: z.coerce.number().int().min(1).max(200).optional(),
});
const sinCache = { 'Cache-Control': 'no-store' };

/** Acción reservada a una cuenta administradora: mismo cuerpo y cabeceras que los demás errores. */
const sinPermiso = () =>
  Response.json(
    { error: 'Esta acción requiere una cuenta administradora.', codigo: 'sin_permiso' },
    { status: 403, headers: sinCache },
  );

const NO_CONFIGURADO = 'El cotizador no está listo. Pide a quien administra el cotizador que lo revise.';

function responderError(e: unknown) {
  if (e instanceof ErrorMigracionRequerida || e instanceof ErrorCatalogo) {
    registrarError('api/accion', e);
    return Response.json(
      { error: NO_CONFIGURADO, codigo: 'no_configurado' },
      { status: 503, headers: sinCache },
    );
  }
  if (e instanceof ErrorIA) {
    if (e.tecnico) registrarError('api/accion', `${e.codigo}: ${e.tecnico}`);
    return Response.json({ error: e.message, codigo: e.codigo }, { status: e.status, headers: sinCache });
  }
  if (e instanceof ErrorPdf) registrarError('api/accion', e.tecnico);
  if (e instanceof ErrorUsuario)
    return Response.json(
      { error: e.message, codigo: e.codigo, ...(e.detalle ? { detalle: e.detalle } : {}) },
      { status: e.status, headers: sinCache },
    );
  if (e instanceof ErrorPrecio)
    return Response.json(
      { error: 'Los datos de la cotización no son válidos para calcular montos.', codigo: e.codigo },
      { status: 400, headers: sinCache },
    );
  registrarError('api/accion', e);
  return Response.json(
    { error: 'No se pudo completar la operación. El estado guardado se conserva.', codigo: 'error_interno' },
    { status: 500, headers: sinCache },
  );
}

export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  const url = new URL(req.url);
  try {
    const almacen = new Almacen();
    const id = url.searchParams.get('id');
    if (id !== null) {
      if (!z.uuid().safeParse(id).success)
        return Response.json({ error: 'Solicitud inválida.', codigo: 'solicitud_invalida' }, { status: 400 });
      const cotizacion = almacen.obtener(id);
      if (!cotizacion)
        return Response.json(
          { error: 'No se encontró la cotización.', codigo: 'no_encontrada' },
          { status: 404, headers: sinCache },
        );
      return Response.json(
        { cotizacion, eventos: almacen.eventos(cotizacion.id), asistenteConfigurado: asistenteConfigurado() },
        { headers: sinCache },
      );
    }
    // Papelera del historial: borradores eliminados que se pueden restaurar con `restaurar_borrador`. Paginada y
    // con búsqueda en el servidor, como el listado; dice en cuántos días se vacía.
    if (url.searchParams.has('papelera')) {
      const consulta = papeleraSchema.safeParse(Object.fromEntries(url.searchParams));
      if (!consulta.success)
        return Response.json({ error: 'Solicitud inválida.', codigo: 'solicitud_invalida' }, { status: 400, headers: sinCache });
      const { q, pagina, porPagina } = consulta.data;
      return Response.json(
        { ...almacen.listarPapelera({ q, pagina, porPagina }), plazoDias: DIAS_PAPELERA },
        { headers: sinCache },
      );
    }
    // Número manual al emitir: el diálogo muestra el último usado y el tope antes de enviar. Solo administración,
    // como el número manual mismo.
    if (url.searchParams.has('numeracion')) {
      if (url.searchParams.get('numeracion') !== '1')
        return Response.json({ error: 'Solicitud inválida.', codigo: 'solicitud_invalida' }, { status: 400, headers: sinCache });
      if (sesion.usuario.rol !== 'admin') return sinPermiso();
      return Response.json(almacen.numeracion(), { headers: sinCache });
    }
    // Quienes crearon cotizaciones, para el filtro «Vendedora» del historial.
    if (url.searchParams.has('vendedoras')) {
      if (url.searchParams.get('vendedoras') !== '1')
        return Response.json({ error: 'Solicitud inválida.', codigo: 'solicitud_invalida' }, { status: 400, headers: sinCache });
      return Response.json({ vendedoras: almacen.vendedoras() }, { headers: sinCache });
    }
    const filtros = listadoSchema.safeParse(Object.fromEntries(url.searchParams));
    if (!filtros.success)
      return Response.json({ error: 'Filtros inválidos.', codigo: 'solicitud_invalida' }, { status: 400 });
    const { estado, comercial, operativo, formato, parte, ...resto } = filtros.data;
    const estados = estado as EstadoCotizacion[] | undefined;
    const filtrosListado: FiltrosListado = { ...resto, estados, comerciales: comercial, operativos: operativo };
    if (formato === 'csv') return exportarCsv(almacen, filtrosListado, parte);
    const pagina = almacen.listar(filtrosListado);
    return Response.json({ ...pagina, asistenteConfigurado: asistenteConfigurado() }, { headers: sinCache });
  } catch (e) {
    return responderError(e);
  }
}

/**
 * Listado completo con los filtros vigentes, en CSV (separador «;» y BOM para Excel en español). Hasta
 * `MAX_EXPORTACION` filas por archivo: si el listado es más largo, sin `parte` responde 409 `exportacion_por_partes`
 * con el total y las partes (nunca corta en silencio), y con `parte` entrega ese tramo, en el orden del historial.
 */
function exportarCsv(almacen: Almacen, filtros: FiltrosListado, parte?: number) {
  const porParte = MAX_EXPORTACION;
  const { total } = almacen.listar({ ...filtros, pagina: 1, porPagina: 1 });
  const partes = partesExportacion(total, porParte);
  const detalle = { total, partes, porParte };
  if (parte === undefined && partes > 1)
    return Response.json(
      {
        error: `Hay ${total.toLocaleString('es-CL')} cotizaciones con estos filtros y un archivo admite ${porParte.toLocaleString('es-CL')}. Descárgalas en ${partes} partes o acota las fechas.`,
        codigo: 'exportacion_por_partes',
        detalle,
      },
      { status: 409, headers: sinCache },
    );
  const numeroParte = parte ?? 1;
  if (numeroParte > partes)
    return Response.json(
      { error: `El listado tiene ${partes === 1 ? 'una parte' : `${partes} partes`}.`, codigo: 'solicitud_invalida', detalle },
      { status: 400, headers: sinCache },
    );
  // Páginas que dividen exacto la parte: la parte N empieza en la fila (N − 1) × porParte.
  const porPagina = Math.min(200, porParte);
  const filas: ResumenCotizacion[] = [];
  for (let pagina = ((numeroParte - 1) * porParte) / porPagina + 1; filas.length < porParte; pagina++) {
    const p = almacen.listar({ ...filtros, pagina, porPagina });
    filas.push(...p.cotizaciones);
    if (p.cotizaciones.length < porPagina) break;
  }
  const hoy = fechaLocal(new Date());
  const sufijo = partes > 1 ? `-parte-${numeroParte}-de-${partes}` : '';
  return new Response(`\uFEFF${csvCotizaciones(filas.slice(0, porParte))}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cotizaciones-${hoy}${sufijo}.csv"`,
      'X-Total-Cotizaciones': String(total),
      ...sinCache,
    },
  });
}

export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = accionSchema.safeParse(cuerpo.valor);
  if (!parsed.success)
    return Response.json({ error: 'Solicitud inválida.', codigo: 'solicitud_invalida' }, { status: 400 });
  // Elegir números a mano (al emitir o después, desde el documento) y regenerar PDF es de cuentas administradoras.
  if ((parsed.data.tipo === 'regenerar_pdf' || parsed.data.tipo === 'cambiar_numero' || (parsed.data.tipo === 'emitir' && parsed.data.numero !== undefined)) && sesion.usuario.rol !== 'admin')
    return sinPermiso();
  try {
    const catalogo = await cargarCatalogo();
    let llm: LLM;
    if (parsed.data.tipo !== 'chat') {
      llm = { interpretar: async () => { throw new Error('Esta acción no utiliza el asistente.'); } };
    } else if (llmFijoDePrueba()) {
      const { LLMFijo } = await import('@/asistente/fijo');
      llm = new LLMFijo();
    } else llm = crearLLM();
    const { nombre, email } = sesion.usuario;
    const admin = sesion.usuario.rol === 'admin';
    const inicio = Date.now();
    // Cada mensaje del chat deja en el registro del servidor solo conteos y tiempo, nunca el texto: sirve para
    // observar el asistente en uso (cuántos avisos y de qué tipo).
    const registrarTurno = (d: DiagnosticoTurno) => {
      const avisos: Record<string, number> = {};
      for (const a of d.avisos) avisos[a.categoria] = (avisos[a.categoria] ?? 0) + 1;
      console.info('[asistente]', JSON.stringify({ herramienta: d.herramienta, modelo: d.modelo, respaldo: d.respaldo, avisos, ms: Date.now() - inicio }));
    };
    return Response.json(
      { ...await new Servicio(catalogo, llm, new Almacen(), { nombre, email, admin }, registrarTurno).ejecutar(parsed.data),
        ...(parsed.data.tipo === 'chat' ? { diagnostico: { modelo: llm.modeloEfectivo ?? null, respaldo: llm.usoRespaldo ?? false, ms: Date.now() - inicio } } : {}) },
      {
        headers: sinCache,
      },
    );
  } catch (e) {
    return responderError(e);
  }
}

import { ErrorIA } from '@/asistente/errores';
import { z } from 'zod';
import { Servicio, type DiagnosticoTurno } from '@/servidor/servicio';
import { Almacen, type FiltrosListado } from '@/servidor/almacen';
import { csvCotizaciones, MAX_EXPORTACION } from '@/servidor/exportar';
import { fechaLocal } from '@/negocio/vigencia';
import { MARGEN_MAX, MARGEN_MIN } from '@/negocio/limites';
import { cargarCatalogo, ErrorCatalogo } from '@/servidor/catalogo';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { leerJson } from '@/servidor/cuerpo';
import type { LLM } from '@/asistente/llm';
import { asistenteConfigurado, crearLLM } from '@/servidor/ajustes-ia';
import { ErrorMigracionRequerida } from '@/servidor/base-datos';
import { descuentoItemSchema } from '@/servidor/persistencia-esquemas';
import { ErrorPdf, ErrorUsuario, registrarError } from '@/servidor/errores';
import { ErrorPrecio } from '@/negocio/precios';
import { ESTADOS, type EstadoCotizacion, type ResumenCotizacion } from '@/negocio/estado';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const version = z.iso.datetime();
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
const familiaSchema = z.enum(['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA']);
const solicitudRestaurarSchema = z.object({
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
  observaciones: texto(1000),
  modeloOriginal: texto(300),
  coincidenciaModelo: z.enum(['canonico', 'alias', 'posible']).nullable().optional(),
  fuente: texto(300),
  medidaPorDefecto: z.boolean().optional(),
  personalizado: z.object({ familia: familiaSchema }).strict().nullable().optional(),
  referencias: referenciasSchema.optional(),
  descuento: descuentoItemSchema.nullable().optional(),
}).strict();
const accionSchema = z.discriminatedUnion('tipo', [
  z
    .object({
      tipo: z.literal('agregar_producto'),
      id: z.uuid().optional(),
      actualizada: version.optional(),
      codigo: z.string().trim().min(1).max(80),
      cantidad: z.number().int().min(1).max(10000),
      ancho: z.number().finite().min(0.3).max(3).optional(),
      alto: z.number().finite().min(0.3).max(6).optional(),
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
          madera: z.string().trim().min(1).max(300),
          descripcion: texto(300),
          ancho: z.number().finite().min(0.3).max(3).nullable().optional(),
          alto: z.number().finite().min(0.3).max(6).nullable().optional(),
          tipoMedida: z.enum(['hoja', 'vano', 'no_especificado']).optional(),
          cantidad: z.number().int().min(1).max(10000),
          precioUnitario: z.number().int().positive().max(100_000_000),
          observaciones: texto(1000),
          referencias: referenciasSchema.optional(),
        })
        .strict(),
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
  z.object({ tipo: z.literal('regenerar_pdf'), id: z.uuid(), actualizada: version, documento: z.enum(['cotizacion', 'nota']) }).strict(),
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
  z.object({ tipo: z.literal('duplicar'), id: z.uuid() }).strict(),
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
                  observaciones: texto(1000),
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
  z.object({ tipo: z.literal('generar_nota'), id: z.uuid(), actualizada: version }).strict(),
  z.object({
    tipo: z.literal('operacion'), id: z.uuid(), actualizada: version,
    paso: z.enum(['iniciar_produccion', 'produccion_terminada', 'lista_despacho', 'despachada', 'completada']),
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
  pagina: z.coerce.number().int().min(1).max(10000).optional(),
  porPagina: z.coerce.number().int().min(1).max(200).optional(),
  formato: z.literal('csv').optional(),
});
const modoFijo = () => process.env.NELTUME_LLM === 'fijo' && process.env.NELTUME_TEST_MODE === '1';
const sinCache = { 'Cache-Control': 'no-store' };
const configurado = () => modoFijo() || asistenteConfigurado();

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
        { cotizacion, eventos: almacen.eventos(cotizacion.id), asistenteConfigurado: configurado() },
        { headers: sinCache },
      );
    }
    // Papelera del historial: borradores eliminados que se pueden restaurar con `restaurar_borrador`.
    const papelera = url.searchParams.get('papelera');
    if (papelera !== null) {
      if (papelera !== '1')
        return Response.json({ error: 'Solicitud inválida.', codigo: 'solicitud_invalida' }, { status: 400 });
      return Response.json({ borradores: almacen.papelera() }, { headers: sinCache });
    }
    const filtros = listadoSchema.safeParse(Object.fromEntries(url.searchParams));
    if (!filtros.success)
      return Response.json({ error: 'Filtros inválidos.', codigo: 'solicitud_invalida' }, { status: 400 });
    const { estado, formato, ...resto } = filtros.data;
    const estados = estado as EstadoCotizacion[] | undefined;
    if (formato === 'csv') return exportarCsv(almacen, { ...resto, estados });
    const pagina = almacen.listar({ ...resto, estados });
    return Response.json({ ...pagina, asistenteConfigurado: configurado() }, { headers: sinCache });
  } catch (e) {
    return responderError(e);
  }
}

/** Listado completo con los filtros vigentes, en CSV (separador «;» y BOM para Excel en español). */
function exportarCsv(almacen: Almacen, filtros: FiltrosListado) {
  const filas: ResumenCotizacion[] = [];
  for (let pagina = 1; filas.length < MAX_EXPORTACION; pagina++) {
    const p = almacen.listar({ ...filtros, pagina, porPagina: 200 });
    filas.push(...p.cotizaciones);
    if (filas.length >= p.total || !p.cotizaciones.length) break;
  }
  const hoy = fechaLocal(new Date());
  return new Response(`\uFEFF${csvCotizaciones(filas.slice(0, MAX_EXPORTACION))}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cotizaciones-${hoy}.csv"`,
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
  if ((parsed.data.tipo === 'regenerar_pdf' || (parsed.data.tipo === 'emitir' && parsed.data.numero !== undefined)) && sesion.usuario.rol !== 'admin')
    return Response.json({ error: 'Esta acción requiere una cuenta administradora.' }, { status: 403 });
  try {
    const catalogo = await cargarCatalogo();
    let llm: LLM;
    if (parsed.data.tipo !== 'chat') {
      llm = { interpretar: async () => { throw new Error('Esta acción no utiliza el asistente.'); } };
    } else if (modoFijo()) {
      const { LLMFijo } = await import('@/asistente/fijo');
      llm = new LLMFijo();
    } else llm = crearLLM();
    const { nombre, email } = sesion.usuario;
    const inicio = Date.now();
    // Cada mensaje del chat deja en el registro del servidor solo conteos y tiempo, nunca el texto: sirve para
    // observar el asistente en uso (cuántos avisos y de qué tipo).
    const registrarTurno = (d: DiagnosticoTurno) => {
      const avisos: Record<string, number> = {};
      for (const a of d.avisos) avisos[a.categoria] = (avisos[a.categoria] ?? 0) + 1;
      console.info('[asistente]', JSON.stringify({ herramienta: d.herramienta, modelo: d.modelo, respaldo: d.respaldo, avisos, ms: Date.now() - inicio }));
    };
    return Response.json(
      { ...await new Servicio(catalogo, llm, new Almacen(), { nombre, email }, registrarTurno).ejecutar(parsed.data),
        ...(parsed.data.tipo === 'chat' ? { diagnostico: { modelo: llm.modeloEfectivo ?? null, respaldo: llm.usoRespaldo ?? false, ms: Date.now() - inicio } } : {}) },
      {
        headers: sinCache,
      },
    );
  } catch (e) {
    return responderError(e);
  }
}

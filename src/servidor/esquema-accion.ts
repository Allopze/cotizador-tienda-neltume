import { z } from 'zod';
import { NIVELES_RAZONAMIENTO } from '@/asistente/configuracion';
import { FABRICAS } from '@/negocio/estado';
import { LARGO_OBSERVACION_ITEM, MARGEN_MAX, MARGEN_MIN, rangoMedidas } from '@/negocio/limites';
import { documentoTributarioSchema, facturacionAprobacionSchema, receptorFacturacionEntradaSchema } from './facturacion-esquemas';
import { descuentoItemSchema } from './persistencia-esquemas';

// Esquema de `POST /api/accion`: una acción por `tipo`. Lo usa la ruta y, como JSON Schema, las pruebas de la app de
// Android (tests/esquema-movil.test.ts), que validan cada solicitud que arma la app.

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
export const accionSchema = z.discriminatedUnion('tipo', [
  z
    .object({
      tipo: z.literal('agregar_producto'),
      id: z.uuid().optional(),
      actualizada: version.optional(),
      nuevoId: z.uuid().optional(),
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
      nuevoId: z.uuid().optional(),
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
      razonamiento: z.enum(NIVELES_RAZONAMIENTO).optional(),
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
    tipo: z.literal('duplicar_item'),
    id: z.uuid(),
    actualizada: version,
    indice: z.number().int().nonnegative().max(99),
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
      facturacion: facturacionAprobacionSchema.optional(),
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
  z.object({
    tipo: z.literal('datos_facturacion'),
    id: z.uuid(),
    actualizada: version,
    documento: documentoTributarioSchema.nullable(),
    receptor: receptorFacturacionEntradaSchema.nullable().optional(),
  }).strict(),
]);

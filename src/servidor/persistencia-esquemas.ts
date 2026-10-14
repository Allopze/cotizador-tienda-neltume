import { z } from 'zod';
import { descuentoEsManual, MAX_DESDE_PUERTAS } from '../negocio/descuento-cantidad';
import { calcularVence } from '../negocio/vigencia';
import { REGLAS } from '../negocio/precios';
import { MARGEN_MAX, MARGEN_MIN } from '../negocio/limites';

const MENSAJE_DESDE = `«Desde» debe ser un número entero de puertas, de 2 a ${MAX_DESDE_PUERTAS}.`;
/**
 * Tramo del descuento por cantidad: el mismo al configurarlo en Ajustes, al congelarlo en las reglas de una
 * cotización y al leerlo de la base. Solo fija tipos y rangos gruesos; lo demás (umbral mínimo, máximo de la
 * configuración, umbrales distintos) lo valida `errorTramos`, con mensajes para la persona.
 */
export const tramoDescuentoSchema = z.object({
  desdePuertas: z.number({ error: MENSAJE_DESDE }).int(MENSAJE_DESDE).min(1, MENSAJE_DESDE).max(MAX_DESDE_PUERTAS, MENSAJE_DESDE),
  porcentaje: z
    .number({ error: 'El porcentaje del tramo debe ser un número.' })
    .min(0, 'El porcentaje del tramo debe ser mayor que 0.')
    .max(100, 'El porcentaje de un tramo no puede superar 100 %.'),
});
export const tramosDescuentoSchema = z.array(tramoDescuentoSchema);

/** Descuento especial de un ítem (ver `descuentoItemValido`, que además limita los decimales). */
export const descuentoItemSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('porcentaje'), valor: z.number().positive().max(100) }).strict(),
  z.object({ tipo: z.literal('monto'), valor: z.number().int().positive().max(100_000_000) }).strict(),
]);

const clienteSchema = z.object({
  nombre: z.string().nullable(),
  rut: z.string().nullable(),
  giro: z.string().nullable(),
  telefono: z.string().nullable(),
  direccion: z.string().nullable(),
  comuna: z.string().nullable(),
  proyecto: z.string().nullable(),
});

const solicitudSchema = z.object({
  modelo: z.string().nullable(),
  madera: z.string().nullable(),
  ancho: z.number().nullable(),
  alto: z.number().nullable(),
  medida: z.string().nullable(),
  cantidad: z.number().int().min(1).max(10000).nullable(),
  precioUnitario: z.number().int().positive().max(100_000_000).nullable().optional(),
  margen: z.number().finite().min(MARGEN_MIN).max(MARGEN_MAX).nullable().optional(),
  tipoMedida: z.enum(['hoja', 'vano', 'no_especificado']).nullable().optional(),
  medidaPorDefecto: z.boolean().optional(),
  descripcion: z.string().max(300).nullable().optional(),
  observaciones: z.string().max(1000).nullable().optional(),
  modeloOriginal: z.string().max(300).nullable().optional(),
  coincidenciaModelo: z.enum(['canonico', 'alias', 'posible']).nullable().optional(),
  fuente: z.string().max(300).nullable().optional(),
  personalizado: z.object({ familia: z.enum(['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA']) }).nullable().optional(),
  costoFabrica: z.number().int().positive().max(100_000_000).nullable().optional(),
  referencias: z
    .array(
      z.object({
        archivo: z.string().regex(/^[0-9a-f]{64}\.(jpg|png|webp|pdf)$/),
        nombre: z.string().min(1).max(200),
        tipo: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
        tamano: z.number().int().positive(),
        fecha: z.string(),
      }),
    )
    .max(10)
    .optional(),
  descuento: descuentoItemSchema.nullable().optional(),
});

const productoSchema = z.object({
  codigo: z.string(),
  modelo: z.string(),
  familia: z.enum(['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA']),
  tipo: z.string().nullable(),
  madera: z.string().min(1),
  medida: z.string(),
  anchoMin: z.number().nullable(),
  anchoMax: z.number().nullable(),
  altoMin: z.number().nullable().optional(),
  altoMax: z.number().nullable().optional(),
  largo: z.number(),
  precioNeto: z.number(),
  descripcion: z.string(),
  filaOrigen: z.number().int(),
});

const montosSchema = z.object({
  lineas: z.array(
    z.object({
      producto: productoSchema,
      cantidad: z.number().int().min(1).max(10000),
      precioUnitario: z.number().int(),
      precioFabrica: z.number().finite().nonnegative().optional(),
      margen: z.number().finite().min(MARGEN_MIN).max(MARGEN_MAX).optional(),
      precioCliente: z.number().int().optional(),
      margenPersonalizado: z.boolean().optional(),
      tipoMedida: z.enum(['hoja', 'vano', 'no_especificado']).nullable().optional(),
      observaciones: z.string().max(1000).nullable().optional(),
      descripcionDocumento: z.string().max(300).nullable().optional(),
      total: z.number().int(),
      precioUnitarioPersonalizado: z.number().int().positive().max(100_000_000).nullable().optional(),
      descuentoItem: descuentoItemSchema.nullable().optional(),
      descuentoUnitario: z.number().int().nonnegative().optional(),
      indice: z.number().int().nonnegative().nullable(),
      anchoSolicitado: z.number().nullable(),
      altoSolicitado: z.number().nullable(),
      medidaSolicitada: z.string().nullable(),
    }),
  ),
  subtotal: z.number().int(),
  descuentoPorcentaje: z.number().min(0).max(100),
  descuento: z.number().int().nonnegative(),
  flete: z.number().int().nonnegative(),
  neto: z.number().int(),
  iva: z.number().int(),
  total: z.number().int(),
});

const rechazoSchema = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.literal('faltan_datos'),
    campos: z.array(z.string()),
    disponibles: z.record(z.string(), z.array(z.string())),
  }),
  z.object({ tipo: z.literal('modelo_desconocido'), valor: z.string(), disponibles: z.array(z.string()) }),
  z.object({
    tipo: z.literal('modelo_posible'),
    valor: z.string(),
    sugerido: z.string(),
    disponibles: z.array(z.string()),
    familia: z.enum(['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA']).optional(),
  }),
  z.object({
    tipo: z.literal('madera_desconocida'),
    valor: z.string(),
    disponibles: z.array(z.string()),
    familia: z.enum(['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA']).optional(),
  }),
  z.object({
    tipo: z.literal('madera_no_disponible'),
    valor: z.string(),
    disponibles: z.array(z.string()),
    familia: z.enum(['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA']).optional(),
  }),
  z.object({
    tipo: z.literal('medida_no_disponible'),
    familia: z.enum(['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA']).optional(),
    campo: z.enum(['ancho', 'alto', 'medida']),
    valor: z.union([z.number(), z.string()]),
    disponibles: z.array(z.string()),
    rango: z.object({ min: z.number(), max: z.number() }).optional(),
  }),
  z.object({
    tipo: z.literal('medida_implausible'),
    campo: z.enum(['ancho', 'alto']),
    valor: z.number(),
    disponibles: z.array(z.string()),
  }),
  z.object({ tipo: z.literal('producto_ambiguo'), valor: z.string(), disponibles: z.array(z.string()) }),
  z.object({
    tipo: z.literal('cantidad_invalida'),
    valor: z.number().nullable(),
    disponibles: z.array(z.string()),
  }),
]);

export const cotizacionSchema = z.looseObject({
  id: z.string(),
  numero: z.number().int().nullable(),
  estado: z.enum(['borrador', 'emitida', 'aprobada', 'reemplazada', 'anulada']),
  cliente: clienteSchema,
  solicitudes: z.array(solicitudSchema),
  montos: montosSchema,
  incompletos: z.array(
    z.object({ indice: z.number().int().nonnegative(), rechazo: rechazoSchema, pregunta: z.string() }),
  ),
  historial: z.array(z.object({ rol: z.enum(['usuario', 'asistente']), texto: z.string() })),
  creada: z.string(),
  actualizada: z.string(),
  pdf: z.string().nullable(),
  fechaEmision: z.string().nullable().optional(),
  origen: z.number().int().nullable().optional(),
  vence: z.string().nullable(),
  descuento: z.number().min(0).max(50),
  /** Ausente: el descuento de quien lo guardó antes de existir el automático (se deriva al guardar). */
  descuentoManual: z.boolean().optional(),
  flete: z.number().int().nonnegative(),
  fleteDescripcion: z.string().max(300).nullable().optional(),
  fleteCantidad: z.number().int().min(1).max(10000).optional(),
  /** Margen especial de toda la cotización (fracción); ausente o null usa el de cada categoría. */
  margenCotizacion: z.number().finite().min(MARGEN_MIN).max(MARGEN_MAX).nullable().optional(),
  observaciones: z.string().nullable().optional(),
  despacho: z
    .object({
      direccion: z.string().nullable(),
      transporte: z.string().nullable(),
      entregaComprometida: z.string().nullable(),
    })
    .nullable()
    .optional(),
  reglas: z
    .object({
      ajuste: z.number().finite(),
      iva: z.number().finite(),
      vigenciaDiasHabiles: z.number().int().min(0).max(365),
      descuentoMaximo: z.number().min(0).max(100),
      descuentosPorCantidad: tramosDescuentoSchema.optional(),
      margenes: z.object({
        puertas_solidas_mara_lenga: z.number().finite().min(0).max(MARGEN_MAX),
        puertas_solidas_oregon: z.number().finite().min(0).max(MARGEN_MAX),
        // Categorías posteriores a la primera versión: las cotizaciones congeladas antes no las traen.
        puertas_solidas_rauli: z.number().finite().min(0).max(MARGEN_MAX).optional(),
        puertas_prepintadas: z.number().finite().min(0).max(MARGEN_MAX),
        puertas_enchapadas_mara: z.number().finite().min(0).max(MARGEN_MAX),
        marcos_finger_sin_enchape: z.number().finite().min(0).max(MARGEN_MAX),
        marcos_finger_enchapados: z.number().finite().min(0).max(MARGEN_MAX),
        // Categorías incorporadas después; las cotizaciones antiguas siguen usando su «otros» congelado.
        marcos_solidos_oregon: z.number().finite().min(0).max(MARGEN_MAX).optional(),
        marcos_solidos_lenga: z.number().finite().min(0).max(MARGEN_MAX).optional(),
        accesorios_madera_solida: z.number().finite().min(0).max(MARGEN_MAX).optional(),
        otros: z.number().finite().min(0).max(MARGEN_MAX),
      }).strict().optional(),
    })
    .optional(),
  creadaPor: z.string().nullable(),
  emitidaPor: z.string().nullable(),
  aprobadaPor: z.string().nullable(),
  anuladaPor: z.string().nullable(),
  fechaAnulacion: z.string().nullable(),
  motivoAnulacion: z.string().nullable(),
  reemplazadaPor: z.number().int().nullable(),
  versionCatalogo: z.string().nullable(),
  nota: z
    .object({
      numero: z.number().int(),
      pdf: z.string(),
      montos: montosSchema,
      fecha: z.string(),
      despacho: z.object({
        direccion: z.string().nullable(),
        transporte: z.string().nullable(),
        entregaComprometida: z.string().nullable().optional(),
      }),
      observaciones: z.string().nullable().optional(),
      anulada: z.boolean(),
    })
    .nullable(),
  estadoComercial: z.enum(['pendiente', 'enviada', 'seguimiento', 'aprobada', 'rechazada', 'vendida']).optional(),
  estadoOperativo: z.enum(['sin_pedido', 'anticipo_pagado', 'pedido_generado', 'en_produccion', 'produccion_terminada', 'saldo_pendiente', 'pagada', 'lista_despacho', 'despachada', 'completada']).optional(),
  pagos: z.array(z.object({
    id: z.string(), fecha: z.string(), monto: z.number().int().positive(), observacion: z.string().nullable(), usuario: z.string().nullable(),
  })).optional(),
  comentariosInternos: z.array(z.object({
    id: z.string(), fecha: z.string(), texto: z.string().min(1).max(2000), usuario: z.string().nullable(),
  })).optional(),
  facturacion: z.object({
    estado: z.enum(['pendiente', 'facturada']), tipo: z.enum(['factura', 'boleta']).nullable(),
    identificadorExterno: z.string().nullable(), fecha: z.string().nullable(),
  }).optional(),
});

export const estadoPersistidoSchema = z.object({
  siguienteCotizacion: z.number().int().positive(),
  siguienteNota: z.number().int().positive(),
  cotizaciones: z.array(cotizacionSchema),
});

export const catalogoPersistidoSchema = z.object({
  fuente: z.string(),
  sha256: z.string().min(1),
  fecha: z.string(),
  productos: z.array(productoSchema).min(1),
});

type Registro = Record<string, unknown>;
const esRegistro = (v: unknown): v is Registro => typeof v === 'object' && v !== null && !Array.isArray(v);
const completarMontos = (m: unknown) =>
  esRegistro(m)
    ? {
        subtotal: m.neto,
        descuentoPorcentaje: 0,
        descuento: 0,
        flete: 0,
        ...m,
        lineas: Array.isArray(m.lineas)
          ? m.lineas.map((l) => ({
              indice: null,
              anchoSolicitado: null,
              altoSolicitado: null,
              medidaSolicitada: null,
              precioFabrica: esRegistro(l) && esRegistro(l.producto) ? l.producto.precioNeto : undefined,
              margen: esRegistro(l) && esRegistro(l.producto) && typeof l.producto.precioNeto === 'number' && l.producto.precioNeto > 0 && typeof l.precioUnitario === 'number' ? l.precioUnitario / l.producto.precioNeto - 1 : 0,
              precioCliente: esRegistro(l) && typeof l.precioUnitario === 'number' ? l.precioUnitario : undefined,
              margenPersonalizado: false,
              tipoMedida: null,
              observaciones: null,
              descripcionDocumento: null,
              ...l,
            }))
          : m.lineas,
      }
    : m;

/**
 * Completa un estado JSON anterior al esquema 6 con los valores por omisión de los campos nuevos
 * (giro, vigencia, descuento, flete, autoría, medidas pedidas, despacho). No altera datos existentes.
 */
export function completarEstadoLegado(entrada: unknown): unknown {
  if (!esRegistro(entrada) || !Array.isArray(entrada.cotizaciones)) return entrada;
  return {
    ...entrada,
    cotizaciones: entrada.cotizaciones.map((q) => {
      if (!esRegistro(q)) return q;
      const fechaEmision = typeof q.fechaEmision === 'string' ? q.fechaEmision : null;
      return {
        vence: fechaEmision ? calcularVence(fechaEmision) : null,
        descuento: 0,
        flete: 0,
        fleteDescripcion: null,
        fleteCantidad: 1,
        margenCotizacion: null,
        observaciones: null,
        despacho: null,
        reglas: REGLAS,
        creadaPor: null,
        emitidaPor: null,
        aprobadaPor: null,
        anuladaPor: null,
        fechaAnulacion: null,
        motivoAnulacion: null,
        reemplazadaPor: null,
        versionCatalogo: null,
        ...q,
        // Un descuento guardado antes del automático lo fijó una persona (así lo persiste también `guardar`).
        descuentoManual: descuentoEsManual({
          descuento: typeof q.descuento === 'number' ? q.descuento : undefined,
          descuentoManual: typeof q.descuentoManual === 'boolean' ? q.descuentoManual : undefined,
        }),
        estadoComercial:
          typeof q.estadoComercial === 'string'
            ? q.estadoComercial
            : q.estado === 'emitida' ? 'enviada' : q.estado === 'aprobada' ? 'aprobada' : 'pendiente',
        estadoOperativo: typeof q.estadoOperativo === 'string' ? q.estadoOperativo : q.nota ? 'pedido_generado' : 'sin_pedido',
        pagos: Array.isArray(q.pagos) ? q.pagos : [],
        comentariosInternos: Array.isArray(q.comentariosInternos) ? q.comentariosInternos : [],
        facturacion: esRegistro(q.facturacion)
          ? q.facturacion
          : { estado: 'pendiente', tipo: null, identificadorExterno: null, fecha: null },
        cliente: esRegistro(q.cliente) ? { giro: null, ...q.cliente } : q.cliente,
        solicitudes: Array.isArray(q.solicitudes)
          ? q.solicitudes.map((s) => esRegistro(s) ? {
              tipoMedida: null, descripcion: null, observaciones: null, margen: null,
              modeloOriginal: null, coincidenciaModelo: null, fuente: null, ...s,
            } : s)
          : q.solicitudes,
        montos: completarMontos(q.montos),
        nota: esRegistro(q.nota)
          ? {
              despacho: { direccion: null, transporte: null, entregaComprometida: null },
              observaciones: null,
              anulada: false,
              ...q.nota,
              montos: completarMontos(q.nota.montos),
            }
          : (q.nota ?? null),
      };
    }),
  };
}

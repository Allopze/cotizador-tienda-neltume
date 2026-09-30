import { z } from 'zod';
import { calcularVence } from '../negocio/vigencia';
import { REGLAS } from '../negocio/precios';

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
  margen: z.number().finite().min(-0.5).max(5).nullable().optional(),
  tipoMedida: z.enum(['hoja', 'vano', 'no_especificado']).nullable().optional(),
  descripcion: z.string().max(300).nullable().optional(),
  observaciones: z.string().max(1000).nullable().optional(),
  modeloOriginal: z.string().max(300).nullable().optional(),
  coincidenciaModelo: z.enum(['canonico', 'alias', 'posible']).nullable().optional(),
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
      margen: z.number().finite().min(-0.5).max(5).optional(),
      precioCliente: z.number().int().optional(),
      margenPersonalizado: z.boolean().optional(),
      tipoMedida: z.enum(['hoja', 'vano', 'no_especificado']).nullable().optional(),
      observaciones: z.string().max(1000).nullable().optional(),
      total: z.number().int(),
      precioUnitarioPersonalizado: z.number().int().positive().max(100_000_000).nullable().optional(),
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
  z.object({ tipo: z.literal('madera_desconocida'), valor: z.string(), disponibles: z.array(z.string()) }),
  z.object({ tipo: z.literal('madera_no_disponible'), valor: z.string(), disponibles: z.array(z.string()) }),
  z.object({
    tipo: z.literal('medida_no_disponible'),
    campo: z.enum(['ancho', 'alto', 'medida']),
    valor: z.union([z.number(), z.string()]),
    disponibles: z.array(z.string()),
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
  descuento: z.number().min(0).max(100),
  flete: z.number().int().nonnegative(),
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
      margenes: z.object({
        puertas_solidas_mara_lenga: z.number().finite().min(0).max(5),
        puertas_solidas_oregon: z.number().finite().min(0).max(5),
        puertas_prepintadas: z.number().finite().min(0).max(5),
        puertas_enchapadas_mara: z.number().finite().min(0).max(5),
        marcos_finger_sin_enchape: z.number().finite().min(0).max(5),
        marcos_finger_enchapados: z.number().finite().min(0).max(5),
        otros: z.number().finite().min(0).max(5),
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
              modeloOriginal: null, coincidenciaModelo: null, ...s,
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

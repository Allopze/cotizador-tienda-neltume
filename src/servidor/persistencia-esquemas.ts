import { z } from 'zod';
import { calcularVence } from '../negocio/vigencia';

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
      total: z.number().int(),
      indice: z.number().int().nonnegative().nullable(),
      anchoSolicitado: z.number().nullable(),
      altoSolicitado: z.number().nullable(),
      medidaSolicitada: z.string().nullable(),
    }),
  ),
  subtotal: z.number().int(),
  descuentoPorcentaje: z.number().min(0).max(50),
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
  descuento: z.number().min(0).max(50),
  flete: z.number().int().nonnegative(),
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
      despacho: z.object({ direccion: z.string().nullable(), transporte: z.string().nullable() }),
      anulada: z.boolean(),
    })
    .nullable(),
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
        creadaPor: null,
        emitidaPor: null,
        aprobadaPor: null,
        anuladaPor: null,
        fechaAnulacion: null,
        motivoAnulacion: null,
        reemplazadaPor: null,
        versionCatalogo: null,
        ...q,
        cliente: esRegistro(q.cliente) ? { giro: null, ...q.cliente } : q.cliente,
        montos: completarMontos(q.montos),
        nota: esRegistro(q.nota)
          ? {
              despacho: { direccion: null, transporte: null },
              anulada: false,
              ...q.nota,
              montos: completarMontos(q.nota.montos),
            }
          : (q.nota ?? null),
      };
    }),
  };
}

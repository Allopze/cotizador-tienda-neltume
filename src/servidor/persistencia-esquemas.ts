import { z } from 'zod';

const clienteSchema = z.object({
  nombre: z.string().nullable(),
  rut: z.string().nullable(),
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
  cantidad: z.number().int().nullable(),
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
      cantidad: z.number().int(),
      precioUnitario: z.number().int(),
      total: z.number().int(),
    }),
  ),
  neto: z.number().int(),
  iva: z.number().int(),
  total: z.number().int(),
});

const rechazoSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('faltan_datos'), campos: z.array(z.string()), disponibles: z.record(z.string(), z.array(z.string())) }),
  z.object({ tipo: z.literal('modelo_desconocido'), valor: z.string(), disponibles: z.array(z.string()) }),
  z.object({ tipo: z.literal('madera_desconocida'), valor: z.string(), disponibles: z.array(z.string()) }),
  z.object({ tipo: z.literal('madera_no_disponible'), valor: z.string(), disponibles: z.array(z.string()) }),
  z.object({
    tipo: z.literal('medida_no_disponible'),
    campo: z.enum(['ancho', 'alto', 'medida']),
    valor: z.union([z.number(), z.string()]),
    disponibles: z.array(z.string()),
  }),
  z.object({ tipo: z.literal('cantidad_invalida'), valor: z.number().nullable(), disponibles: z.array(z.string()) }),
]);

const cotizacionSchema = z.looseObject({
  id: z.string(),
  numero: z.number().int().nullable(),
  estado: z.enum(['borrador', 'emitida', 'aprobada']),
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
  nota: z
    .object({ numero: z.number().int(), pdf: z.string(), montos: montosSchema, fecha: z.string() })
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

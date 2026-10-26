import { z } from 'zod';
import { LARGO_OBSERVACION_ITEM } from '../negocio/limites';
import { FABRICAS } from '../negocio/estado';
const texto = z.string().max(300).nullable();
/**
 * Fábrica que hace el ítem, solo si la persona la dijo («las Coz Coz van a Santiago»); el servidor la anula si el
 * nombre de la fábrica no está escrito en la conversación.
 */
const fabricaSchema = z.enum(FABRICAS).nullable();
/**
 * Precio de una unidad que la persona escribió para un producto («a $450.000 + IVA»). Igual que el flete, el
 * servidor solo lo acepta si está escrito en la conversación; lo que no está en el catálogo pasa a ser un pedido
 * especial con ese precio.
 */
const precioSchema = z
  .object({
    valor: z.number().nullable(),
    iva: z.enum(['neto', 'incluido']).nullable(),
  })
  .strict();
/**
 * Descuento especial que la persona pidió para un producto («15 % de descuento», «rebájale $20.000 c/u»): un
 * porcentaje o un monto por unidad. Como el precio, el servidor solo lo acepta si la cifra está escrita en la
 * conversación; null lo quita.
 */
const descuentoSchema = z
  .object({
    tipo: z.enum(['porcentaje', 'monto']),
    valor: z.number().nullable(),
  })
  .strict();
export const solicitudSchema = z
  .object({
    modelo: texto,
    madera: texto,
    ancho: z.number().nullable(),
    alto: z.number().nullable(),
    medida: texto,
    tipoMedida: z.enum(['hoja', 'vano', 'no_especificado']).nullable().optional(),
    descripcion: texto.optional(),
    observaciones: z.string().max(LARGO_OBSERVACION_ITEM).nullable().optional(),
    // Se acepta cualquier número y el servidor anula cantidades no enteras o fuera de 1–10.000 (con aviso).
    cantidad: z.number().nullable(),
    /** Frase exacta del mensaje que describe el ítem; el servidor la muestra junto al ítem. */
    fuente: texto.optional(),
    precio: precioSchema.nullable().optional(),
    descuento: descuentoSchema.nullable().optional(),
    fabrica: fabricaSchema.optional(),
    /**
     * Ítem libre: algo que no es carpintería (una bebida, la instalación, un servicio) que se cotiza con su nombre,
     * cantidad y precio, sin madera, medidas ni fábrica. El servidor lo ignora si el nombre existe en el catálogo.
     */
    libre: z.boolean().nullable().optional(),
  })
  .strict();
export const clienteSchema = z
  .object({
    nombre: texto,
    rut: texto,
    // Opcional para no rechazar respuestas que no lo incluyan: si falta se conserva el giro previo.
    giro: texto.optional(),
    telefono: texto,
    direccion: texto,
    comuna: texto,
    proyecto: texto,
  })
  .strict();
const actualizarSchema = z
  .object({ items: z.array(solicitudSchema).max(100), cliente: clienteSchema })
  .strict();
const solicitudCambioSchema = z
  .object({
    modelo: texto.optional(),
    madera: texto.optional(),
    ancho: z.number().nullable().optional(),
    alto: z.number().nullable().optional(),
    medida: texto.optional(),
    cantidad: z.number().nullable().optional(),
    tipoMedida: z.enum(['hoja', 'vano', 'no_especificado']).nullable().optional(),
    descripcion: texto.optional(),
    observaciones: z.string().max(LARGO_OBSERVACION_ITEM).nullable().optional(),
    fuente: texto.optional(),
    precio: precioSchema.nullable().optional(),
    descuento: descuentoSchema.nullable().optional(),
    fabrica: fabricaSchema.optional(),
  })
  .strict();
const clienteCambioSchema = z
  .object({
    nombre: texto.optional(),
    rut: texto.optional(),
    giro: texto.optional(),
    telefono: texto.optional(),
    direccion: texto.optional(),
    comuna: texto.optional(),
    proyecto: texto.optional(),
  })
  .strict();
/**
 * Línea de flete pedida en el chat. Es la única cifra en pesos que la IA devuelve: el servidor solo la acepta
 * si está escrita en la conversación y la guarda neta según `iva`.
 */
const fleteChatSchema = z
  .object({
    descripcion: texto,
    cantidad: z.number().nullable(),
    /** Valor de una unidad, tal como lo escribió la persona. */
    valor: z.number().nullable(),
    /** «+ IVA» o «neto» es "neto"; «IVA incluido» o «con IVA» es "incluido"; null si no lo dice. */
    iva: z.enum(['neto', 'incluido']).nullable(),
  })
  .strict();
export type FleteChat = z.infer<typeof fleteChatSchema>;
const modificarSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            indice: z.number().int().nonnegative(),
            cambios: solicitudCambioSchema,
          })
          .strict(),
      )
      .max(100)
      .optional(),
    agregar: z.array(solicitudSchema).max(100).optional(),
    quitar: z.array(z.number().int().nonnegative()).max(100).optional(),
    cliente: clienteCambioSchema.optional(),
    /** Agrega o cambia la línea de flete; null la quita. */
    flete: fleteChatSchema.nullable().optional(),
  })
  .strict();
export type ModificacionCotizacion = z.infer<typeof modificarSchema>;
/**
 * Lo que se le pide al modelo: en cada ítem nuevo debe decidir tipoMedida y fuente (null si no aplica).
 * Como campos opcionales, algunos modelos los omitían y se perdía «medida de vano». El servidor sigue
 * aceptando su ausencia (`modificarSchema`).
 */
export const modificarPedidoSchema = modificarSchema.extend({
  agregar: z
    .array(
      solicitudSchema.extend({
        tipoMedida: z.enum(['hoja', 'vano', 'no_especificado']).nullable(),
        fuente: texto,
      }),
    )
    .max(100)
    .optional(),
});
export const aprobarSchema = z.object({ numero: z.number().int().positive() }).strict();
/**
 * Reparto de los ítems de borrador.items entre las fábricas; null quita la fábrica asignada. `modelo` repite el del
 * ítem de ese índice: el servidor lo compara para no cruzar ítems (asignar en el orden en que se nombraron).
 */
export const asignarFabricasSchema = z
  .object({
    asignaciones: z
      .array(
        z.object({ indice: z.number().int().nonnegative(), modelo: z.string().max(300), fabrica: fabricaSchema }).strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
/**
 * Nuevo número de la cotización o de una de sus notas de pedido (la de `fabrica`). `actual` es el número que tiene
 * hoy ese documento si la persona lo nombra; null es el de la cotización de la conversación. El servidor exige que
 * los números estén escritos en el mensaje y pide confirmarlo.
 */
export const cambiarNumeroSchema = z
  .object({
    documento: z.enum(['cotizacion', 'nota']),
    fabrica: fabricaSchema,
    actual: z.number().int().positive().nullable(),
    numero: z.number().int().positive(),
  })
  .strict();
export const responderSchema = z.object({ texto: z.string().min(1).max(2000) }).strict();
/** Extracción de atributos para un producto nuevo. El precio nunca se solicita al LLM. */
export const atributosProductoSchema = z
  .object({
    modelo: z.string().trim().min(1).max(100).nullable(),
    familia: z.enum(['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA']).nullable(),
    madera: z.string().trim().min(1).max(80).nullable(),
    tipo: z.string().trim().max(120).nullable(),
    medida: z.string().trim().max(60).nullable(),
    anchoMin: z.number().finite().nullable(),
    anchoMax: z.number().finite().nullable(),
    largo: z.number().finite().nullable(),
  })
  .strict();
export const salidaSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('actualizar_cotizacion'), input: actualizarSchema }).strict(),
  z.object({ name: z.literal('modificar_cotizacion'), input: modificarSchema }).strict(),
  z.object({ name: z.literal('aprobar_cotizacion'), input: aprobarSchema }).strict(),
  z.object({ name: z.literal('asignar_fabricas'), input: asignarFabricasSchema }).strict(),
  z.object({ name: z.literal('cambiar_numero'), input: cambiarNumeroSchema }).strict(),
  z.object({ name: z.literal('responder'), input: responderSchema }).strict(),
]);

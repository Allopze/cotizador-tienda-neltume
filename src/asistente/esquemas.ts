import { z } from 'zod';
const texto = z.string().max(300).nullable();
export const solicitudSchema = z
  .object({
    modelo: texto,
    madera: texto,
    ancho: z.number().nullable(),
    alto: z.number().nullable(),
    medida: texto,
    tipoMedida: z.enum(['hoja', 'vano', 'no_especificado']).nullable().optional(),
    descripcion: texto.optional(),
    observaciones: z.string().max(1000).nullable().optional(),
    // Se acepta cualquier número y el servidor anula cantidades no enteras o fuera de 1–10.000 (con aviso).
    cantidad: z.number().nullable(),
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
export const actualizarSchema = z
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
    observaciones: z.string().max(1000).nullable().optional(),
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
export const modificarSchema = z
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
  })
  .strict();
export type ModificacionCotizacion = z.infer<typeof modificarSchema>;
export const aprobarSchema = z.object({ numero: z.number().int().positive() }).strict();
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
  z.object({ name: z.literal('responder'), input: responderSchema }).strict(),
]);

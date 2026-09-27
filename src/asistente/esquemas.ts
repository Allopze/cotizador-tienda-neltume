import { z } from 'zod';
const texto = z.string().max(300).nullable();
export const solicitudSchema = z
  .object({
    modelo: texto,
    madera: texto,
    ancho: z.number().nullable(),
    alto: z.number().nullable(),
    medida: texto,
    cantidad: z.number().nullable(),
  })
  .strict();
export const clienteSchema = z
  .object({ nombre: texto, rut: texto, telefono: texto, direccion: texto, comuna: texto, proyecto: texto })
  .strict();
export const actualizarSchema = z
  .object({ items: z.array(solicitudSchema).max(100), cliente: clienteSchema })
  .strict();
export const aprobarSchema = z.object({ numero: z.number().int().positive() }).strict();
export const responderSchema = z.object({ texto: z.string().min(1).max(2000) }).strict();
export const salidaSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('actualizar_cotizacion'), input: actualizarSchema }).strict(),
  z.object({ name: z.literal('aprobar_cotizacion'), input: aprobarSchema }).strict(),
  z.object({ name: z.literal('responder'), input: responderSchema }).strict(),
]);

import { z } from 'zod';

export const documentoTributarioSchema = z.enum(['boleta', 'factura']);

/** Receptor persistido en SQLite / respaldos JSON. */
export const receptorFacturacionPersistidoSchema = z.object({
  razonSocial: z.string().nullable(),
  rut: z.string().nullable(),
  giro: z.string().nullable(),
  direccion: z.string().nullable(),
  comuna: z.string().nullable(),
  correo: z.string().nullable(),
});

/** Entrada de receptor en acciones de API (cada campo admite máximo 300 caracteres). */
export const receptorFacturacionEntradaSchema = z
  .object({
    razonSocial: z.string().max(300).nullable().optional(),
    rut: z.string().max(300).nullable().optional(),
    giro: z.string().max(300).nullable().optional(),
    direccion: z.string().max(300).nullable().optional(),
    comuna: z.string().max(300).nullable().optional(),
    correo: z.string().max(300).nullable().optional(),
  })
  .strict();

export const facturacionAprobacionSchema = z
  .object({
    documento: documentoTributarioSchema.nullable(),
    receptor: receptorFacturacionEntradaSchema.nullable().optional(),
  })
  .strict();

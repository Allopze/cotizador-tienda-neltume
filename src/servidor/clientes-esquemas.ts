import { z } from 'zod';
import { documentoTributarioSchema, receptorFacturacionEntradaSchema } from './facturacion-esquemas';

const textoCorto = z.string().max(300).nullable().optional();

const camposCliente = {
  nombre: z.string().max(300),
  rut: textoCorto,
  giro: textoCorto,
  telefono: textoCorto,
  direccion: textoCorto,
  comuna: textoCorto,
  correo: textoCorto,
  notas: z.string().max(1000).nullable().optional(),
  documentoHabitual: documentoTributarioSchema.nullable().optional(),
  receptorFacturacion: receptorFacturacionEntradaSchema.nullable().optional(),
};

export const crearClienteSchema = z.object(camposCliente).strict();

export const editarClienteSchema = z
  .object({
    id: z.uuid(),
    actualizado: z.iso.datetime(),
    ...camposCliente,
  })
  .strict();

export const eliminarClienteSchema = z
  .object({
    id: z.uuid(),
    actualizado: z.iso.datetime(),
  })
  .strict();

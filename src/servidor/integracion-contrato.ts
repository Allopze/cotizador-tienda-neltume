import { z } from 'zod';
import type { Fabrica } from '../negocio/estado';

/**
 * Contrato v1 con la aplicación de la fábrica (docs/integracion-fabrica.md). Las claves van en inglés, como el
 * contrato acordado; los valores (modelos, maderas, descripciones) van tal como los guarda el cotizador. La tienda
 * valida cada mensaje con estos esquemas antes de encolarlo: un pedido que no cumple no sale.
 */
export const VERSION_CONTRATO = '1.0';
export const ORIGEN_INTEGRACION = 'neltume-store';
export const RUTA_PEDIDOS = '/api/integrations/neltume/orders';
/** Adjuntos (referencias del cliente) por su sha256; se suben antes del pedido que los nombra. */
export const rutaAdjunto = (sha256: string) => `/api/integrations/neltume/attachments/${sha256}`;

/** Código de cada fábrica en el contrato; nunca se deduce del nombre que se muestra. */
export const CODIGO_FABRICA: Record<Fabrica, string> = { panguipulli: 'PANGUIPULLI', santiago: 'SANTIAGO' };

export const EVENTOS = ['order.ready', 'order.cancelled'] as const;
export type EventoIntegracion = (typeof EVENTOS)[number];

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const texto = (max: number) => z.string().max(max);
const textoNulo = (max: number) => z.string().max(max).nullable();
const pesos = z.number().int().min(0).max(10_000_000_000);

export const referenciaSchema = z
  .object({
    attachmentId: sha256,
    filename: texto(200),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    sizeBytes: z.number().int().positive(),
  })
  .strict();

export const itemSchema = z
  .object({
    /** N° de la fila en ambos PDF (1, 2, 3…). */
    lineNumber: z.number().int().positive(),
    /** Posición del ítem en la cotización (desde 0); null en líneas sin ítem de origen. */
    sourceItemIndex: z.number().int().nonnegative().nullable(),
    productCode: texto(80),
    /** «MOL-O-3-A · 0,80–0,85 × 2 m»: el producto base del catálogo; null en un pedido especial. */
    catalogReference: textoNulo(200),
    isCustom: z.boolean(),
    family: z.enum(['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA']),
    model: texto(300),
    wood: textoNulo(300),
    productType: textoNulo(300),
    /** Lo que imprimen los PDF: la descripción escrita a mano o el producto con la medida pedida. */
    description: texto(600),
    descriptionEdited: z.boolean(),
    quantity: z.number().int().positive(),
    dimensions: z
      .object({
        widthMm: z.number().int().positive().nullable(),
        heightMm: z.number().int().positive().nullable(),
        /** Largo de un marco, moldura o pieza T. */
        lengthMm: z.number().int().positive().nullable(),
        /** Escuadría o sección pedida («2X4»), en marcos, molduras y piezas T. */
        section: textoNulo(80),
        measureType: z.enum(['hoja', 'vano', 'no_especificado']).nullable(),
        /** La medida solicitada como la imprime la nota («820 × 2000 mm (Hoja)»). */
        requested: textoNulo(200),
      })
      .strict(),
    observations: textoNulo(2000),
    references: z.array(referenciaSchema).max(10),
  })
  .strict();

export const pedidoSchema = z
  .object({
    orderNumber: texto(20),
    orderDate: z.iso.datetime(),
    quoteNumber: z.number().int().positive(),
    approvedBy: textoNulo(200),
    issuedBy: textoNulo(200),
    customer: z
      .object({
        name: textoNulo(300),
        taxId: textoNulo(300),
        businessActivity: textoNulo(300),
        phone: textoNulo(300),
        address: textoNulo(300),
        commune: textoNulo(300),
        project: textoNulo(300),
      })
      .strict(),
    delivery: z
      .object({
        address: textoNulo(300),
        carrier: textoNulo(120),
        destination: textoNulo(300),
        committedDelivery: textoNulo(120),
      })
      .strict(),
    items: z.array(itemSchema).min(1).max(100),
    notes: texto(4000),
    /** Las otras notas de pedido de la misma cotización (a otras fábricas), como las nombra el PDF. */
    relatedOrders: z
      .array(z.object({ factoryCode: texto(40), orderNumber: texto(20), itemCount: z.number().int().nonnegative() }).strict())
      .max(10),
    /**
     * Lo comercial va aparte de los ítems, para que la fábrica lo guarde lejos de la producción: precios de fábrica
     * netos, como el documento comercial. `unitPrice` y `lineTotal` son null en un pedido especial «Por definir».
     */
    commercial: z
      .object({
        currency: z.literal('CLP'),
        basis: z.literal('factory_price_net'),
        lines: z
          .array(z.object({ lineNumber: z.number().int().positive(), unitPrice: pesos.nullable(), lineTotal: pesos.nullable() }).strict())
          .max(100),
        subtotal: pesos,
        discount: pesos,
        net: pesos,
        vatRate: z.number().min(0).max(1),
        vat: pesos,
        total: pesos,
      })
      .strict(),
  })
  .strict();
export type PedidoFabrica = z.infer<typeof pedidoSchema>;
export type ItemFabrica = z.infer<typeof itemSchema>;

export const cancelacionSchema = z
  .object({
    orderNumber: texto(20),
    quoteNumber: z.number().int().positive().nullable(),
    cancelledAt: z.iso.datetime(),
    cancelledBy: textoNulo(200),
    reason: textoNulo(300),
  })
  .strict();
export type CancelacionFabrica = z.infer<typeof cancelacionSchema>;

export const documentoSchema = z
  .object({
    filename: texto(200),
    mimeType: z.literal('application/pdf'),
    contentBase64: z.string().min(1),
    sha256,
  })
  .strict();

/** El mensaje completo que se firma y se envía. `order` y `documents` van en order.ready; `cancellation`, en order.cancelled. */
export const mensajeSchema = z
  .object({
    schemaVersion: z.literal(VERSION_CONTRATO),
    eventType: z.enum(EVENTOS),
    eventId: z.uuid(),
    source: z.literal(ORIGEN_INTEGRACION),
    sourceOrderId: z.string().min(1).max(100),
    sourceOrderRevision: z.number().int().positive(),
    destinationFactoryCode: texto(40),
    issuedAt: z.iso.datetime(),
    order: pedidoSchema.optional(),
    cancellation: cancelacionSchema.optional(),
    documents: z.object({ commercial: documentoSchema, production: documentoSchema }).strict().optional(),
  })
  .strict()
  .refine((m) => (m.eventType === 'order.ready' ? !!m.order && !!m.documents && !m.cancellation : !!m.cancellation && !m.order && !m.documents), {
    message: 'order.ready lleva order y documents; order.cancelled, solo cancellation.',
  });
export type MensajeFabrica = z.infer<typeof mensajeSchema>;

/**
 * Confirmación de la fábrica (2xx). Solo cuenta como entregado si nombra el mismo evento: la fábrica responde 2xx
 * recién cuando guardó el pedido. «duplicate» es un reenvío de algo que ya tenía (misma clave de idempotencia).
 */
export const confirmacionSchema = z
  .object({
    status: z.enum(['accepted', 'duplicate']),
    eventId: z.string().max(100),
    factoryOrderId: z.string().max(200).optional(),
    receivedAt: z.string().max(40).optional(),
  })
  .passthrough();

/** Cuerpo de un error de la fábrica; solo se guarda para diagnosticar. */
export const errorFabricaSchema = z
  .object({ error: z.object({ code: z.string().max(80), message: z.string().max(500).optional() }).passthrough() })
  .passthrough();

/** Clave de idempotencia estable por pedido y revisión: un reintento nunca crea otro pedido en la fábrica. */
export const claveIdempotencia = (sourceOrderId: string, fabrica: Fabrica, revision: number) =>
  `${ORIGEN_INTEGRACION}:${sourceOrderId}:${CODIGO_FABRICA[fabrica]}:${revision}`;

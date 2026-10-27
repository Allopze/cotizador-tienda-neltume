import type Database from 'better-sqlite3';
import type { Cotizacion, Fabrica, NotaPedido } from '../negocio/estado';
import { REGLAS, type Linea } from '../negocio/precios';
import { metros } from '../catalogo/resolver';
import { CODIGO_PERSONALIZADO } from '../negocio/personalizados';
import { documentoNota } from './documentos';
import { descripcionImpresa, filasDocumento, medidaPedida, plantilla, referenciaCatalogo, type DocumentoPdf } from './pdf';
import {
  CODIGO_FABRICA,
  cancelacionSchema,
  pedidoSchema,
  type CancelacionFabrica,
  type ItemFabrica,
  type PedidoFabrica,
} from './integracion-contrato';

/** Adjunto que se sube antes del pedido: el archivo de la referencia del cliente, por su contenido. */
export interface AdjuntoFabrica {
  attachmentId: string;
  /** Nombre en `data/referencias`. */
  archivo: string;
  mimeType: string;
  sizeBytes: number;
}

/** Lo que se encola con un order.ready: el pedido estructurado, la orden de trabajo y lo que hay que adjuntar. */
export interface EnvioPreparado {
  fabrica: Fabrica;
  pedido: PedidoFabrica;
  /** PDF de la nota de pedido ya emitido (`data/pdf`): el documento comercial, tal cual. */
  archivoComercial: string;
  /** HTML de la orden de trabajo, con la misma copia de la cotización y la misma fecha que la nota. */
  htmlProduccion: string;
  adjuntos: AdjuntoFabrica[];
}

const mm = (m: number | null, familia: Linea['producto']['familia']) =>
  m === null ? null : Math.round((metros(m, familia) ?? m) * 1000);

/** Un ítem del pedido: lo mismo que imprime la fila de la nota, en campos. */
function item(q: Cotizacion, l: Linea, lineNumber: number): ItemFabrica {
  const familia = l.producto.familia;
  // El reparto ya deja fuera los ítems libres: uno aquí es un error, no algo que la fábrica deba recibir.
  if (familia === 'OTRO') throw new Error(`El ítem libre «${l.producto.modelo}» no va en un pedido a fábrica.`);
  const s = l.indice != null ? q.solicitudes[l.indice] : undefined;
  const puerta = l.producto.familia === 'PUERTA';
  const especial = l.producto.codigo === CODIGO_PERSONALIZADO;
  return {
    lineNumber,
    sourceItemIndex: l.indice,
    productCode: l.producto.codigo,
    catalogReference: especial ? null : referenciaCatalogo(l),
    isCustom: especial,
    family: familia,
    model: l.producto.modelo,
    wood: l.producto.madera || null,
    productType: l.producto.tipo,
    description: descripcionImpresa(l),
    descriptionEdited: !!l.descripcionDocumento,
    quantity: l.cantidad,
    dimensions: {
      widthMm: puerta ? mm(l.anchoSolicitado, 'PUERTA') : null,
      heightMm: puerta ? mm(l.altoSolicitado, 'PUERTA') : null,
      lengthMm: puerta ? null : mm(l.altoSolicitado, l.producto.familia),
      section: puerta ? null : (l.medidaSolicitada ?? (l.producto.medida || null)),
      measureType: l.tipoMedida ?? null,
      requested: medidaPedida(l),
    },
    observations: l.observaciones ?? null,
    references: (s?.referencias ?? []).map((r) => ({
      attachmentId: r.archivo.slice(0, 64),
      filename: r.nombre,
      mimeType: r.tipo,
      sizeBytes: r.tamano,
    })),
  };
}

/**
 * Pedido de la nota `nota` de `q` para su fábrica: las mismas filas, en el mismo orden, que la nota de pedido
 * (incluidos los especiales «Por definir»), la obra y el despacho con que se generó, y aparte los
 * precios de fábrica. Lanza si el resultado no cumple el contrato: un pedido incompleto no se envía.
 */
export function pedidoDeNota(q: Cotizacion, nota: NotaPedido): PedidoFabrica {
  if (!nota.fabrica || q.numero === null) throw new Error('La nota no tiene fábrica o la cotización no tiene número.');
  const doc = documentoNota(q, nota);
  const filas = filasDocumento(q, doc);
  return pedidoSchema.parse({
    orderNumber: String(nota.numero),
    orderDate: nota.fecha,
    quoteNumber: q.numero,
    // Datos personales: la fábrica no guarda los del cliente final ni las cuentas de la tienda (decisión D1 del ADR-0023
    // de la fábrica), así que no viajan. Van null, sin cambiar la forma del contrato; el PDF comercial los conserva.
    approvedBy: null,
    issuedBy: null,
    customer: {
      name: null,
      taxId: null,
      businessActivity: null,
      phone: null,
      address: null,
      commune: null,
      project: q.cliente.proyecto,
    },
    delivery: {
      address: nota.despacho.direccion,
      carrier: nota.despacho.transporte,
      destination: nota.despacho.destino ?? null,
      committedDelivery: nota.despacho.entregaComprometida ?? null,
    },
    items: filas.map(({ l }, i) => item(q, l, i + 1)),
    notes: nota.observaciones ?? '',
    relatedOrders: (doc.otrasNotas ?? []).map((o) => ({
      factoryCode: o.fabrica ? CODIGO_FABRICA[o.fabrica] : 'DESCONOCIDA',
      orderNumber: String(o.numero),
      itemCount: o.items,
    })),
    commercial: {
      currency: 'CLP',
      basis: 'factory_price_net',
      lines: filas.map(({ l, definida }, i) => ({
        lineNumber: i + 1,
        unitPrice: definida ? l.precioUnitario : null,
        lineTotal: definida ? l.total : null,
      })),
      subtotal: nota.montos.subtotal,
      discount: nota.montos.descuento,
      net: nota.montos.neto,
      vatRate: (q.reglas ?? REGLAS).iva,
      vat: nota.montos.iva,
      total: nota.montos.total,
    },
  });
}

/** Adjuntos de un pedido, sin repetir un archivo que comparten varios ítems. */
function adjuntosDe(q: Cotizacion, pedido: PedidoFabrica): AdjuntoFabrica[] {
  const vistos = new Map<string, AdjuntoFabrica>();
  for (const it of pedido.items) {
    const s = it.sourceItemIndex !== null ? q.solicitudes[it.sourceItemIndex] : undefined;
    for (const r of s?.referencias ?? [])
      vistos.set(r.archivo.slice(0, 64), { attachmentId: r.archivo.slice(0, 64), archivo: r.archivo, mimeType: r.tipo, sizeBytes: r.tamano });
  }
  return [...vistos.values()];
}

/**
 * Prepara el envío de una nota de pedido ya generada: el pedido y la orden de trabajo salen de la misma cotización y
 * la misma nota que el PDF comercial, así que los dos documentos son la misma versión del pedido. `doc` es el
 * documento con que se imprimió la nota, si se conoce (al generarla); si no, el que la reconstruye.
 */
export async function prepararEnvio(
  q: Cotizacion,
  nota: NotaPedido,
  { db, doc }: { db?: Database.Database; doc?: DocumentoPdf } = {},
): Promise<EnvioPreparado> {
  const pedido = pedidoDeNota(q, nota);
  const htmlProduccion = await plantilla(q, { ...(doc ?? documentoNota(q, nota)), produccion: true }, db);
  return { fabrica: nota.fabrica!, pedido, archivoComercial: nota.pdf, htmlProduccion, adjuntos: adjuntosDe(q, pedido) };
}

/** Datos del aviso de anulación de la nota de `q` para su fábrica. */
export function cancelacionDeNota(q: Cotizacion, nota: NotaPedido): CancelacionFabrica {
  return cancelacionSchema.parse({
    orderNumber: String(nota.numero),
    quoteNumber: q.numero,
    cancelledAt: q.fechaAnulacion ?? new Date().toISOString(),
    cancelledBy: null,
    reason: q.motivoAnulacion,
  });
}

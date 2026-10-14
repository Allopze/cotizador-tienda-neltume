import { etiquetaEstado, etiquetaOperativo, type ResumenCotizacion } from '../negocio/estado';
import { fechaLocal } from '../negocio/vigencia';

/**
 * Filas por archivo CSV. Un listado más largo no se corta: se descarga por partes de este tamaño (`partesExportacion`),
 * o se acota con los filtros de fecha.
 */
export const MAX_EXPORTACION = 5000;

/** Cuántos archivos hacen falta para `total` filas, con `porParte` filas cada uno (al menos uno, aunque esté vacío). */
export function partesExportacion(total: number, porParte = MAX_EXPORTACION) {
  return Math.max(1, Math.ceil(total / porParte));
}

/**
 * Saldo y facturación solo tienen sentido en una venta: una cotización aprobada. En un borrador, una emitida, una
 * reemplazada o una anulada nadie debe ese total ni hay nada que facturar, así que esas celdas quedan vacías.
 */
const deVenta = <T>(q: ResumenCotizacion, valor: () => T) => (q.estado === 'aprobada' ? valor() : null);

const COLUMNAS: [string, (q: ResumenCotizacion) => string | number | null][] = [
  ['N°', (q) => q.numero],
  ['Estado', (q) => etiquetaEstado[q.estado]],
  ['Fecha', (q) => fechaLocal(q.fecha)],
  ['Emisión', (q) => (q.fechaEmision ? fechaLocal(q.fechaEmision) : null)],
  ['Vence', (q) => q.vence],
  ['Vencida', (q) => (q.vencida ? 'Sí' : '')],
  ['Cliente', (q) => q.cliente.nombre],
  ['RUT', (q) => q.cliente.rut],
  ['Giro', (q) => q.cliente.giro],
  ['Teléfono', (q) => q.cliente.telefono],
  ['Dirección', (q) => q.cliente.direccion],
  ['Comuna', (q) => q.cliente.comuna],
  ['Proyecto', (q) => q.cliente.proyecto],
  ['Productos', (q) => q.productos],
  ['Ítems', (q) => q.items],
  ['Pendientes', (q) => q.pendientes],
  ['Subtotal', (q) => q.subtotal],
  ['Descuento %', (q) => (q.descuento ? String(q.descuento).replace('.', ',') : 0)],
  ['Descuento $', (q) => q.descuentoMonto],
  ['Flete', (q) => q.flete],
  ['Neto', (q) => q.neto],
  ['IVA', (q) => q.iva],
  ['Total', (q) => q.total],
  ['Pagado', (q) => q.pagado ?? 0],
  ['Saldo', (q) => deVenta(q, () => q.saldoPendiente ?? Math.max(0, q.total - (q.pagado ?? 0)))],
  ['Operación', (q) => etiquetaOperativo[q.estadoOperativo ?? 'sin_pedido']],
  ['Facturación', (q) => deVenta(q, () => (q.facturacion?.estado === 'facturada' ? 'Facturada' : 'Pendiente'))],
  ['Revisión de', (q) => q.origen],
  ['Reemplazada por', (q) => q.reemplazadaPor],
  ['Nota de pedido', (q) => (q.nota ? `${q.nota.numero}${q.nota.anulada ? ' (anulada)' : ''}` : null)],
  ['Creada por', (q) => q.creadaPor],
  ['Emitida por', (q) => q.emitidaPor],
  ['Aprobada por', (q) => q.aprobadaPor],
  ['Anulada por', (q) => q.anuladaPor],
];

/**
 * Celda CSV: comillas cuando hace falta y un apóstrofo delante de textos que una planilla
 * interpretaría como fórmula (=, +, -, @), para que abrir el archivo nunca ejecute nada.
 */
function celda(valor: string | number | null) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') return String(valor);
  const seguro = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
  return /[";\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

export function csvCotizaciones(filas: ResumenCotizacion[]) {
  return [
    COLUMNAS.map(([titulo]) => celda(titulo)).join(';'),
    ...filas.map((q) => COLUMNAS.map(([, valor]) => celda(valor(q))).join(';')),
  ].join('\r\n');
}

import type { Cliente, SolicitudItem } from '../catalogo/tipos';
import type { Rechazo } from '../catalogo/resolver';
import type { Montos } from './precios';
export interface Mensaje {
  rol: 'usuario' | 'asistente';
  texto: string;
}
/**
 * borrador → emitida → aprobada. Una emitida pasa a «reemplazada» cuando se emite su revisión o se
 * aprueba otra de la misma serie; «anulada» es definitiva. Solo el borrador se edita directamente.
 */
export type EstadoCotizacion = 'borrador' | 'emitida' | 'aprobada' | 'reemplazada' | 'anulada';
export const ESTADOS: readonly EstadoCotizacion[] = [
  'borrador',
  'emitida',
  'aprobada',
  'reemplazada',
  'anulada',
];
export interface Despacho {
  direccion: string | null;
  transporte: string | null;
}
export interface NotaPedido {
  numero: number;
  pdf: string;
  montos: Montos;
  fecha: string;
  despacho: Despacho;
  /** La cotización aprobada se anuló después: la nota ya no es válida para fábrica. */
  anulada: boolean;
}
export interface Cotizacion {
  id: string;
  numero: number | null;
  estado: EstadoCotizacion;
  cliente: Cliente;
  solicitudes: SolicitudItem[];
  montos: Montos;
  incompletos: { indice: number; rechazo: Rechazo; pregunta: string }[];
  historial: Mensaje[];
  creada: string;
  /** Versión para control optimista: toda acción que modifica la cotización debe enviarla. */
  actualizada: string;
  pdf: string | null;
  /** Ausente en estados guardados antes de registrar la fecha de emisión. */
  fechaEmision?: string | null;
  /** Número de la cotización emitida de la que se derivó esta revisión. */
  origen?: number | null;
  /** Último día de validez (YYYY-MM-DD, inclusive), 10 días hábiles después de la emisión. */
  vence: string | null;
  /** Porcentaje 0–50 aplicado al neto del cliente antes del IVA. */
  descuento: number;
  /** Flete neto en pesos enteros; se suma como fila propia. */
  flete: number;
  creadaPor: string | null;
  emitidaPor: string | null;
  aprobadaPor: string | null;
  anuladaPor: string | null;
  fechaAnulacion: string | null;
  motivoAnulacion: string | null;
  /** Número de la revisión o cotización aprobada que dejó a esta como «reemplazada». */
  reemplazadaPor: number | null;
  /** Versión del catálogo (sha256:fecha) con la que se calcularon los montos al emitir. */
  versionCatalogo: string | null;
  nota: NotaPedido | null;
}
/** Fila del listado: sin historial, solicitudes ni líneas. */
export interface ResumenCotizacion {
  id: string;
  numero: number | null;
  estado: EstadoCotizacion;
  cliente: Cliente;
  subtotal: number;
  /** Porcentaje de descuento. */
  descuento: number;
  /** Monto descontado en pesos. */
  descuentoMonto: number;
  flete: number;
  neto: number;
  iva: number;
  total: number;
  /** Cantidad de ítems pedidos y de ítems pendientes. */
  items: number;
  pendientes: number;
  /** Texto breve: «3 × MOLCO pino, 2 × MARCO». */
  productos: string;
  creada: string;
  actualizada: string;
  fechaEmision: string | null;
  vence: string | null;
  vencida: boolean;
  origen: number | null;
  reemplazadaPor: number | null;
  pdf: string | null;
  creadaPor: string | null;
  emitidaPor: string | null;
  aprobadaPor: string | null;
  anuladaPor: string | null;
  fechaAnulacion: string | null;
  nota: { numero: number; pdf: string; fecha: string; anulada: boolean } | null;
}
export interface Estado {
  siguienteCotizacion: number;
  siguienteNota: number;
  cotizaciones: Cotizacion[];
}
export const CORRELATIVO_COTIZACION = 323;
export const CORRELATIVO_NOTA = 1;
export const estadoInicial = (): Estado => ({
  siguienteCotizacion: CORRELATIVO_COTIZACION,
  siguienteNota: CORRELATIVO_NOTA,
  cotizaciones: [],
});
export const etiquetaEstado: Record<EstadoCotizacion, string> = {
  borrador: 'Borrador',
  emitida: 'Emitida',
  aprobada: 'Aprobada',
  reemplazada: 'Reemplazada',
  anulada: 'Anulada',
};
/** Solo un borrador admite cambios directos; editar una emitida crea (o reutiliza) su revisión. */
export const esEditable = (q: Pick<Cotizacion, 'estado'>) =>
  q.estado === 'borrador' || q.estado === 'emitida';

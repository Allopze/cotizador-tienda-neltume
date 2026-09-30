import type { Cliente, SolicitudItem } from '../catalogo/tipos';
import type { Rechazo } from '../catalogo/resolver';
import type { Montos, ReglasComerciales } from './precios';
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
  /** Texto libre o fecha acordada con el cliente. */
  entregaComprometida?: string | null;
  destino?: string | null;
  valor?: number | null;
}
export type EstadoComercial = 'pendiente' | 'enviada' | 'seguimiento' | 'aprobada' | 'rechazada' | 'vendida';
export type EstadoOperativo =
  | 'sin_pedido'
  | 'anticipo_pagado'
  | 'pedido_generado'
  | 'en_produccion'
  | 'produccion_terminada'
  | 'saldo_pendiente'
  | 'pagada'
  | 'lista_despacho'
  | 'despachada'
  | 'completada';
export interface Pago {
  id: string;
  fecha: string;
  monto: number;
  observacion: string | null;
  usuario: string | null;
}
export interface ComentarioInterno {
  id: string;
  fecha: string;
  texto: string;
  usuario: string | null;
}
export interface Facturacion {
  estado: 'pendiente' | 'facturada';
  tipo: 'factura' | 'boleta' | null;
  identificadorExterno: string | null;
  fecha: string | null;
}
export interface NotaPedido {
  numero: number;
  pdf: string;
  montos: Montos;
  fecha: string;
  despacho: Despacho;
  observaciones?: string | null;
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
  /** Texto comercial o instrucciones que deben acompañar al documento. */
  observaciones?: string | null;
  /** Datos de despacho que se pueden preparar antes de aprobar. */
  despacho?: Despacho | null;
  /** Reglas congeladas para que una cotización no cambie si luego se ajusta la configuración. */
  reglas?: ReglasComerciales;
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
  /** Fases comerciales y operativas separadas del estado del documento. */
  estadoComercial?: EstadoComercial;
  estadoOperativo?: EstadoOperativo;
  pagos?: Pago[];
  comentariosInternos?: ComentarioInterno[];
  facturacion?: Facturacion;
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
  /** Fecha que describe el documento (anulación, aprobación, emisión o última edición); ordena el listado. */
  fecha: string;
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
  estadoComercial?: EstadoComercial;
  estadoOperativo?: EstadoOperativo;
  pagado?: number;
  saldoPendiente?: number;
  porcentajePagado?: number;
  pagos?: number;
}
/** Entrada del registro de actividad de una cotización. */
export interface EventoCotizacion {
  fecha: string;
  usuario: string | null;
  tipo: TipoEvento;
  detalle: string | null;
}
export type TipoEvento =
  | 'creada'
  | 'revision'
  | 'duplicada'
  | 'modificada'
  | 'emitida'
  | 'aprobada'
  | 'anulada'
  | 'reemplazada'
  | 'desvinculada'
  | 'pago_registrado'
  | 'comentario'
  | 'seguimiento'
  | 'produccion'
  | 'produccion_terminada'
  | 'nota_generada'
  | 'despachada'
  | 'lista_despacho'
  | 'completada'
  | 'facturada';
export const etiquetaEvento: Record<TipoEvento, string> = {
  creada: 'Creada',
  revision: 'Revisión creada',
  duplicada: 'Duplicada',
  modificada: 'Modificada',
  emitida: 'Emitida',
  aprobada: 'Aprobada',
  anulada: 'Anulada',
  reemplazada: 'Reemplazada',
  desvinculada: 'Queda como cotización nueva',
  pago_registrado: 'Pago registrado',
  comentario: 'Comentario interno',
  seguimiento: 'Seguimiento actualizado',
  produccion: 'Producción iniciada',
  produccion_terminada: 'Producción terminada',
  nota_generada: 'Nota de pedido generada',
  despachada: 'Despachada',
  lista_despacho: 'Lista para despacho',
  completada: 'Completada',
  facturada: 'Facturación actualizada',
};
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

import type { Cliente, SolicitudItem } from '../catalogo/tipos';
import type { Rechazo } from '../catalogo/resolver';
import type { Montos, ReglasComerciales } from './precios';
import { ANTICIPO_MINIMO, ANTICIPO_TEXTO } from './limites';
import { fechaLocal } from './vigencia';
export interface Mensaje {
  rol: 'usuario' | 'asistente';
  texto: string;
}
/** Turnos previos al borrador que viajan como contexto del siguiente mensaje. */
const MAX_CHARLA = 12;
/**
 * Mientras no hay borrador, cada intercambio (sin pedido todavía) se suma a la charla que acompaña al mensaje
 * siguiente. La usan la pantalla y las evaluaciones, para que la IA vea lo mismo en ambas.
 */
export const sumarCharla = (charla: Mensaje[], historial: Mensaje[]) =>
  [...charla, ...historial.slice(-2)].slice(-MAX_CHARLA);
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
export const etiquetaComercial: Record<EstadoComercial, string> = {
  pendiente: 'Pendiente',
  enviada: 'Enviada',
  seguimiento: 'En seguimiento',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada / cancelada',
  vendida: 'Vendida',
};
export type EstadoOperativo =
  | 'sin_pedido'
  | 'anticipo_pagado'
  | 'pedido_generado'
  | 'en_produccion'
  | 'saldo_pendiente'
  | 'pagada'
  | 'lista_despacho'
  | 'despachada'
  | 'completada';
/**
 * Estado operativo tal como se guardó. «produccion_terminada» nunca se asignó (el paso «Producción terminada»
 * deja el pedido en «saldo_pendiente» o «pagada») y ya no existe: un dato antiguo que lo traiga se lee como
 * «en_produccion», el paso del que salía. Lo demás pasa igual (lo valida quien lo lee).
 */
export const leerEstadoOperativo = <T,>(valor: T): T | 'en_produccion' =>
  valor === 'produccion_terminada' ? 'en_produccion' : valor;
export const etiquetaOperativo: Record<EstadoOperativo, string> = {
  sin_pedido: 'Sin nota de pedido',
  anticipo_pagado: `${ANTICIPO_TEXTO} pagado`,
  pedido_generado: 'Nota de pedido generada',
  en_produccion: 'En producción',
  saldo_pendiente: 'Saldo pendiente',
  pagada: '100 % pagado',
  lista_despacho: 'Lista para despacho',
  despachada: 'Despachada',
  completada: 'Completada',
};
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
/** «Pendiente de facturación» o «Facturada · Factura N° 123». */
export function etiquetaFacturacion(f: Facturacion | undefined) {
  if (f?.estado !== 'facturada') return 'Pendiente de facturación';
  const documento = f.tipo === 'boleta' ? 'Boleta' : 'Factura';
  return `Facturada · ${documento}${f.identificadorExterno ? ` N° ${f.identificadorExterno}` : ''}`;
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
  /**
   * La persona fijó el descuento a mano: no cambia con las líneas hasta que restaure el automático. Si es
   * falso (o falta), `descuento` es el del tramo por cantidad que corresponde a las puertas de la cotización
   * (0 si sus reglas no tienen tramos).
   */
  descuentoManual?: boolean;
  /** Flete neto en pesos enteros (total de su línea): se suma al neto y no lleva descuento. */
  flete: number;
  /** Texto de la línea de flete; null (o ausente) usa el que se arma con el destino y el transportista. */
  fleteDescripcion?: string | null;
  /** Unidades de la línea de flete (1 si falta); el unitario es `flete / fleteCantidad`. */
  fleteCantidad?: number;
  /**
   * Margen especial de toda la cotización, como fracción (0,42 = 42 %). Pasa por encima del margen de la
   * categoría y por debajo del de cada línea; null (o ausente) usa el de cada categoría. La nota de pedido
   * no lo usa: se calcula a precio de fábrica.
   */
  margenCotizacion?: number | null;
  /** Texto comercial o instrucciones que deben acompañar al documento. */
  observaciones?: string | null;
  /** Datos de despacho que se pueden preparar antes de aprobar. */
  despacho?: Despacho | null;
  /** Reglas congeladas para que una cotización no cambie si luego se ajusta la configuración. */
  reglas?: ReglasComerciales;
  creadaPor: string | null;
  emitidaPor: string | null;
  aprobadaPor: string | null;
  /**
   * Instante en que el cliente la aprobó (ISO). Ausente antes de v23 o si se quitó la aprobación: entonces vale
   * la fecha del último evento «aprobada».
   */
  fechaAprobacion?: string | null;
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
/** Anticipo que habilita la nota de pedido y la producción: la mitad del total, redondeada hacia arriba. */
export const anticipoMinimo = (total: number) => Math.ceil(total * ANTICIPO_MINIMO);
/** «Otro» solo indica que falta el nombre: no identifica a quien lleva el pedido. */
export const sinTransportista = (transporte: string | null | undefined) =>
  !transporte?.trim() || transporte.trim().toLowerCase() === 'otro';
/** Código que muestra la línea de flete junto a los productos. */
export const CODIGO_FLETE = 'FLETE';
export const cantidadFlete = (q: Pick<Cotizacion, 'fleteCantidad'>) =>
  q.fleteCantidad && q.fleteCantidad > 0 ? q.fleteCantidad : 1;
/** El servidor guarda siempre `flete = cantidad × unitario`, así que la división es exacta. */
export const unitarioFlete = (q: Pick<Cotizacion, 'flete' | 'fleteCantidad'>) =>
  Math.round(q.flete / cantidadFlete(q));
/** Descripción de la línea de flete: la escrita por la persona o «Flete / despacho a Temuco · Starken». */
export function descripcionFlete(q: Pick<Cotizacion, 'fleteDescripcion' | 'despacho'>) {
  if (q.fleteDescripcion?.trim()) return q.fleteDescripcion.trim();
  const destino = q.despacho?.destino?.trim();
  const transporte = q.despacho?.transporte;
  return [
    `Flete / despacho${destino ? ` a ${destino}` : ''}`,
    !sinTransportista(transporte) && transporte!.trim(),
  ]
    .filter(Boolean)
    .join(' · ');
}
type FaseOperativa = Pick<Cotizacion, 'estado' | 'estadoOperativo'>;
/** Un pago se anula mientras la operación no llegue a «Lista para despacho» (ahí el saldo ya está pagado). */
export const pagoAnulable = (q: FaseOperativa) =>
  q.estado === 'aprobada' && !['lista_despacho', 'despachada', 'completada'].includes(q.estadoOperativo ?? '');
/** Suma de los pagos registrados. */
export const totalPagado = (q: Pick<Cotizacion, 'pagos'>) => (q.pagos ?? []).reduce((s, p) => s + p.monto, 0);
/**
 * ¿Se puede anular? Solo una emitida o una aprobada que no se despachó, completó ni facturó. Con `ok` trae lo
 * pagado (para advertirlo: anular no devuelve pagos); sin `ok`, el motivo que se muestra en vez del botón.
 * El servidor aplica esta misma regla.
 */
export function puedeAnular(
  q: Pick<Cotizacion, 'estado' | 'numero' | 'estadoOperativo' | 'facturacion' | 'pagos' | 'reemplazadaPor'>,
): { ok: true; pagado: number } | { ok: false; motivo: string } {
  if (q.estado === 'anulada') return { ok: false, motivo: `La cotización N° ${q.numero} ya está anulada.` };
  if (q.estado === 'borrador') return { ok: false, motivo: 'Un borrador no se anula: elimínalo.' };
  if (q.estado === 'reemplazada')
    return { ok: false, motivo: `La cotización N° ${q.numero} fue reemplazada y ya no está vigente.` };
  if (q.estadoOperativo === 'despachada' || q.estadoOperativo === 'completada' || q.facturacion?.estado === 'facturada')
    return { ok: false, motivo: 'No se puede anular una cotización despachada, completada o facturada.' };
  return { ok: true, pagado: totalPagado(q) };
}
/**
 * Días (YYYY-MM-DD, hora de Chile) que admite la fecha de un pago o de una factura: desde el día de la aprobación
 * (`aprobacion`, ISO; null si no se conoce) hasta hoy. Sirve de `min`/`max` del campo y el servidor lo exige.
 */
export const rangoFechaOperacion = (aprobacion: string | null | undefined, ahora: Date = new Date()) => ({
  min: aprobacion ? fechaLocal(aprobacion) : null,
  max: fechaLocal(ahora),
});
/** Con la cotización aprobada, los datos de despacho se editan hasta registrar el despacho. */
export const despachoEditable = (q: FaseOperativa) =>
  q.estado === 'aprobada' && !['despachada', 'completada'].includes(q.estadoOperativo ?? '');
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
  facturacion?: Pick<Facturacion, 'estado'>;
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
  | 'pago_anulado'
  | 'despacho_actualizado'
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
  pago_anulado: 'Pago anulado',
  despacho_actualizado: 'Despacho actualizado',
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

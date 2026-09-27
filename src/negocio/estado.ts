import type { Cliente, SolicitudItem } from '../catalogo/tipos';
import type { Rechazo } from '../catalogo/resolver';
import type { Montos } from './precios';
export interface Mensaje {
  rol: 'usuario' | 'asistente';
  texto: string;
}
export interface Cotizacion {
  id: string;
  numero: number | null;
  estado: 'borrador' | 'emitida' | 'aprobada';
  cliente: Cliente;
  solicitudes: SolicitudItem[];
  montos: Montos;
  incompletos: { indice: number; rechazo: Rechazo; pregunta: string }[];
  historial: Mensaje[];
  creada: string;
  actualizada: string;
  pdf: string | null;
  /** Ausente en estados guardados antes de registrar la fecha de emisión. */
  fechaEmision?: string | null;
  /** Número de la cotización emitida de la que se derivó esta revisión. */
  origen?: number | null;
  nota: { numero: number; pdf: string; montos: Montos; fecha: string } | null;
}
export interface Estado {
  siguienteCotizacion: number;
  siguienteNota: number;
  cotizaciones: Cotizacion[];
}
export const CORRELATIVO_COTIZACION = 323;
export const estadoInicial = (): Estado => ({
  siguienteCotizacion: CORRELATIVO_COTIZACION,
  siguienteNota: 1,
  cotizaciones: [],
});
export const etiquetaEstado: Record<Cotizacion['estado'], string> = {
  borrador: 'Borrador',
  emitida: 'Emitida',
  aprobada: 'Aprobada',
};

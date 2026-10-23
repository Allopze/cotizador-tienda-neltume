import { anticipoMinimo, type EstadoCotizacion, type EstadoOperativo } from './estado';

/** El recorrido de un pedido, de la cotización a la puerta entregada y facturada. */
export const PASOS = ['Borrador', 'Emitida', 'Aprobada', 'Anticipo', 'Notas', 'Producción', 'Despacho', 'Facturada'] as const;
export type Paso = (typeof PASOS)[number];

export interface DatosPasos {
  estado: EstadoCotizacion;
  operacion: EstadoOperativo;
  /** Notas de pedido vigentes (sin anular). */
  notas: number;
  pagado: number;
  total: number;
  facturada: boolean;
}

export interface AvancePedido {
  /** Cada paso, en el orden de `PASOS`: cumplido o no. */
  hechos: boolean[];
  /** Primer paso sin cumplir: el que sigue (`PASOS.length` si el pedido está completo). */
  actual: number;
}

const EN_PRODUCCION: EstadoOperativo[] = ['saldo_pendiente', 'pagada', 'lista_despacho', 'despachada', 'completada'];

/**
 * Qué pasos del recorrido lleva cumplidos una cotización. Una anulada o reemplazada ya no avanza: quien la muestra
 * usa su estado, no esta línea. El anticipo se mide con lo pagado (la mitad del total), igual que la nota de pedido.
 */
export function avancePedido(d: DatosPasos): AvancePedido {
  const aprobada = d.estado === 'aprobada';
  const hechos = [
    d.estado !== 'borrador',
    d.estado !== 'borrador' && d.estado !== 'anulada' && d.estado !== 'reemplazada' ? true : false,
    aprobada,
    aprobada && d.total > 0 && d.pagado >= anticipoMinimo(d.total),
    aprobada && d.notas > 0,
    aprobada && EN_PRODUCCION.includes(d.operacion),
    aprobada && (d.operacion === 'despachada' || d.operacion === 'completada'),
    aprobada && d.facturada,
  ];
  const sin = hechos.findIndex((h) => !h);
  return { hechos, actual: sin === -1 ? PASOS.length : sin };
}

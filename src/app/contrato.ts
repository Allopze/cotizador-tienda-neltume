// Formas de las respuestas de la API usadas por la interfaz (copiadas de src/servidor: no se importa
// código de servidor en el cliente). Ver contrato-api del backend v6.
import type { Cotizacion, EventoCotizacion, ResumenCotizacion } from '@/negocio/estado';
import type { Familia, Producto, ReferenciaItem, SolicitudItem } from '@/catalogo/tipos';
import type { Cliente } from '@/catalogo/tipos';
import type { OpcionCotizacion } from '@/servidor/referencias';
import type { TarifaStarkenAplicada } from '@/negocio/starken';

export interface ItemCambio {
  indice: number;
  descripcion: string;
}
export interface CambiosCotizacion {
  agregados: ItemCambio[];
  quitados: ItemCambio[];
  modificados: { antes: ItemCambio; despues: ItemCambio }[];
  cliente: (keyof Cliente)[];
}
export interface Resultado {
  cotizacion: Cotizacion;
  archivo?: string;
  seleccion?: OpcionCotizacion[];
  confirmar?: { id: string; numero: number; actualizada: string; vence: string | null; vencida: boolean };
  avisos?: string[];
  cambios?: CambiosCotizacion;
  eliminada?: true;
  /** Respuesta sin pedido desde una pantalla nueva: no se guardó un borrador. */
  efimera?: true;
}
export interface Listado {
  cotizaciones: ResumenCotizacion[];
  total: number;
  pagina: number;
  porPagina: number;
  asistenteConfigurado: boolean;
}
export interface Detalle {
  cotizacion: Cotizacion;
  eventos: EventoCotizacion[];
  asistenteConfigurado: boolean;
}
export type ProductoManual = Producto & {
  creada: string;
  creadaPor: string | null;
  actualizada: string | null;
};
export type ProductoAdministrable = Producto & {
  fuente: 'planilla' | 'manual';
  creada: string | null;
  creadaPor: string | null;
  actualizada: string | null;
};
export interface CambiosEdicion {
  cliente?: Partial<Record<keyof Cliente, string | null>>;
  cantidades?: { indice: number; cantidad: number }[];
  items?: {
    indice: number;
    cambios: Partial<Pick<SolicitudItem, 'modelo' | 'madera' | 'ancho' | 'alto' | 'medida' | 'precioUnitario' | 'margen' | 'tipoMedida' | 'descripcion' | 'observaciones' | 'referencias' | 'descuento'>>;
  }[];
  /** Fija el descuento a mano: deja de seguir al descuento por cantidad. */
  descuento?: number;
  /** Restaura el descuento por cantidad (automático). */
  descuentoAutomatico?: true;
  flete?: number;
  /** Línea de flete del detalle; null la quita. */
  fleteLinea?: { descripcion?: string | null; cantidad?: number; unitario?: number } | null;
  /** Fracción (0,42 = 42 %); null vuelve al margen de cada categoría. */
  margenCotizacion?: number | null;
  observaciones?: string | null;
  despacho?: Partial<Despacho> | null;
  /** Tarifa de Starken elegida por la persona: el valor de despacho es su neto y la actividad la registra. */
  tarifaStarken?: TarifaStarkenAplicada;
}
export interface ProductoElegido {
  codigo: string;
  cantidad: number;
  ancho?: number;
  alto?: number;
  tipoMedida?: 'hoja' | 'vano' | 'no_especificado';
}
/** Producto del catálogo tal como lo muestra la consulta: con el precio unitario de la cotización. */
export interface ProductoConsulta {
  codigo: string;
  modelo: string;
  familia: Producto['familia'];
  tipo: string | null;
  madera: string;
  medida: string;
  largo: number;
  anchoMin?: number | null;
  anchoMax?: number | null;
  altoMin?: number | null;
  altoMax?: number | null;
  descripcion: string;
  unitario: number;
  manual: boolean;
}
export interface Despacho {
  direccion?: string | null;
  transporte?: string | null;
  entregaComprometida?: string | null;
  destino?: string | null;
  valor?: number | null;
}
/** Producto fuera de catálogo (acción `agregar_personalizado`); medidas en metros, precio neto unitario. */
export interface ProductoPersonalizadoElegido {
  nombre: string;
  familia: Familia;
  madera: string;
  descripcion: string | null;
  ancho: number | null;
  alto: number | null;
  tipoMedida: 'hoja' | 'vano' | 'no_especificado';
  cantidad: number;
  precioUnitario: number;
  observaciones: string | null;
  referencias: ReferenciaItem[];
}

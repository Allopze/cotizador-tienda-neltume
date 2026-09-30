// Formas de las respuestas de la API usadas por la interfaz (copiadas de src/servidor: no se importa
// código de servidor en el cliente). Ver contrato-api del backend v6.
import type { Cotizacion, EventoCotizacion, ResumenCotizacion } from '@/negocio/estado';
import type { Producto, SolicitudItem } from '@/catalogo/tipos';
import type { Cliente } from '@/catalogo/tipos';
import type { OpcionCotizacion } from '@/servidor/referencias';

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
    cambios: Partial<Pick<SolicitudItem, 'modelo' | 'madera' | 'ancho' | 'alto' | 'medida' | 'precioUnitario'>>;
  }[];
  descuento?: number;
  flete?: number;
  observaciones?: string | null;
  despacho?: Partial<Despacho> | null;
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
  descripcion: string;
  unitario: number;
  manual: boolean;
}
export interface Despacho {
  direccion?: string | null;
  transporte?: string | null;
  entregaComprometida?: string | null;
}

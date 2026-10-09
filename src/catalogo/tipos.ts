import type { OrigenCatalogo } from './origenes';
/** Nombre canónico de una madera configurada en config/catalogo.json. */
export type Madera = string;
export type Familia = 'PUERTA' | 'MARCO' | 'PIEZAS_T' | 'MOLDURA';
export interface Producto {
  codigo: string;
  modelo: string;
  familia: Familia;
  tipo: string | null;
  madera: Madera;
  medida: string;
  anchoMin: number | null;
  anchoMax: number | null;
  /** Rangos de alto opcionales; si faltan, se usa `largo` como medida exacta. */
  altoMin?: number | null;
  altoMax?: number | null;
  largo: number;
  precioNeto: number;
  descripcion: string;
  filaOrigen: number;
}
export interface Catalogo {
  fuente: string;
  sha256: string;
  fecha: string;
  productos: Producto[];
  /** Planilla de la que salen los productos; sin indicar, la principal. Cada importación reemplaza solo su origen. */
  origen?: OrigenCatalogo;
}
export interface SolicitudItem {
  modelo: string | null;
  madera: string | null;
  ancho: number | null;
  alto: number | null;
  medida: string | null;
  cantidad: number | null;
  /** Precio unitario excepcional para esta cotización; null usa el precio calculado del catálogo. */
  precioUnitario?: number | null;
  margen?: number | null;
  tipoMedida?: 'hoja' | 'vano' | 'no_especificado' | null;
  /** Medidas tomadas del catálogo sin que la persona haya indicado dimensiones. */
  medidaPorDefecto?: boolean;
  descripcion?: string | null;
  observaciones?: string | null;
  modeloOriginal?: string | null;
  /** 'posible' ya no se produce: queda solo para borradores antiguos; hoy un alias dudoso deja el ítem pendiente. */
  coincidenciaModelo?: 'canonico' | 'alias' | 'posible' | null;
  /** Frase del pedido de la que salió el ítem, tal como la escribió la persona (la extrae la IA). */
  fuente?: string | null;
  /**
   * Producto fuera de catálogo: no se busca en el catálogo, `modelo` es su nombre y `precioUnitario` su precio
   * neto al cliente. Ausente (o null) en los ítems de catálogo.
   */
  personalizado?: { familia: Familia } | null;
  /** Imágenes o documentos que entregó el cliente para este ítem; nunca pasan al catálogo. */
  referencias?: ReferenciaItem[];
  /** Descuento especial solo de este ítem; ausente (o null) mantiene su precio. Nunca toca el catálogo. */
  descuento?: DescuentoItem | null;
  /**
   * Solo en tránsito desde el chat: el precio que la persona escribió para el ítem, tal como lo propuso la IA.
   * El servidor lo ancla al texto y lo convierte en `precioUnitario` (o en un pedido especial); nunca se guarda.
   * null es no haberlo escrito: un precio se quita en el detalle, no con un null que la IA pudo poner de más.
   */
  precio?: PrecioEscrito | null;
}
/** Precio de una unidad escrito en el chat, como lo escribió la persona; `iva` dice si lo incluía. */
export interface PrecioEscrito {
  valor: number | null;
  iva: 'neto' | 'incluido' | null;
}
/**
 * Descuento especial de un ítem, sobre su precio unitario: `porcentaje` (0–100, dos decimales) o `monto`
 * fijo en pesos enteros por unidad, nunca mayor que ese precio.
 */
export interface DescuentoItem {
  tipo: 'porcentaje' | 'monto';
  valor: number;
}
/** Archivo de referencia de un ítem. El archivo se guarda por su contenido: varias cotizaciones pueden compartirlo. */
export interface ReferenciaItem {
  /** Nombre en disco: sha256 del contenido y extensión («<64 hex>.jpg»). */
  archivo: string;
  /** Nombre original, como lo eligió la persona. */
  nombre: string;
  tipo: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  /** Bytes. */
  tamano: number;
  fecha: string;
}
export interface Cliente {
  nombre: string | null;
  rut: string | null;
  /** Giro comercial, requerido en la nota de pedido. */
  giro: string | null;
  telefono: string | null;
  direccion: string | null;
  comuna: string | null;
  proyecto: string | null;
}
export const clienteVacio = (): Cliente => ({
  nombre: null,
  rut: null,
  giro: null,
  telefono: null,
  direccion: null,
  comuna: null,
  proyecto: null,
});

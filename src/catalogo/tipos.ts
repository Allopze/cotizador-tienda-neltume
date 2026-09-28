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
}
export interface SolicitudItem {
  modelo: string | null;
  madera: string | null;
  ancho: number | null;
  alto: number | null;
  medida: string | null;
  cantidad: number | null;
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

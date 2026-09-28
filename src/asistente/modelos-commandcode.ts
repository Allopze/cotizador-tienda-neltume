/** Datos públicos del catálogo de modelos compatibles con chat de CommandCode. */
export interface ModeloCommandCode {
  id: string;
  nombre: string;
  contexto: number | null;
  precioEntrada: number | null;
  precioSalida: number | null;
  gratis: boolean;
}

import type { Producto } from '../catalogo/tipos';

/** Datos suficientes para que un proveedor estime el transporte sin leer ni alterar precios de venta. */
export interface ProductoDespacho {
  producto: Producto;
  cantidad: number;
  anchoSolicitado: number | null;
  altoSolicitado: number | null;
}

export interface CotizacionEnvio {
  transportista: string;
  valor: number;
  plazoEstimado?: string | null;
  referenciaExterna?: string | null;
}

/** Punto de extensión para integraciones de transporte; no está ligado a una empresa concreta. */
export interface ShippingProvider {
  readonly id: string;
  readonly nombre: string;
  calculateShipping(
    destination: string,
    products: readonly ProductoDespacho[],
  ): Promise<CotizacionEnvio | null>;
}

export async function calcularFlete(
  provider: ShippingProvider,
  destination: string,
  products: readonly ProductoDespacho[],
) {
  const destino = destination.replace(/\s+/g, ' ').trim();
  if (!destino || !products.length) return null;
  const cotizacion = await provider.calculateShipping(destino, products);
  if (!cotizacion || !Number.isSafeInteger(cotizacion.valor) || cotizacion.valor < 0)
    throw new Error('El proveedor de despacho devolvió un valor inválido.');
  return cotizacion;
}

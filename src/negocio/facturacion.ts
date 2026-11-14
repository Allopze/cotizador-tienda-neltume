import type { Cliente } from '../catalogo/tipos';
import { normalizarRut } from './cliente';

export type TipoDocumentoTributario = 'boleta' | 'factura';

export interface ReceptorFacturacion {
  razonSocial: string | null;
  rut: string | null;
  giro: string | null;
  direccion: string | null;
  comuna: string | null;
  correo: string | null;
}

export const correoElectronicoValido = (texto: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto.trim());

export const receptorVacio = (): ReceptorFacturacion => ({
  razonSocial: null,
  rut: null,
  giro: null,
  direccion: null,
  comuna: null,
  correo: null,
});

/** Receptor precargado desde los datos del cliente de una cotización (y correo opcional). */
export const receptorDesdeCliente = (
  cliente: Pick<Cliente, 'nombre' | 'rut' | 'giro' | 'direccion' | 'comuna'>,
  correo: string | null = null,
): ReceptorFacturacion => ({
  razonSocial: cliente.nombre ?? null,
  rut: cliente.rut ?? null,
  giro: cliente.giro ?? null,
  direccion: cliente.direccion ?? null,
  comuna: cliente.comuna ?? null,
  correo: correo ?? null,
});

export function receptorTieneContenido(receptor: Partial<ReceptorFacturacion> | null | undefined): boolean {
  if (!receptor) return false;
  return Boolean(
    receptor.razonSocial?.trim() ||
      receptor.rut?.trim() ||
      receptor.giro?.trim() ||
      receptor.direccion?.trim() ||
      receptor.comuna?.trim() ||
      receptor.correo?.trim(),
  );
}

/**
 * Campos obligatorios faltantes para facturar cuando se elige Factura:
 * razón social, RUT válido (módulo 11), giro y dirección. Comuna y correo son opcionales.
 */
export function faltanDatosFactura(receptor: Partial<ReceptorFacturacion> | null | undefined): string[] {
  const faltantes: string[] = [];
  if (!receptor?.razonSocial?.trim()) faltantes.push('razón social');
  if (!receptor?.rut?.trim() || !normalizarRut(receptor.rut)) faltantes.push('RUT válido');
  if (!receptor?.giro?.trim()) faltantes.push('giro');
  if (!receptor?.direccion?.trim()) faltantes.push('dirección');
  return faltantes;
}

export const receptorValidoParaFactura = (receptor: Partial<ReceptorFacturacion> | null | undefined) =>
  faltanDatosFactura(receptor).length === 0;

/** Texto plano (una línea por campo) listo para copiar y pegar en el facturador externo. */
export function textoCopiarFactura(receptor: Partial<ReceptorFacturacion> | null | undefined): string {
  if (!receptor) return '';
  const filas: [string, string | null | undefined][] = [
    ['Razón social', receptor.razonSocial],
    ['RUT', receptor.rut ? (normalizarRut(receptor.rut) ?? receptor.rut) : null],
    ['Giro', receptor.giro],
    ['Dirección', receptor.direccion],
    ['Comuna', receptor.comuna],
    ['Correo', receptor.correo],
  ];
  return filas
    .filter(([, valor]) => !!valor?.trim())
    .map(([etiqueta, valor]) => `${etiqueta}: ${valor!.trim()}`)
    .join('\n');
}

/** Etiqueta breve de intención de documento y receptor para mostrar en estados y listados. */
export function etiquetaDocumentoFacturacion(facturacion?: {
  estado?: 'pendiente' | 'facturada';
  documento?: TipoDocumentoTributario | null;
  tipo?: TipoDocumentoTributario | null;
  receptor?: Pick<ReceptorFacturacion, 'razonSocial' | 'rut'> | null;
}): string | null {
  const doc = facturacion?.documento ?? facturacion?.tipo ?? null;
  if (!doc) return null;
  if (doc === 'boleta') return 'Boleta';
  const r = facturacion?.receptor;
  if (r?.razonSocial) return `Factura a ${r.razonSocial}${r.rut ? ` (${r.rut})` : ''}`;
  return facturacion?.estado === 'facturada' ? 'Factura' : 'Factura (faltan datos del receptor)';
}

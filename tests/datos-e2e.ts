export const DIR_E2E = process.env.NELTUME_E2E_DIR ?? 'data/test-e2e';
export const USUARIO_E2E = 'prueba@neltume.test';
export const CLAVE_E2E = 'clave-e2e-segura-2026';
/** Administrador: las secciones Importar, Gestionar y Configuración del catálogo son solo para admin. */
export const ADMIN_E2E = 'admin@neltume.test';

/**
 * Archivo del disco de un documento descargado: «Neltume - Nota de pedido N.º 577 Panguipulli.pdf» →
 * «nota-pedido-panguipulli-577.pdf» (la inversa de `nombreDescarga`, src/servidor/nombre-descarga.ts).
 */
export function archivoDeDescarga(nombre: string) {
  const m = /^Neltume - (Cotización|Nota de pedido) N\.º (\d+)(?: (Panguipulli|Santiago))?( \(anulada\))?\.pdf$/.exec(nombre);
  if (!m) throw new Error(`Nombre de descarga inesperado: ${nombre}`);
  const [, tipo, numero, fabrica, anulada] = m;
  const base = tipo === 'Cotización' ? 'cotizacion' : `nota-pedido${fabrica ? `-${fabrica.toLowerCase()}` : ''}`;
  return `${base}-${numero}${anulada ? '-anulada' : ''}.pdf`;
}

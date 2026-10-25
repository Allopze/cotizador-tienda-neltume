import { nombreFabrica, type Fabrica } from '../negocio/estado';

const TIPOS = { cotizacion: 'Cotización', 'nota-pedido': 'Nota de pedido' } as const;
// «cotizacion-340.pdf», «nota-pedido-panguipulli-577.pdf»; un PDF que se volvió a generar al cambiar un número lleva
// «-2», «-3»… tras el número, y la copia anulada, «-anulada».
const ARCHIVO = /^(cotizacion|nota-pedido)(?:-(panguipulli|santiago))?-(\d+)(?:-\d+)?(-anulada)?\.pdf$/;

/**
 * Nombre con que se descarga un documento, el del estilo común con la fábrica (docs/estilo-documentos-v1.md, sección 7):
 * «Neltume - Nota de pedido N.º 577 Panguipulli.pdf». Sin el sufijo de la versión regenerada («cotizacion-340-2.pdf» es
 * la N.º 340) y con «(anulada)» en la copia anulada. Un nombre que no calza queda como está.
 */
export function nombreDescarga(archivo: string) {
  const m = ARCHIVO.exec(archivo);
  if (!m) return archivo;
  const [, tipo, fabrica, numero, anulada] = m;
  const destino = fabrica ? ` ${nombreFabrica[fabrica as Fabrica]}` : '';
  return `Neltume - ${TIPOS[tipo as keyof typeof TIPOS]} N.º ${numero}${destino}${anulada ? ' (anulada)' : ''}.pdf`;
}

/**
 * Cabecera `Content-Disposition` con ese nombre: `filename*` lleva el nombre completo (UTF-8) y `filename` una versión
 * solo ASCII («Neltume - Cotizacion N.o 323.pdf») para quien no entienda la primera.
 */
export function disposicionDescarga(disposicion: 'inline' | 'attachment', archivo: string) {
  const nombre = nombreDescarga(archivo);
  const ascii = nombre
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7e]/g, '_');
  // encodeURIComponent deja pasar «'()*», que `filename*` (RFC 5987) no admite sin codificar.
  const utf8 = encodeURIComponent(nombre).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposicion}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

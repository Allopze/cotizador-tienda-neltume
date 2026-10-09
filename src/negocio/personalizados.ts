import { metros, type Rechazo } from '../catalogo/resolver';
import type { Familia, Producto, ReferenciaItem, SolicitudItem } from '../catalogo/tipos';

/** Código con que un producto fuera de catálogo aparece en el detalle y en los documentos. */
export const CODIGO_PERSONALIZADO = 'ESPECIAL';

/**
 * Rechazos que dicen que lo pedido no existe en el catálogo (modelo, madera o medida), no que falten datos:
 * el ítem se puede cotizar como pedido especial con el precio que indique la persona.
 */
export const SIN_CATALOGO = new Set<Rechazo['tipo']>([
  'modelo_desconocido',
  'madera_desconocida',
  'madera_no_disponible',
  'medida_no_disponible',
]);
/**
 * Familia con que se cotiza como especial un ítem rechazado: la de su modelo, si el catálogo la conoce; si no, la
 * que dice su nombre («marco», «guardapolvo»…) o su forma (sección sin ancho es un accesorio). Solo una puerta
 * cuenta para el descuento por cantidad.
 */
export function familiaEspecial(
  r: Rechazo,
  s?: Pick<SolicitudItem, 'modelo' | 'ancho' | 'medida'>,
): Familia {
  const conocida = 'familia' in r ? r.familia : undefined;
  if (conocida) return conocida;
  const nombre = (s?.modelo ?? '').toLowerCase();
  if (/\bmarcos?\b/.test(nombre)) return 'MARCO';
  if (/\bpiezas?\s*t\b/.test(nombre)) return 'PIEZAS_T';
  if (/guardapolvo|pilastra|endolado|moldura|cornisa|junquillo|tapajunta/.test(nombre)) return 'MOLDURA';
  return s && s.ancho == null && s.medida ? 'MOLDURA' : 'PUERTA';
}

/** Formatos admitidos como referencia del cliente y la extensión con que se guardan. */
export const TIPOS_REFERENCIA: Record<ReferenciaItem['tipo'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
export const MAX_BYTES_REFERENCIA = 10 * 1024 * 1024;
export const MAX_REFERENCIAS_ITEM = 10;
/** Atributo `accept` del selector de archivos. */
export const ACEPTA_REFERENCIA = '.jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf';
export const ARCHIVO_REFERENCIA = /^[0-9a-f]{64}\.(jpg|png|webp|pdf)$/;

export const esPersonalizado = (s: Pick<SolicitudItem, 'personalizado'> | null | undefined) => !!s?.personalizado;
export const esImagen = (r: Pick<ReferenciaItem, 'tipo'>) => r.tipo !== 'application/pdf';
export const etiquetaTipoReferencia = (r: Pick<ReferenciaItem, 'tipo'>) =>
  r.tipo === 'application/pdf' ? 'Documento PDF' : `Imagen ${TIPOS_REFERENCIA[r.tipo].toUpperCase()}`;
export function tamanoReferencia(bytes: number) {
  const formato = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 1 });
  return bytes < 1024 * 1024 ? `${formato(Math.max(1, Math.round(bytes / 1024)))} KB` : `${formato(bytes / 1024 / 1024)} MB`;
}
/** Ruta con que la interfaz muestra o descarga una referencia. */
export const urlReferencia = (r: Pick<ReferenciaItem, 'archivo' | 'nombre'>, descargar = false) =>
  `/api/referencias/${r.archivo}?${new URLSearchParams({ nombre: r.nombre, ...(descargar ? { descargar: '1' } : {}) })}`;

/** Referencias iguales (mismo archivo y nombre) en el mismo orden: no cuenta como cambio. */
export const mismasReferencias = (a: ReferenciaItem[] | undefined, b: ReferenciaItem[] | undefined) =>
  JSON.stringify((a ?? []).map((r) => [r.archivo, r.nombre])) === JSON.stringify((b ?? []).map((r) => [r.archivo, r.nombre]));

export type ResolucionPersonalizado =
  | { ok: true; producto: Producto; ancho: number | null; alto: number | null }
  | { ok: false; campos: string[] };

/**
 * Producto con que se valoriza un ítem fuera de catálogo: su precio es el que escribió la persona (precio neto al
 * cliente, sin margen) y su descripción, la del documento o su nombre con la madera. Nunca se guarda en el catálogo.
 */
export function productoPersonalizado(s: SolicitudItem, familia: Familia): ResolucionPersonalizado {
  const campos = [
    !s.modelo?.trim() && 'modelo',
    !s.madera?.trim() && 'madera',
    (s.cantidad === null || !Number.isInteger(s.cantidad) || s.cantidad < 1 || s.cantidad > 10000) && 'cantidad',
    !s.precioUnitario && 'precio',
  ].filter((c): c is string => !!c);
  const ancho = s.ancho === null ? null : metros(s.ancho);
  const alto = s.alto === null ? null : metros(s.alto);
  if (s.ancho !== null && ancho === null) campos.push('ancho');
  if (s.alto !== null && alto === null) campos.push('alto');
  if (campos.length) return { ok: false, campos };
  const nombre = s.modelo!.trim(),
    madera = s.madera!.trim();
  return {
    ok: true,
    ancho,
    alto,
    producto: {
      codigo: CODIGO_PERSONALIZADO,
      modelo: nombre,
      familia,
      tipo: null,
      madera,
      medida: '',
      anchoMin: ancho,
      anchoMax: ancho,
      altoMin: alto,
      altoMax: alto,
      largo: alto ?? 0,
      precioNeto: s.precioUnitario!,
      descripcion: `${nombre} · ${madera}`,
      filaOrigen: 0,
    },
  };
}

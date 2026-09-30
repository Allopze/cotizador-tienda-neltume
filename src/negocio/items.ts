import { metros, normalizarMedida } from '../catalogo/resolver';
import type { SolicitudItem } from '../catalogo/tipos';

/** Modelo y madera normalizados para comparar; vacío si el ítem no los trae. */
export interface ProductoItem {
  modelo: string;
  madera: string;
}
export type ClaveProducto = (s: SolicitudItem) => ProductoItem;

const MAX_TEXTO = { modelo: 300, madera: 300, medida: 300, descripcion: 300, observaciones: 1000 } as const;

/** Espacios colapsados y recortados; un texto vacío queda null. */
export const textoItem = (valor: string | null | undefined, max: number) =>
  valor?.replace(/\s+/g, ' ').trim().slice(0, max) || null;

/** Mismo saneamiento que la edición directa para los textos de un ítem; un campo ausente sigue ausente. */
export function sanearTextos<T extends Partial<SolicitudItem>>(item: T): T {
  const limpio: Partial<SolicitudItem> = { ...item };
  for (const campo of Object.keys(MAX_TEXTO) as (keyof typeof MAX_TEXTO)[])
    if (limpio[campo] !== undefined) limpio[campo] = textoItem(limpio[campo], MAX_TEXTO[campo]);
  return limpio as T;
}

export const claveMedida = (n: number | null) => {
  if (n === null) return '';
  const v = metros(n);
  return v === null ? `?${n}` : v.toFixed(4);
};
const claveMedidas = (s: SolicitudItem) =>
  [claveMedida(s.ancho), claveMedida(s.alto), s.medida ? normalizarMedida(s.medida) : ''].join('|');

/** Cambia el producto si un modelo o madera que el ítem ya tenía pasa a ser otro (completar un dato faltante no cuenta). */
const cambioDeProducto = (antes: ProductoItem, despues: ProductoItem) =>
  (antes.modelo !== '' && antes.modelo !== despues.modelo) ||
  (antes.madera !== '' && antes.madera !== despues.madera);

/** La descripción de documento describía el producto anterior: se descarta si cambia y el turno no trae otra. */
export const descartaDescripcion = (antes: SolicitudItem, despues: SolicitudItem, producto: ClaveProducto) =>
  !!antes.descripcion && despues.descripcion === antes.descripcion && cambioDeProducto(producto(antes), producto(despues));

export const avisoDescripcionDescartada = (numero: number) =>
  `El ítem ${numero} cambió de modelo o madera: se descartó su descripción de documento personalizada, que describía el producto anterior.`;

/**
 * Devuelve los ítems que propone la IA con las ediciones manuales del ítem anterior que corresponde. La IA no ve
 * margen ni precio, y deja en null lo que no cambia. Orden de emparejamiento, cada ítem nuevo con uno anterior libre:
 * misma posición e identidad (modelo, madera y medidas); misma identidad en otra posición; misma posición con las
 * medidas cambiadas o completadas; misma posición con otro modelo o madera pero las mismas medidas (este último no
 * hereda el precio manual, que era del producto anterior). Sin pareja es un ítem nuevo y no hereda nada.
 * `descartadas` son las posiciones que perdieron su descripción.
 */
export function fusionarItems(previos: SolicitudItem[], nuevos: SolicitudItem[], producto: ClaveProducto) {
  const pp = previos.map(producto),
    pn = nuevos.map(producto),
    mp = previos.map(claveMedidas),
    mn = nuevos.map(claveMedidas);
  const pareja = new Map<number, number>(),
    usados = new Set<number>();
  const emparejar = (enOtraPosicion: boolean, aceptar: (i: number, j: number) => boolean) => {
    for (const i of nuevos.keys()) {
      if (pareja.has(i)) continue;
      const candidatos = enOtraPosicion ? [...previos.keys()] : i < previos.length ? [i] : [];
      const j = candidatos.find((c) => !usados.has(c) && aceptar(i, c));
      if (j === undefined) continue;
      pareja.set(i, j);
      usados.add(j);
    }
  };
  const mismaIdentidad = (i: number, j: number) =>
    pn[i].modelo === pp[j].modelo && pn[i].madera === pp[j].madera && mn[i] === mp[j];
  emparejar(false, mismaIdentidad);
  emparejar(true, mismaIdentidad);
  emparejar(false, (i, j) => !cambioDeProducto(pp[j], pn[i]));
  emparejar(false, (i, j) => mn[i] === mp[j]);
  const descartadas: number[] = [];
  const items = nuevos.map((nuevo, i) => {
    const j = pareja.get(i);
    if (j === undefined) return nuevo;
    const previo = previos[j];
    const item: SolicitudItem = {
      ...nuevo,
      margen: previo.margen ?? null,
      precioUnitario: cambioDeProducto(pp[j], pn[i]) ? null : (previo.precioUnitario ?? null),
      tipoMedida: nuevo.tipoMedida ?? previo.tipoMedida ?? null,
      descripcion: nuevo.descripcion ?? previo.descripcion ?? null,
      observaciones: nuevo.observaciones ?? previo.observaciones ?? null,
    };
    if (descartaDescripcion(previo, item, producto)) {
      item.descripcion = null;
      descartadas.push(i);
    }
    return item;
  });
  return { items, descartadas };
}

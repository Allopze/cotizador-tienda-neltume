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

/** Cambia el producto solo si un modelo o madera que había pasa a ser otro: un valor que falta, antes o después, no cuenta. */
const cambioDeProducto = (antes: ProductoItem, despues: ProductoItem) =>
  (antes.modelo !== '' && despues.modelo !== '' && antes.modelo !== despues.modelo) ||
  (antes.madera !== '' && despues.madera !== '' && antes.madera !== despues.madera);

export interface Descartes {
  descripcion: boolean;
  precio: boolean;
}

/**
 * La descripción de documento y el precio unitario manual eran del producto anterior: si cambia el modelo o la
 * madera se quitan de `despues`, salvo que el mismo cambio traiga otro valor. Devuelve lo descartado, o null.
 */
export function descartarDelProducto(antes: SolicitudItem, despues: SolicitudItem, producto: ClaveProducto): Descartes | null {
  if (!cambioDeProducto(producto(antes), producto(despues))) return null;
  const descartes = {
    descripcion: !!antes.descripcion && despues.descripcion === antes.descripcion,
    precio: !!antes.precioUnitario && despues.precioUnitario === antes.precioUnitario,
  };
  if (!descartes.descripcion && !descartes.precio) return null;
  if (descartes.descripcion) despues.descripcion = null;
  if (descartes.precio) despues.precioUnitario = null;
  return descartes;
}

export const avisoProductoCambiado = (numero: number, { descripcion, precio }: Descartes) =>
  `El ítem ${numero} cambió de modelo o madera: se descartó ${[
    descripcion && 'su descripción de documento personalizada',
    precio && 'su precio unitario manual',
  ]
    .filter(Boolean)
    .join(' y ')}${precio ? '; se usa el precio de catálogo' : ''}.`;

/**
 * Devuelve los ítems que propone la IA con las ediciones manuales del ítem anterior que corresponde. La IA no ve
 * margen ni precio, y deja en null lo que no cambia. Orden de emparejamiento, cada ítem nuevo con uno anterior libre:
 * misma posición e identidad (modelo, madera y medidas); misma identidad en otra posición; misma posición con las
 * medidas cambiadas o completadas; misma posición con otro modelo o madera pero las mismas medidas (ahí la descripción
 * y el precio manual se descartan, con aviso). Sin pareja es un ítem nuevo y no hereda nada.
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
  const avisos: string[] = [];
  const items = nuevos.map((nuevo, i) => {
    const j = pareja.get(i);
    if (j === undefined) {
      // Sin pareja no hereda nada, pero la IA puede repetir la descripción del ítem que había en su posición.
      const item = { ...nuevo };
      const descartes = i < previos.length ? descartarDelProducto(previos[i], item, producto) : null;
      if (!descartes) return nuevo;
      avisos.push(avisoProductoCambiado(i + 1, descartes));
      return item;
    }
    const previo = previos[j];
    const item: SolicitudItem = {
      ...nuevo,
      margen: previo.margen ?? null,
      precioUnitario: previo.precioUnitario ?? null,
      tipoMedida: nuevo.tipoMedida ?? previo.tipoMedida ?? null,
      descripcion: nuevo.descripcion ?? previo.descripcion ?? null,
      observaciones: nuevo.observaciones ?? previo.observaciones ?? null,
    };
    const descartes = descartarDelProducto(previo, item, producto);
    if (descartes) avisos.push(avisoProductoCambiado(i + 1, descartes));
    return item;
  });
  return { items, avisos };
}

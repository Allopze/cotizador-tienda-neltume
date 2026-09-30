import { metros, normalizarMedida } from '../catalogo/resolver';
import type { SolicitudItem } from '../catalogo/tipos';

/** Modelo y madera normalizados para comparar; vacío si el ítem no los trae. */
export interface ProductoItem {
  modelo: string;
  madera: string;
}
type IdentidadProducto = (s: SolicitudItem) => ProductoItem;

const MAX_TEXTO = { modelo: 300, madera: 300, medida: 300, descripcion: 300, observaciones: 1000 } as const;

/** Espacios colapsados y recortados al largo del campo; un texto vacío queda null. */
export const textoCampo = (campo: keyof typeof MAX_TEXTO, valor: string | null | undefined) =>
  valor?.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO[campo]) || null;

/** El origen del modelo (alias o coincidencia posible) deja de valer si el modelo cambia; recalcular lo deduce de nuevo. */
export function reiniciarOrigenModelo(item: SolicitudItem) {
  item.modeloOriginal = null;
  item.coincidenciaModelo = null;
}

/** Mismo saneamiento que la edición directa para los textos de un ítem; un campo ausente sigue ausente. */
export function sanearTextos<T extends Partial<SolicitudItem>>(item: T): T {
  const limpio: Partial<SolicitudItem> = { ...item };
  for (const campo of Object.keys(MAX_TEXTO) as (keyof typeof MAX_TEXTO)[])
    if (limpio[campo] !== undefined) limpio[campo] = textoCampo(campo, limpio[campo]);
  return limpio as T;
}

export const claveMedida = (n: number | null) => {
  if (n === null) return '';
  const v = metros(n);
  return v === null ? `?${n}` : v.toFixed(4);
};
const medidasDelItem = (s: SolicitudItem) =>
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
export function descartarDelProducto(
  antes: SolicitudItem,
  despues: SolicitudItem,
  producto: { antes: ProductoItem; despues: ProductoItem },
): Descartes | null {
  if (!cambioDeProducto(producto.antes, producto.despues)) return null;
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
 * margen ni precio, y deja en null lo que no cambia. Sin pareja, el ítem es nuevo y no hereda nada.
 */
export function fusionarItems(previos: SolicitudItem[], nuevos: SolicitudItem[], identidad: IdentidadProducto) {
  const productoPrevio = previos.map(identidad),
    productoNuevo = nuevos.map(identidad),
    medidasPrevias = previos.map(medidasDelItem),
    medidasNuevas = nuevos.map(medidasDelItem);
  const pareja = new Map<number, number>(),
    usados = new Set<number>();
  // Cada ítem nuevo sin pareja se busca entre los anteriores libres, en su posición o en cualquiera.
  const emparejar = (posicion: 'misma' | 'cualquiera', aceptar: (nuevo: number, previo: number) => boolean) => {
    for (const i of nuevos.keys()) {
      if (pareja.has(i)) continue;
      const candidatos = posicion === 'cualquiera' ? [...previos.keys()] : i < previos.length ? [i] : [];
      const j = candidatos.find((c) => !usados.has(c) && aceptar(i, c));
      if (j === undefined) continue;
      pareja.set(i, j);
      usados.add(j);
    }
  };
  const mismaIdentidad = (i: number, j: number) =>
    productoNuevo[i].modelo === productoPrevio[j].modelo &&
    productoNuevo[i].madera === productoPrevio[j].madera &&
    medidasNuevas[i] === medidasPrevias[j];
  // 1. Misma posición y misma identidad (modelo, madera y medidas).
  emparejar('misma', mismaIdentidad);
  // 2. Misma identidad en otra posición: la lista se reordenó o se insertó un ítem.
  emparejar('cualquiera', mismaIdentidad);
  // 3. Misma posición con las medidas cambiadas, o con un modelo o madera completado.
  emparejar('misma', (i, j) => !cambioDeProducto(productoPrevio[j], productoNuevo[i]));
  // 4. Misma posición con otro modelo o madera pero las mismas medidas: hereda, salvo descripción y precio manual.
  emparejar('misma', (i, j) => medidasNuevas[i] === medidasPrevias[j]);
  const avisos: string[] = [];
  const items = nuevos.map((nuevo, i) => {
    const j = pareja.get(i);
    if (j === undefined) {
      // Sin pareja no hereda nada, pero la IA puede repetir la descripción del ítem que había en su posición.
      const item = { ...nuevo };
      const descartes =
        i < previos.length
          ? descartarDelProducto(previos[i], item, { antes: productoPrevio[i], despues: productoNuevo[i] })
          : null;
      if (!descartes) return nuevo;
      avisos.push(avisoProductoCambiado(i + 1, descartes));
      return item;
    }
    const previo = previos[j];
    const mismoModelo = productoPrevio[j].modelo !== '' && productoPrevio[j].modelo === productoNuevo[i].modelo;
    const item: SolicitudItem = {
      ...nuevo,
      margen: previo.margen ?? null,
      precioUnitario: previo.precioUnitario ?? null,
      tipoMedida: nuevo.tipoMedida ?? previo.tipoMedida ?? null,
      descripcion: nuevo.descripcion ?? previo.descripcion ?? null,
      observaciones: nuevo.observaciones ?? previo.observaciones ?? null,
      // La IA no ve cómo se interpretó el modelo: se conserva mientras el modelo sea el mismo.
      ...(mismoModelo
        ? { modeloOriginal: previo.modeloOriginal ?? null, coincidenciaModelo: previo.coincidenciaModelo ?? null }
        : {}),
    };
    const descartes = descartarDelProducto(previo, item, { antes: productoPrevio[j], despues: productoNuevo[i] });
    if (descartes) avisos.push(avisoProductoCambiado(i + 1, descartes));
    return item;
  });
  return { items, avisos };
}

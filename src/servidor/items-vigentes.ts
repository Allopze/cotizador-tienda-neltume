import { pregunta } from '../asistente/preguntas';
import { nombreCanonicoModelo } from '../catalogo/configuracion';
import {
  maderaDelCatalogo,
  maderaEfectiva,
  resolverItem,
  type CatalogoConsultable,
  type Resolucion,
} from '../catalogo/resolver';
import type { SolicitudItem } from '../catalogo/tipos';
import type { Cotizacion } from '../negocio/estado';
import { bajoElCosto, precioEnRango, RANGO_MARGEN } from '../negocio/limites';
import { productoPersonalizado } from '../negocio/personalizados';
import { descuentoItemValido, margenProducto, pesos, REGLAS, type ItemPrecio } from '../negocio/precios';

/** Un ítem que se valoriza: su índice en el pedido y las medidas pedidas, ya resueltas. */
export type ItemVigente = ItemPrecio & {
  indice: number;
  anchoSolicitado: number | null;
  altoSolicitado: number | null;
  medidaSolicitada: string | null;
};

export interface ItemsVigentes {
  /**
   * Cada solicitud como se cotiza: el modelo canónico y la madera con que se cotiza (un marco «en Mara Enchapada»
   * también si queda pendiente). Son copias: quien llama decide si guarda la normalización.
   */
  solicitudes: SolicitudItem[];
  /** Ítems que se valorizan, en el orden del pedido y con su índice. */
  validos: ItemVigente[];
  /** Ítems pendientes, por índice: falta un dato, no están en el catálogo o su precio o descuento queda fuera de regla. */
  incompletos: Cotizacion['incompletos'];
  /** Ítems que se cotizan con la siguiente medida del catálogo, para avisarlo. */
  siguienteMedida: Extract<Resolucion, { ok: true }>[];
  /**
   * Ítems valorizados que se venden bajo su costo de fábrica (ganancia entre −50 % y 0 %): se cotizan, pero se
   * avisa. Un pedido especial cuenta solo si tiene costo de fábrica escrito.
   */
  bajoCosto: { indice: number; nombre: string; precio: number; costo: number }[];
}

/**
 * Qué ítems se valorizan con el catálogo vigente y cuáles quedan pendientes. Es una sola regla para el cálculo de
 * la cotización (`Servicio.recalcular`) y para el bulto que se cotiza en Starken (`starken-servicio.ts`): así la
 * huella que se firma con la tarifa es la que se comprueba al aplicarla, y las dos no pueden divergir. No cambia
 * la cotización.
 */
export function itemsVigentes(
  catalogo: CatalogoConsultable,
  q: Pick<Cotizacion, 'solicitudes' | 'reglas' | 'margenCotizacion'>,
): ItemsVigentes {
  const reglas = q.reglas ?? REGLAS;
  const solicitudes: SolicitudItem[] = [];
  const validos: ItemVigente[] = [];
  const incompletos: Cotizacion['incompletos'] = [];
  const siguienteMedida: ItemsVigentes['siguienteMedida'] = [];
  const bajoCosto: ItemsVigentes['bajoCosto'] = [];
  for (const [indice, solicitud] of q.solicitudes.entries()) {
    const s = { ...solicitud };
    solicitudes.push(s);
    if (s.personalizado) {
      // Fuera de catálogo: no se busca ni se normaliza contra el catálogo; vale el precio escrito.
      const r = productoPersonalizado(s, s.personalizado.familia);
      if (!r.ok) {
        incompletos.push({
          indice,
          rechazo: { tipo: 'faltan_datos', campos: r.campos.filter((c) => c !== 'precio'), disponibles: {} },
          pregunta: 'Completa el nombre, la madera, las medidas, la cantidad y el precio del producto personalizado.',
        });
        continue;
      }
      validos.push({
        producto: r.producto,
        cantidad: s.cantidad!,
        indice,
        anchoSolicitado: r.ancho,
        altoSolicitado: r.alto,
        medidaSolicitada: null,
        precioUnitario: s.precioUnitario ?? null,
        margen: null,
        tipoMedida: s.tipoMedida ?? null,
        observaciones: s.observaciones ?? null,
        descripcionDocumento: s.descripcion ?? r.producto.descripcion,
        descuento: s.descuento ?? null,
      });
      continue;
    }
    // Un marco «en Mara Enchapada» se guarda con la madera con que se cotiza, también si queda pendiente:
    // el alta desde el pendiente y las preguntas parten de ella.
    const madera = s.madera ? maderaDelCatalogo(catalogo, s.madera) : null,
      efectiva = maderaEfectiva(catalogo, s);
    if (madera && efectiva && efectiva !== madera) s.madera = efectiva;
    const res = resolverItem(catalogo, s);
    if (!res.ok) {
      incompletos.push({ indice, rechazo: res.rechazo, pregunta: pregunta(res.rechazo, s.modelo) });
      continue;
    }
    if (res.coincidenciaModelo !== 'canonico') {
      s.modeloOriginal ??= s.modelo;
      s.coincidenciaModelo = res.coincidenciaModelo;
    } else if (!s.modeloOriginal) {
      s.coincidenciaModelo = 'canonico';
    }
    s.modelo = nombreCanonicoModelo(res.producto.modelo);
    s.madera = res.producto.madera;
    if (res.ajusteAncho === 'siguiente' || res.ajusteAlto === 'siguiente') siguienteMedida.push(res);
    validos.push({
      producto: { ...res.producto, modelo: nombreCanonicoModelo(res.producto.modelo) },
      cantidad: res.cantidad,
      indice,
      anchoSolicitado: res.anchoSolicitado,
      altoSolicitado: res.altoSolicitado,
      medidaSolicitada: res.medidaSolicitada,
      precioUnitario: s.precioUnitario ?? null,
      margen: s.margen ?? null,
      tipoMedida: s.tipoMedida ?? null,
      observaciones: s.observaciones ?? null,
      descripcionDocumento: s.descripcion ?? null,
      descuento: s.descuento ?? null,
    });
  }
  // Valida todas las entradas, también deshacer y chat: un precio fuera del rango permitido, o un descuento que no
  // vale o supera el precio, deja el ítem pendiente.
  for (let i = validos.length - 1; i >= 0; i--) {
    const item = validos[i];
    const costo = item.producto.precioNeto;
    const precio =
      item.precioUnitario ??
      Math.round(costo * (1 + (item.margen ?? q.margenCotizacion ?? margenProducto(item.producto, reglas))));
    let problema: string | null = null;
    if (!precioEnRango(precio, costo))
      problema = `El precio ${pesos(precio)} queda fuera del rango permitido (${RANGO_MARGEN} sobre el costo ${pesos(costo)}). Corrígelo o quita el ítem.`;
    if (
      item.descuento &&
      (!descuentoItemValido(item.descuento) || (item.descuento.tipo === 'monto' && item.descuento.valor > precio))
    )
      problema = `El descuento del ítem ${item.indice + 1} no es válido o supera su precio unitario (${pesos(precio)}). Ajusta o quita el descuento.`;
    if (problema) {
      incompletos.push({
        indice: item.indice,
        rechazo: { tipo: 'faltan_datos', campos: ['precio'], disponibles: {} },
        pregunta: problema,
      });
      validos.splice(i, 1);
      continue;
    }
    // El costo de un pedido especial es el que se escribió para fábrica; sin él no se sabe si hay pérdida.
    const especial = q.solicitudes[item.indice].personalizado;
    const costoFabrica = especial ? (q.solicitudes[item.indice].costoFabrica ?? null) : costo;
    if (costoFabrica !== null && bajoElCosto(precio, costoFabrica))
      bajoCosto.unshift({
        indice: item.indice,
        nombre: especial ? item.producto.modelo : item.producto.codigo,
        precio,
        costo: costoFabrica,
      });
  }
  incompletos.sort((a, b) => a.indice - b.indice);
  return { solicitudes, validos, incompletos, siguienteMedida, bajoCosto };
}

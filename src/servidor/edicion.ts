// Piezas de la edición de una cotización: aplicar los cambios de los ítems y del flete, el despacho, y los textos
// que quedan en la actividad. Son funciones sin estado; `Servicio.editar` las orquesta dentro de su transacción.
import type { ReferenciaItem, SolicitudItem } from '../catalogo/tipos';
import { aCentesimas, margenAPorcentaje, redondearMargen } from '../negocio/cifras';
import { contarPuertas, descuentoEsManual, textoPuertas } from '../negocio/descuento-cantidad';
import {
  avisoProductoCambiado,
  descartarDelProducto,
  reiniciarOrigenModelo,
  textoCampo,
  type ProductoItem,
} from '../negocio/items';
import {
  cantidadFlete,
  sinTransportista,
  unitarioFlete,
  type Cotizacion,
  type Despacho,
} from '../negocio/estado';
import { MARGEN_MAX, MARGEN_MIN } from '../negocio/limites';
import { esLibre, mismasReferencias } from '../negocio/personalizados';
import { descuentoItemValido, fleteValido, margenValido, pesos, textoDescuentoItem, type Linea } from '../negocio/precios';
import { textoTarifaAplicada, type TarifaStarkenAplicada } from '../negocio/starken';
import type { Accion, CambiosCotizacion } from './acciones';
import { sanearReferencias } from './archivos-referencia';
import { ErrorNoEncontrado, ErrorUsuario } from './errores';

type Editar = Extract<Accion, { tipo: 'editar' }>;
/** Cambio de un ítem pedido desde el detalle. */
export type CambioItem = NonNullable<Editar['items']>[number];

/** Nueva versión estrictamente posterior a la anterior, aunque ocurra en el mismo milisegundo. */
export const marca = (anterior?: string) =>
  new Date(Math.max(Date.now(), anterior ? Date.parse(anterior) + 1 : 0)).toISOString();

export const limpiarTexto = (valor: unknown, max: number) =>
  typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim().slice(0, max) || null : null;

const porcentajeTexto = (n: number) => `${String(n).replace('.', ',')} %`;
/** Margen (fracción) como porcentaje legible: 0,42 → «42 %»; sin el ruido binario de 0,07 × 100. */
const margenTexto = (m: number) => porcentajeTexto(margenAPorcentaje(m));
const ESTANDAR_CATEGORIA = 'estándar de categoría';
/** Descuento especial de un ítem para comparar versiones: «porcentaje:15», «monto:5000» o vacío. */
export const claveDescuento = (s: SolicitudItem) => (s.descuento ? `${s.descuento.tipo}:${s.descuento.valor}` : '');

type DescuentoGuardado = { descuento: number; manual: boolean };
export const descuentoDe = (q: Cotizacion): DescuentoGuardado => ({ descuento: q.descuento, manual: descuentoEsManual(q) });
/**
 * Lo que cambió del descuento, para la actividad: el del tramo por cantidad (con las puertas que lo
 * explican), el fijado a mano o el automático restaurado. Vacío si nada cambió.
 */
export function cambioDescuento(antes: DescuentoGuardado, q: Cotizacion): string[] {
  const { descuento, manual } = descuentoDe(q);
  if (antes.descuento === descuento && antes.manual === manual) return [];
  const a = porcentajeTexto(antes.descuento),
    b = porcentajeTexto(descuento),
    puertas = textoPuertas(contarPuertas(q.montos.lineas));
  // Sin tramos no hay otro modo: todo descuento es de una persona y «manual» no aclara nada.
  if (manual) return [`Descuento ${a} → ${b}${q.reglas?.descuentosPorCantidad?.length ? ' (manual)' : ''}`];
  if (antes.manual)
    return [
      antes.descuento === descuento
        ? `Descuento automático restaurado: ${b}`
        : `Descuento automático restaurado: ${a} → ${b} (${puertas})`,
    ];
  return [`Descuento por cantidad ${a} → ${b} (${puertas})`];
}

/** Texto breve de las diferencias, para el registro de actividad. */
export function textoCambios(c: CambiosCotizacion | undefined, extras: string[] = []) {
  const partes = [
    ...(c?.agregados.map((x) => `Agregado: ${x.descripcion}`) ?? []),
    ...(c?.quitados.map((x) => `Quitado: ${x.descripcion}`) ?? []),
    ...(c?.modificados.map((x) =>
      x.antes.descripcion === x.despues.descripcion
        ? `Modificado: ${x.despues.descripcion}`
        : `${x.antes.descripcion} → ${x.despues.descripcion}`,
    ) ?? []),
    ...(c?.cliente.length ? [`Datos del cliente: ${c.cliente.join(', ')}`] : []),
    ...extras,
  ];
  return partes.length ? partes.join(' · ') : null;
}

/** «Ítem 2 · referencia agregada: foto.jpg · quitada: plano.pdf», para el registro de actividad. */
function textoReferencias(indice: number, antes: ReferenciaItem[] = [], despues: ReferenciaItem[] = []) {
  const clave = (r: ReferenciaItem) => `${r.archivo}|${r.nombre}`;
  const previas = new Set(antes.map(clave)),
    nuevas = new Set(despues.map(clave));
  const agregadas = despues.filter((r) => !previas.has(clave(r))).map((r) => r.nombre);
  const quitadas = antes.filter((r) => !nuevas.has(clave(r))).map((r) => r.nombre);
  return [
    `Ítem ${indice + 1}`,
    agregadas.length && `referencia agregada: ${agregadas.join(', ')}`,
    quitadas.length && `referencia quitada: ${quitadas.join(', ')}`,
    !agregadas.length && !quitadas.length && 'referencias reordenadas',
  ]
    .filter(Boolean)
    .join(' · ');
}

type CampoDespacho = 'direccion' | 'transporte' | 'entregaComprometida' | 'destino';
const CAMPOS_DESPACHO: readonly (readonly [CampoDespacho, string, number])[] = [
  ['direccion', 'Dirección', 300],
  ['transporte', 'Transportista', 120],
  ['entregaComprometida', 'Entrega comprometida', 120],
  ['destino', 'Destino', 300],
];
/** Despacho con los cambios ya limpios sobre `base`, y el texto de lo que cambió (para la actividad). */
export function aplicarDespacho(base: Despacho | null | undefined, cambios: Partial<Despacho>, valor: number) {
  const despacho: Despacho = {
    direccion: base?.direccion ?? null,
    transporte: base?.transporte ?? null,
    entregaComprometida: base?.entregaComprometida ?? null,
    destino: base?.destino ?? null,
    valor,
  };
  const cambiados: { campo: CampoDespacho; texto: string }[] = [];
  for (const [campo, etiqueta, largo] of CAMPOS_DESPACHO) {
    if (cambios[campo] === undefined) continue;
    const limpio = limpiarTexto(cambios[campo], largo);
    // «Otro» solo dice que falta el nombre: no se guarda como transportista.
    const nuevo = campo === 'transporte' && sinTransportista(limpio) ? null : limpio;
    if (nuevo === despacho[campo]) continue;
    cambiados.push({ campo, texto: `${etiqueta}: ${despacho[campo] ?? '—'} → ${nuevo ?? '—'}` });
    despacho[campo] = nuevo;
  }
  return { despacho, cambiados };
}

/**
 * Las cantidades y los cambios de cada ítem pedidos desde el detalle, sobre una copia de `base`. Valida cada campo
 * y avisa los datos que se descartan al cambiar de producto. `producto` da el modelo y la madera comparables de un
 * ítem (ver `Servicio.producto`); `directorio` es donde viven las referencias del cliente.
 */
export function aplicarCambiosItems(
  base: SolicitudItem[],
  pedido: Pick<Editar, 'cantidades' | 'items'>,
  { directorio, producto }: { directorio: string; producto: (s: SolicitudItem, pareja?: SolicitudItem) => ProductoItem },
) {
  const solicitudes = structuredClone(base);
  for (const { indice, cantidad } of pedido.cantidades ?? []) {
    if (!solicitudes[indice]) throw new ErrorNoEncontrado('No se encontró el ítem.');
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10000)
      throw new ErrorUsuario('La cantidad debe ser un entero entre 1 y 10.000.');
    solicitudes[indice] = { ...solicitudes[indice], cantidad };
  }
  const indicesEditados = new Set<number>();
  const avisos: string[] = [];
  for (const cambio of pedido.items ?? []) {
    if (!solicitudes[cambio.indice] || indicesEditados.has(cambio.indice))
      throw new ErrorNoEncontrado('No se encontró el ítem o se repitió su índice.');
    indicesEditados.add(cambio.indice);
    const cambios = cambio.cambios;
    const siguiente = { ...solicitudes[cambio.indice] };
    if (cambios.personalizado !== undefined) {
      // «Cotizar como especial»: lo que no existe en el catálogo se cotiza con el precio que se indique.
      const familias = ['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA', 'OTRO'];
      if (cambios.personalizado && !familias.includes(cambios.personalizado.familia))
        throw new ErrorUsuario('La familia del pedido especial no es válida.');
      siguiente.personalizado = cambios.personalizado ? { familia: cambios.personalizado.familia } : null;
      if (siguiente.personalizado) {
        siguiente.margen = null;
        if (!siguiente.modelo) throw new ErrorUsuario('El pedido especial necesita un nombre.');
        if (!(cambios.precioUnitario ?? siguiente.precioUnitario))
          throw new ErrorUsuario('Indica el precio unitario del pedido especial.');
      }
    }
    const libre = esLibre(siguiente);
    if (libre && cambios.costoFabrica != null)
      throw new ErrorUsuario('Un ítem libre no va a fábrica: no lleva costo de fábrica.');
    if (cambios.costoFabrica !== undefined) {
      const valor = cambios.costoFabrica;
      if (!siguiente.personalizado)
        throw new ErrorUsuario('Solo un pedido especial lleva costo de fábrica: el del catálogo sale de la planilla.');
      if (valor !== null && (!Number.isSafeInteger(valor) || valor <= 0 || valor > 100_000_000))
        throw new ErrorUsuario('El costo de fábrica debe ser un entero entre $1 y $100.000.000.');
      siguiente.costoFabrica = valor;
    }
    // Un ítem que vuelve al catálogo deja de tener costo escrito: el suyo sale de la planilla.
    if (!siguiente.personalizado) delete siguiente.costoFabrica;
    if (siguiente.personalizado) {
      // Fuera de catálogo el precio es el dato de origen: no hay precio de catálogo al que volver.
      if (cambios.precioUnitario === null)
        throw new ErrorUsuario('Un producto personalizado necesita un precio unitario.');
      if (cambios.margen !== undefined && cambios.margen !== null)
        throw new ErrorUsuario('Un producto personalizado no usa ganancia: cambia directamente su precio unitario.');
      for (const campo of libre ? (['modelo'] as const) : (['modelo', 'madera'] as const))
        if (cambios[campo] !== undefined && !textoCampo(campo, cambios[campo]))
          throw new ErrorUsuario(
            campo === 'modelo' ? 'El producto personalizado necesita un nombre.' : 'Indica la madera del producto personalizado.',
          );
    }
    if (cambios.referencias !== undefined) {
      const referencias = sanearReferencias(directorio, cambios.referencias ?? []);
      if (referencias.length) siguiente.referencias = referencias;
      else delete siguiente.referencias;
    }
    for (const campo of ['modelo', 'madera', 'medida', 'descripcion', 'observaciones'] as const)
      if (cambios[campo] !== undefined) {
        siguiente[campo] = textoCampo(campo, cambios[campo]);
        if (campo === 'modelo') reiniciarOrigenModelo(siguiente);
      }
    if (cambios.tipoMedida !== undefined) {
      if (cambios.tipoMedida !== null && !['hoja', 'vano', 'no_especificado'].includes(cambios.tipoMedida))
        throw new ErrorUsuario('El tipo de medida no es válido.');
      siguiente.tipoMedida = cambios.tipoMedida;
    }
    for (const campo of ['ancho', 'alto'] as const)
      if (cambios[campo] !== undefined) {
        const valor = cambios[campo];
        if (valor !== null && !Number.isFinite(valor)) throw new ErrorUsuario(`La medida ${campo} no es válida.`);
        siguiente[campo] = valor ?? null;
        delete siguiente.medidaPorDefecto;
      }
    if (cambios.precioUnitario !== undefined) {
      const valor = cambios.precioUnitario;
      if (valor !== null && (!Number.isSafeInteger(valor) || valor <= 0 || valor > 100_000_000))
        throw new ErrorUsuario('El precio unitario debe ser un entero entre $1 y $100.000.000.');
      siguiente.precioUnitario = valor ?? null;
      if (valor !== null) siguiente.margen = null;
    }
    if (cambios.margen !== undefined) {
      const valor = cambios.margen;
      if (valor !== null && !margenValido(valor))
        throw new ErrorUsuario(`La ganancia debe ser un porcentaje entre ${MARGEN_MIN * 100} % y ${MARGEN_MAX * 100} %, con hasta dos decimales.`);
      // Guardado sin el error binario de un porcentaje dividido por 100 (0,07 llega como 0,07000000000000001).
      siguiente.margen = valor === null ? null : redondearMargen(valor);
      if (valor !== null) siguiente.precioUnitario = null;
    }
    if (cambios.descuento !== undefined) {
      const valor = cambios.descuento;
      // Un descuento de 0 es no tener descuento: se quita, igual que con null.
      if (!valor || valor.valor === 0) delete siguiente.descuento;
      else if (!descuentoItemValido(valor))
        throw new ErrorUsuario(
          valor.tipo === 'porcentaje'
            ? 'El descuento del ítem debe ser un porcentaje entre 0 % y 100 %, con hasta dos decimales.'
            : 'El descuento del ítem debe ser un monto entero en pesos, desde $0.',
        );
      else siguiente.descuento = { tipo: valor.tipo, valor: valor.tipo === 'porcentaje' ? aCentesimas(valor.valor) : valor.valor };
    }
    const anterior = solicitudes[cambio.indice];
    const descartes = descartarDelProducto(anterior, siguiente, {
      antes: producto(anterior, siguiente),
      despues: producto(siguiente, anterior),
    });
    if (descartes) avisos.push(avisoProductoCambiado(cambio.indice + 1, descartes));
    // Un ítem libre es nombre, cantidad y precio: no conserva madera, medidas ni fábrica de lo que fue.
    if (esLibre(siguiente)) {
      Object.assign(siguiente, { madera: null, ancho: null, alto: null, medida: null, tipoMedida: null, fabrica: null });
      delete siguiente.costoFabrica;
      delete siguiente.medidaPorDefecto;
    }
    solicitudes[cambio.indice] = siguiente;
  }
  return { solicitudes, avisos };
}

/**
 * Flete que pide la edición: un valor de despacho (a mano o de Starken) es el total del flete, en una sola unidad;
 * la línea de flete del detalle fija su cantidad, unitario y descripción, o la quita. El total se valida después,
 * junto con el descuento (ver `Servicio.editar`).
 */
export function aplicarFlete(q: Cotizacion, pedido: Pick<Editar, 'flete' | 'despacho' | 'fleteLinea'>) {
  let flete = pedido.flete ?? (pedido.despacho?.valor === undefined ? q.flete : pedido.despacho.valor ?? 0),
    fleteCantidad = cantidadFlete(q),
    fleteDescripcion = q.fleteDescripcion ?? null;
  if (flete !== q.flete) fleteCantidad = 1;
  const linea = pedido.fleteLinea;
  if (linea === null) {
    flete = 0;
    fleteCantidad = 1;
    fleteDescripcion = null;
  } else if (linea) {
    const cantidad = linea.cantidad ?? cantidadFlete(q);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10000)
      throw new ErrorUsuario('La cantidad del flete debe ser un número entero entre 1 y 10.000.');
    const unitario = linea.unitario ?? unitarioFlete(q);
    if (!fleteValido(unitario))
      throw new ErrorUsuario('El unitario del flete debe ser un monto entero en pesos sin IVA, desde $0.');
    fleteCantidad = cantidad;
    flete = cantidad * unitario;
    if (linea.descripcion !== undefined) fleteDescripcion = limpiarTexto(linea.descripcion, 300);
  }
  return { flete, fleteCantidad, fleteDescripcion };
}

/** Datos generales de la cotización tal como quedan tras la edición. */
export interface Generales {
  flete: number;
  fleteCantidad: number;
  fleteDescripcion: string | null;
  margenCotizacion: number | null;
  observaciones: Cotizacion['observaciones'];
  despacho: Cotizacion['despacho'];
}

/**
 * Lo que la edición cambió fuera de la lista de ítems (flete, ganancia especial, observaciones, despacho, tarifa)
 * y dentro de cada ítem editado (ganancia, referencias, precio, descuento especial), para la actividad. `destino`
 * aún tiene los datos generales anteriores; `antes` son sus ítems previos y `lineas` las líneas ya calculadas.
 */
export function textoActividad({
  destino,
  nuevos,
  margenAntes,
  antes,
  solicitudes,
  lineas,
  items,
  tarifa,
  describir,
}: {
  destino: Cotizacion;
  nuevos: Generales;
  margenAntes: number | null;
  antes: SolicitudItem[];
  solicitudes: SolicitudItem[];
  lineas: Linea[];
  items: CambioItem[] | undefined;
  tarifa: TarifaStarkenAplicada | undefined;
  describir: (s: SolicitudItem) => string;
}) {
  const { flete, fleteCantidad, fleteDescripcion, margenCotizacion, observaciones, despacho } = nuevos;
  const extras = [
    ...(flete !== destino.flete ? [`Flete ${pesos(destino.flete)} → ${pesos(flete)}`] : []),
    ...(fleteCantidad !== cantidadFlete(destino)
      ? [`Cantidad del flete: ${cantidadFlete(destino)} → ${fleteCantidad}`]
      : []),
    ...(fleteDescripcion !== (destino.fleteDescripcion ?? null)
      ? [`Descripción del flete: ${fleteDescripcion ?? 'automática'}`]
      : []),
    ...(margenCotizacion !== margenAntes
      ? [
          `Ganancia especial de la cotización: ${margenAntes === null ? ESTANDAR_CATEGORIA : margenTexto(margenAntes)} → ${margenCotizacion === null ? ESTANDAR_CATEGORIA : margenTexto(margenCotizacion)}`,
        ]
      : []),
    ...(observaciones !== destino.observaciones ? ['Observaciones actualizadas'] : []),
    ...(JSON.stringify(despacho) !== JSON.stringify(destino.despacho) ? ['Despacho actualizado'] : []),
    ...(tarifa ? [textoTarifaAplicada(tarifa)] : []),
  ];
  for (const cambio of items ?? []) {
    // `antes` y no los ítems de la cotización: en un borrador `destino` es la misma y sus ítems ya son los nuevos.
    const anterior = antes[cambio.indice];
    if (!anterior) continue;
    const margenLinea = solicitudes[cambio.indice].margen ?? null;
    if (cambio.cambios.margen !== undefined && margenLinea !== (anterior.margen ?? null)) {
      const linea = lineas.find((l) => l.indice === cambio.indice);
      const margenAnterior = linea ? margenTexto(linea.margen ?? 0) : 'sin resolver';
      const sinMargenPropio = margenCotizacion === null ? ESTANDAR_CATEGORIA : 'ganancia especial de la cotización';
      const margenNuevo = margenLinea === null ? sinMargenPropio : margenTexto(margenLinea);
      extras.push(`Ganancia de ${describir(anterior)}: ${margenAnterior} → ${margenNuevo}`);
    }
    if (cambio.cambios.referencias !== undefined && !mismasReferencias(anterior.referencias, solicitudes[cambio.indice].referencias))
      extras.push(textoReferencias(cambio.indice, anterior.referencias, solicitudes[cambio.indice].referencias));
    if (cambio.cambios.precioUnitario !== undefined && cambio.cambios.precioUnitario !== anterior.precioUnitario)
      extras.push(`Precio cliente de ${describir(anterior)} actualizado${cambio.cambios.precioUnitario === null ? ' según la ganancia aplicada' : ` a ${pesos(cambio.cambios.precioUnitario)}`}`);
    const descuentoItem = solicitudes[cambio.indice].descuento ?? null;
    if (cambio.cambios.descuento !== undefined && claveDescuento(anterior) !== claveDescuento(solicitudes[cambio.indice]))
      extras.push(
        `Descuento especial de ${describir(anterior)}: ${anterior.descuento ? textoDescuentoItem(anterior.descuento) : 'sin descuento'} → ${descuentoItem ? textoDescuentoItem(descuentoItem) : 'sin descuento'}`,
      );
  }
  return extras;
}

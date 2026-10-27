// Orquestación de un mensaje del chat: consulta a la IA fuera del bloqueo, revisa su lectura contra lo que escribió
// la persona (anclaje de frases, cifras y nombres; precios y descuentos escritos) y aplica el resultado en una
// transacción. Lo que necesita del servicio (abrir una revisión, recalcular, comparar versiones) llega en
// `ContextoChat`: `Servicio` es la única fachada pública.
import { ErrorIA, errorProveedor } from '../asistente/errores';
import { MAX_OPCIONES } from '../asistente/preguntas';
import type { ModificacionCotizacion } from '../asistente/esquemas';
import { fleteDelChat } from '../asistente/flete';
import { salidaSchema } from '../asistente/esquemas';
import { contextoSeguro, TURNOS_HISTORIAL, type LLM } from '../asistente/llm';
import {
  anclarCifras,
  anclarFrases,
  anclarNombres,
  avisosDeCampos,
  avisosDePalabras,
  cifrasDelTexto,
  ESCUADRIAS_HABITUALES,
  fraseDelMensaje,
  nombresDichos,
  sinTildes,
  type ResolverNombre,
} from '../asistente/anclaje';
import {
  MONTO_BAJO,
  montoEscrito,
  montoTotal,
  montosDelTexto,
  porcentajeEscrito,
  porcentajesDelTexto,
  textosSinPorcentajes,
} from '../asistente/montos';
import { fleteAlFinal, pareceUnPedido, pedidosSinRegistrar, sinLineasDeFlete } from '../asistente/cobertura';
import { respuestaDirecta } from '../asistente/respuesta-directa';
import { mapaCatalogo } from '../catalogo/mapa';
import { maderasConEquivalente, nombreCanonicoModelo } from '../catalogo/configuracion';
import { metrosTexto } from '../catalogo/escalones';
import {
  aliasMaderasCatalogo,
  aliasModelosCatalogo,
  maderaDelCatalogo,
  maderaEfectiva,
  maderasCatalogo,
  metros,
  modeloDelCatalogo,
  modelosCatalogo,
  normalizar,
  normalizarMedida,
  resolverItem,
  resolverNombres,
  type CatalogoConsultable,
} from '../catalogo/resolver';
import type { Cliente, DescuentoItem, Familia, Producto, SolicitudItem } from '../catalogo/tipos';
import { sanearCliente } from '../negocio/cliente';
import {
  FABRICAS,
  numeroNota,
  cantidadFlete,
  descripcionFlete,
  nombreFabrica,
  textoNotas,
  unitarioFlete,
  type Cotizacion,
  type Fabrica,
  type NotaPedido,
} from '../negocio/estado';
import {
  avisoProductoCambiado,
  desdeIA,
  descartarDelProducto,
  detectarTipoMedida,
  fusionarItems,
  reiniciarOrigenModelo,
  textoCampo,
  type Descartes,
  type ProductoItem,
} from '../negocio/items';
import { ANTICIPO_TEXTO, MARGEN_MAX, MARGEN_MIN } from '../negocio/limites';
import { esLibre, familiaItem, SIN_CATALOGO } from '../negocio/personalizados';
import {
  ahorroLinea,
  cotizar,
  descuentoItemValido,
  pesos,
  precioConDescuento,
  REGLAS,
  textoDescuentoItem,
} from '../negocio/precios';
import { estaVencida, fechaChilena } from '../negocio/vigencia';
import type { Accion, AsignacionFabrica, CambiosCotizacion, CategoriaAviso, DiagnosticoTurno, Resultado } from './acciones';
import type { Almacen, Unidad } from './almacen';
import { cambioDescuento, claveDescuento, descuentoDe, marca, textoCambios } from './edicion';
import { ErrorConflicto, ErrorNoEncontrado, ErrorUsuario, VERSION_OBSOLETA } from './errores';
import { resolverReferencia } from './referencias';

/** Lo que el chat usa del servicio: su catálogo, la IA, el almacén y las reglas de edición de la cotización. */
export interface ContextoChat {
  catalogo: CatalogoConsultable;
  llm: LLM;
  almacen: Almacen;
  autor: string | null;
  /** Recibe cada mensaje del chat ya guardado; no cambia lo que se responde. */
  diagnostico?: (d: DiagnosticoTurno) => void;
  nueva(): Cotizacion;
  obtener(u: Unidad, id: string): Cotizacion;
  exigirEditable(q: Cotizacion): void;
  abrirEdicion(q: Cotizacion, u: Unidad): Cotizacion;
  /** Recalcula montos y pendientes; devuelve los avisos y las solicitudes normalizadas, que asigna quien llama. */
  recalcular(q: Cotizacion): { avisos: string[]; solicitudes: SolicitudItem[] };
  producto(s: SolicitudItem, pareja?: SolicitudItem): ProductoItem;
  familiaDe(modelo: string): Familia | null;
  productosDe(modelo: string): Producto[];
  sinCambios(q: Cotizacion, solicitudes: SolicitudItem[], cliente: Cliente): boolean;
  cambios(antes: SolicitudItem[], despues: SolicitudItem[], clienteAntes: Cliente, clienteDespues: Cliente): CambiosCotizacion | undefined;
  describir(s: SolicitudItem): string;
  /** Asigna fábricas sin crear una revisión (ver `Servicio.asignarFabricas`); devuelve el texto de lo asignado. */
  asignarFabricas(q: Cotizacion, u: Unidad, asignaciones: AsignacionFabrica[]): { cotizacion: Cotizacion; texto: string };
  /** Documento cuyo número se cambiaría y su número actual; lanza si no se puede (ver `Servicio.documentoRenumerable`). */
  documentoRenumerable(
    u: Unidad,
    q: Cotizacion,
    documento: 'cotizacion' | 'nota',
    fabrica?: Fabrica | null,
    numero?: number,
  ): { actual: number; nota: NotaPedido | null };
}

const NO_ENTENDI = 'No entendí, ¿puedes reformularlo?';
const PEDIDO_SIN_REGISTRAR =
  'No agregué productos y tu mensaje parece un pedido. Escríbelo de nuevo con modelo, madera, medidas y cantidad.';
const AYUDA_ESPECIAL =
  'Si es un pedido especial, escribe su precio (por ejemplo «la de 1,90 a $450.000 + IVA») o usa «Cotizar como especial» en el detalle.';
// Montos o términos comerciales en texto libre del modelo; palabras como «total» o «valor» solas no bastan.
// Se leen igual que el anclaje: «450 mil», «450 lucas», «Precio: 450.000 + IVA» y «20 %» (auditoría BUG-030).
const textoMonetario = (texto: string) =>
  montosDelTexto(texto).length > 0 ||
  porcentajesDelTexto(texto).length > 0 ||
  /\b(?:CLP|USD|costos?|m[aá]rgen(?:es)?|descuentos?)\b/i.test(texto);
/** El mensaje habla del descuento de un producto («sin descuento», «descuéntale», «rebaja»), ya sin tildes. */
const HABLA_DE_DESCUENTO = /\b(?:descuent|descont|rebaj)/;
const SOLICITUD_APROBACION =
  /\b(?:aprueba|apruebe|aprobar|se aprob[oó]|haz(?:me)? (?:la )?nota|genera(?:r)? (?:la )?nota|prepara(?:r)? (?:la )?nota)(?![\p{L}\p{N}])/iu;

/**
 * El mensaje pide cambiar el número de un documento («cambia el número de la cotización a 340», «la nota de Santiago
 * debe ser la 61»): sus cifras son números de documento, no referencias a otra cotización (ver `procesarChat`).
 */
const CAMBIO_NUMERO =
  /\b(?:n[uú]mero|correlativo|numeraci[oó]n|renumer\w*)\b|\b(?:nota|orden|ot)\b[^.\n]*\b(?:a|al|sea|ser|por|es)\s+(?:la\s+|el\s+)?(?:n[°º.]?\s*)?\d|\b(?:tiene que|debe|deber[ií]a)\s+ser\s+(?:la|el)\s+(?:n[°º.]?\s*)?\d/iu;
const NO_EDITABLE_APROBADA =
  'La cotización está aprobada y no se puede editar. Por chat puedes repartir sus ítems entre las fábricas (antes de generar las notas de pedido) o cambiar su número o el de sus notas.';
const PREGUNTA_FABRICA =
  '¿A qué fábrica va cada ítem? Dímelo, por ejemplo: «las Molco a Panguipulli y las Coz Coz a Santiago».';
/**
 * La fábrica dicha como tal: «fábrica de Panguipulli», «van a Santiago», «para Panguipulli», «las hace Santiago»,
 * «las Molco a Panguipulli». Sueltos, Panguipulli y Santiago también son un modelo, una comuna o un despacho: «a
 * Santiago» no vale cuando es el destino o el cliente (auditoría BUG-027).
 */
const fabricaDicha = (nombre: string) =>
  new RegExp(
    `\\b(?:fabricas?|taller)\\s+(?:de\\s+)?${nombre}\\b` +
      `|\\b(?:van|va|vamos|manda(?:r|mos)?|lleva(?:r|mos)?|hace|hacen|para)\\s+(?:la\\s+)?(?:f[aá]brica\\s+(?:de\\s+)?)?${nombre}\\b` +
      `|\\b(?<!despacho )(?<!envio )(?<!entrega )(?<!destino )(?<!comuna )(?<!cliente )(?<!de )a\\s+(?:la\\s+)?(?:f[aá]brica\\s+(?:de\\s+)?)?${nombre}\\b`,
  );
const FABRICA_DICHA: Record<Fabrica, RegExp> = {
  panguipulli: fabricaDicha('pangui(?:pulli)?'),
  santiago: fabricaDicha('(?:santiago|stgo)'),
};
/** ¿Alguno de los textos de la persona nombra la fábrica como tal? Sin eso, la IA la habría deducido: no se asigna. */
const fabricaEscrita = (fabrica: Fabrica, textos: string[]) =>
  textos.some((t) => FABRICA_DICHA[fabrica].test(sinTildes(t)));
/** Fábricas que el mensaje nombra como tales y la respuesta de la IA no asigna a ningún ítem. */
function fabricasSinAsignar(mensaje: string, input: ModificacionCotizacion): Fabrica[] {
  const texto = sinTildes(mensaje);
  const asignadas = new Set([...(input.agregar ?? []), ...(input.items ?? []).map((i) => i.cambios)].map((x) => x.fabrica));
  return FABRICAS.filter((f) => FABRICA_DICHA[f].test(texto) && !asignadas.has(f));
}
/** Enteros escritos en el mensaje («1.250» es 1250): los números de documento deben salir de ahí. */
const enterosEscritos = (texto: string) =>
  new Set((texto.match(/\d[\d.]*/g) ?? []).map((n) => Number(n.replace(/\./g, ''))).filter(Number.isSafeInteger));
/**
 * Un `modificar_cotizacion` que solo cambia fábricas de ítems existentes es un reparto: va como `asignar_fabricas`,
 * sin abrir una revisión. null si trae otro cambio.
 */
function soloFabricas(input: ModificacionCotizacion): AsignacionFabrica[] | null {
  const items = input.items ?? [];
  if (
    !items.length ||
    input.agregar?.length ||
    input.quitar?.length ||
    Object.keys(input.cliente ?? {}).length ||
    input.flete !== undefined ||
    items.some((i) => i.cambios.fabrica === undefined || Object.keys(i.cambios).some((k) => k !== 'fabrica' && k !== 'fuente'))
  )
    return null;
  return items.map((i) => ({ indice: i.indice, fabrica: i.cambios.fabrica ?? null }));
}
/**
 * Asignaciones de `asignar_fabricas` con el ítem que de verdad nombran: la IA repite el modelo de cada uno, y si no
 * es el del índice que dio (asignó en el orden del mensaje), vale el único ítem de ese modelo. Sin uno claro, se omite.
 */
function itemsDelReparto(
  ctx: ContextoChat,
  q: Cotizacion,
  asignaciones: { indice: number; modelo: string; fabrica: Fabrica | null }[],
): AsignacionFabrica[] {
  const modelo = (s: SolicitudItem | undefined) => (s ? ctx.producto(s).modelo : '');
  const resultado: AsignacionFabrica[] = [];
  for (const a of asignaciones) {
    const dicho = ctx.producto({ modelo: a.modelo, madera: null, ancho: null, alto: null, medida: null, cantidad: null }).modelo;
    const candidatos = q.solicitudes.flatMap((s, i) => (modelo(s) === dicho ? [i] : []));
    const indice = candidatos.includes(a.indice) ? a.indice : candidatos.length === 1 ? candidatos[0] : null;
    if (indice !== null && !resultado.some((r) => r.indice === indice)) resultado.push({ indice, fabrica: a.fabrica });
  }
  return resultado;
}

/**
 * Quita de los ítems de la IA la fábrica que el mensaje no nombra (ver `fabricaEscrita`), con un aviso. Un cambio que
 * solo traía esa fábrica se descarta entero.
 */
function fabricasDichas(
  input: ModificacionCotizacion,
  textos: string[],
  describir: (indice: number) => string,
): { input: ModificacionCotizacion; avisos: string[] } {
  const avisos: string[] = [];
  const revisar = <T extends { fabrica?: Fabrica | null }>(item: T, nombre: string): T => {
    if (item.fabrica === null) {
      // Quitar la fábrica solo si el mensaje lo pide (auditoría BUG-026).
      const pide = /\b(?:sin|quita(?:r|le|las|los)?|saca(?:r|le|las|los)?|elimina(?:r)?)\b[^.\n]*\bfabric/.test(
        sinTildes(textos.join('\n')),
      );
      if (pide) return item;
      avisos.push(`No quité la fábrica de ${nombre}: el mensaje no lo pide.`);
      const sinFabrica = { ...item };
      delete sinFabrica.fabrica;
      return sinFabrica as T;
    }
    if (!item.fabrica || fabricaEscrita(item.fabrica, textos)) return item;
    avisos.push(`No asigné fábrica a ${nombre}: el mensaje no dice a cuál va.`);
    const sinAsignar = { ...item };
    delete sinAsignar.fabrica;
    return sinAsignar as T;
  };
  return {
    input: {
      ...input,
      ...(input.agregar ? { agregar: input.agregar.map((a) => revisar(a, a.modelo ?? 'un ítem nuevo')) } : {}),
      ...(input.items
        ? {
            items: input.items
              .map((i) => ({ ...i, cambios: revisar(i.cambios, describir(i.indice)) }))
              .filter((i) => Object.keys(i.cambios).length),
          }
        : {}),
    },
    avisos,
  };
}

/** Palabras que confirman («sí», «ya», «correcto, ese») y las que pueden acompañarlas sin agregar nada. */
const AFIRMA = new Set([
  'si', 'sip', 'ok', 'okey', 'okay', 'ya', 'dale', 'correcto', 'exacto', 'claro', 'confirmo', 'confirmado',
  'afirmativo', 'efectivamente', 'perfecto', 'listo', 'bueno', 'acuerdo', 'eso', 'ese', 'esa', 'asi', 'obvio',
  'va',
]);
const ACOMPANA_AFIRMACION = new Set([
  'es', 'de', 'el', 'la', 'mismo', 'misma', 'modelo', 'por', 'favor', 'porfa', 'gracias', 'nomas', 'cotiza',
  'cotizala', 'cotizalo', 'cotizalas', 'cotizalos', 'po',
]);
/** Lo que desdice una confirmación («no», «es otra», «tampoco»). */
const NIEGA = /^(?:no|nop|otr[oa]s?|tampoco|distint[oa]s?|diferentes?)$/;
/**
 * ¿El mensaje confirma lo que preguntó el asistente, sin un «no»? Vale «sí», «sii», «sí po», «👍» o un mensaje
 * que parte confirmando («sí, pero que sean 3»): la confirmación respalda solo el nombre sugerido, y las cifras y
 * los demás nombres siguen necesitando respaldo propio.
 */
function afirmacionBreve(mensaje: string) {
  const texto = sinTildes(mensaje).replace(/👍[\u{1F3FB}-\u{1F3FF}]?/gu, ' si ');
  const palabras = texto
    .split(/[^a-zñ]+/)
    .filter(Boolean)
    // «siii» es «si»; «sipo», «si po».
    .flatMap((p) => (p.replace(/(.)\1+$/, '$1') === 'sipo' ? ['si', 'po'] : [p.replace(/(.)\1+$/, '$1')]));
  if (!palabras.length || palabras.some((p) => NIEGA.test(p))) return false;
  return (
    AFIRMA.has(palabras[0]) ||
    (!/\d/.test(texto) &&
      palabras.length <= 6 &&
      palabras.some((p) => AFIRMA.has(p)) &&
      palabras.every((p) => AFIRMA.has(p) || ACOMPANA_AFIRMACION.has(p)))
  );
}

/** Orden con que se elige una opción de la lista («la primera», «la segunda opción»); -1 es «la última». */
const ORDINALES = new Map(
  Object.entries({
    primer: 0, primera: 0, primero: 0, segunda: 1, segundo: 1, tercer: 2, tercera: 2, tercero: 2, cuarta: 3,
    cuarto: 3, quinta: 4, quinto: 4, ultima: -1, ultimo: -1,
  }),
);
/**
 * «la primera» a la única pregunta pendiente con una lista de modelos o maderas («¿Qué madera necesitas para
 * Molco? Opciones: Mara, Lenga.»): el ítem cuenta como si el borrador ya dijera esa opción. Con más de una
 * lista, o una que no se muestra entera, el orden no dice cuál.
 */
function opcionElegida(mensaje: string, q: Cotizacion): { indice: number; item: SolicitudItem }[] {
  const palabras = sinTildes(mensaje).split(/[^a-zñ]+/).filter(Boolean);
  const orden = palabras.filter((p) => ORDINALES.has(p));
  if (
    orden.length !== 1 ||
    /\d/.test(mensaje) ||
    !palabras.every((p) => ORDINALES.has(p) || p === 'opcion' || AFIRMA.has(p) || ACOMPANA_AFIRMACION.has(p))
  )
    return [];
  const listas = q.incompletos.flatMap(({ indice, rechazo: r }) =>
    r.tipo === 'faltan_datos'
      ? r.campos.map((campo) => ({ indice, campo, opciones: r.disponibles[campo] ?? [] }))
      : r.tipo === 'modelo_desconocido'
        ? [{ indice, campo: 'modelo', opciones: r.disponibles }]
        : (r.tipo === 'madera_desconocida' || r.tipo === 'madera_no_disponible') && r.disponibles.length
          ? [{ indice, campo: 'madera', opciones: r.disponibles }]
          : r.tipo === 'producto_ambiguo' || r.tipo === 'medida_no_disponible'
            ? [{ indice, campo: 'medida', opciones: [] }]
            : [],
  );
  const [lista] = listas;
  if (listas.length !== 1 || (lista.campo !== 'modelo' && lista.campo !== 'madera')) return [];
  const s = q.solicitudes[lista.indice];
  const valor = lista.opciones.length <= MAX_OPCIONES ? lista.opciones.at(ORDINALES.get(orden[0])!) : undefined;
  return s && valor ? [{ indice: lista.indice, item: { ...s, [lista.campo]: valor } }] : [];
}

/**
 * ¿La frase trae un monto en pesos («$900.000», «900 mil»)? Su cantidad y sus medidas no cuentan, tampoco como
 * las lee montosDelTexto («0,83» → 1, «2.0» → 2000).
 */
function conMonto(frase: string) {
  const cifras = cifrasDelTexto(frase, false).flatMap((c) => [c, Math.round(c), Math.round(c * 1000)]);
  return montosDelTexto(frase).some((m) => !cifras.includes(m));
}

/**
 * ¿Sobra el aviso «No pude verificar el ítem N»? Un ítem editado lleva la frase «pedido original · cambio», que
 * no está entera en el mensaje; si la del cambio sí está, el ítem viene de este mensaje. Si conserva la frase de
 * un ítem anterior, viene de un mensaje ya revisado: los valores nuevos los revisan anclarCifras y anclarNombres.
 */
function editadoEnElMensaje(aviso: string, items: SolicitudItem[], previos: SolicitudItem[], mensaje: string) {
  const n = /^No pude verificar el ítem (\d+) /.exec(aviso);
  const fuente = n ? items[Number(n[1]) - 1]?.fuente : null;
  if (!fuente) return false;
  if (previos.some((p) => p.fuente === fuente)) return true;
  const partes = fuente.split(' · ');
  return partes.length > 1 && fraseDelMensaje(partes.at(-1)!, mensaje);
}

/**
 * La lectura por frase sin los campos que el anclaje de cifras y nombres dejó vacíos: ya tienen su aviso («quedó
 * pendiente…») y su pregunta. Así cada campo de un ítem se avisa una sola vez.
 */
function sinLoDejado(ia: SolicitudItem[], porFrase: SolicitudItem[], anclados: SolicitudItem[]) {
  return porFrase.map((leido, i) => {
    const dejados = (['modelo', 'madera', 'cantidad', 'ancho', 'alto'] as const).filter(
      (c) => anclados[i]?.[c] == null && ia[i]?.[c] != null,
    );
    return dejados.length ? { ...leido, ...Object.fromEntries(dejados.map((c) => [c, null])) } : leido;
  });
}

/** Solo un borrador cambia de versión con el historial: así no se invalidan selecciones de otras personas. */
function registrar(q: Cotizacion, usuario: string, asistente: string) {
  q.historial.push({ rol: 'usuario', texto: usuario }, { rol: 'asistente', texto: asistente });
  if (q.estado === 'borrador') q.actualizada = marca(q.actualizada);
}

/** Cantidades no enteras o fuera de rango del modelo quedan pendientes, con aviso. */
function sanearSolicitudes(items: SolicitudItem[], mensaje?: string) {
  const avisos: string[] = [];
  const solicitudes = items.map((s) => {
    const tipoMedida = detectarTipoMedida(s.fuente) ?? (items.length === 1 ? detectarTipoMedida(mensaje) : null);
    if (tipoMedida) s = { ...s, tipoMedida };
    if (s.cantidad === null || (Number.isInteger(s.cantidad) && s.cantidad >= 1 && s.cantidad <= 10000))
      return s;
    avisos.push(
      `La cantidad ${String(s.cantidad).replace('.', ',')} de ${s.modelo ?? 'un ítem'} no es válida: indica un entero entre 1 y 10.000.`,
    );
    return { ...s, cantidad: null };
  });
  return { solicitudes, avisos };
}

/**
 * Escuadrías 2xN («2X4») que el catálogo tiene para un modelo y, si la madera se sabe y la tiene, para esa madera
 * (la de cotizar: un marco «en Mara Enchapada» es Pino Finger). Sin productos del modelo, las habituales.
 */
function escuadriasDe(ctx: ContextoChat, modelo: string, madera: string | null): string[] {
  const productos = ctx.productosDe(modelo);
  if (!productos.length) return [...ESCUADRIAS_HABITUALES];
  const efectiva = madera ? maderaEfectiva(ctx.catalogo, { modelo, madera }) : null;
  const conMadera = efectiva ? productos.filter((p) => p.madera === efectiva) : [];
  const medidas = (conMadera.length ? conMadera : productos).map((p) => normalizarMedida(p.medida));
  return [...new Set(medidas.filter((m) => /^2X\d+$/.test(m)))];
}

/**
 * Corrección para la IA si su respuesta deja fuera pedidos del mensaje o pregunta por el chat lo que debía
 * registrar como ítem pendiente, o si no asigna la fábrica que el mensaje dice; null si la respuesta sirve. En modo
 * «avisar» (`corrige` falso) no se revisan los omitidos: Qwen3.7-Flash responde «¿De qué madera quieres las 3
 * Rupanco…?» a la mitad de los pedidos sin madera, aunque el prompt lo prohíbe, y un pedido o una fábrica que no
 * queda registrada no se arregla con un aviso.
 */
function revisarSalida(
  ctx: ContextoChat,
  salida: unknown,
  mensaje: string,
  base: Cotizacion,
  modo: 'cotizacion_nueva' | 'modificacion_anterior',
  resolver: Record<'modelo' | 'madera', ResolverNombre>,
  corrige: boolean,
): string | { correccion: string; mensaje: string } | null {
  const parsed = salidaSchema.safeParse(salida);
  if (!parsed.success) return null;
  const res = parsed.data;
  if (res.name === 'modificar_cotizacion') {
    const faltan = corrige ? pedidosOmitidos(ctx, res.input, mensaje, base, resolver) : [];
    if (!faltan.length) {
      // Qwen3.7-Flash a veces registra los productos sin la fábrica que el mensaje dice para cada uno.
      const sinFabrica = fabricasSinAsignar(mensaje, res.input);
      return sinFabrica.length
        ? `El mensaje dice a qué fábrica va cada producto (${sinFabrica.map((f) => nombreFabrica[f]).join(' y ')}), pero tu respuesta no la asignó. Responde de nuevo con modificar_cotizacion, con los mismos ítems, y pon en cada uno la fábrica que dice el mensaje.`
        : null;
    }
    const correccion = `Tu respuesta anterior no registró estos pedidos del mensaje: ${faltan.map((f) => `«${f}»`).join(', ')}. Responde de nuevo con modificar_cotizacion e incluye en agregar todos los ítems del mensaje (también los que ya habías registrado), cada uno con su propia fuente.`;
    // Con un flete en el mensaje, el modelo a veces registra solo el flete y ningún producto, y repite el error
    // al corregirlo: el reintento va sin la línea del flete, que ya quedó registrado y se conserva.
    const acotado = res.input.flete && !res.input.agregar?.length ? sinLineasDeFlete(mensaje) : mensaje;
    return acotado !== mensaje && acotado.trim()
      ? { correccion: `El flete ya quedó registrado; ahora faltan los productos. ${correccion}`, mensaje: acotado }
      : correccion;
  }
  if (res.name === 'responder' && pedidoSinRegistrar(mensaje, base, modo, resolver))
    return 'El mensaje pide productos: regístralos con modificar_cotizacion y deja en null lo que no se dijo; el sistema pregunta lo que falta con botones. No uses responder para pedir datos de un ítem.';
  return null;
}

/**
 * ¿El mensaje pide productos que el borrador aún no tiene? Sirve para saber si una respuesta sin cambios
 * (`responder`) dejó un pedido sin registrar.
 */
function pedidoSinRegistrar(
  mensaje: string,
  base: Cotizacion,
  modo: 'cotizacion_nueva' | 'modificacion_anterior',
  resolver: Record<'modelo' | 'madera', ResolverNombre>,
) {
  if (modo !== 'cotizacion_nueva' || !pareceUnPedido(mensaje, resolver)) return false;
  const enBorrador = new Set(base.solicitudes.flatMap((s) => (s.modelo ? [normalizar(s.modelo)] : [])));
  return [...nombresDichos(mensaje, resolver.modelo, resolver.madera).resueltos.keys()].some((m) => !enBorrador.has(m));
}

/** Un ítem que la IA marcó libre lo es si tiene nombre y ese nombre no es un modelo del catálogo. */
function esLibreFuera(ctx: ContextoChat, s: SolicitudItem) {
  if (!s.modelo?.trim()) return false;
  const r = resolverItem(ctx.catalogo, { modelo: s.modelo });
  // «modelo_posible» es un nombre que se parece a uno del catálogo: no es un ítem libre (auditoría BUG-031).
  return !r.ok && r.rechazo.tipo === 'modelo_desconocido';
}

/**
 * Precio que la persona escribió para un ítem en el chat. Debe estar en la frase del propio ítem (o en la
 * conversación, si su frase no se ubica): así no toma el de otro producto ni el del flete. Se guarda neto.
 * Un producto del catálogo pasa a ese precio y se avisa cuál era el de catálogo; uno que no existe (modelo,
 * madera o medida) pasa a ser un pedido especial con ese precio. Sin `textos` (doble de prueba) el monto no
 * se ancla.
 */
function preciosEscritos(ctx: ContextoChat, items: SolicitudItem[], mensaje: string, textos: string[] | null, q: Cotizacion) {
  const avisos: string[] = [];
  const reglas = q.reglas ?? REGLAS;
  const resultado = items.map((original, i): SolicitudItem => {
    const { precio, libre, ...propuesto } = original;
    // Un ítem libre (lo que no es carpintería) solo si su nombre no es un modelo del catálogo: la marca de la IA
    // nunca reemplaza un producto que existe.
    const nuevoLibre = !!libre && !propuesto.personalizado && esLibreFuera(ctx, propuesto);
    const item: SolicitudItem = nuevoLibre
      ? {
          ...propuesto,
          madera: null,
          ancho: null,
          alto: null,
          medida: null,
          tipoMedida: null,
          fabrica: null,
          margen: null,
          personalizado: { familia: 'OTRO' },
        }
      : propuesto;
    const nombreLibre = `«${item.modelo}»`;
    // Al editar, la frase del ítem es «pedido original · cambio»: el precio está en la última parte.
    const frase = item.fuente?.split(' · ').at(-1) ?? null;
    if (!precio?.valor) {
      if (nuevoLibre) avisos.push(`Agregué ${nombreLibre} como ítem libre (no va a fábrica). Indica su precio.`);
      // Un total de varias unidades llega sin valor; sin un monto en la frase, la IA solo rellenó el campo.
      if (precio?.valor === null && frase && conMonto(frase))
        avisos.push(`Escribiste un precio total para el ítem ${i + 1}; indica el valor por unidad.`);
      return item;
    }
    const etiqueta = `ítem ${i + 1}${item.modelo ? ` (${item.modelo})` : ''}`;
    // Vale la línea del mensaje que contiene la frase, sin las frases de los otros ítems ni sus medidas: el precio de
    // otra puerta de la misma línea no respalda este (auditoría BUG-029).
    const otrasFrases = items
      .flatMap((o, j) => (j !== i && o.fuente ? [o.fuente.split(' · ').at(-1)!] : []))
      // Dos ítems de la misma línea comparten la frase: quitarla borraría el texto del propio ítem.
      .filter((f) => f && f !== frase);
    const lineas = frase ? mensaje.split('\n').filter((l) => fraseDelMensaje(frase, l)) : [];
    const donde = textos
      ? lineas.length
        ? lineas.map((l) => sinMedidas(sinFrasesAjenas(l, otrasFrases)))
        : textos.map(sinMedidas)
      : null;
    const leido = montoEscrito(precio.valor, donde);
    if (!leido.ok) {
      avisos.push(
        leido.ambiguo
          ? `No apliqué el precio del ${etiqueta}: «${leido.ambiguo}» no es un monto claro en pesos. Escríbelo completo, por ejemplo «a $450.000 + IVA».`
          : `No apliqué el precio del ${etiqueta}: no aparece escrito como precio en su línea del pedido.`,
      );
      return item;
    }
    // Un número suelto (una dirección, un código) no es un precio: tiene que llevar «$», «a», «por», «precio»…
    if (donde && !MARCADOR_PRECIO.test(donde.join(' '))) {
      avisos.push(
        `No apliqué el precio del ${etiqueta}: la cifra aparece en el mensaje, pero no como un precio. Escríbelo, por ejemplo «a $450.000».`,
      );
      return item;
    }
    // Un total de varias unidades nunca se toma como el precio de una, lo haya dejado vacío la IA o no.
    if ((item.cantidad ?? 0) > 1 && montoTotal(leido.valor, donde ?? [mensaje])) {
      avisos.push(`Escribiste un precio total para el ítem ${i + 1}; indica el valor por unidad.`);
      return item;
    }
    // «+ IVA» es neto y «IVA incluido» lo trae dentro: si el modelo dijo lo contrario, manda el texto
    // (auditoría BUG-028).
    let ivaDicho = precio.iva;
    if (textos) {
      const escrito = sinTildes((lineas.length ? lineas : textos).join('\n'));
      const incluido = /\biva\s+incluido\b|\bcon\s+iva\b|\bincluye\s+iva\b/.test(escrito);
      const neto = /\+\s*iva\b|\bmas\s+iva\b|\bneto\b/.test(escrito);
      if (ivaDicho === 'incluido' && neto && !incluido) {
        ivaDicho = 'neto';
        avisos.push(`Escribiste «+ IVA» en el ${etiqueta}: tomé ${pesos(leido.valor)} como precio neto.`);
      } else if (ivaDicho === 'neto' && incluido) {
        ivaDicho = 'incluido';
        avisos.push(`Escribiste «IVA incluido» en el ${etiqueta}: tomé ${pesos(leido.valor)} con el IVA dentro.`);
      }
    }
    const neto = Math.round(ivaDicho === 'incluido' ? leido.valor / (1 + reglas.iva) : leido.valor);
    if (!Number.isSafeInteger(neto) || neto <= 0 || neto > 100_000_000) {
      avisos.push(`No apliqué el precio del ${etiqueta}: debe ser un monto entre $1 y $100.000.000.`);
      return item;
    }
    if (ivaDicho === null)
      avisos.push(
        `Tomé ${pesos(neto)} como precio sin IVA del ${etiqueta}. Si lo incluía, escribe «con IVA incluido».`,
      );
    // Un ítem libre barato (una bebida) es normal: no se avisa como un precio al que le faltan ceros.
    if (neto < MONTO_BAJO && !esLibre(item))
      avisos.push(`El precio del ${etiqueta} quedó en ${pesos(neto)}: revisa si le faltan ceros.`);
    const conPrecio: SolicitudItem = { ...item, precioUnitario: neto, margen: null };
    if (nuevoLibre)
      avisos.push(`Agregué ${nombreLibre} como ítem libre a ${pesos(neto)} sin IVA c/u: no va a fábrica.`);
    if (item.personalizado) return conPrecio;
    const r = resolverItem(ctx.catalogo, conPrecio);
    if (r.ok) {
      // Como un precio escrito en el detalle: entre −50 % y 500 % sobre el costo de fábrica.
      const margen = neto / r.producto.precioNeto - 1;
      // Fuera del margen permitido se conserva: recalcular deja el ítem pendiente y su pregunta lo explica.
      if (margen < MARGEN_MIN || margen > MARGEN_MAX) return conPrecio;
      const catalogo = cotizar(
        [
          {
            producto: r.producto,
            cantidad: 1,
            anchoSolicitado: r.anchoSolicitado,
            altoSolicitado: r.altoSolicitado,
            medidaSolicitada: r.medidaSolicitada,
          },
        ],
        reglas,
        { margenCotizacion: q.margenCotizacion ?? null },
      ).lineas[0].precioUnitario;
      if (catalogo !== neto)
        avisos.push(
          `Usé el precio que indicaste para el ${etiqueta}: ${pesos(neto)} sin IVA c/u; el de catálogo es ${pesos(catalogo)}.`,
        );
      return conPrecio;
    }
    // Si faltan datos (madera, cantidad), el precio queda en el ítem hasta saber si existe en el catálogo.
    if (!SIN_CATALOGO.has(r.rechazo.tipo) || !item.modelo) return conPrecio;
    const familia = familiaItem(item, null, r.rechazo, (m) => ctx.familiaDe(m));
    const especial: SolicitudItem = {
      ...conPrecio,
      modelo:
        r.rechazo.tipo === 'modelo_desconocido'
          ? item.modelo
          : nombreCanonicoModelo(modeloDelCatalogo(ctx.catalogo, item.modelo).modelo),
      madera: item.madera ? (maderaDelCatalogo(ctx.catalogo, item.madera) ?? item.madera) : null,
      personalizado: { familia },
    };
    const medidas = [especial.ancho, especial.alto]
      .filter((n): n is number => n !== null)
      .map((n) => metrosTexto(metros(n, familia) ?? n));
    const nombre = [especial.modelo, especial.madera, medidas.length ? `${medidas.join(' × ')} m` : '']
      .filter(Boolean)
      .join(' ');
    avisos.push(
      `«${nombre}» no está en el catálogo: lo cotizo como pedido especial a ${pesos(neto)} sin IVA c/u, como lo indicaste.`,
    );
    return especial;
  });
  return { items: resultado, avisos };
}

/**
 * Descuento especial que la persona pidió para un ítem en el chat («15 % de descuento a las Molco», «rebájale
 * $20.000 c/u»). Como el precio escrito, su cifra debe estar en la línea del propio ítem (o en la conversación,
 * si su frase no se ubica); un monto es por unidad y neto. Un null o un 0 lo quita solo si el mensaje habla de
 * descuento: puede ser relleno de la IA. Sin `textos` (doble de prueba) no se ancla. Devuelve también los ítems
 * cuyo descuento cambió, para confirmarlo con los precios ya calculados (ver `confirmarDescuentos`).
 */
function descuentosEscritos(items: SolicitudItem[], mensaje: string, textos: string[] | null) {
  const avisos: string[] = [];
  /** Ítems cuyo descuento cambió, con el que tenían antes. */
  const cambiados = new Map<number, DescuentoItem | null>();
  const resultado = items.map(({ descuentoEscrito: pedido, ...item }, i): SolicitudItem => {
    if (pedido === undefined) return item;
    const etiqueta = `ítem ${i + 1}${item.modelo ? ` (${item.modelo})` : ''}`;
    // Al editar, la frase del ítem es «pedido original · cambio»: el descuento está en la última parte. Se excluyen
    // las frases de los otros ítems de la misma línea (auditoría BUG-049).
    const frase = item.fuente?.split(' · ').at(-1) ?? null;
    const otrasFrases = items
      .flatMap((o, j) => (j !== i && o.fuente ? [o.fuente.split(' · ').at(-1)!] : []))
      // Dos ítems de la misma línea comparten la frase: quitarla borraría el texto del propio ítem.
      .filter((f) => f && f !== frase);
    const lineas = frase ? mensaje.split('\n').filter((l) => fraseDelMensaje(frase, l)) : [];
    const lineasPropias = lineas.map((l) => sinFrasesAjenas(l, otrasFrases));
    const hablaDeDescuento =
      !textos || HABLA_DE_DESCUENTO.test(sinTildes((lineasPropias.length ? lineasPropias : [mensaje]).join('\n')));
    if (pedido === null || pedido.valor === 0) {
      if (!item.descuento || !hablaDeDescuento) return item;
      cambiados.set(i, item.descuento);
      const sinDescuento = { ...item };
      delete sinDescuento.descuento;
      return sinDescuento;
    }
    if (pedido.valor === null) {
      if (hablaDeDescuento)
        avisos.push(
          `Indica cuánto descuento quieres para el ${etiqueta}: un porcentaje («15 % de descuento») o un monto por unidad («$20.000 de descuento c/u»).`,
        );
      return item;
    }
    const donde = textos && lineasPropias.length ? lineasPropias : textos;
    let descuento: DescuentoItem;
    if (pedido.tipo === 'porcentaje') {
      if (!(pedido.valor > 0 && pedido.valor <= 100)) {
        avisos.push(`No apliqué el descuento del ${etiqueta}: debe ser un porcentaje mayor que 0 % y hasta 100 %.`);
        return item;
      }
      // «descuento de 2 molco» no dice un porcentaje: sin «%» ni «por ciento», un número seguido de una palabra es
      // ambiguo (auditoría BUG-049).
      const texto = donde?.join(' ') ?? '';
      if (texto && !/(?:%|por\s+ciento)/i.test(texto) && /descuento\s+de\s+\d+(?:[.,]\d+)?\s+[a-zñ]/i.test(texto)) {
        avisos.push(
          `No apliqué el descuento del ${etiqueta}: no queda claro si ese número es un porcentaje. Escríbelo con «%», por ejemplo «15 % de descuento».`,
        );
        return item;
      }
      const valor = porcentajeEscrito(pedido.valor, donde);
      if (valor === null) {
        avisos.push(`No apliqué el descuento del ${etiqueta}: el porcentaje no aparece escrito en su línea del pedido.`);
        return item;
      }
      descuento = { tipo: 'porcentaje', valor };
    } else {
      // «15 % de descuento» no respalda un descuento de $15.
      const leido = montoEscrito(pedido.valor, textosSinPorcentajes(donde));
      if (!leido.ok) {
        avisos.push(
          leido.ambiguo
            ? `No apliqué el descuento del ${etiqueta}: «${leido.ambiguo}» no es un monto claro en pesos. Escríbelo completo, por ejemplo «$20.000 de descuento c/u».`
            : `No apliqué el descuento del ${etiqueta}: el monto no aparece escrito en su línea del pedido.`,
        );
        return item;
      }
      // «$20.000 en total» no es un descuento por unidad: se pide el de cada una (auditoría BUG-049).
      if ((item.cantidad ?? 0) > 1 && montoTotal(leido.valor, donde ?? [mensaje])) {
        avisos.push(
          `Escribiste un descuento total para el ${etiqueta}; indica cuánto descuenta por unidad (por ejemplo «$10.000 c/u»).`,
        );
        return item;
      }
      descuento = { tipo: 'monto', valor: leido.valor };
    }
    if (!descuentoItemValido(descuento)) {
      avisos.push(
        descuento.tipo === 'porcentaje'
          ? `No apliqué el descuento del ${etiqueta}: el porcentaje admite hasta dos decimales.`
          : `No apliqué el descuento del ${etiqueta}: debe ser un monto entero en pesos, hasta $100.000.000.`,
      );
      return item;
    }
    if (descuento.tipo === 'monto' && descuento.valor < MONTO_BAJO)
      avisos.push(`El descuento del ${etiqueta} quedó en ${pesos(descuento.valor)} c/u: revisa si le faltan ceros.`);
    const nuevo = { ...item, descuento };
    if (claveDescuento(nuevo) !== claveDescuento(item)) cambiados.set(i, item.descuento ?? null);
    return nuevo;
  });
  return { items: resultado, avisos, cambiados };
}

/**
 * Lo que el chat confirma de cada descuento especial que aplicó o quitó: el precio original y el rebajado, como
 * los verá el cliente. Un ítem pendiente lo explica su pregunta (también un monto mayor que su precio).
 */
function confirmarDescuentos(q: Cotizacion, cambiados: Map<number, DescuentoItem | null>) {
  return [...cambiados.keys()].sort((a, b) => a - b).flatMap((i) => {
    const s = q.solicitudes[i];
    if (!s) return [];
    const linea = q.montos.lineas.find((l) => l.indice === i);
    const etiqueta = `ítem ${i + 1}${s.modelo ? ` (${s.modelo})` : ''}`;
    if (!s.descuento)
      return [`Quité el descuento especial del ${etiqueta}${linea ? `: vuelve a ${pesos(linea.precioUnitario)} c/u` : ''}.`];
    if (!linea)
      return q.incompletos.some((p) => p.indice === i && p.rechazo.tipo === 'faltan_datos' && p.rechazo.campos.includes('precio'))
        ? []
        : [`Anoté un descuento especial de ${textoDescuentoItem(s.descuento)} para el ${etiqueta}: se aplica cuando el ítem esté completo.`];
    return [
      `Descuento especial de ${textoDescuentoItem(s.descuento)} en el ${etiqueta}: ${pesos(linea.precioUnitario)} → ${pesos(precioConDescuento(linea))} c/u${linea.cantidad > 1 ? ` (ahorro ${pesos(ahorroLinea(linea))})` : ''}.`,
    ];
  });
}

/**
 * Trozos del mensaje que piden productos y no quedaron en ningún ítem nuevo. Solo se revisa cuando la IA
 * agrega ítems (o el borrador está vacío): una edición o un «saca los marcos» no tiene por qué cubrirlo.
 */
function pedidosOmitidos(
  ctx: ContextoChat,
  cambios: ModificacionCotizacion,
  mensaje: string,
  base: Cotizacion,
  resolver: Record<'modelo' | 'madera', ResolverNombre>,
): string[] {
  if (cambios.items?.length || cambios.quitar?.length) return [];
  if (!cambios.agregar?.length && base.solicitudes.length) return [];
  const frases = (cambios.agregar ?? []).map((s) => s.fuente?.trim() ?? '');
  // Sin la frase de cada ítem no se puede saber qué parte del mensaje cubre.
  if (frases.some((f) => !f)) return [];
  const cliente = { ...base.cliente, ...(cambios.cliente ?? {}) };
  const otros = [
    ...base.solicitudes.map((s) => s.fuente ?? ''),
    ...Object.values(cliente).filter((v): v is string => typeof v === 'string'),
  ];
  const faltan = pedidosSinRegistrar(mensaje, frases, otros, resolver, { conFlete: !!cambios.flete }) ?? [];
  // «… con su marco 2x5» suele quedar dentro de la frase de la puerta: si no hay ningún marco, falta.
  const conMarco = /\bcon\s+(?:sus?\s+)?marcos?\b[^,.;\n]*/i.exec(mensaje);
  const hayMarco = [...(cambios.agregar ?? []), ...base.solicitudes].some(
    (s) => !!s.modelo && ctx.familiaDe(resolver.modelo(s.modelo) ?? s.modelo) === 'MARCO',
  );
  if (conMarco && !hayMarco) faltan.push(conMarco[0].trim());
  return faltan;
}

/**
 * Texto libre que la IA agregó a un ítem solo vale si está escrito en el mensaje o en su frase: una descripción o una
 * observación inventada llegaba al PDF del cliente y a la nota de fábrica (auditoría BUG-009).
 */
function anclarTextos(items: SolicitudItem[], textos: string[]): { items: SolicitudItem[]; avisos: string[] } {
  const avisos: string[] = [];
  const plano = (t: string) => sinTildes(t).toLowerCase().replace(/\s+/g, ' ').trim();
  const escrito = (valor: string) =>
    !!plano(valor) && textos.some((t) => plano(t).includes(plano(valor)));
  const resultado = items.map((item, i) => {
    const siguiente = { ...item };
    // Un ítem libre se nombra con su descripción: ahí el nombre es el dato.
    if (item.libre || esLibre(siguiente)) return siguiente;
    for (const campo of ['descripcion', 'observaciones'] as const) {
      const valor = siguiente[campo];
      if (!valor || escrito(valor)) continue;
      delete siguiente[campo];
      avisos.push(
        `No guardé ${campo === 'descripcion' ? 'la descripción' : 'la observación'} que el asistente agregó al ítem ${i + 1}: no aparece en tu mensaje.`,
      );
    }
    return siguiente;
  });
  return { items: resultado, avisos };
}

/** Los datos del cliente que la IA cambió también deben estar escritos: no se sobrescribe con lo inventado. */
function anclarCliente(cliente: Partial<Cliente>, textos: string[]): { cliente: Partial<Cliente>; avisos: string[] } {
  const avisos: string[] = [];
  const plano = (t: string) => sinTildes(t).toLowerCase().replace(/\s+/g, ' ').trim();
  const digitos = (t: string) => t.replace(/\D/g, '');
  const resultado: Partial<Cliente> = { ...cliente };
  for (const campo of ['nombre', 'rut', 'giro', 'telefono', 'direccion', 'comuna', 'proyecto'] as const) {
    const valor = resultado[campo];
    if (valor === undefined || valor === null) continue;
    const escrito =
      campo === 'rut' || campo === 'telefono'
        ? !!digitos(valor) && textos.some((t) => digitos(t).includes(digitos(valor)))
        : !!plano(valor) && textos.some((t) => plano(t).includes(plano(valor)));
    if (escrito) continue;
    delete resultado[campo];
    avisos.push(`No guardé el dato del cliente que el asistente agregó (${campo}): no aparece en tu mensaje.`);
  }
  return { cliente: resultado, avisos };
}

/**
 * El índice que propuso la IA tiene que ser el del ítem que nombra el mensaje (auditoría BUG-007): con dos Molco,
 * editar o quitar «las Coz Coz» por el índice 0 borraba la puerta equivocada.
 */
function indiceCoherente(items: SolicitudItem[], indice: number, texto: string): boolean {
  const s = items[indice];
  if (!s?.modelo) return true;
  const plano = normalizar(texto);
  const modelos = [...new Set(items.map((i) => i.modelo).filter((m): m is string => !!m))];
  const mencionados = modelos.filter((m) => plano.includes(normalizar(m)));
  // Sin un modelo en el mensaje no hay con qué confundir el índice que dio la IA.
  if (!mencionados.length) return true;
  return mencionados.includes(s.modelo);
}

/**
 * Un texto sin las medidas («90x210», «80 x 200 cm»): una medida nunca es un precio ni un descuento
 * (auditoría BUG-029).
 */
const sinMedidas = (texto: string) =>
  texto.replace(
    /\d+(?:[.,]\d+)?\s*(?:m|mt|mts|mtrs|metros?|cm|mm|"|”|pulg(?:adas?)?)?\s*(?:x|×|\*|por)\s*\d+(?:[.,]\d+)?(?:\s*(?:m|mt|mts|mtrs|metros?|cm|mm|"|”|pulg(?:adas?)?))?/gi,
    ' ',
  );
/** Un precio escrito lleva una marca de monto; un número suelto (una dirección, un código) no lo es. */
const MARCADOR_PRECIO = /(?:\$|\ba\b|\bpor\b|\bprecio\b|\bvalor\b|\bc\/u\b|\bmil\b|\blucas?\b|\bpesos?\b)/i;
/** Lo escrito sin las frases de los otros ítems: el precio o el descuento de uno no vale para otro. */
const sinFrasesAjenas = (texto: string, frases: string[]) =>
  frases.reduce((t, frase) => (frase ? t.split(frase).join(' ') : t), texto);

function aplicarModificacion(ctx: ContextoChat, base: Cotizacion, cambios: ModificacionCotizacion, mensaje: string) {
  const items = structuredClone(base.solicitudes);
  const descartados: [SolicitudItem, Descartes][] = [];
  const actualizar = cambios.items ?? [];
  const quitar = cambios.quitar ?? [];
  const actualizarIndices = new Set<number>();
  const quitarIndices = new Set<number>();
  if (
    !actualizar.length &&
    !quitar.length &&
    !cambios.agregar?.length &&
    !Object.keys(cambios.cliente ?? {}).length &&
    cambios.flete === undefined
  )
    return null;
  for (const cambio of actualizar) {
    if (
      cambio.indice >= items.length ||
      actualizarIndices.has(cambio.indice) ||
      !Object.keys(cambio.cambios).length
    )
      return null;
    // La frase del cambio, si la trae, es lo que la persona escribió para ese ítem.
    if (!indiceCoherente(items, cambio.indice, cambio.cambios.fuente ?? mensaje)) return null;
    actualizarIndices.add(cambio.indice);
    const siguiente = { ...items[cambio.indice], ...desdeIA(cambio.cambios) };
    // La frase del cambio se suma a la del pedido original: juntas explican de dónde sale el ítem. Si no
    // caben, se recorta la anterior: la del cambio es la que se busca en el mensaje.
    if (cambio.cambios.fuente !== undefined) {
      const previa = items[cambio.indice].fuente ?? null,
        nueva = siguiente.fuente ?? null;
      const recortada = previa?.slice(0, Math.max(0, 300 - (nueva?.length ?? 0) - 3)).trim();
      siguiente.fuente =
        previa && nueva && !previa.includes(nueva)
          ? recortada
            ? textoCampo('fuente', `${recortada} · ${nueva}`)
            : nueva
          : (previa ?? nueva);
    }
    if (cambio.cambios.modelo !== undefined) reiniciarOrigenModelo(siguiente);
    const anterior = items[cambio.indice];
    const descartes = descartarDelProducto(anterior, siguiente, {
      antes: ctx.producto(anterior, siguiente),
      despues: ctx.producto(siguiente, anterior),
    });
    if (descartes) descartados.push([siguiente, descartes]);
    items[cambio.indice] = siguiente;
  }
  for (const indice of quitar) {
    if (indice >= items.length || quitarIndices.has(indice) || actualizarIndices.has(indice)) return null;
    if (!indiceCoherente(items, indice, mensaje)) return null;
    quitarIndices.add(indice);
  }
  for (const indice of [...quitarIndices].sort((a, b) => b - a)) items.splice(indice, 1);
  // Un ítem que la IA repite (en el mismo turno o con la frase de un turno anterior) suma en silencio y duplica el
  // pedido. Se descarta, con un aviso (auditoría BUG-008).
  const claveItem = (s: SolicitudItem) =>
    JSON.stringify([s.modelo?.toLowerCase(), s.madera?.toLowerCase(), s.ancho, s.alto, s.medida?.toLowerCase(), s.cantidad, s.tipoMedida]);
  const vistos = new Set(items.map(claveItem));
  const duplicados: string[] = [];
  const nuevos: SolicitudItem[] = [];
  for (const s of (cambios.agregar ?? []).map((x) => desdeIA(x))) {
    const clave = claveItem(s);
    if (vistos.has(clave)) {
      duplicados.push(ctx.describir(s));
      continue;
    }
    vistos.add(clave);
    nuevos.push(s);
  }
  items.push(...nuevos);
  if (items.length > 100) return null;
  return {
    items,
    cliente: { ...base.cliente, ...(cambios.cliente ?? {}) },
    avisos: [
      ...descartados.map(([d, descartes]) => avisoProductoCambiado(items.indexOf(d) + 1, descartes)),
      ...(duplicados.length
        ? [`No dupliqué ${duplicados.join(', ')}: ya estaba en la cotización con la misma cantidad.`]
        : []),
    ],
  };
}

export async function procesarChat(ctx: ContextoChat, accion: Extract<Accion, { tipo: 'chat' }>): Promise<Resultado> {
  // La IA puede tardar hasta el plazo configurado: se consulta sin retener el bloqueo del estado,
  // para no dejar esperando (ni fallar) las acciones de otra persona.
  const conversacion = accion.id ? ctx.almacen.obtener(accion.id) : null;
  if (accion.id && !conversacion) throw new ErrorNoEncontrado();
  if (!accion.id && accion.nuevoId) verificarNoProcesado(ctx.almacen, accion.nuevoId);
  if (conversacion && accion.actualizada !== undefined && accion.actualizada !== conversacion.actualizada)
    throw new ErrorConflicto(VERSION_OBSOLETA);
  let previo: Cotizacion | null = null;
  let modo: 'cotizacion_nueva' | 'modificacion_anterior' = 'cotizacion_nueva';
  if (accion.objetivoId) {
    previo = ctx.almacen.obtener(accion.objetivoId);
    if (!previo) throw new ErrorNoEncontrado('No se encontró la cotización seleccionada.');
    if (!accion.objetivoActualizada || accion.objetivoActualizada !== previo.actualizada)
      throw new ErrorConflicto(
        'La cotización cambió. Elige nuevamente la cotización que quieres modificar.',
      );
    modo = 'modificacion_anterior';
  } else {
    // Las cifras de un cambio de número son números de documento: con una conversación abierta, el cambio es sobre
    // ella (o sobre el documento que nombre la IA en `actual`), no sobre la cotización que tenga ese número.
    const referencia =
      SOLICITUD_APROBACION.test(accion.mensaje) || (conversacion && CAMBIO_NUMERO.test(accion.mensaje))
        ? { tipo: 'ninguna' as const }
        : resolverReferencia(accion.mensaje, ctx.almacen.candidatas(), conversacion?.id);
    if (referencia.tipo === 'inexistente')
      throw new ErrorNoEncontrado(
        `No existe la cotización N° ${referencia.numero}. Revisa el número o búscala en el historial; no se aplicó ningún cambio.`,
      );
    if (referencia.tipo === 'multiples') {
      const contexto = conversacion ?? ctx.almacen.obtener(referencia.opciones[0].id);
      if (!contexto) throw new ErrorNoEncontrado('No se encontró la cotización seleccionada.');
      return { cotizacion: contexto, seleccion: referencia.opciones };
    }
    if (referencia.tipo === 'unica') {
      previo = ctx.almacen.obtener(referencia.cotizacion.id);
      if (!previo) throw new ErrorNoEncontrado();
      modo = 'modificacion_anterior';
    } else previo = conversacion;
  }
  // Una aprobada solo admite, por chat, repartir sus ítems entre fábricas y cambiar números (se revisa con la respuesta).
  if (previo && previo.estado !== 'aprobada') ctx.exigirEditable(previo);
  // M4: si la emitida ya tiene una revisión abierta, el cambio se aplica sobre esa revisión.
  if (previo?.estado === 'emitida') previo = ctx.almacen.revisionAbierta(previo) ?? previo;
  // M1: el borrador nuevo se escribe recién con la respuesta de la IA; si falla, no queda nada.
  const nuevo = previo ? null : { ...ctx.nueva(), ...(accion.nuevoId ? { id: accion.nuevoId } : {}) };
  const base = previo ?? nuevo!;
  // Sin borrador, el contexto de la conversación es el intercambio previo que no se guardó.
  const historialIA = (nuevo ? (accion.contexto ?? []) : base.historial).slice(-TURNOS_HISTORIAL);
  const resolver = resolverNombres(ctx.catalogo);
  // Familia del modelo que nombró la persona o la IA (también con un alias): fija el rango de sus medidas.
  const familia = (modelo: string) => ctx.familiaDe(resolver.modelo(modelo) ?? modelo);
  // En modo «avisar» la lectura de la IA no se enmienda: sin atajos ni reordenar el mensaje, y solo se reintenta un
  // pedido respondido por el chat o una fábrica dicha sin asignar (ver `revisarSalida`).
  const corrige = (ctx.llm.anclaje ?? 'corregir') === 'corregir';
  // Un dato suelto que responde la pregunta pendiente («lenga», «son 3») se aplica sin consultar a la IA,
  // igual que los botones. Los dobles de prueba (sin verificarCifras) siempre pasan por la IA.
  const directa =
    ctx.llm.verificarCifras && corrige && previo?.estado === 'borrador' && modo === 'cotizacion_nueva'
      ? respuestaDirecta(base, accion.mensaje, resolver, familia)
      : null;
  let salida: unknown = directa;
  if (!directa)
    try {
      salida = await ctx.llm.interpretar(
        contextoSeguro(
          corrige ? fleteAlFinal(accion.mensaje) : accion.mensaje,
          base.solicitudes,
          base.cliente,
          modelosCatalogo(ctx.catalogo),
          maderasCatalogo(ctx.catalogo),
          historialIA,
          modo,
          modo === 'modificacion_anterior'
            ? { numero: base.numero ?? base.origen ?? null, estado: base.estado }
            : null,
          {
            modelos: aliasModelosCatalogo(ctx.catalogo),
            maderas: aliasMaderasCatalogo(ctx.catalogo),
            catalogo: mapaCatalogo(ctx.catalogo),
            ...(base.numero !== null
              ? {
                  documentos: {
                    estado: base.estado,
                    numero: base.numero,
                    notas: base.notas.map((n) => ({ fabrica: n.fabrica ?? null, numero: n.numero })),
                  },
                }
              : {}),
          },
        ),
        ctx.llm.verificarCifras
          ? { revisar: (s) => revisarSalida(ctx, s, accion.mensaje, base, modo, resolver, corrige) }
          : {},
      );
    } catch (error) {
      if (error instanceof ErrorIA) throw error;
      throw errorProveedor();
    }
  // Para el diagnóstico: la herramienta que usó la IA y de dónde salió cada aviso (sin marca, `otros`).
  let herramienta: string | null = directa ? 'directa' : null;
  const categorias = new Map<string, CategoriaAviso>();
  const marcar = (categoria: CategoriaAviso, avisos: string[]) => {
    for (const texto of avisos) categorias.set(texto, categoria);
    return avisos;
  };
  const resultado = await ctx.almacen.transaccion((u): Resultado => {
    let q: Cotizacion;
    if (nuevo) {
      // Se guarda recién si el mensaje trae un pedido o datos del cliente (ver `efimera`).
      if (u.obtener(nuevo.id)) throw errorProcesado(nuevo.id);
      q = nuevo;
    } else {
      q = ctx.obtener(u, base.id);
      // Control optimista: la respuesta se calculó sobre la versión leída antes de consultar a la IA.
      if (q.actualizada !== base.actualizada)
        throw new ErrorConflicto(
          'La cotización cambió mientras se procesaba tu mensaje. Revisa el detalle y vuelve a enviarlo.',
        );
      if (q.estado !== 'aprobada') ctx.exigirEditable(q);
    }
    const responder = (texto: string, extra: Omit<Resultado, 'cotizacion'> = {}): Resultado => {
      registrar(q, accion.mensaje, texto);
      if (q === nuevo) return { cotizacion: q, ...extra, efimera: true };
      u.guardar(q);
      return { cotizacion: q, ...extra };
    };
    const parsed = salidaSchema.safeParse(salida);
    if (!parsed.success) return responder(NO_ENTENDI);
    const res = parsed.data;
    if (!directa) herramienta = res.name;
    if (res.name === 'aprobar_cotizacion') {
      const numero = res.input.numero;
      // El número de la cotización tiene que estar escrito: la IA no lo propone de la nada (auditoría BUG-051).
      if (!enterosEscritos(accion.mensaje).has(numero))
        return responder(
          `¿Qué cotización quieres aprobar? Escribe su número, por ejemplo «el cliente aprobó la N° ${numero}».`,
        );
      const objetivo = u.porNumero(numero);
      if (!objetivo) return responder(`No existe la cotización N° ${numero}. Genera primero su PDF.`);
      if (objetivo.estado === 'anulada')
        return responder(
          `La cotización N° ${numero} está anulada${objetivo.notas.length ? `, junto con ${textoNotas(objetivo.notas)},` : ''} y no se puede aprobar. Duplícala para preparar una nueva.`,
        );
      if (objetivo.notas.length)
        return responder(
          `La cotización N° ${numero} ya está aprobada con ${textoNotas(objetivo.notas)}.`,
          { archivo: objetivo.notas[0].pdf },
        );
      if (objetivo.estado !== 'emitida')
        return responder(
          objetivo.estado === 'borrador'
            ? `La cotización N° ${numero} todavía no se emite. Genera y revisa su PDF antes de aprobarla.`
            : `La cotización N° ${numero} está ${objetivo.estado} y no se puede aprobar.`,
        );
      const aprobada = u.serie(objetivo.id).find((s) => s.estado === 'aprobada');
      if (aprobada)
        return responder(
          `La cotización N° ${aprobada.numero} de la misma serie ya fue aprobada; no se puede aprobar la N° ${numero}.`,
        );
      const vencida = estaVencida(objetivo.vence);
      const texto = `¿Confirmas que el cliente aprobó la cotización N° ${numero}? Se registrará la aprobación; la nota de pedido estará disponible al registrar al menos ${ANTICIPO_TEXTO} de pago.${vencida ? ` Atención: venció el ${fechaChilena(objetivo.vence!)}.` : ''}`;
      const resultado = responder(texto);
      return {
        ...resultado,
        confirmar: {
          id: objetivo.id,
          numero,
          // Si el objetivo es la misma conversación, el historial no cambia su versión (sigue emitida).
          actualizada: objetivo.actualizada,
          vence: objetivo.vence,
          vencida,
        },
      };
    }
    // Lo que la persona escribió en esta conversación: una fábrica que no aparece ahí, la dedujo la IA.
    const textosPersona = [accion.mensaje, ...historialIA.filter((m) => m.rol === 'usuario').map((m) => m.texto)];
    const reparto =
      res.name === 'asignar_fabricas'
        ? itemsDelReparto(ctx, q, res.input.asignaciones)
        : res.name === 'modificar_cotizacion'
          ? soloFabricas(res.input)
          : null;
    if (reparto) {
      if (!reparto.length || reparto.some((a) => a.indice >= q.solicitudes.length)) return responder(NO_ENTENDI);
      const dichas = reparto.filter((a) => a.fabrica === null || fabricaEscrita(a.fabrica, textosPersona));
      if (!dichas.length) return responder(PREGUNTA_FABRICA);
      let texto: string;
      try {
        texto = ctx.asignarFabricas(q, u, dichas).texto;
      } catch (error) {
        if (error instanceof ErrorUsuario) return responder(error.message);
        throw error;
      }
      const sinFabrica = q.solicitudes.filter((s) => !s.fabrica && !esLibre(s));
      return responder(
        [
          texto ? `Fábricas asignadas: ${texto}.` : 'Esos ítems ya tenían esa fábrica.',
          ...(dichas.length < reparto.length
            ? [
                `No asigné ${reparto
                  .filter((a) => !dichas.includes(a))
                  .map((a) => ctx.describir(q.solicitudes[a.indice]))
                  .join(', ')}: el mensaje no dice a qué fábrica va.`,
              ]
            : []),
          ...(sinFabrica.length ? [`Falta asignar la fábrica de: ${sinFabrica.map((s) => ctx.describir(s)).join(', ')}.`] : []),
        ].join('\n\n'),
      );
    }
    if (res.name === 'cambiar_numero') return cambiarNumeroPorChat(ctx, u, q, res.input, accion.mensaje, responder);
    if (q.estado === 'aprobada') return responder(NO_EDITABLE_APROBADA);
    let propuesta: { items: SolicitudItem[]; cliente: Partial<Cliente>; avisos: string[] };
    let avisosFabrica: string[] = [];
    if (res.name === 'actualizar_cotizacion') {
      if (modo === 'modificacion_anterior') return responder(NO_ENTENDI);
      // La IA ya no reemplaza la lista completa sin que el mensaje lo pida: podía borrar una puerta en silencio
      // (auditoría BUG-026). Si la lista nueva deja fuera una puerta, el mensaje tiene que nombrarla.
      if (q.solicitudes.length && res.input.items.length < q.solicitudes.length) {
        const texto = normalizar(accion.mensaje);
        const nuevos = res.input.items.map((i) => normalizar(i.modelo ?? ''));
        const puertaPerdida = q.solicitudes.some((s) => {
          if (!s.modelo || nuevos.includes(normalizar(s.modelo))) return false;
          const familia = s.personalizado?.familia ?? ctx.familiaDe(s.modelo);
          return familia === 'PUERTA' && !texto.includes(normalizar(s.modelo));
        });
        if (puertaPerdida) return responder(NO_ENTENDI);
      }
      // La IA devuelve la lista completa sin margen ni precio: se recuperan las ediciones manuales de q. Una fábrica
      // que el mensaje no nombra no se toma (el ítem conserva la que tenía).
      const { items, avisos: avisosFusion } = fusionarItems(
        q.solicitudes,
        res.input.items.map(({ fabrica, ...s }) =>
          desdeIA({ ...s, ...(fabrica && fabricaEscrita(fabrica, textosPersona) ? { fabrica } : {}) }),
        ),
        (s, pareja) => ctx.producto(s, pareja),
      );
      propuesta = {
        items,
        avisos: avisosFusion,
        cliente: {
          ...res.input.cliente,
          giro: res.input.cliente.giro === undefined ? q.cliente.giro : res.input.cliente.giro,
        },
      };
    } else if (res.name === 'modificar_cotizacion') {
      const dichas = fabricasDichas(res.input, textosPersona, (i) =>
        q.solicitudes[i] ? ctx.describir(q.solicitudes[i]) : `el ítem ${i + 1}`,
      );
      avisosFabrica = [
        ...dichas.avisos,
        // Si ni el reintento la asignó, la fábrica dicha que falta no pasa en silencio.
        ...marcar(
          'noRegistre',
          fabricasSinAsignar(accion.mensaje, dichas.input).map(
            (f) => `No registré la fábrica de ${nombreFabrica[f]} que indicaste: revisa a qué ítems va.`,
          ),
        ),
      ];
      // En una cotización nueva los índices se refieren al borrador en curso (vacío si aún no existe).
      const aplicado = aplicarModificacion(ctx, q, dichas.input, accion.mensaje);
      if (!aplicado) return responder(avisosFabrica.length ? [...avisosFabrica, PREGUNTA_FABRICA].join('\n\n') : NO_ENTENDI);
      propuesta = aplicado;
    } else if (res.name === 'responder') {
      // En «avisar», si ni el reintento lo registró, un pedido respondido con texto no puede pasar en silencio.
      const sinRegistrar =
        ctx.llm.verificarCifras && !corrige && pedidoSinRegistrar(accion.mensaje, base, modo, resolver)
          ? marcar('responder', [PEDIDO_SIN_REGISTRAR])
          : [];
      // No deja pasar montos inventados ni texto monetario desde el modelo.
      return responder(
        textoMonetario(res.input.texto)
          ? 'Puedo ayudarte con modelos, maderas, medidas, cantidades y datos del cliente. Los montos se muestran en la cotización.'
          : res.input.texto,
        sinRegistrar.length ? { avisos: sinRegistrar } : {},
      );
    } else return responder(NO_ENTENDI);
    // Lo que vio la IA: el mensaje y los turnos recientes. Una cifra que no está ahí, la inventó.
    const textosIA = [accion.mensaje, ...historialIA.filter((m) => m.rol === 'usuario').map((m) => m.texto)];
    const { linea: flete, avisos: avisosFlete } = fleteDelChat(
      res.name === 'modificar_cotizacion' ? res.input.flete : undefined,
      q,
      { textos: ctx.llm.verificarCifras && !directa ? textosIA : null, iva: (q.reglas ?? REGLAS).iva },
    );
    const cambiaFlete =
      !!flete &&
      (flete.flete !== q.flete ||
        flete.fleteCantidad !== cantidadFlete(q) ||
        flete.fleteDescripcion !== (q.fleteDescripcion ?? null));
    propuesta.avisos.push(...avisosFlete, ...avisosFabrica);
    if (ctx.llm.verificarCifras && !directa) {
      // «sí» a «¿Te refieres a X?» (lo que pide el prompt): el ítem cuenta como si el borrador ya dijera X.
      // Respalda solo ese nombre; las cifras y los demás nombres siguen saliendo de lo que escribió la persona.
      // «la primera» a una pregunta con opciones respalda igual esa opción.
      const confirmados: { indice: number; item: SolicitudItem }[] = [
        ...(afirmacionBreve(accion.mensaje)
          ? q.incompletos.flatMap(({ indice, rechazo }) => {
              const s = q.solicitudes[indice];
              if (rechazo.tipo !== 'modelo_posible' || !s) return [];
              // Con la forma que usó la IA («HUILO HUILO») si el catálogo la lleva al mismo modelo.
              const propio = propuesta.items[indice]?.modelo,
                sugerido = resolver.modelo(rechazo.sugerido);
              const modelo =
                propio && sugerido && resolver.modelo(propio) === sugerido ? propio : rechazo.sugerido;
              return [{ indice, item: { ...s, modelo } }];
            })
          : []),
        ...opcionElegida(accion.mensaje, q),
      ];
      // Lo confirmado respalda su valor por ser una confirmación explícita de la persona, en cualquier índice.
      const previos = [...q.solicitudes, ...confirmados.map(({ item }) => ({ ...item, confirmado: true }))];
      // Primero cada ítem contra su propia frase, para que no tome la madera o la cantidad de otro.
      const anteriores = historialIA.filter((m) => m.rol === 'usuario').map((m) => m.texto);
      const leidoPorFrase = anclarFrases(
        propuesta.items,
        previos,
        accion.mensaje,
        resolver,
        anteriores,
        familia,
        (modelo, madera) => escuadriasDe(ctx, resolver.modelo(modelo) ?? modelo, madera),
      );
      const leidos = leidoPorFrase.avisos.filter(
        (a) => !editadoEnElMensaje(a, propuesta.items, q.solicitudes, accion.mensaje),
      );
      const anclado = anclarCifras(corrige ? leidoPorFrase.items : propuesta.items, previos, textosIA, familia);
      const pedidasComo = (modelo: string | null, madera: string) =>
        modelo ? maderasConEquivalente(familia(modelo), madera) : [];
      const nombres = anclarNombres(
        anclado.items,
        previos,
        textosIA,
        { modelo: aliasModelosCatalogo(ctx.catalogo), madera: aliasMaderasCatalogo(ctx.catalogo) },
        resolver,
        pedidasComo,
      );
      const porFrase = corrige
        ? {
            ...leidoPorFrase,
            avisos: leidos.map((a) => marcar(a.startsWith('No reconocí') ? 'palabra' : 'campo', [a])[0]),
          }
        : {
            items: propuesta.items,
            avisos: [
              // Sin corregir, la frase que no se ubicó se avisa igual: la lectura de la IA quedó sin revisar.
              ...marcar('campo', leidos.filter((a) => a.startsWith('No pude verificar'))),
              // Contra lo que queda en la cotización: una cifra o un nombre que el anclaje ya dejó pendiente tiene
              // su propio aviso; no se avisa además como «anoté…» ni como «tu mensaje parece decir…».
              ...marcar(
                'campo',
                avisosDeCampos(
                  nombres.items,
                  sinLoDejado(propuesta.items, leidoPorFrase.items, nombres.items),
                  familia,
                  pedidasComo,
                ),
              ),
              ...marcar('palabra', avisosDePalabras(propuesta.items, accion.mensaje, resolver)),
            ],
          };
      propuesta = {
        ...propuesta,
        items: nombres.items,
        avisos: [
          ...propuesta.avisos,
          ...porFrase.avisos,
          ...marcar('cifras', anclado.avisos),
          ...marcar('nombres', nombres.avisos),
        ],
      };
      // Lo que la IA no registró ni tras la corrección se avisa: la cotización no debe verse completa.
      if (res.name === 'modificar_cotizacion') {
        const faltan = pedidosOmitidos(ctx, res.input, accion.mensaje, base, resolver);
        if (faltan.length)
          propuesta.avisos.push(
            ...marcar('noRegistre', [
              `No registré: ${faltan.map((f) => `«${f}»`).join(', ')}. Revisa si falta y escríbelo de nuevo.`,
            ]),
          );
      }
    }
    // Texto libre y datos del cliente que la IA agregó: valen solo si están escritos en lo que vio el modelo.
    if (ctx.llm.verificarCifras && !directa) {
      const textosLibres = [...textosIA, ...propuesta.items.flatMap((s) => (s.fuente ? [s.fuente] : []))];
      const conTextos = anclarTextos(propuesta.items, textosLibres);
      const conCliente = anclarCliente(propuesta.cliente, textosLibres);
      propuesta = {
        ...propuesta,
        items: conTextos.items,
        cliente: conCliente.cliente,
        avisos: [...propuesta.avisos, ...marcar('campo', [...conTextos.avisos, ...conCliente.avisos])],
      };
    }
    const conPrecios = preciosEscritos(
      ctx,
      propuesta.items,
      accion.mensaje,
      ctx.llm.verificarCifras && !directa ? textosIA : null,
      q,
    );
    const conDescuentos = descuentosEscritos(
      conPrecios.items,
      accion.mensaje,
      ctx.llm.verificarCifras && !directa ? textosIA : null,
    );
    propuesta = {
      ...propuesta,
      items: conDescuentos.items,
      avisos: [...propuesta.avisos, ...conPrecios.avisos, ...conDescuentos.avisos],
    };
    const { solicitudes, avisos: avisosItems } = sanearSolicitudes(propuesta.items, accion.mensaje);
    const { cliente, avisos: avisosCliente } = sanearCliente(propuesta.cliente);
    const avisos = [...propuesta.avisos, ...avisosItems, ...avisosCliente];
    const extra = avisos.length ? { avisos } : {};
    if (q === nuevo && !solicitudes.length && !cambiaFlete && Object.values(cliente).every((v) => v === null))
      return responder(
        'Cuéntame qué necesitas cotizar: modelo, madera, medidas y cantidad. También puedes agregar los datos del cliente.',
        extra,
      );
    if (
      ctx.sinCambios(q, solicitudes, cliente) &&
      !cambiaFlete &&
      (q.estado !== 'borrador' || modo === 'modificacion_anterior')
    )
      return responder(
        [
          ...avisos,
          `No hay cambios respecto de la cotización N° ${q.numero ?? q.origen ?? 'en borrador'}.`,
        ].join('\n\n'),
        extra,
      );
    const antes = q.solicitudes,
      clienteAntes = q.cliente;
    const destino = ctx.abrirEdicion(q, u);
    const descuentoAntes = descuentoDe(destino);
    destino.solicitudes = solicitudes;
    destino.cliente = cliente;
    const extrasFlete: string[] = [];
    if (flete && cambiaFlete) {
      if (flete.flete !== destino.flete) extrasFlete.push(`Flete ${pesos(destino.flete)} → ${pesos(flete.flete)}`);
      if (flete.fleteCantidad !== cantidadFlete(destino))
        extrasFlete.push(`Cantidad del flete: ${cantidadFlete(destino)} → ${flete.fleteCantidad}`);
      if (flete.fleteDescripcion !== (destino.fleteDescripcion ?? null))
        extrasFlete.push(`Descripción del flete: ${flete.fleteDescripcion ?? 'automática'}`);
      Object.assign(destino, flete);
    }
    const recalculo = ctx.recalcular(destino);
    destino.solicitudes = recalculo.solicitudes;
    const todos = [
      ...avisos,
      ...recalculo.avisos,
      ...confirmarDescuentos(destino, conDescuentos.cambiados),
    ];
    const exito =
      modo === 'modificacion_anterior'
        ? `Cotización actualizada${destino.origen ? ` como revisión de la N° ${destino.origen}` : ''}. Revisa el detalle y genera el PDF cuando esté listo.`
        : 'Cotización actualizada. Revisa el detalle y genera el PDF cuando esté listo.';
    registrar(
      destino,
      accion.mensaje,
      [
        // Las preguntas se guardan primero para sobrevivir al recorte del historial.
        ...destino.incompletos.map((i) => i.pregunta),
        ...todos,
        ...(extrasFlete.length
          ? [`Flete: ${cantidadFlete(destino)} × ${descripcionFlete(destino)}, ${pesos(unitarioFlete(destino))} sin IVA c/u.`]
          : []),
        // Lo que no existe en el catálogo se cotiza igual, con el precio que indique la persona.
        ...(!destino.incompletos.length
          ? [exito]
          : destino.incompletos.some(
                (i) => SIN_CATALOGO.has(i.rechazo.tipo) && !destino.solicitudes[i.indice]?.personalizado,
              )
            ? [AYUDA_ESPECIAL]
            : []),
      ].join('\n\n'),
    );
    u.guardar(destino);
    // Los ítems de `destino`, ya normalizados por `recalcular` (modelo canónico, madera con que se cotiza).
    const cambios = ctx.cambios(antes, destino.solicitudes, clienteAntes, cliente);
    const descuentosItems = [...conDescuentos.cambiados].map(([i, anterior]) => {
      const s = destino.solicitudes[i];
      return `Descuento especial de ${ctx.describir(s)}: ${anterior ? textoDescuentoItem(anterior) : 'sin descuento'} → ${s.descuento ? textoDescuentoItem(s.descuento) : 'sin descuento'}`;
    });
    const detalle = textoCambios(cambios, [
      ...cambioDescuento(descuentoAntes, destino),
      ...descuentosItems,
      ...extrasFlete,
    ]);
    if (destino === nuevo) u.registrarEvento(destino.id, 'creada', ctx.autor, detalle);
    else u.registrarEvento(destino.id, 'modificada', ctx.autor, detalle);
    return { cotizacion: destino, ...(todos.length ? { avisos: todos } : {}), ...(cambios ? { cambios } : {}) };
  });
  ctx.diagnostico?.({
    herramienta,
    modelo: ctx.llm.modeloEfectivo,
    respaldo: ctx.llm.usoRespaldo,
    avisos: (resultado.avisos ?? []).map((texto) => ({ categoria: categorias.get(texto) ?? 'otros', texto })),
  });
  return resultado;
}

/**
 * `cambiar_numero` pedido por chat: ubica el documento (el de la conversación o el que la IA nombra en `actual`),
 * comprueba que se pueda y propone el cambio para que la persona lo confirme en la interfaz (`confirmarNumero`), igual
 * que una aprobación. Los dos números deben estar escritos en el mensaje.
 */
function cambiarNumeroPorChat(
  ctx: ContextoChat,
  u: Unidad,
  q: Cotizacion,
  { documento, fabrica, actual, numero }: { documento: 'cotizacion' | 'nota'; fabrica: Fabrica | null; actual: number | null; numero: number },
  mensaje: string,
  responder: (texto: string, extra?: Omit<Resultado, 'cotizacion'>) => Resultado,
): Resultado {
  const escritos = enterosEscritos(mensaje);
  // La IA suele completar `actual` con el número de hoy del documento de la conversación (lo ve en `documentos`):
  // ese no necesita estar escrito. Otro número sí: nombra otro documento.
  const deHoy =
    documento === 'cotizacion'
      ? (q.numero ?? q.origen ?? null)
      : (q.notas.find((n) => (fabrica ? n.fabrica === fabrica : q.notas.length === 1))?.numero ?? null);
  if (actual !== null && actual === deHoy && !escritos.has(actual)) actual = null;
  if (!escritos.has(numero) || (actual !== null && !escritos.has(actual)))
    return responder('¿Qué número debe tener? Escríbelo en el mensaje, por ejemplo «la cotización debe ser la 340».');
  let objetivo: Cotizacion | null = q;
  if (documento === 'cotizacion') {
    if (actual !== null && actual !== q.numero) objetivo = u.porNumero(actual);
    // Desde su revisión en borrador (sin número), el número es el de la emitida que revisa.
    else if (q.numero === null && q.origen != null) objetivo = u.porNumero(q.origen);
  } else if (actual !== null && !q.notas.some((n) => n.numero === actual && (!fabrica || n.fabrica === fabrica)))
    objetivo = fabrica ? u.porNota(fabrica, actual) : null;
  if (!objetivo)
    return responder(
      documento === 'cotizacion'
        ? `No existe la cotización N° ${actual}.`
        : `No encontré la nota de pedido N° ${actual}${fabrica ? ` de ${nombreFabrica[fabrica]}` : ''}. Indica de qué fábrica es.`,
    );
  try {
    const { actual: hoy, nota } = ctx.documentoRenumerable(u, objetivo, documento, fabrica, numero);
    const nombre = documento === 'cotizacion' ? `La cotización N° ${hoy}` : `La nota de pedido ${numeroNota(nota!)}`;
    if (hoy === numero) return responder(`${nombre} ya tiene ese número.`);
    const pdfs =
      documento === 'cotizacion' && objetivo.notas.length ? 'su PDF y los de sus notas de pedido' : 'su PDF';
    const resultado = responder(
      `¿Confirmas que ${nombre[0].toLowerCase()}${nombre.slice(1)} pasa a ser la N° ${numero}? Se volverá a generar ${pdfs} con el número nuevo.`,
    );
    return {
      ...resultado,
      confirmarNumero: {
        id: objetivo.id,
        // Leída después de registrar el mensaje: si es la misma conversación (emitida o aprobada), no cambió.
        actualizada: objetivo.actualizada,
        documento,
        ...(nota?.fabrica ? { fabrica: nota.fabrica } : {}),
        actual: hoy,
        numero,
      },
    };
  } catch (error) {
    if (error instanceof ErrorUsuario) return responder(error.message);
    throw error;
  }
}

function errorProcesado(id: string) {
  return new ErrorConflicto(
    'Tu mensaje anterior ya se había procesado. Se abrió la cotización resultante.',
    'mensaje_procesado',
    { id },
  );
}

/** Un reenvío tras cancelar la espera no crea un segundo borrador con el mismo pedido. */
function verificarNoProcesado(almacen: Almacen, id: string) {
  if (almacen.obtener(id)) throw errorProcesado(id);
}
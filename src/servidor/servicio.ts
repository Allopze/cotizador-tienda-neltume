import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ErrorIA, errorProveedor } from '../asistente/errores';
import { pregunta } from '../asistente/preguntas';
import type { ModificacionCotizacion } from '../asistente/esquemas';
import { salidaSchema } from '../asistente/esquemas';
import { contextoSeguro, type LLM } from '../asistente/llm';
import { anclarCifras, anclarNombres } from '../asistente/anclaje';
import { mapaCatalogo } from '../catalogo/mapa';
import {
  aliasMaderasCatalogo,
  aliasModelosCatalogo,
  maderaDelCatalogo,
  maderaEfectiva,
  maderasCatalogo,
  metros,
  modeloDelCatalogo,
  resolverNombres,
  modelosCatalogo,
  normalizar,
  normalizarMedida,
  resolverItem,
  type CatalogoConsultable,
  type Resolucion,
} from '../catalogo/resolver';
import { medidaReferencia, metrosTexto } from '../catalogo/escalones';
import { clienteVacio, type Cliente, type SolicitudItem } from '../catalogo/tipos';
import { mismoCliente, sanearCliente } from '../negocio/cliente';
import { aCentesimas, margenAPorcentaje, redondearMargen } from '../negocio/cifras';
import { contarPuertas, descuentoAutomatico, descuentoEsManual, textoPuertas } from '../negocio/descuento-cantidad';
import {
  avisoProductoCambiado,
  claveMedida,
  descartarDelProducto,
  fusionarItems,
  reiniciarOrigenModelo,
  sanearTextos,
  textoCampo,
  type Descartes,
  type ProductoItem,
} from '../negocio/items';
import {
  anticipoMinimo,
  cantidadFlete,
  despachoEditable,
  etiquetaComercial,
  etiquetaFacturacion,
  etiquetaOperativo,
  unitarioFlete,
  pagoAnulable,
  sinTransportista,
  type Cotizacion,
  type Despacho,
  type Facturacion,
  type Mensaje,
} from '../negocio/estado';
import {
  cotizar,
  descuentoValido,
  fleteValido,
  MARGENES_INICIALES,
  margenValido,
  montosVacios,
  pesos,
  REGLAS,
  type ItemPrecio,
  type Montos,
} from '../negocio/precios';
import { calcularVence, estaVencida, fechaChilena } from '../negocio/vigencia';
import { Almacen, type Unidad } from './almacen';
import { ErrorConflicto, ErrorNoEncontrado, ErrorUsuario, VERSION_OBSOLETA } from './errores';
import { prepararFeriados } from './feriados-sync';
import { generarPdf, plantilla } from './pdf';
import { resolverReferencia, type OpcionCotizacion } from './referencias';
import { leerConfiguracionNegocio } from './configuracion-negocio';
import { nombreCanonicoModelo } from '../catalogo/configuracion';
import { esStarken, netoDesdeIva, textoTarifaAplicada, type TarifaStarkenAplicada } from '../negocio/starken';
import { verificarTarifa } from './starken-firma';

export { ErrorUsuario };

export type Accion =
  /** Solo pruebas: la interfaz crea el borrador con el primer mensaje del chat. */
  | { tipo: 'nueva' }
  | {
      tipo: 'chat';
      id?: string;
      /** Versión de la cotización `id` que ve la persona; obligatoria desde la API si hay `id`. */
      actualizada?: string;
      mensaje: string;
      objetivoId?: string;
      objetivoActualizada?: string;
      /**
       * Id que la interfaz propone para el borrador nuevo. Si la persona cancela la espera y reenvía,
       * el servidor reconoce que ese mensaje ya se procesó en vez de crear un duplicado.
       */
      nuevoId?: string;
      /** Intercambio previo que no generó borrador (preguntas, aprobaciones); solo contexto para la IA. */
      contexto?: Mensaje[];
    }
  | { tipo: 'quitar'; id: string; actualizada: string; indice: number }
  | {
      tipo: 'agregar_producto';
      id?: string;
      actualizada?: string;
      codigo: string;
      cantidad: number;
      ancho?: number;
      alto?: number;
      tipoMedida?: 'hoja' | 'vano' | 'no_especificado';
    }
  | { tipo: 'emitir'; id: string; actualizada: string; numero?: number }
  | {
      tipo: 'aprobar';
      id: string;
      actualizada: string;
      confirmarVencida?: boolean;
      despacho?: Partial<Despacho>;
    }
  | { tipo: 'duplicar'; id: string }
  | { tipo: 'eliminar'; id: string; actualizada: string }
  | { tipo: 'anular'; id: string; actualizada: string; motivo?: string }
  | {
      tipo: 'editar';
      id: string;
      actualizada: string;
      cliente?: Partial<Cliente>;
      cantidades?: { indice: number; cantidad: number }[];
      items?: {
        indice: number;
        cambios: Partial<Pick<SolicitudItem, 'modelo' | 'madera' | 'ancho' | 'alto' | 'medida' | 'precioUnitario' | 'margen' | 'tipoMedida' | 'descripcion' | 'observaciones'>>;
      }[];
      /** Fija el descuento (%) a mano: deja de seguir al descuento por cantidad. */
      descuento?: number;
      /** Vuelve al descuento por cantidad que corresponde a las puertas de la cotización. */
      descuentoAutomatico?: true;
      flete?: number;
      /**
       * Línea de flete del detalle: lo que se indique reemplaza su descripción, cantidad o unitario y el flete
       * pasa a ser cantidad × unitario; null la quita (flete $0). Tiene prioridad sobre `flete` y `despacho.valor`.
       */
      fleteLinea?: { descripcion?: string | null; cantidad?: number; unitario?: number } | null;
      /** Margen especial de toda la cotización (fracción); null vuelve al margen de cada categoría. */
      margenCotizacion?: number | null;
      observaciones?: string | null;
      despacho?: Partial<Despacho> | null;
      /** Tarifa de Starken elegida por la persona: el valor de despacho debe ser su neto y la actividad la registra. */
      tarifaStarken?: TarifaStarkenAplicada;
    }
  | { tipo: 'pago'; id: string; actualizada: string; monto: number; fecha?: string; observacion?: string | null }
  /** Quita un pago registrado por error mientras la operación no llegue a «Lista para despacho». */
  | { tipo: 'anular_pago'; id: string; actualizada: string; pagoId: string; motivo?: string }
  /** Datos logísticos de una cotización aprobada; el valor del flete queda fijo desde la emisión. */
  | { tipo: 'despacho'; id: string; actualizada: string; despacho: Partial<Despacho> }
  | { tipo: 'comentario'; id: string; actualizada: string; texto: string }
  | { tipo: 'comercial'; id: string; actualizada: string; estado: 'seguimiento' | 'rechazada' }
  | { tipo: 'generar_nota'; id: string; actualizada: string }
  | { tipo: 'operacion'; id: string; actualizada: string; paso: 'iniciar_produccion' | 'produccion_terminada' | 'lista_despacho' | 'despachada' | 'completada'; despacho?: Partial<Despacho> }
  | { tipo: 'facturacion'; id: string; actualizada: string; estado: 'pendiente' | 'facturada'; tipoDocumento?: 'factura' | 'boleta' | null; identificadorExterno?: string | null; fecha?: string | null };

export interface ItemCambio {
  indice: number;
  descripcion: string;
}
/** Diferencias de ítems y cliente respecto de la versión anterior, para mostrar en la interfaz. */
export interface CambiosCotizacion {
  agregados: ItemCambio[];
  quitados: ItemCambio[];
  modificados: { antes: ItemCambio; despues: ItemCambio }[];
  cliente: (keyof Cliente)[];
}
export interface Resultado {
  cotizacion: Cotizacion;
  archivo?: string;
  /** Opciones de cotización cuando la referencia del mensaje coincide con varios registros. */
  seleccion?: OpcionCotizacion[];
  /** Aprobación pedida por chat: la interfaz debe confirmarla con la acción explícita `aprobar`. */
  confirmar?: { id: string; numero: number; actualizada: string; vence: string | null; vencida: boolean };
  /** Avisos no bloqueantes: precios que cambiaron al emitir, RUT inválido, cantidades descartadas. */
  avisos?: string[];
  cambios?: CambiosCotizacion;
  /** Solo en `eliminar`: la cotización devuelta ya no existe. */
  eliminada?: true;
  /**
   * Respuesta sin pedido (pregunta, aprobación, mensaje sin productos ni cliente) desde una pantalla
   * nueva: no se guarda un borrador vacío; la cotización devuelta solo lleva el intercambio.
   */
  efimera?: true;
}
export interface UsuarioServicio {
  nombre: string;
  email: string;
}

/** Resultado de la primera fase de emitir/aprobar: ya estaba hecho o número reservado. */
type Preparado<T> =
  { listo: Cotizacion } | ({ listo: null; copia: Cotizacion; numero: number; version: string } & T);
/** Emitir encontró montos distintos a los revisados: se guardaron en el borrador y se pide confirmar. */
type PreciosCambiados = { listo: null; cambiados: { avisos: string[]; total: number; actualizada: string } };

const NO_ENTENDI = 'No entendí, ¿puedes reformularlo?';
// Montos o términos comerciales en texto libre del modelo; palabras como «total» o «valor» solas no bastan.
const TEXTO_MONETARIO =
  /\$\s*\d|\d[\d.,]*\s*(?:CLP|USD|pesos|%)|\b(?:CLP|USD|costos?|m[aá]rgen(?:es)?|descuentos?)\b/i;
const SOLICITUD_APROBACION =
  /\b(?:aprueba|apruebe|aprobar|se aprob[oó]|haz(?:me)? (?:la )?nota|genera(?:r)? (?:la )?nota|prepara(?:r)? (?:la )?nota)(?![\p{L}\p{N}])/iu;
const CAMPOS_CLIENTE: (keyof Cliente)[] = [
  'nombre',
  'rut',
  'giro',
  'telefono',
  'direccion',
  'comuna',
  'proyecto',
];

/** Nueva versión estrictamente posterior a la anterior, aunque ocurra en el mismo milisegundo. */
const marca = (anterior?: string) =>
  new Date(Math.max(Date.now(), anterior ? Date.parse(anterior) + 1 : 0)).toISOString();
const decimal = (n: number) => n.toFixed(2).replace('.', ',');

/** «Medida especial 0,87 × 2,36 m: se cotiza con la referencia HUIL-M-4-E (0,90–0,95 × 2,40 m), …». */
function avisoMedidaEspecial(r: Extract<Resolucion, { ok: true }>) {
  const pedida = [r.anchoSolicitado, r.altoSolicitado].filter((n) => n !== null).map(metrosTexto).join(' × ');
  return `${r.producto.familia === 'PUERTA' ? 'Medida' : 'Largo'} especial ${pedida} m: se cotiza con la referencia ${r.producto.codigo} (${medidaReferencia(r.producto)}), la siguiente medida del catálogo.`;
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
const porcentajeTexto = (n: number) => `${String(n).replace('.', ',')} %`;
type DescuentoGuardado = { descuento: number; manual: boolean };
const descuentoDe = (q: Cotizacion): DescuentoGuardado => ({ descuento: q.descuento, manual: descuentoEsManual(q) });
/**
 * Lo que cambió del descuento, para la actividad: el del tramo por cantidad (con las puertas que lo
 * explican), el fijado a mano o el automático restaurado. Vacío si nada cambió.
 */
function cambioDescuento(antes: DescuentoGuardado, q: Cotizacion): string[] {
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
const limpiarTexto = (valor: unknown, max: number) =>
  typeof valor === 'string' ? valor.replace(/\s+/g, ' ').trim().slice(0, max) || null : null;
/** Fecha elegida por la persona (YYYY-MM-DD) como mediodía UTC, para que no cambie de día al mostrarla. */
function fechaElegida(fecha: string): string | null {
  const soloDia = /^\d{4}-\d{2}-\d{2}$/.test(fecha);
  const t = Date.parse(soloDia ? `${fecha}T12:00:00.000Z` : fecha);
  if (Number.isNaN(t)) return null;
  const iso = new Date(t).toISOString();
  // «2026-02-31» no es un error para Date: se corre al 3 de marzo, y eso no es lo que la persona escribió.
  return soloDia && iso.slice(0, 10) !== fecha ? null : iso;
}
type CampoDespacho = 'direccion' | 'transporte' | 'entregaComprometida' | 'destino';
const CAMPOS_DESPACHO: readonly (readonly [CampoDespacho, string, number])[] = [
  ['direccion', 'Dirección', 300],
  ['transporte', 'Transportista', 120],
  ['entregaComprometida', 'Entrega comprometida', 120],
  ['destino', 'Destino', 300],
];
/** Despacho con los cambios ya limpios sobre `base`, y el texto de lo que cambió (para la actividad). */
function aplicarDespacho(base: Despacho | null | undefined, cambios: Partial<Despacho>, valor: number) {
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
    const nuevo = limpiarTexto(cambios[campo], largo);
    if (nuevo === despacho[campo]) continue;
    cambiados.push({ campo, texto: `${etiqueta}: ${despacho[campo] ?? '—'} → ${nuevo ?? '—'}` });
    despacho[campo] = nuevo;
  }
  return { despacho, cambiados };
}
/** Margen (fracción) como porcentaje legible: 0,42 → «42 %»; sin el ruido binario de 0,07 × 100. */
const margenTexto = (m: number) => porcentajeTexto(margenAPorcentaje(m));
const ESTANDAR_CATEGORIA = 'estándar de categoría';

export class Servicio {
  private readonly autor: string | null;
  constructor(
    private catalogo: CatalogoConsultable,
    private llm: LLM,
    private almacen = new Almacen(),
    usuario: UsuarioServicio | null = null,
  ) {
    this.autor = usuario ? usuario.nombre || usuario.email : null;
  }

  private nueva(): Cotizacion {
    const fecha = new Date().toISOString();
    return {
      id: randomUUID(),
      numero: null,
      estado: 'borrador',
      cliente: clienteVacio(),
      solicitudes: [],
      montos: montosVacios(),
      incompletos: [],
      historial: [],
      creada: fecha,
      actualizada: fecha,
      pdf: null,
      fechaEmision: null,
      vence: null,
      descuento: 0,
      descuentoManual: false,
      flete: 0,
      fleteDescripcion: null,
      fleteCantidad: 1,
      margenCotizacion: null,
      observaciones: null,
      despacho: null,
      reglas: { ...leerConfiguracionNegocio(this.almacen.baseDatos()).reglas },
      creadaPor: this.autor,
      emitidaPor: null,
      aprobadaPor: null,
      anuladaPor: null,
      fechaAnulacion: null,
      motivoAnulacion: null,
      reemplazadaPor: null,
      versionCatalogo: null,
      nota: null,
      estadoComercial: 'pendiente',
      estadoOperativo: 'sin_pedido',
      pagos: [],
      comentariosInternos: [],
      facturacion: { estado: 'pendiente', tipo: null, identificadorExterno: null, fecha: null },
    };
  }

  private versionCatalogo(): string | null {
    const c = this.catalogo as CatalogoConsultable & {
      version?: string | null;
      sha256?: string;
      fecha?: string;
    };
    if ('productos' in c) return `${c.sha256}:${c.fecha}`;
    return c.version ?? null;
  }

  /** Devuelve un aviso por cada línea que pasa a cotizarse con la siguiente medida del catálogo. */
  private recalcular(q: Cotizacion, tocar = true) {
    const clave = (codigo: string, ancho: number | null, alto: number | null) => `${codigo}|${ancho}|${alto}`;
    const previas = new Set(q.montos.lineas.map((l) => clave(l.producto.codigo, l.anchoSolicitado, l.altoSolicitado)));
    const avisos: string[] = [];
    const validos: ItemPrecio[] = [];
    q.incompletos = [];
    for (const [indice, s] of q.solicitudes.entries()) {
      // Un marco «en Mara Enchapada» se guarda con la madera con que se cotiza, también si queda pendiente:
      // el alta desde el pendiente y las preguntas parten de ella.
      const madera = s.madera ? maderaDelCatalogo(this.catalogo, s.madera) : null,
        efectiva = maderaEfectiva(this.catalogo, s);
      if (madera && efectiva && efectiva !== madera) s.madera = efectiva;
      const res = resolverItem(this.catalogo, s);
      if (res.ok) {
        if (res.coincidenciaModelo !== 'canonico') {
          s.modeloOriginal ??= s.modelo;
          s.coincidenciaModelo = res.coincidenciaModelo;
        } else if (!s.modeloOriginal) {
          s.coincidenciaModelo = 'canonico';
        }
        s.modelo = nombreCanonicoModelo(res.producto.modelo);
        s.madera = res.producto.madera;
        const k = clave(res.producto.codigo, res.anchoSolicitado, res.altoSolicitado);
        if ((res.ajusteAncho === 'siguiente' || res.ajusteAlto === 'siguiente') && !previas.has(k)) {
          avisos.push(avisoMedidaEspecial(res));
          previas.add(k);
        }
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
        });
      } else q.incompletos.push({ indice, rechazo: res.rechazo, pregunta: pregunta(res.rechazo, s.modelo) });
    }
    const reglas = q.reglas ?? REGLAS;
    // El descuento por cantidad sigue a las puertas valorizadas (sin ellas no hay descuento); uno fijado a mano no se toca.
    if (!descuentoEsManual(q)) q.descuento = descuentoAutomatico(reglas, contarPuertas(validos));
    q.montos = validos.length
      ? cotizar(validos, reglas, {
          descuento: q.descuento,
          flete: q.flete,
          margenCotizacion: q.margenCotizacion ?? null,
        })
      : montosVacios();
    if (tocar) q.actualizada = marca(q.actualizada);
    return avisos;
  }

  /** Solo un borrador cambia de versión con el historial: así no se invalidan selecciones de otras personas. */
  private registrar(q: Cotizacion, usuario: string, asistente: string) {
    q.historial.push({ rol: 'usuario', texto: usuario }, { rol: 'asistente', texto: asistente });
    if (q.estado === 'borrador') q.actualizada = marca(q.actualizada);
  }

  private verificarVersion(q: Cotizacion, actualizada: string | undefined) {
    if (actualizada !== q.actualizada) throw new ErrorConflicto(VERSION_OBSOLETA);
  }

  private obtener(u: Unidad, id: string, mensaje?: string) {
    const q = u.obtener(id);
    if (!q) throw new ErrorNoEncontrado(mensaje);
    return q;
  }

  private exigirEditable(q: Cotizacion) {
    if (q.estado === 'borrador' || q.estado === 'emitida') return;
    if (q.estado === 'aprobada')
      throw new ErrorConflicto(
        'La cotización está aprobada y no se puede editar. Crea una nueva cotización.',
        'no_editable',
      );
    if (q.estado === 'reemplazada')
      throw new ErrorConflicto(
        `La cotización N° ${q.numero} fue reemplazada${q.reemplazadaPor ? ` por la N° ${q.reemplazadaPor}` : ''} y ya no se puede editar. Modifica la más reciente.`,
        'no_editable',
      );
    throw new ErrorConflicto(
      `La cotización N° ${q.numero} está anulada y no se puede editar. Duplícala para crear una nueva.`,
      'no_editable',
    );
  }

  /**
   * Modelo y madera comparables: los del catálogo aunque el ítem esté incompleto, así un alias no cuenta como cambio.
   * Un alias dudoso cuenta como el modelo que se sugiere: confirmarlo no es cambiar de producto. La madera es
   * con la que se cotiza (un marco en Mara Enchapada es Pino Finger enchapado); si falta el modelo, se usa el
   * de `pareja`, el otro estado del ítem, así completarlo no parece un cambio de madera.
   */
  private producto(s: SolicitudItem, pareja?: SolicitudItem): ProductoItem {
    const modelo = s.modelo ? modeloDelCatalogo(this.catalogo, s.modelo) : null;
    const madera = s.madera
      ? maderaEfectiva(this.catalogo, { modelo: s.modelo ?? pareja?.modelo ?? null, madera: s.madera }, { sugerido: true })
      : null;
    return {
      modelo: modelo ? normalizar(modelo.posible ?? modelo.modelo) : '',
      madera: s.madera ? normalizar(madera ?? s.madera) : '',
    };
  }

  private firma(s: SolicitudItem) {
    const r = resolverItem(this.catalogo, s);
    if (r.ok)
      return [
        r.producto.codigo,
        r.cantidad,
        claveMedida(s.ancho),
        claveMedida(s.alto),
        r.medidaSolicitada ?? '',
        s.tipoMedida ?? '',
        s.descripcion ?? '',
        s.observaciones ?? '',
        s.margen ?? '',
        s.precioUnitario ?? '',
      ].join('|');
    return [
      normalizar(s.modelo ?? ''),
      normalizar(s.madera ?? ''),
      claveMedida(s.ancho),
      claveMedida(s.alto),
      s.medida ? normalizarMedida(s.medida) : '',
      s.tipoMedida ?? '',
      s.descripcion ?? '',
      s.observaciones ?? '',
      s.margen ?? '',
      s.cantidad ?? '',
      s.precioUnitario ?? '',
    ].join('|');
  }

  /** Compara ítems resueltos (código, cantidad y medidas pedidas) y el cliente normalizado. */
  private sinCambios(q: Cotizacion, solicitudes: SolicitudItem[], cliente: Cliente) {
    return (
      q.solicitudes.length === solicitudes.length &&
      q.solicitudes.every((s, i) => this.firma(s) === this.firma(solicitudes[i])) &&
      mismoCliente(q.cliente, cliente)
    );
  }

  private mismoContenido(a: Cotizacion, b: Cotizacion) {
    return (
      this.sinCambios(a, b.solicitudes, b.cliente) &&
      a.descuento === b.descuento &&
      descuentoEsManual(a) === descuentoEsManual(b) &&
      a.flete === b.flete &&
      (a.fleteDescripcion ?? null) === (b.fleteDescripcion ?? null) &&
      cantidadFlete(a) === cantidadFlete(b) &&
      (a.margenCotizacion ?? null) === (b.margenCotizacion ?? null) &&
      a.observaciones === b.observaciones &&
      JSON.stringify(a.despacho) === JSON.stringify(b.despacho)
    );
  }

  /**
   * Borrador donde aplicar un cambio. Una emitida no se toca: se reutiliza su revisión abierta
   * (si tiene el mismo contenido que la emitida) o se crea una. Nunca quedan dos revisiones abiertas.
   */
  private abrirEdicion(q: Cotizacion, u: Unidad): Cotizacion {
    this.exigirEditable(q);
    if (q.estado === 'borrador') return q;
    const abierta = u.revisionAbierta(q);
    if (abierta) {
      if (this.mismoContenido(abierta, q)) return abierta;
      throw new ErrorConflicto(
        `Ya existe una revisión en borrador de la cotización N° ${q.numero}. Ábrela y vuelve a aplicar el cambio allí.`,
        'revision_abierta',
        { id: abierta.id },
      );
    }
    const fecha = new Date().toISOString();
    const copia: Cotizacion = {
      ...structuredClone(q),
      id: randomUUID(),
      numero: null,
      estado: 'borrador',
      pdf: null,
      fechaEmision: null,
      vence: null,
      origen: q.numero,
      nota: null,
      creada: fecha,
      actualizada: fecha,
      creadaPor: this.autor,
      emitidaPor: null,
      aprobadaPor: null,
      anuladaPor: null,
      fechaAnulacion: null,
      motivoAnulacion: null,
      reemplazadaPor: null,
      versionCatalogo: null,
    };
    u.guardar(copia);
    u.registrarEvento(copia.id, 'revision', this.autor, `Revisión de N° ${q.numero}`);
    return copia;
  }

  private verificarSerieNoAprobada(q: Cotizacion, u: Unidad) {
    const aprobada = u.serie(q.id).find((s) => s.id !== q.id && s.estado === 'aprobada');
    if (aprobada)
      throw new ErrorConflicto(
        `La cotización N° ${aprobada.numero} de esta misma serie ya fue aprobada${aprobada.nota ? ` (nota de pedido N° ${aprobada.nota.numero})` : ''}. Duplica la cotización si necesitas un pedido nuevo.`,
        'serie_aprobada',
      );
  }

  private describir(s: SolicitudItem) {
    const medida = (n: number | null) => (n === null ? null : decimal(metros(n) ?? n));
    const medidas = [s.medida ? normalizarMedida(s.medida) : medida(s.ancho), medida(s.alto)].filter(Boolean);
    const cantidad = s.cantidad === null ? '' : `${s.cantidad} × `;
    return `${cantidad}${s.modelo ?? 'producto por definir'}${s.madera ? ` ${s.madera}` : ''}${medidas.length ? ` ${medidas.join(' × ')}` : ''}${s.cantidad === null ? ' (sin cantidad)' : ''}`;
  }

  private cambios(
    antes: SolicitudItem[],
    despues: SolicitudItem[],
    clienteAntes: Cliente,
    clienteDespues: Cliente,
  ): CambiosCotizacion | undefined {
    const fa = antes.map((s) => this.firma(s)),
      fd = despues.map((s) => this.firma(s));
    const usados = new Set<number>();
    const sinParA: number[] = [];
    fa.forEach((f, i) => {
      const j = fd.findIndex((g, k) => g === f && !usados.has(k));
      if (j >= 0) usados.add(j);
      else sinParA.push(i);
    });
    let sinParD = fd.map((_, k) => k).filter((k) => !usados.has(k));
    const item = (lista: SolicitudItem[], indice: number) => ({
      indice,
      descripcion: this.describir(lista[indice]),
    });
    const modelo = (s: SolicitudItem) => normalizar(s.modelo ?? '');
    const modificados: CambiosCotizacion['modificados'] = [];
    const quitados: ItemCambio[] = [];
    for (const i of sinParA) {
      const k = sinParD.find((d) => modelo(despues[d]) === modelo(antes[i]));
      if (k === undefined) quitados.push(item(antes, i));
      else {
        modificados.push({ antes: item(antes, i), despues: item(despues, k) });
        sinParD = sinParD.filter((d) => d !== k);
      }
    }
    const cliente = CAMPOS_CLIENTE.filter((c) => (clienteAntes[c] ?? null) !== (clienteDespues[c] ?? null));
    const agregados = sinParD.map((k) => item(despues, k));
    if (!agregados.length && !quitados.length && !modificados.length && !cliente.length) return undefined;
    return { agregados, quitados, modificados, cliente };
  }

  /** Cantidades no enteras o fuera de rango del modelo quedan pendientes, con aviso. */
  private sanearSolicitudes(items: SolicitudItem[]) {
    const avisos: string[] = [];
    const solicitudes = items.map((s) => {
      if (s.cantidad === null || (Number.isInteger(s.cantidad) && s.cantidad >= 1 && s.cantidad <= 10000))
        return s;
      avisos.push(
        `La cantidad ${String(s.cantidad).replace('.', ',')} de ${s.modelo ?? 'un ítem'} no es válida: indica un entero entre 1 y 10.000.`,
      );
      return { ...s, cantidad: null };
    });
    return { solicitudes, avisos };
  }

  private diferenciasPrecio(anterior: Montos, actual: Montos) {
    if (!anterior.lineas.length) return [];
    const avisos: string[] = [];
    actual.lineas.forEach((l, i) => {
      const previa =
        anterior.lineas.find((p) => p.indice !== null && p.indice === l.indice) ??
        (l.indice === null || anterior.lineas.every((p) => p.indice === null)
          ? anterior.lineas[i]
          : undefined);
      if (!previa) return;
      if (previa.producto.codigo !== l.producto.codigo)
        avisos.push(
          `El ítem ${i + 1} ahora corresponde a ${l.producto.codigo} (antes ${previa.producto.codigo}).`,
        );
      else if (previa.precioUnitario !== l.precioUnitario)
        avisos.push(
          `El precio unitario de ${l.producto.codigo} cambió de ${pesos(previa.precioUnitario)} a ${pesos(l.precioUnitario)} según el catálogo vigente.`,
        );
    });
    if (avisos.length && anterior.total !== actual.total)
      avisos.push(`El total pasó de ${pesos(anterior.total)} a ${pesos(actual.total)}.`);
    return avisos;
  }

  async ejecutar(accion: Accion): Promise<Resultado> {
    switch (accion.tipo) {
      case 'chat':
        return this.chat(accion);
      case 'emitir':
        return this.emitir(accion);
      case 'aprobar':
        return this.aprobar(accion);
      case 'generar_nota':
        return this.generarNotaPedido(accion);
      case 'pago':
        return this.registrarPago(accion);
      case 'anular_pago':
        return this.anularPago(accion);
      case 'despacho':
        return this.actualizarDespacho(accion);
      case 'comentario':
        return this.registrarComentario(accion);
      case 'comercial':
        return this.cambiarEstadoComercial(accion);
      case 'operacion':
        return this.cambiarEstadoOperativo(accion);
      case 'facturacion':
        return this.actualizarFacturacion(accion);
      case 'nueva':
        return this.almacen.transaccion((u) => {
          const q = this.nueva();
          u.guardar(q);
          return { cotizacion: q };
        });
      case 'quitar':
        return this.almacen.transaccion((u) => {
          const q = this.obtener(u, accion.id);
          this.exigirEditable(q);
          this.verificarVersion(q, accion.actualizada);
          if (!q.solicitudes[accion.indice]) throw new ErrorNoEncontrado('No se encontró el ítem.');
          const antes = structuredClone(q.solicitudes);
          const destino = this.abrirEdicion(q, u);
          const descuentoAntes = descuentoDe(destino);
          destino.solicitudes.splice(accion.indice, 1);
          this.recalcular(destino);
          u.guardar(destino);
          const cambios = this.cambios(antes, destino.solicitudes, q.cliente, destino.cliente);
          u.registrarEvento(
            destino.id,
            'modificada',
            this.autor,
            textoCambios(cambios, cambioDescuento(descuentoAntes, destino)),
          );
          return { cotizacion: destino, ...(cambios ? { cambios } : {}) };
        });
      case 'editar':
        return this.editar(accion);
      case 'agregar_producto':
        return this.agregarProducto(accion);
      case 'duplicar':
        return this.almacen.transaccion((u) => {
          const origen = this.obtener(u, accion.id);
          const q = this.nueva();
          q.solicitudes = structuredClone(origen.solicitudes);
          q.cliente = structuredClone(origen.cliente);
          // El descuento y el flete acordados forman parte de lo que se duplica. Uno automático se recalcula
          // abajo con los tramos de la copia (congelados al crearla), que pueden ser otros.
          q.descuento = origen.descuento;
          q.descuentoManual = descuentoEsManual(origen);
          q.flete = origen.flete;
          q.fleteDescripcion = origen.fleteDescripcion ?? null;
          q.fleteCantidad = cantidadFlete(origen);
          q.margenCotizacion = origen.margenCotizacion ?? null;
          q.observaciones = origen.observaciones;
          q.despacho = structuredClone(origen.despacho);
          q.historial = [
            {
              rol: 'asistente',
              texto: origen.numero ? `Duplicada de N° ${origen.numero}.` : 'Duplicada de un borrador.',
            },
          ];
          this.recalcular(q);
          u.guardar(q);
          u.registrarEvento(
            q.id,
            'duplicada',
            this.autor,
            [
              origen.numero ? `Copia de N° ${origen.numero}` : 'Copia de un borrador',
              ...cambioDescuento(descuentoDe(origen), q),
            ].join(' · '),
          );
          return { cotizacion: q };
        });
      case 'eliminar':
        return this.almacen.transaccion((u) => {
          const q = this.obtener(u, accion.id);
          if (q.estado !== 'borrador' || q.numero !== null)
            throw new ErrorConflicto(
              'Solo se pueden eliminar borradores sin número. Una cotización emitida se anula.',
              'estado_invalido',
            );
          this.verificarVersion(q, accion.actualizada);
          u.eliminar(q.id);
          return { cotizacion: q, eliminada: true as const };
        });
      case 'anular':
        return this.almacen.transaccion((u) => {
          const q = this.obtener(u, accion.id);
          if (q.estado === 'anulada') return { cotizacion: q };
          if (q.estado !== 'emitida' && q.estado !== 'aprobada')
            throw new ErrorConflicto(
              q.estado === 'borrador'
                ? 'Un borrador no se anula: elimínalo.'
                : `La cotización N° ${q.numero} fue reemplazada y ya no está vigente.`,
              'estado_invalido',
            );
          this.verificarVersion(q, accion.actualizada);
          const motivo = limpiarTexto(accion.motivo, 300);
          const fecha = new Date().toISOString();
          q.estado = 'anulada';
          q.estadoComercial = 'rechazada';
          q.anuladaPor = this.autor;
          q.fechaAnulacion = fecha;
          q.motivoAnulacion = motivo;
          if (q.nota) q.nota.anulada = true;
          // Una revisión en borrador de esta emitida ya no revisa nada: sigue como cotización nueva.
          const avisos: string[] = [];
          const revision = q.numero !== null ? u.revisionAbierta(q) : null;
          if (revision) {
            revision.origen = null;
            revision.historial.push({
              rol: 'asistente',
              texto: `La cotización N° ${q.numero} se anuló. Este borrador sigue disponible como cotización nueva.`,
            });
            revision.actualizada = marca(revision.actualizada);
            u.guardar(revision);
            u.registrarEvento(revision.id, 'desvinculada', this.autor, `N° ${q.numero} anulada`);
            avisos.push(
              `El borrador de revisión de la N° ${q.numero} quedó como cotización nueva, sin relación con la anulada.`,
            );
          }
          q.historial.push({
            rol: 'asistente',
            texto: `Cotización N° ${q.numero} anulada${q.nota ? ` junto con la nota de pedido N° ${q.nota.numero}` : ''}${motivo ? `. Motivo: ${motivo}` : ''}.`,
          });
          q.actualizada = marca(q.actualizada);
          u.guardar(q);
          u.registrarEvento(q.id, 'anulada', this.autor, motivo);
          return { cotizacion: q, ...(avisos.length ? { avisos } : {}) };
        });
    }
  }

  /** Selección explícita del catálogo: precios, revisiones y cálculo permanecen en el servidor. */
  private agregarProducto(accion: Extract<Accion, { tipo: 'agregar_producto' }>) {
    return this.almacen.transaccion((u): Resultado => {
      if (Boolean(accion.id) !== Boolean(accion.actualizada))
        throw new ErrorUsuario('Indica la versión de la cotización.');
      if (!Number.isInteger(accion.cantidad) || accion.cantidad < 1 || accion.cantidad > 10000)
        throw new ErrorUsuario('La cantidad debe ser un entero entre 1 y 10.000.');
      const catalogo = this.catalogo;
      const productos =
        'productos' in catalogo
          ? catalogo.productos
          : catalogo.modelos().flatMap((modelo) => catalogo.productosDeModelo(normalizar(modelo)));
      const p = productos.find((producto) => producto.codigo === accion.codigo);
      if (!p)
        throw new ErrorNoEncontrado('El producto ya no está disponible. Vuelve a buscarlo en el catálogo.');
      const item: SolicitudItem = {
        modelo: p.modelo,
        madera: p.madera,
        cantidad: accion.cantidad,
        ancho: p.familia === 'PUERTA' ? (accion.ancho ?? p.anchoMax ?? p.anchoMin) : null,
        alto: accion.alto ?? p.altoMax ?? p.largo,
        medida: p.familia === 'PUERTA' ? null : p.medida,
        tipoMedida: accion.tipoMedida ?? 'no_especificado',
      };
      const res = resolverItem(this.catalogo, item);
      if (!res.ok || res.producto.codigo !== p.codigo)
        throw new ErrorUsuario(
          'Las medidas no corresponden a esta referencia. Selecciona el producto adecuado del catálogo.',
        );
      const q = accion.id ? this.obtener(u, accion.id) : this.nueva();
      this.exigirEditable(q);
      if (accion.id) this.verificarVersion(q, accion.actualizada!);
      if (q.solicitudes.length >= 100) throw new ErrorUsuario('Una cotización admite hasta 100 productos.');
      const antes = structuredClone(q.solicitudes);
      const destino = this.abrirEdicion(q, u);
      const descuentoAntes = descuentoDe(destino);
      destino.solicitudes.push(item);
      const avisos = this.recalcular(destino);
      const cambios = this.cambios(antes, destino.solicitudes, q.cliente, destino.cliente);
      u.guardar(destino);
      u.registrarEvento(
        destino.id,
        'modificada',
        this.autor,
        textoCambios(cambios, cambioDescuento(descuentoAntes, destino)),
      );
      return { cotizacion: destino, cambios, ...(avisos.length ? { avisos } : {}) };
    });
  }

  private editar(accion: Extract<Accion, { tipo: 'editar' }>) {
    return this.almacen.transaccion((u): Resultado => {
      const q = this.obtener(u, accion.id);
      this.exigirEditable(q);
      this.verificarVersion(q, accion.actualizada);
      const solicitudes = structuredClone(q.solicitudes);
      for (const { indice, cantidad } of accion.cantidades ?? []) {
        if (!solicitudes[indice]) throw new ErrorNoEncontrado('No se encontró el ítem.');
        if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10000)
          throw new ErrorUsuario('La cantidad debe ser un entero entre 1 y 10.000.');
        solicitudes[indice] = { ...solicitudes[indice], cantidad };
      }
      const indicesEditados = new Set<number>();
      const avisosItems: string[] = [];
      for (const cambio of accion.items ?? []) {
        if (!solicitudes[cambio.indice] || indicesEditados.has(cambio.indice))
          throw new ErrorNoEncontrado('No se encontró el ítem o se repitió su índice.');
        indicesEditados.add(cambio.indice);
        const cambios = cambio.cambios;
        const siguiente = { ...solicitudes[cambio.indice] };
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
            throw new ErrorUsuario('El margen debe ser un porcentaje entre -50 % y 500 %, con hasta dos decimales.');
          // Guardado sin el error binario de un porcentaje dividido por 100 (0,07 llega como 0,07000000000000001).
          siguiente.margen = valor === null ? null : redondearMargen(valor);
          if (valor !== null) siguiente.precioUnitario = null;
        }
        const anterior = solicitudes[cambio.indice];
        const descartes = descartarDelProducto(anterior, siguiente, {
          antes: this.producto(anterior, siguiente),
          despues: this.producto(siguiente, anterior),
        });
        if (descartes) avisosItems.push(avisoProductoCambiado(cambio.indice + 1, descartes));
        solicitudes[cambio.indice] = siguiente;
      }
      const { cliente, avisos: avisosCliente } = accion.cliente
        ? sanearCliente(accion.cliente, q.cliente)
        : { cliente: q.cliente, avisos: [] as string[] };
      const avisos = [...avisosItems, ...avisosCliente];
      if (accion.descuento !== undefined && accion.descuentoAutomatico)
        throw new ErrorUsuario('Fija un descuento o restaura el automático, no las dos cosas a la vez.');
      // Escribir un descuento distinto del actual lo fija a mano (repetir el valor que ya tiene no cambia nada);
      // restaurarlo vuelve al del tramo por cantidad, que calcula `recalcular`.
      const descuentoManual = accion.descuentoAutomatico
        ? false
        : accion.descuento !== undefined && aCentesimas(accion.descuento) !== q.descuento
          ? true
          : descuentoEsManual(q);
      const descuento = accion.descuento ?? q.descuento;
      let flete = accion.flete ?? (accion.despacho?.valor === undefined ? q.flete : accion.despacho.valor ?? 0),
        fleteCantidad = cantidadFlete(q),
        fleteDescripcion = q.fleteDescripcion ?? null;
      // Un valor de despacho (a mano o de Starken) es el total del flete: una sola unidad.
      if (flete !== q.flete) fleteCantidad = 1;
      const linea = accion.fleteLinea;
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
          throw new ErrorUsuario('El unitario del flete debe ser un monto neto entero en pesos, desde $0.');
        fleteCantidad = cantidad;
        flete = cantidad * unitario;
        if (linea.descripcion !== undefined) fleteDescripcion = limpiarTexto(linea.descripcion, 300);
      }
      const reglas = q.reglas ?? REGLAS;
      if (!descuentoValido(descuento, reglas.descuentoMaximo))
        throw new ErrorUsuario(
          `El descuento debe estar entre 0 % y ${reglas.descuentoMaximo} %, con hasta dos decimales.`,
        );
      if (!fleteValido(flete))
        throw new ErrorUsuario('El flete debe ser un monto neto entero en pesos, desde $0.');
      const margenAntes = q.margenCotizacion ?? null;
      const margenPedido = accion.margenCotizacion === undefined ? margenAntes : accion.margenCotizacion;
      if (margenPedido !== null && !margenValido(margenPedido))
        throw new ErrorUsuario(
          'El margen especial de la cotización debe ser un porcentaje entre -50 % y 500 %, con hasta dos decimales.',
        );
      const margenCotizacion = margenPedido === null ? null : redondearMargen(margenPedido);
      const extra = avisos.length ? { avisos } : {};
      const descuentoNuevo = aCentesimas(descuento);
      const observaciones =
        accion.observaciones === undefined
          ? q.observaciones
          : limpiarTexto(accion.observaciones, 2000);
      const despacho =
        accion.despacho === undefined
          ? q.despacho
          : accion.despacho === null
            ? null
            : aplicarDespacho(q.despacho, accion.despacho, flete).despacho;
      const tarifa = accion.tarifaStarken;
      if (tarifa) {
        if (!esStarken(despacho?.transporte))
          throw new ErrorUsuario('Elige Starken como transportista antes de aplicar su tarifa.');
        // El navegador no es de fiar para el costo: la firma la dio este servidor para esta cotización.
        const firma = verificarTarifa(accion.id, tarifa);
        if (firma !== 'valida')
          throw new ErrorUsuario(
            firma === 'vencida'
              ? 'La tarifa de Starken venció. Vuelve a cotizar el despacho.'
              : 'La tarifa de Starken no es válida para esta cotización. Vuelve a cotizar el despacho.',
          );
        if (flete !== netoDesdeIva(tarifa.costoTotal))
          throw new ErrorUsuario(
            `El valor de despacho debe ser el neto de la tarifa elegida (${pesos(netoDesdeIva(tarifa.costoTotal))}).`,
          );
      }
      if (
        !tarifa &&
        JSON.stringify([solicitudes, cliente, observaciones, despacho]) ===
          JSON.stringify([q.solicitudes, q.cliente, q.observaciones, q.despacho]) &&
        descuentoNuevo === q.descuento &&
        descuentoManual === descuentoEsManual(q) &&
        flete === q.flete &&
        fleteCantidad === cantidadFlete(q) &&
        fleteDescripcion === (q.fleteDescripcion ?? null) &&
        margenCotizacion === margenAntes
      ) {
        if (!q.incompletos.length) return { cotizacion: q, ...extra };
        // El catálogo puede haber recibido el producto que faltaba, aunque el pedido siga igual.
        const recalculada = structuredClone(q);
        const nuevosAvisos = this.recalcular(recalculada, false);
        const pendientes = new Set(q.incompletos.map((p) => p.indice));
        const resueltas = recalculada.montos.lineas.filter((l) => l.indice !== null && pendientes.has(l.indice));
        if (!resueltas.length) return { cotizacion: q, ...extra };
        const destino = this.abrirEdicion(q, u);
        destino.solicitudes = recalculada.solicitudes;
        destino.incompletos = recalculada.incompletos;
        destino.montos = recalculada.montos;
        destino.descuento = recalculada.descuento;
        destino.actualizada = marca(destino.actualizada);
        u.guardar(destino);
        // Los productos agregados a mano los conoce el catálogo con que se cotizó, no la base de cotizaciones.
        const catalogo = this.catalogo as CatalogoConsultable & { listarManuales?: () => { codigo: string }[] };
        const manuales = new Set((catalogo.listarManuales?.() ?? []).map((p) => p.codigo));
        for (const linea of resueltas)
          u.registrarEvento(
            destino.id, 'modificada', this.autor,
            `Ítem ${linea.indice! + 1} cotizado con ${linea.producto.codigo}${manuales.has(linea.producto.codigo) ? ', agregado al catálogo' : ' del catálogo vigente'}`,
          );
        const todos = [...avisos, ...nuevosAvisos];
        return { cotizacion: destino, ...(todos.length ? { avisos: todos } : {}) };
      }
      const destino = this.abrirEdicion(q, u);
      const antes = structuredClone(destino.solicitudes),
        clienteAntes = destino.cliente;
      destino.solicitudes = solicitudes;
      destino.cliente = cliente;
      const descuentoAntes = descuentoDe(destino);
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
              `Margen especial de la cotización: ${margenAntes === null ? ESTANDAR_CATEGORIA : margenTexto(margenAntes)} → ${margenCotizacion === null ? ESTANDAR_CATEGORIA : margenTexto(margenCotizacion)}`,
            ]
          : []),
        ...(observaciones !== destino.observaciones ? ['Observaciones actualizadas'] : []),
        ...(JSON.stringify(despacho) !== JSON.stringify(destino.despacho) ? ['Despacho actualizado'] : []),
        ...(tarifa ? [textoTarifaAplicada(tarifa)] : []),
      ];
      for (const cambio of accion.items ?? []) {
        // `antes` y no `q.solicitudes`: en un borrador `destino` es `q` y sus ítems ya son los nuevos.
        const anterior = antes[cambio.indice];
        if (!anterior) continue;
        const margenLinea = solicitudes[cambio.indice].margen ?? null;
        if (cambio.cambios.margen !== undefined && margenLinea !== (anterior.margen ?? null)) {
          const linea = q.montos.lineas.find((l) => l.indice === cambio.indice);
          const margenAnterior = linea ? margenTexto(linea.margen ?? 0) : 'sin resolver';
          const sinMargenPropio = margenCotizacion === null ? ESTANDAR_CATEGORIA : 'margen especial de la cotización';
          const margenNuevo = margenLinea === null ? sinMargenPropio : margenTexto(margenLinea);
          extras.push(`Margen de ${this.describir(anterior)}: ${margenAnterior} → ${margenNuevo}`);
        }
        if (cambio.cambios.precioUnitario !== undefined && cambio.cambios.precioUnitario !== anterior.precioUnitario)
          extras.push(`Precio cliente de ${this.describir(anterior)} actualizado${cambio.cambios.precioUnitario === null ? ' según margen aplicado' : ` a ${pesos(cambio.cambios.precioUnitario)}`}`);
      }
      destino.descuento = descuentoNuevo;
      destino.descuentoManual = descuentoManual;
      destino.flete = flete;
      destino.fleteCantidad = fleteCantidad;
      destino.fleteDescripcion = fleteDescripcion;
      destino.margenCotizacion = margenCotizacion;
      destino.observaciones = observaciones;
      destino.despacho = despacho;
      const todos = [...avisos, ...this.recalcular(destino)];
      extras.unshift(...cambioDescuento(descuentoAntes, destino));
      u.guardar(destino);
      const cambios = this.cambios(antes, solicitudes, clienteAntes, cliente);
      u.registrarEvento(destino.id, 'modificada', this.autor, textoCambios(cambios, extras));
      return { cotizacion: destino, ...(todos.length ? { avisos: todos } : {}), ...(cambios ? { cambios } : {}) };
    });
  }

  /** Reserva el número, genera el PDF fuera del bloqueo y confirma solo si nadie cambió la cotización. */
  private async emitir(accion: Extract<Accion, { tipo: 'emitir' }>): Promise<Resultado> {
    const preparado = await this.almacen.transaccion(
      (u): Preparado<{ avisos: string[] }> | PreciosCambiados => {
        const q = this.obtener(u, accion.id);
        if (q.pdf) return { listo: q };
        if (q.estado !== 'borrador') this.exigirEditable(q);
        this.verificarVersion(q, accion.actualizada);
        this.verificarSerieNoAprobada(q, u);
        // M3: los montos se recalculan con el catálogo vigente al emitir, no con los guardados.
        const copia = structuredClone(q);
        this.recalcular(copia, false);
        if (copia.incompletos.length || !copia.montos.lineas.length)
          throw new ErrorUsuario(
            'Completa o quita los ítems pendientes antes de generar el PDF.',
            'incompleta',
          );
        const avisos = this.diferenciasPrecio(q.montos, copia.montos);
        if (!avisos.length && q.montos.total !== copia.montos.total)
          avisos.push(`El total pasó de ${pesos(q.montos.total)} a ${pesos(copia.montos.total)}.`);
        // Nunca se emite un total distinto del que la persona revisó: se actualiza el borrador y se
        // pide confirmar. Al reenviar con la versión nueva ya no hay diferencias y se emite.
        if (avisos.length) {
          q.montos = copia.montos;
          q.descuento = copia.descuento;
          q.incompletos = [];
          q.actualizada = marca(q.actualizada);
          u.guardar(q);
          u.registrarEvento(
            q.id,
            'modificada',
            this.autor,
            `Precios del catálogo vigente: ${avisos.join(' ')}`,
          );
          return { listo: null, cambiados: { avisos, total: q.montos.total, actualizada: q.actualizada } };
        }
        // Reserva durable antes de generar: un fallo puede dejar un salto, jamás reutilizar un número.
        const numero = u.reservarCotizacion(accion.numero);
        return { listo: null, copia, numero, avisos, version: q.actualizada };
      },
    );
    if (preparado.listo) return { cotizacion: preparado.listo, archivo: preparado.listo.pdf! };
    if ('cambiados' in preparado)
      throw new ErrorConflicto(
        'Los precios del catálogo cambiaron desde que revisaste esta cotización. Revisa los montos actualizados antes de emitir.',
        'precios_cambiaron',
        preparado.cambiados,
      );
    const { copia, numero, avisos, version } = preparado;
    // La vigencia cuenta días hábiles: antes se actualizan los feriados decretados (sin bloquear si no hay red).
    await prepararFeriados(this.almacen.baseDatos());
    const reglas = copia.reglas ?? REGLAS;
    const archivo = `cotizacion-${numero}.pdf`,
      fecha = new Date().toISOString(),
      vence = calcularVence(fecha, reglas.vigenciaDiasHabiles);
    const documento = { ...copia, numero, fechaEmision: fecha, vence, emitidaPor: this.autor };
    await generarPdf(
      this.almacen.directorio,
      archivo,
      await plantilla(documento, {
        tipo: 'cotizacion',
        numero,
        montos: copia.montos,
        fecha,
        vence,
        autor: this.autor,
        reglas,
        observaciones: copia.observaciones,
      }),
    );
    try {
      return await this.almacen.transaccion((u): Resultado => {
        const q = this.obtener(u, accion.id);
        if (q.pdf)
          throw new ErrorConflicto(
            `Otra persona emitió esta cotización mientras se generaba el PDF (N° ${q.numero}).`,
          );
        if (q.actualizada !== version) throw new ErrorConflicto(VERSION_OBSOLETA);
        this.verificarSerieNoAprobada(q, u);
        q.montos = copia.montos;
        q.incompletos = [];
        q.numero = numero;
        q.pdf = archivo;
        q.fechaEmision = fecha;
        q.vence = vence;
        q.estado = 'emitida';
        q.estadoComercial = 'enviada';
        q.emitidaPor = this.autor;
        q.versionCatalogo = this.versionCatalogo();
        q.actualizada = marca(q.actualizada);
        // A2: al emitir una revisión, la original deja de ser aprobable.
        if (q.origen != null) {
          const original = u.porNumero(q.origen);
          if (original?.estado === 'emitida') {
            original.estado = 'reemplazada';
            original.reemplazadaPor = numero;
            original.actualizada = marca(original.actualizada);
            u.guardar(original);
            u.registrarEvento(original.id, 'reemplazada', this.autor, `Por la revisión N° ${numero}`);
          }
        }
        u.guardar(q);
        u.registrarEvento(q.id, 'emitida', this.autor, `N° ${numero}`);
        return { cotizacion: q, archivo, ...(avisos.length ? { avisos } : {}) };
      });
    } catch (error) {
      await rm(join(this.almacen.directorio, 'pdf', archivo), { force: true });
      throw error;
    }
  }

  private async aprobar(accion: Extract<Accion, { tipo: 'aprobar' }>): Promise<Resultado> {
    return this.almacen.transaccion((u): Resultado => {
      const q = this.obtener(u, accion.id);
      if (q.estado === 'aprobada')
        return { cotizacion: q, ...(q.nota ? { archivo: q.nota.pdf } : {}) };
      if (q.estado === 'anulada')
        throw new ErrorConflicto('Esta cotización está anulada y no se puede aprobar.', 'estado_invalido');
      if (q.estado === 'reemplazada')
        throw new ErrorConflicto('Esta cotización fue reemplazada y no se puede aprobar.', 'estado_invalido');
      if (q.estado !== 'emitida' || !q.pdf || q.numero === null)
        throw new ErrorConflicto(
          'Emite la cotización y genera su PDF antes de registrar la aprobación del cliente.',
          'estado_invalido',
        );
      if (q.estadoComercial === 'rechazada')
        throw new ErrorConflicto('La cotización fue marcada como rechazada.', 'estado_invalido');
      this.verificarVersion(q, accion.actualizada);
      this.verificarSerieNoAprobada(q, u);
      if (estaVencida(q.vence) && !accion.confirmarVencida)
        throw new ErrorConflicto(
          `La cotización N° ${q.numero} venció el ${fechaChilena(q.vence!)}. Confirma que el cliente la aceptó igualmente para aprobarla.`,
          'cotizacion_vencida',
          { vence: q.vence },
        );
      q.despacho = this.despachoEditado(q, accion.despacho ?? {}).despacho;
      q.estado = 'aprobada';
      q.estadoComercial = 'aprobada';
      q.aprobadaPor = this.autor;
      q.actualizada = marca(q.actualizada);
      u.guardar(q);
      u.registrarEvento(q.id, 'aprobada', this.autor, `Aprobada por cliente · N° ${q.numero}`);
      for (const otra of u.serie(q.id))
        if (otra.id !== q.id && otra.estado === 'emitida') {
          otra.estado = 'reemplazada';
          otra.reemplazadaPor = q.numero;
          otra.actualizada = marca(otra.actualizada);
          u.guardar(otra);
          u.registrarEvento(otra.id, 'reemplazada', this.autor, `Se aprobó la N° ${q.numero}`);
        }
      return { cotizacion: q };
    });
  }

  private async registrarPago(accion: Extract<Accion, { tipo: 'pago' }>): Promise<Resultado> {
    return this.almacen.transaccion((u): Resultado => {
      const q = this.obtener(u, accion.id);
      this.exigirAprobada(q, 'Registra la aprobación del cliente antes de ingresar pagos.');
      this.verificarVersion(q, accion.actualizada);
      if (!Number.isSafeInteger(accion.monto) || accion.monto <= 0)
        throw new ErrorUsuario('El monto del pago debe ser un entero positivo en pesos.');
      const abonado = (q.pagos ?? []).reduce((s, p) => s + p.monto, 0);
      const saldo = q.montos.total - abonado;
      if (accion.monto > saldo)
        throw new ErrorUsuario(`El pago supera el saldo pendiente de ${pesos(saldo)}.`);
      const fecha = accion.fecha ? fechaElegida(accion.fecha) : new Date().toISOString();
      if (!fecha) throw new ErrorUsuario('La fecha del pago no es válida.');
      const observacion = limpiarTexto(accion.observacion, 500);
      const pago = { id: randomUUID(), fecha, monto: accion.monto, observacion, usuario: this.autor };
      q.pagos = [...(q.pagos ?? []), pago];
      this.estadoPorPagos(q);
      q.actualizada = marca(q.actualizada);
      u.guardar(q);
      u.registrarEvento(q.id, 'pago_registrado', this.autor, `${pesos(pago.monto)} · ${fecha.slice(0, 10)}${observacion ? ` · ${observacion}` : ''}`);
      return { cotizacion: q };
    });
  }

  /** Estados operativos que dependen solo de lo pagado: el anticipo antes de la nota, el saldo después de producir. */
  private estadoPorPagos(q: Cotizacion) {
    const pagado = (q.pagos ?? []).reduce((s, p) => s + p.monto, 0);
    const operacion = q.estadoOperativo ?? (q.nota ? 'pedido_generado' : 'sin_pedido');
    if (!q.nota && (operacion === 'sin_pedido' || operacion === 'anticipo_pagado'))
      q.estadoOperativo = pagado >= anticipoMinimo(q.montos.total) ? 'anticipo_pagado' : 'sin_pedido';
    else if (['produccion_terminada', 'saldo_pendiente', 'pagada'].includes(operacion))
      q.estadoOperativo = pagado >= q.montos.total ? 'pagada' : 'saldo_pendiente';
  }

  private async anularPago(accion: Extract<Accion, { tipo: 'anular_pago' }>): Promise<Resultado> {
    return this.almacen.transaccion((u): Resultado => {
      const q = this.obtener(u, accion.id);
      this.exigirAprobada(q);
      this.verificarVersion(q, accion.actualizada);
      const pago = (q.pagos ?? []).find((p) => p.id === accion.pagoId);
      if (!pago) throw new ErrorNoEncontrado('No se encontró el pago.');
      if (!pagoAnulable(q))
        throw new ErrorConflicto(
          `El pago ya no se puede anular: la operación está en «${etiquetaOperativo[q.estadoOperativo!]}».`,
          'estado_invalido',
        );
      const motivo = limpiarTexto(accion.motivo, 300);
      const anterior = q.estadoOperativo;
      q.pagos = q.pagos!.filter((p) => p.id !== pago.id);
      this.estadoPorPagos(q);
      q.actualizada = marca(q.actualizada);
      u.guardar(q);
      const cambio =
        anterior && q.estadoOperativo !== anterior
          ? ` · ${etiquetaOperativo[anterior]} → ${etiquetaOperativo[q.estadoOperativo!]}`
          : '';
      u.registrarEvento(
        q.id,
        'pago_anulado',
        this.autor,
        `${pesos(pago.monto)} · ${pago.fecha.slice(0, 10)}${pago.observacion ? ` · ${pago.observacion}` : ''}${motivo ? ` · Motivo: ${motivo}` : ''}${cambio}`,
      );
      return { cotizacion: q };
    });
  }

  private async registrarComentario(accion: Extract<Accion, { tipo: 'comentario' }>): Promise<Resultado> {
    return this.almacen.transaccion((u): Resultado => {
      const q = this.obtener(u, accion.id);
      this.verificarVersion(q, accion.actualizada);
      const texto = accion.texto.replace(/\s+/g, ' ').trim();
      if (!texto) throw new ErrorUsuario('Escribe un comentario antes de guardarlo.');
      q.comentariosInternos = [
        ...(q.comentariosInternos ?? []),
        { id: randomUUID(), fecha: new Date().toISOString(), texto: texto.slice(0, 2000), usuario: this.autor },
      ];
      q.actualizada = marca(q.actualizada);
      u.guardar(q);
      u.registrarEvento(q.id, 'comentario', this.autor, texto.slice(0, 500));
      return { cotizacion: q };
    });
  }

  private async cambiarEstadoComercial(accion: Extract<Accion, { tipo: 'comercial' }>): Promise<Resultado> {
    return this.almacen.transaccion((u): Resultado => {
      const q = this.obtener(u, accion.id);
      this.verificarVersion(q, accion.actualizada);
      if (q.estado !== 'emitida') throw new ErrorConflicto('El seguimiento comercial solo se cambia en una cotización emitida.', 'estado_invalido');
      if (q.estadoComercial === 'aprobada' || q.estadoComercial === 'vendida')
        throw new ErrorConflicto('La cotización ya fue aprobada por el cliente.', 'estado_invalido');
      q.estadoComercial = accion.estado;
      if (accion.estado === 'rechazada') {
        q.estado = 'anulada';
        q.anuladaPor = this.autor;
        q.fechaAnulacion = new Date().toISOString();
        q.motivoAnulacion = 'Rechazada por cliente';
      }
      q.actualizada = marca(q.actualizada);
      u.guardar(q);
      u.registrarEvento(q.id, 'seguimiento', this.autor, `Estado comercial: ${etiquetaComercial[accion.estado]}`);
      return { cotizacion: q };
    });
  }

  /** El valor del despacho es el flete de la cotización emitida: no se cambia sin emitir otra revisión. */
  private exigirValorDespachoFijo(q: Cotizacion, valor: number | null | undefined) {
    if (valor !== undefined && (valor ?? 0) !== q.flete)
      throw new ErrorConflicto(
        `El valor del despacho (${pesos(q.flete)} neto) quedó fijo al emitir la cotización y no se puede cambiar. Crea una revisión para modificarlo.`,
        'no_editable',
      );
  }

  /** Despacho con los cambios pedidos: el valor es siempre el flete emitido y cualquier otro se rechaza. */
  private despachoEditado(q: Cotizacion, cambios: Partial<Despacho>) {
    this.exigirValorDespachoFijo(q, cambios.valor);
    return aplicarDespacho(q.despacho, cambios, q.flete);
  }

  /** Despacho, operación y facturación parten de la aprobación del cliente y terminan si la cotización se anula. */
  private exigirAprobada(q: Cotizacion, sinAprobar = 'Registra la aprobación del cliente antes de continuar.') {
    if (q.estado === 'aprobada') return;
    throw new ErrorConflicto(
      q.estado === 'anulada' || q.estado === 'reemplazada'
        ? `La cotización N° ${q.numero} está ${q.estado} y ya no admite este cambio.`
        : sinAprobar,
      'estado_invalido',
    );
  }

  private async actualizarDespacho(accion: Extract<Accion, { tipo: 'despacho' }>): Promise<Resultado> {
    return this.almacen.transaccion((u): Resultado => {
      const q = this.obtener(u, accion.id);
      this.exigirAprobada(q);
      this.verificarVersion(q, accion.actualizada);
      if (!despachoEditable(q))
        throw new ErrorConflicto(
          `El despacho ya está registrado (${etiquetaOperativo[q.estadoOperativo!]}) y sus datos no se pueden cambiar.`,
          'no_editable',
        );
      const { despacho, cambiados } = this.despachoEditado(q, accion.despacho);
      if (!cambiados.length) return { cotizacion: q };
      // La nota de pedido conserva el despacho con que se generó: no se regenera ni se toca su PDF.
      q.despacho = despacho;
      q.actualizada = marca(q.actualizada);
      u.guardar(q);
      u.registrarEvento(q.id, 'despacho_actualizado', this.autor, cambiados.map((c) => c.texto).join(' · '));
      return { cotizacion: q };
    });
  }

  private async cambiarEstadoOperativo(accion: Extract<Accion, { tipo: 'operacion' }>): Promise<Resultado> {
    return this.almacen.transaccion((u): Resultado => {
      const q = this.obtener(u, accion.id);
      this.exigirAprobada(q);
      this.verificarVersion(q, accion.actualizada);
      const pagado = (q.pagos ?? []).reduce((s, p) => s + p.monto, 0);
      const paso = accion.paso;
      const esPasoValido =
        (paso === 'iniciar_produccion' && !!q.nota && q.estadoOperativo === 'pedido_generado') ||
        (paso === 'produccion_terminada' && q.estadoOperativo === 'en_produccion') ||
        (paso === 'lista_despacho' && ['produccion_terminada', 'pagada'].includes(q.estadoOperativo ?? '') && pagado >= q.montos.total) ||
        (paso === 'despachada' && q.estadoOperativo === 'lista_despacho') ||
        (paso === 'completada' && q.estadoOperativo === 'despachada');
      if (!esPasoValido) throw new ErrorConflicto('Esta acción no está disponible para el estado actual.', 'estado_invalido');
      // Anular un pago después de la nota puede dejar el pedido bajo el anticipo: la producción lo exige de nuevo.
      if ((paso === 'iniciar_produccion' || paso === 'produccion_terminada') && pagado < anticipoMinimo(q.montos.total))
        throw new ErrorConflicto(
          `La producción se habilita con al menos 50 % pagado (${pesos(anticipoMinimo(q.montos.total))}); hay ${pesos(pagado)} registrados.`,
          'estado_invalido',
        );
      const anterior = q.estadoOperativo!;
      let despacho: Despacho | undefined;
      let logistica = '';
      if (paso === 'despachada') {
        const editado = this.despachoEditado(q, accion.despacho ?? {});
        despacho = editado.despacho;
        if (sinTransportista(despacho.transporte))
          throw new ErrorUsuario('Indica el transportista antes de registrar el despacho.');
        q.despacho = despacho;
        // Transportista y destino vigentes; dirección y entrega solo si este paso las cambió.
        logistica = [
          '',
          `Transportista: ${despacho.transporte}`,
          `Destino: ${despacho.destino ?? 'sin indicar'}`,
          ...editado.cambiados.filter((c) => c.campo === 'direccion' || c.campo === 'entregaComprometida').map((c) => c.texto),
        ].join(' · ');
      }
      q.estadoOperativo = ({
        iniciar_produccion: 'en_produccion',
        produccion_terminada: pagado < q.montos.total ? 'saldo_pendiente' : 'pagada',
        lista_despacho: 'lista_despacho',
        despachada: 'despachada',
        completada: 'completada',
      }[paso]) as NonNullable<Cotizacion['estadoOperativo']>;
      q.actualizada = marca(q.actualizada);
      u.guardar(q);
      const evento: Record<typeof paso, 'produccion' | 'produccion_terminada' | 'lista_despacho' | 'despachada' | 'completada'> = {
        iniciar_produccion: 'produccion',
        produccion_terminada: 'produccion_terminada',
        lista_despacho: 'lista_despacho',
        despachada: 'despachada',
        completada: 'completada',
      };
      u.registrarEvento(
        q.id,
        evento[paso],
        this.autor,
        `${etiquetaOperativo[anterior]} → ${etiquetaOperativo[q.estadoOperativo]}${logistica}`,
      );
      return { cotizacion: q };
    });
  }

  private async actualizarFacturacion(accion: Extract<Accion, { tipo: 'facturacion' }>): Promise<Resultado> {
    return this.almacen.transaccion((u): Resultado => {
      const q = this.obtener(u, accion.id);
      this.exigirAprobada(q);
      this.verificarVersion(q, accion.actualizada);
      let facturacion: Facturacion = { estado: 'pendiente', tipo: null, identificadorExterno: null, fecha: null };
      if (accion.estado === 'facturada') {
        if (accion.tipoDocumento !== 'factura' && accion.tipoDocumento !== 'boleta')
          throw new ErrorUsuario('Indica si se emitió una factura o una boleta.');
        const fecha = accion.fecha ? fechaElegida(accion.fecha) : new Date().toISOString();
        if (!fecha) throw new ErrorUsuario('La fecha de la factura no es válida.');
        facturacion = {
          estado: 'facturada',
          tipo: accion.tipoDocumento,
          identificadorExterno: limpiarTexto(accion.identificadorExterno, 120),
          fecha,
        };
      }
      const actual = q.facturacion;
      if (actual && JSON.stringify(actual) === JSON.stringify(facturacion)) return { cotizacion: q };
      q.facturacion = facturacion;
      q.actualizada = marca(q.actualizada);
      u.guardar(q);
      u.registrarEvento(
        q.id,
        'facturada',
        this.autor,
        facturacion.estado === 'facturada'
          ? `${etiquetaFacturacion(facturacion)} · ${facturacion.fecha!.slice(0, 10)}`
          : 'Vuelve a pendiente de facturación',
      );
      return { cotizacion: q };
    });
  }

  private async generarNotaPedido(accion: Extract<Accion, { tipo: 'generar_nota' }>): Promise<Resultado> {
    const preparado = await this.almacen.transaccion((u): Preparado<{ montos: Montos }> => {
      const q = this.obtener(u, accion.id);
      // Antes que la nota: una aprobada que después se anuló no se informa como aprobada.
      if (q.estado === 'anulada')
        throw new ErrorConflicto(
          `La cotización N° ${q.numero} está anulada${q.nota ? ` junto con su nota de pedido N° ${q.nota.numero}` : ''} y no se puede aprobar. Duplícala para preparar una nueva.`,
          'estado_invalido',
        );
      if (q.nota) return { listo: q };
      // Aprobar es irreversible: exige una cotización ya emitida y revisada, nunca emite de paso.
      if (q.estado !== 'aprobada' || !q.pdf || q.numero === null)
        throw new ErrorConflicto(
          'Registra la aprobación del cliente antes de preparar la nota de pedido.',
          'estado_invalido',
        );
      this.verificarVersion(q, accion.actualizada);
      const pagado = (q.pagos ?? []).reduce((s, p) => s + p.monto, 0);
      if (pagado < anticipoMinimo(q.montos.total))
        throw new ErrorConflicto(`La nota de pedido se habilita al registrar al menos 50 % (${pesos(anticipoMinimo(q.montos.total))}).`, 'estado_invalido');
      this.verificarSerieNoAprobada(q, u);
      // La nota usa los precios guardados sin ajuste, sin descuento ni flete, y a precio de fábrica:
      // ni el margen especial de la cotización ni el de las líneas (no se pasan) intervienen.
      const montos = cotizar(
        q.montos.lineas.map((l) => ({
          producto: l.producto,
          cantidad: l.cantidad,
          indice: l.indice,
          anchoSolicitado: l.anchoSolicitado,
          altoSolicitado: l.altoSolicitado,
          medidaSolicitada: l.medidaSolicitada,
          // La nota de pedido usa el costo de fábrica, no el precio personalizado de venta.
          precioUnitario: null,
          tipoMedida: l.tipoMedida,
          observaciones: l.observaciones,
          descripcionDocumento: l.descripcionDocumento,
        })),
        {
          ...(q.reglas ?? REGLAS),
          ajuste: 0,
          margenes: Object.fromEntries(Object.keys(MARGENES_INICIALES).map((k) => [k, 0])) as typeof MARGENES_INICIALES,
        },
      );
      const numero = u.reservarNota();
      const copia = structuredClone(q);
      const despacho: Despacho = q.despacho ?? { direccion: null, transporte: null };
      copia.despacho = {
        direccion: limpiarTexto(despacho.direccion, 300),
        transporte: limpiarTexto(despacho.transporte, 120),
        entregaComprometida: limpiarTexto(despacho.entregaComprometida, 120),
        destino: despacho.destino ?? null,
        valor: q.flete,
      };
      return { listo: null, copia, numero, montos, version: q.actualizada };
    });
    if (preparado.listo) return { cotizacion: preparado.listo, archivo: preparado.listo.nota!.pdf };
    const { copia, numero, montos, version } = preparado;
    const despacho: Despacho = copia.despacho ?? {
      direccion: null,
      transporte: null,
      entregaComprometida: null,
    };
    const archivo = `nota-pedido-${numero}.pdf`,
      fecha = new Date().toISOString();
    await generarPdf(
      this.almacen.directorio,
      archivo,
      await plantilla(copia, {
        tipo: 'nota',
        numero,
        montos,
        fecha,
        autor: this.autor,
        despacho,
        reglas: copia.reglas,
        observaciones: copia.observaciones,
      }),
    );
    try {
      return await this.almacen.transaccion((u): Resultado => {
        const q = this.obtener(u, accion.id);
        if (q.nota)
          throw new ErrorConflicto(`Otra persona aprobó esta cotización (nota N° ${q.nota.numero}).`);
        if (q.actualizada !== version || q.estado !== 'aprobada') throw new ErrorConflicto(VERSION_OBSOLETA);
        this.verificarSerieNoAprobada(q, u);
        q.despacho = despacho;
        const notaDespacho: Despacho = {
          direccion: despacho.direccion,
          transporte: despacho.transporte,
          ...(despacho.entregaComprometida ? { entregaComprometida: despacho.entregaComprometida } : {}),
          destino: despacho.destino ?? null,
          valor: despacho.valor ?? q.flete,
        };
        q.nota = {
          numero,
          pdf: archivo,
          montos,
          fecha,
          despacho: notaDespacho,
          observaciones: copia.observaciones,
          anulada: false,
        };
        q.estadoOperativo = 'pedido_generado';
        q.estadoComercial = 'vendida';
        q.historial.push({
          rol: 'asistente',
          texto: `Nota de pedido N° ${numero} generada después de registrar el anticipo.`,
        });
        q.actualizada = marca(q.actualizada);
        u.guardar(q);
        u.registrarEvento(q.id, 'nota_generada', this.autor, `Nota de pedido N° ${numero} · precio fábrica`);
        // Las demás emitidas de la serie ya no pueden aprobarse: una sola nota por pedido.
        for (const otra of u.serie(q.id))
          if (otra.id !== q.id && otra.estado === 'emitida') {
            otra.estado = 'reemplazada';
            otra.reemplazadaPor = q.numero;
            otra.actualizada = marca(otra.actualizada);
            u.guardar(otra);
            u.registrarEvento(otra.id, 'reemplazada', this.autor, `Se aprobó la N° ${q.numero}`);
          }
        return { cotizacion: q, archivo };
      });
    } catch (error) {
      await rm(join(this.almacen.directorio, 'pdf', archivo), { force: true });
      throw error;
    }
  }

  private aplicarModificacion(base: Cotizacion, cambios: ModificacionCotizacion) {
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
      !Object.keys(cambios.cliente ?? {}).length
    )
      return null;
    for (const cambio of actualizar) {
      if (
        cambio.indice >= items.length ||
        actualizarIndices.has(cambio.indice) ||
        !Object.keys(cambio.cambios).length
      )
        return null;
      actualizarIndices.add(cambio.indice);
      const siguiente = { ...items[cambio.indice], ...sanearTextos(cambio.cambios) };
      // La frase del cambio se suma a la del pedido original: juntas explican de dónde sale el ítem.
      if (cambio.cambios.fuente !== undefined) {
        const previa = items[cambio.indice].fuente ?? null,
          nueva = siguiente.fuente ?? null;
        siguiente.fuente =
          previa && nueva && !previa.includes(nueva)
            ? textoCampo('fuente', `${previa} · ${nueva}`)
            : (previa ?? nueva);
      }
      if (cambio.cambios.modelo !== undefined) reiniciarOrigenModelo(siguiente);
      const anterior = items[cambio.indice];
      const descartes = descartarDelProducto(anterior, siguiente, {
        antes: this.producto(anterior, siguiente),
        despues: this.producto(siguiente, anterior),
      });
      if (descartes) descartados.push([siguiente, descartes]);
      items[cambio.indice] = siguiente;
    }
    for (const indice of quitar) {
      if (indice >= items.length || quitarIndices.has(indice) || actualizarIndices.has(indice)) return null;
      quitarIndices.add(indice);
    }
    for (const indice of [...quitarIndices].sort((a, b) => b - a)) items.splice(indice, 1);
    items.push(...(cambios.agregar ?? []).map(sanearTextos));
    if (items.length > 100) return null;
    return {
      items,
      cliente: { ...base.cliente, ...(cambios.cliente ?? {}) },
      avisos: descartados.map(([d, descartes]) => avisoProductoCambiado(items.indexOf(d) + 1, descartes)),
    };
  }

  private async chat(accion: Extract<Accion, { tipo: 'chat' }>): Promise<Resultado> {
    // La IA puede tardar hasta el plazo configurado: se consulta sin retener el bloqueo del estado,
    // para no dejar esperando (ni fallar) las acciones de otra persona.
    const conversacion = accion.id ? this.almacen.obtener(accion.id) : null;
    if (accion.id && !conversacion) throw new ErrorNoEncontrado();
    if (!accion.id && accion.nuevoId) this.verificarNoProcesado(accion.nuevoId);
    if (conversacion && accion.actualizada !== undefined && accion.actualizada !== conversacion.actualizada)
      throw new ErrorConflicto(VERSION_OBSOLETA);
    let previo: Cotizacion | null = null;
    let modo: 'cotizacion_nueva' | 'modificacion_anterior' = 'cotizacion_nueva';
    if (accion.objetivoId) {
      previo = this.almacen.obtener(accion.objetivoId);
      if (!previo) throw new ErrorNoEncontrado('No se encontró la cotización seleccionada.');
      if (!accion.objetivoActualizada || accion.objetivoActualizada !== previo.actualizada)
        throw new ErrorConflicto(
          'La cotización cambió. Elige nuevamente la cotización que quieres modificar.',
        );
      modo = 'modificacion_anterior';
    } else {
      const referencia = SOLICITUD_APROBACION.test(accion.mensaje)
        ? { tipo: 'ninguna' as const }
        : resolverReferencia(accion.mensaje, this.almacen.candidatas(), conversacion?.id);
      if (referencia.tipo === 'inexistente')
        throw new ErrorNoEncontrado(
          `No existe la cotización N° ${referencia.numero}. Revisa el número o búscala en el historial; no se aplicó ningún cambio.`,
        );
      if (referencia.tipo === 'multiples') {
        const contexto = conversacion ?? this.almacen.obtener(referencia.opciones[0].id);
        if (!contexto) throw new ErrorNoEncontrado('No se encontró la cotización seleccionada.');
        return { cotizacion: contexto, seleccion: referencia.opciones };
      }
      if (referencia.tipo === 'unica') {
        previo = this.almacen.obtener(referencia.cotizacion.id);
        if (!previo) throw new ErrorNoEncontrado();
        modo = 'modificacion_anterior';
      } else previo = conversacion;
    }
    if (previo) this.exigirEditable(previo);
    // M4: si la emitida ya tiene una revisión abierta, el cambio se aplica sobre esa revisión.
    if (previo?.estado === 'emitida') previo = this.almacen.revisionAbierta(previo) ?? previo;
    // M1: el borrador nuevo se escribe recién con la respuesta de la IA; si falla, no queda nada.
    const nuevo = previo ? null : { ...this.nueva(), ...(accion.nuevoId ? { id: accion.nuevoId } : {}) };
    const base = previo ?? nuevo!;
    // Sin borrador, el contexto de la conversación es el intercambio previo que no se guardó.
    const historialIA = nuevo ? (accion.contexto ?? []) : base.historial;
    let salida: unknown;
    try {
      salida = await this.llm.interpretar(
        contextoSeguro(
          accion.mensaje,
          base.solicitudes,
          base.cliente,
          modelosCatalogo(this.catalogo),
          maderasCatalogo(this.catalogo),
          historialIA,
          modo,
          modo === 'modificacion_anterior'
            ? { numero: base.numero ?? base.origen ?? null, estado: base.estado }
            : null,
          {
            modelos: aliasModelosCatalogo(this.catalogo),
            maderas: aliasMaderasCatalogo(this.catalogo),
            catalogo: mapaCatalogo(this.catalogo),
          },
        ),
      );
    } catch (error) {
      if (error instanceof ErrorIA) throw error;
      throw errorProveedor();
    }
    return this.almacen.transaccion((u): Resultado => {
      let q: Cotizacion;
      if (nuevo) {
        // Se guarda recién si el mensaje trae un pedido o datos del cliente (ver `efimera`).
        if (u.obtener(nuevo.id)) throw this.errorProcesado(nuevo.id);
        q = nuevo;
      } else {
        q = this.obtener(u, base.id);
        // Control optimista: la respuesta se calculó sobre la versión leída antes de consultar a la IA.
        if (q.actualizada !== base.actualizada)
          throw new ErrorConflicto(
            'La cotización cambió mientras se procesaba tu mensaje. Revisa el detalle y vuelve a enviarlo.',
          );
        this.exigirEditable(q);
      }
      const responder = (texto: string, extra: Omit<Resultado, 'cotizacion'> = {}): Resultado => {
        this.registrar(q, accion.mensaje, texto);
        if (q === nuevo) return { cotizacion: q, ...extra, efimera: true };
        u.guardar(q);
        return { cotizacion: q, ...extra };
      };
      const parsed = salidaSchema.safeParse(salida);
      if (!parsed.success) return responder(NO_ENTENDI);
      const res = parsed.data;
      if (res.name === 'aprobar_cotizacion') {
        const numero = res.input.numero;
        const objetivo = u.porNumero(numero);
        if (!objetivo) return responder(`No existe la cotización N° ${numero}. Genera primero su PDF.`);
        if (objetivo.estado === 'anulada')
          return responder(
            `La cotización N° ${numero} está anulada${objetivo.nota ? `, junto con su nota de pedido N° ${objetivo.nota.numero},` : ''} y no se puede aprobar. Duplícala para preparar una nueva.`,
          );
        if (objetivo.nota)
          return responder(
            `La cotización N° ${numero} ya está aprobada con la nota de pedido N° ${objetivo.nota.numero}.`,
            { archivo: objetivo.nota.pdf },
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
        const texto = `¿Confirmas que el cliente aprobó la cotización N° ${numero}? Se registrará la aprobación; la nota de pedido estará disponible al registrar al menos 50 % de pago.${vencida ? ` Atención: venció el ${fechaChilena(objetivo.vence!)}.` : ''}`;
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
      let propuesta: { items: SolicitudItem[]; cliente: Partial<Cliente>; avisos: string[] };
      if (res.name === 'actualizar_cotizacion') {
        if (modo === 'modificacion_anterior') return responder(NO_ENTENDI);
        // La IA devuelve la lista completa sin margen ni precio: se recuperan las ediciones manuales de q.
        const { items, avisos: avisosFusion } = fusionarItems(
          q.solicitudes,
          res.input.items.map(sanearTextos),
          (s, pareja) => this.producto(s, pareja),
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
        // En una cotización nueva los índices se refieren al borrador en curso (vacío si aún no existe).
        const aplicado = this.aplicarModificacion(q, res.input);
        if (!aplicado) return responder(NO_ENTENDI);
        propuesta = aplicado;
      } else
        // No deja pasar montos inventados ni texto monetario desde el modelo.
        return responder(
          TEXTO_MONETARIO.test(res.input.texto)
            ? 'Puedo ayudarte con modelos, maderas, medidas, cantidades y datos del cliente. Los montos se muestran en la cotización.'
            : res.input.texto,
        );
      if (this.llm.verificarCifras) {
        // Lo que vio la IA: el mensaje y los turnos recientes. Una cifra que no está ahí, la inventó.
        const textosIA = [accion.mensaje, ...historialIA.map((m) => m.texto)];
        const anclado = anclarCifras(propuesta.items, q.solicitudes, textosIA);
        const nombres = anclarNombres(anclado.items, q.solicitudes, textosIA, {
          modelo: aliasModelosCatalogo(this.catalogo),
          madera: aliasMaderasCatalogo(this.catalogo),
        }, resolverNombres(this.catalogo));
        propuesta = {
          ...propuesta,
          items: nombres.items,
          avisos: [...propuesta.avisos, ...anclado.avisos, ...nombres.avisos],
        };
      }
      const { solicitudes, avisos: avisosItems } = this.sanearSolicitudes(propuesta.items);
      const { cliente, avisos: avisosCliente } = sanearCliente(propuesta.cliente);
      const avisos = [...propuesta.avisos, ...avisosItems, ...avisosCliente];
      const extra = avisos.length ? { avisos } : {};
      if (q === nuevo && !solicitudes.length && Object.values(cliente).every((v) => v === null))
        return responder(
          'Cuéntame qué necesitas cotizar: modelo, madera, medidas y cantidad. También puedes agregar los datos del cliente.',
          extra,
        );
      if (
        this.sinCambios(q, solicitudes, cliente) &&
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
      const destino = this.abrirEdicion(q, u);
      const descuentoAntes = descuentoDe(destino);
      destino.solicitudes = solicitudes;
      destino.cliente = cliente;
      const todos = [...avisos, ...this.recalcular(destino)];
      const exito =
        modo === 'modificacion_anterior'
          ? `Cotización actualizada${destino.origen ? ` como revisión de la N° ${destino.origen}` : ''}. Revisa el detalle y genera el PDF cuando esté listo.`
          : 'Cotización actualizada. Revisa el detalle y genera el PDF cuando esté listo.';
      this.registrar(
        destino,
        accion.mensaje,
        [
          ...todos,
          destino.incompletos.length ? destino.incompletos.map((i) => i.pregunta).join('\n\n') : exito,
        ].join('\n\n'),
      );
      u.guardar(destino);
      const cambios = this.cambios(antes, solicitudes, clienteAntes, cliente);
      const detalle = textoCambios(cambios, cambioDescuento(descuentoAntes, destino));
      if (destino === nuevo) u.registrarEvento(destino.id, 'creada', this.autor, detalle);
      else u.registrarEvento(destino.id, 'modificada', this.autor, detalle);
      return { cotizacion: destino, ...(todos.length ? { avisos: todos } : {}), ...(cambios ? { cambios } : {}) };
    });
  }

  private errorProcesado(id: string) {
    return new ErrorConflicto(
      'Tu mensaje anterior ya se había procesado. Se abrió la cotización resultante.',
      'mensaje_procesado',
      { id },
    );
  }

  /** Un reenvío tras cancelar la espera no crea un segundo borrador con el mismo pedido. */
  private verificarNoProcesado(id: string) {
    if (this.almacen.obtener(id)) throw this.errorProcesado(id);
  }
}

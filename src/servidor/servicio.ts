import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ErrorIA, errorProveedor } from '../asistente/errores';
import { pregunta } from '../asistente/preguntas';
import type { ModificacionCotizacion } from '../asistente/esquemas';
import { salidaSchema } from '../asistente/esquemas';
import { contextoSeguro, type LLM } from '../asistente/llm';
import {
  aliasMaderasCatalogo,
  aliasModelosCatalogo,
  maderaDelCatalogo,
  maderasCatalogo,
  metros,
  modeloDelCatalogo,
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
import { aCentesimas } from '../negocio/cifras';
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
  despachoEditable,
  etiquetaComercial,
  etiquetaFacturacion,
  etiquetaOperativo,
  pagoAnulable,
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
      descuento?: number;
      flete?: number;
      observaciones?: string | null;
      despacho?: Partial<Despacho> | null;
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
const CAMPOS_DESPACHO = [
  ['direccion', 'Dirección', 300],
  ['transporte', 'Transportista', 120],
  ['entregaComprometida', 'Entrega comprometida', 120],
  ['destino', 'Destino', 300],
] as const;
/** «Otro» solo indica que falta el nombre: no identifica a quien lleva el pedido. */
const sinTransportista = (transporte: string | null | undefined) =>
  !transporte || transporte.trim().toLowerCase() === 'otro';

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
      flete: 0,
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
    q.montos = validos.length
      ? cotizar(validos, q.reglas ?? REGLAS, { descuento: q.descuento, flete: q.flete })
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
   * Un alias dudoso cuenta como el modelo que se sugiere: confirmarlo no es cambiar de producto.
   */
  private producto(s: SolicitudItem): ProductoItem {
    const modelo = s.modelo ? modeloDelCatalogo(this.catalogo, s.modelo) : null;
    return {
      modelo: modelo ? normalizar(modelo.posible ?? modelo.modelo) : '',
      madera: s.madera ? normalizar(maderaDelCatalogo(this.catalogo, s.madera) ?? s.madera) : '',
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
      a.flete === b.flete &&
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
          destino.solicitudes.splice(accion.indice, 1);
          this.recalcular(destino);
          u.guardar(destino);
          const cambios = this.cambios(antes, destino.solicitudes, q.cliente, destino.cliente);
          u.registrarEvento(destino.id, 'modificada', this.autor, textoCambios(cambios));
          return { cotizacion: destino, ...(cambios ? { cambios } : {}) };
        });
      case 'editar':
        return this.editar(accion);
      case 'duplicar':
        return this.almacen.transaccion((u) => {
          const origen = this.obtener(u, accion.id);
          const q = this.nueva();
          q.solicitudes = structuredClone(origen.solicitudes);
          q.cliente = structuredClone(origen.cliente);
          // El descuento y el flete acordados forman parte de lo que se duplica.
          q.descuento = origen.descuento;
          q.flete = origen.flete;
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
            origen.numero ? `Copia de N° ${origen.numero}` : 'Copia de un borrador',
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
          const motivo = accion.motivo?.replace(/\s+/g, ' ').trim().slice(0, 300) || null;
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
          if (valor !== null && (!Number.isFinite(valor) || valor < -0.5 || valor > 5 || Math.round(valor * 10000) !== valor * 10000))
            throw new ErrorUsuario('El margen debe ser un porcentaje entre -50 % y 500 %, con hasta dos decimales.');
          siguiente.margen = valor ?? null;
          if (valor !== null) siguiente.precioUnitario = null;
        }
        const anterior = solicitudes[cambio.indice];
        const descartes = descartarDelProducto(anterior, siguiente, {
          antes: this.producto(anterior),
          despues: this.producto(siguiente),
        });
        if (descartes) avisosItems.push(avisoProductoCambiado(cambio.indice + 1, descartes));
        solicitudes[cambio.indice] = siguiente;
      }
      const { cliente, avisos: avisosCliente } = accion.cliente
        ? sanearCliente(accion.cliente, q.cliente)
        : { cliente: q.cliente, avisos: [] as string[] };
      const avisos = [...avisosItems, ...avisosCliente];
      const descuento = accion.descuento ?? q.descuento,
        flete = accion.flete ?? (accion.despacho?.valor === undefined ? q.flete : accion.despacho.valor ?? 0);
      const reglas = q.reglas ?? REGLAS;
      if (!descuentoValido(descuento, reglas.descuentoMaximo))
        throw new ErrorUsuario(
          `El descuento debe estar entre 0 % y ${reglas.descuentoMaximo} %, con hasta dos decimales.`,
        );
      if (!fleteValido(flete))
        throw new ErrorUsuario('El flete debe ser un monto neto entero en pesos, desde $0.');
      const extra = avisos.length ? { avisos } : {};
      const descuentoNuevo = aCentesimas(descuento);
      const observaciones =
        accion.observaciones === undefined
          ? q.observaciones
          : accion.observaciones?.replace(/\s+/g, ' ').trim().slice(0, 2000) || null;
      const despacho =
        accion.despacho === undefined
          ? q.despacho
          : accion.despacho === null
            ? null
            : {
                direccion:
                  accion.despacho.direccion === undefined
                    ? q.despacho?.direccion ?? null
                    : typeof accion.despacho.direccion === 'string'
                      ? accion.despacho.direccion.replace(/\s+/g, ' ').trim().slice(0, 300) || null
                      : null,
                transporte:
                  accion.despacho.transporte === undefined
                    ? q.despacho?.transporte ?? null
                    : typeof accion.despacho.transporte === 'string'
                      ? accion.despacho.transporte.replace(/\s+/g, ' ').trim().slice(0, 120) || null
                      : null,
                entregaComprometida:
                  accion.despacho.entregaComprometida === undefined
                    ? q.despacho?.entregaComprometida ?? null
                    : typeof accion.despacho.entregaComprometida === 'string'
                      ? accion.despacho.entregaComprometida.replace(/\s+/g, ' ').trim().slice(0, 120) || null
                      : null,
                destino:
                  accion.despacho.destino === undefined
                    ? q.despacho?.destino ?? null
                    : typeof accion.despacho.destino === 'string'
                      ? accion.despacho.destino.replace(/\s+/g, ' ').trim().slice(0, 300) || null
                      : null,
                valor: flete,
              };
      if (
        JSON.stringify([solicitudes, cliente, observaciones, despacho]) ===
          JSON.stringify([q.solicitudes, q.cliente, q.observaciones, q.despacho]) &&
        descuentoNuevo === q.descuento &&
        flete === q.flete
      )
        return { cotizacion: q, ...extra };
      const destino = this.abrirEdicion(q, u);
      const antes = structuredClone(destino.solicitudes),
        clienteAntes = destino.cliente;
      destino.solicitudes = solicitudes;
      destino.cliente = cliente;
      const extras = [
        ...(descuentoNuevo !== destino.descuento
          ? [`Descuento ${porcentajeTexto(destino.descuento)} → ${porcentajeTexto(descuentoNuevo)}`]
          : []),
        ...(flete !== destino.flete ? [`Flete ${pesos(destino.flete)} → ${pesos(flete)}`] : []),
        ...(observaciones !== destino.observaciones ? ['Observaciones actualizadas'] : []),
        ...(JSON.stringify(despacho) !== JSON.stringify(destino.despacho) ? ['Despacho actualizado'] : []),
      ];
      for (const cambio of accion.items ?? []) {
        const anterior = q.solicitudes[cambio.indice];
        if (!anterior) continue;
        if (cambio.cambios.margen !== undefined && cambio.cambios.margen !== anterior.margen) {
          const linea = q.montos.lineas.find((l) => l.indice === cambio.indice);
          const margenAnterior = linea ? porcentajeTexto(Math.round((linea.margen ?? 0) * 10000) / 100) : 'sin resolver';
          const margenNuevo = cambio.cambios.margen === null ? 'estándar de categoría' : porcentajeTexto(cambio.cambios.margen * 100);
          extras.push(`Margen de ${this.describir(anterior)}: ${margenAnterior} → ${margenNuevo}`);
        }
        if (cambio.cambios.precioUnitario !== undefined && cambio.cambios.precioUnitario !== anterior.precioUnitario)
          extras.push(`Precio cliente de ${this.describir(anterior)} actualizado${cambio.cambios.precioUnitario === null ? ' según margen aplicado' : ` a ${pesos(cambio.cambios.precioUnitario)}`}`);
      }
      destino.descuento = descuentoNuevo;
      destino.flete = flete;
      destino.observaciones = observaciones;
      destino.despacho = despacho;
      const todos = [...avisos, ...this.recalcular(destino)];
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
      const despacho = accion.despacho ?? q.despacho ?? {};
      this.exigirValorDespachoFijo(q, despacho.valor);
      q.despacho = {
        direccion: despacho.direccion ?? q.despacho?.direccion ?? null,
        transporte: despacho.transporte ?? q.despacho?.transporte ?? null,
        entregaComprometida: despacho.entregaComprometida ?? q.despacho?.entregaComprometida ?? null,
        destino: despacho.destino ?? q.despacho?.destino ?? null,
        valor: despacho.valor ?? q.despacho?.valor ?? q.flete,
      };
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
      const observacion = accion.observacion?.replace(/\s+/g, ' ').trim().slice(0, 500) || null;
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
      q.estadoOperativo = pagado >= Math.ceil(q.montos.total * 0.5) ? 'anticipo_pagado' : 'sin_pedido';
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
        `${pesos(pago.monto)} · ${pago.fecha.slice(0, 10)}${motivo ? ` · Motivo: ${motivo}` : ''}${cambio}`,
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
    const vigente = q.despacho?.valor ?? q.flete;
    if (valor !== undefined && (valor ?? 0) !== vigente)
      throw new ErrorConflicto(
        `El valor del despacho (${pesos(vigente)} neto) quedó fijo al emitir la cotización y no se puede cambiar. Crea una revisión para modificarlo.`,
        'no_editable',
      );
  }

  /** Despacho con los cambios pedidos ya limpios y el detalle de lo que cambió, para el registro de actividad. */
  private despachoEditado(q: Cotizacion, cambios: Partial<Despacho>) {
    this.exigirValorDespachoFijo(q, cambios.valor);
    const despacho: Despacho = {
      direccion: q.despacho?.direccion ?? null,
      transporte: q.despacho?.transporte ?? null,
      entregaComprometida: q.despacho?.entregaComprometida ?? null,
      destino: q.despacho?.destino ?? null,
      valor: q.despacho?.valor ?? q.flete,
    };
    const detalle: string[] = [];
    for (const [campo, etiqueta, largo] of CAMPOS_DESPACHO) {
      if (cambios[campo] === undefined) continue;
      const nuevo = limpiarTexto(cambios[campo], largo);
      if (nuevo === despacho[campo]) continue;
      detalle.push(`${etiqueta}: ${despacho[campo] ?? '—'} → ${nuevo ?? '—'}`);
      despacho[campo] = nuevo;
    }
    return { despacho, detalle };
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
      const { despacho, detalle } = this.despachoEditado(q, accion.despacho);
      if (!detalle.length) return { cotizacion: q };
      // La nota de pedido conserva el despacho con que se generó: no se regenera ni se toca su PDF.
      q.despacho = despacho;
      q.actualizada = marca(q.actualizada);
      u.guardar(q);
      u.registrarEvento(q.id, 'despacho_actualizado', this.autor, detalle.join(' · '));
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
      const anterior = q.estadoOperativo!;
      let despacho: Despacho | undefined;
      if (paso === 'despachada') {
        despacho = this.despachoEditado(q, accion.despacho ?? {}).despacho;
        if (sinTransportista(despacho.transporte))
          throw new ErrorUsuario('Indica el transportista antes de registrar el despacho.');
        q.despacho = despacho;
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
      const logistica = despacho
        ? ` · Transportista: ${despacho.transporte} · Destino: ${despacho.destino ?? 'sin indicar'}`
        : '';
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
      if (pagado < Math.ceil(q.montos.total * 0.5))
        throw new ErrorConflicto(`La nota de pedido se habilita al registrar al menos 50 % (${pesos(Math.ceil(q.montos.total * 0.5))}).`, 'estado_invalido');
      this.verificarSerieNoAprobada(q, u);
      // La nota usa los precios guardados sin ajuste, sin descuento ni flete.
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
        direccion:
          typeof despacho.direccion === 'string'
            ? despacho.direccion.replace(/\s+/g, ' ').trim().slice(0, 300) || null
            : q.despacho?.direccion ?? null,
        transporte:
          typeof despacho.transporte === 'string'
            ? despacho.transporte.replace(/\s+/g, ' ').trim().slice(0, 120) || null
            : q.despacho?.transporte ?? null,
        entregaComprometida:
          typeof despacho.entregaComprometida === 'string'
            ? despacho.entregaComprometida.replace(/\s+/g, ' ').trim().slice(0, 120) || null
            : q.despacho?.entregaComprometida ?? null,
        destino: despacho.destino ?? null,
        valor: despacho.valor ?? q.flete,
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
      if (cambio.cambios.modelo !== undefined) reiniciarOrigenModelo(siguiente);
      const anterior = items[cambio.indice];
      const descartes = descartarDelProducto(anterior, siguiente, {
        antes: this.producto(anterior),
        despues: this.producto(siguiente),
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
          { modelos: aliasModelosCatalogo(this.catalogo), maderas: aliasMaderasCatalogo(this.catalogo) },
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
          (s) => this.producto(s),
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
        if (modo !== 'modificacion_anterior') return responder(NO_ENTENDI);
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
      if (destino === nuevo) u.registrarEvento(destino.id, 'creada', this.autor, textoCambios(cambios));
      else u.registrarEvento(destino.id, 'modificada', this.autor, textoCambios(cambios));
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

import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  maderaEfectiva,
  metros,
  modeloDelCatalogo,
  normalizar,
  normalizarMedida,
  resolverItem,
  type CatalogoConsultable,
  type Resolucion,
} from '../catalogo/resolver';
import { medidaReferencia, metrosTexto } from '../catalogo/escalones';
import { clienteVacio, type Cliente, type Producto, type SolicitudItem } from '../catalogo/tipos';
import type { LLM } from '../asistente/llm';
import { CODIGO_PERSONALIZADO, esLibre, familiaItem, productoPersonalizado } from '../negocio/personalizados';
import { mismoCliente, sanearCliente } from '../negocio/cliente';
import {
  ANTICIPO_TEXTO,
  DESCUENTO_MAXIMO,
  errorMedida,
  MARGEN_MAX,
  MARGEN_MIN,
  RANGO_MARGEN,
  rangoPrecio,
} from '../negocio/limites';
import { avisoVano, indicesMedidaSinTipo } from '../negocio/medidas';
import { aCentesimas, redondearMargen } from '../negocio/cifras';
import { contarPuertas, descuentoAutomatico, descuentoEsManual } from '../negocio/descuento-cantidad';
import { claveMedida, sanearTextos, textoCampo, type ProductoItem } from '../negocio/items';
import {
  anticipoMinimo,
  cantidadFlete,
  despachoEditable,
  etiquetaComercial,
  etiquetaFacturacion,
  etiquetaEtapa,
  etiquetaOperativo,
  etapaProduccion,
  FABRICAS,
  fabricaDeNota,
  nombreFabrica,
  numeroNota,
  numerosNotas,
  operacionDe,
  operacionPorProduccion,
  pagoAnulable,
  retrocesoOperativo,
  textoNotas,
  puedeAnular,
  rangoFechaOperacion,
  sinTransportista,
  totalPagado,
  type Cotizacion,
  type Despacho,
  type Fabrica,
  type Facturacion,
  type NotaPedido,
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
  type Linea,
  type Montos,
} from '../negocio/precios';
import { calcularVence, estaVencida, fechaChilena, fechaLocal } from '../negocio/vigencia';
import { esStarken, netoDesdeIva } from '../negocio/starken';
import type {
  Accion,
  AsignacionFabrica,
  CambiosCotizacion,
  DiagnosticoTurno,
  ItemCambio,
  Resultado,
  UsuarioServicio,
} from './acciones';
import { Almacen, type Unidad } from './almacen';
import { sanearReferencias } from './archivos-referencia';
import { procesarChat, type ContextoChat } from './chat';
import {
  aplicarCambiosItems,
  aplicarDespacho,
  aplicarFlete,
  cambioDescuento,
  claveDescuento,
  descuentoDe,
  limpiarTexto,
  marca,
  textoActividad,
  textoCambios,
} from './edicion';
import { ErrorConflicto, ErrorNoEncontrado, ErrorUsuario, registrarError, VERSION_OBSOLETA } from './errores';
import { prepararFeriados } from './feriados-sync';
import { generarPdf, plantilla, prepararPdf, type DocumentoPdf } from './pdf';
import { documentoCotizacion, documentoNota } from './documentos';
import { configuracionFabrica, fabricaIntegrada } from './integracion-configuracion';
import { cancelacionDeNota, prepararEnvio, type EnvioPreparado } from './integracion-pedido';
import { itemsVigentes } from './items-vigentes';
import { leerConfiguracionNegocio } from './configuracion-negocio';
import { verificarTarifa, huellaBulto } from './starken-firma';

export { ErrorUsuario, textoCambios };
export type {
  Accion,
  AsignacionFabrica,
  CambiosCotizacion,
  CategoriaAviso,
  DiagnosticoTurno,
  ItemCambio,
  ProductoPersonalizado,
  Resultado,
  UsuarioServicio,
} from './acciones';

/** Resultado de la primera fase de emitir/aprobar: ya estaba hecho o validado (el número se reserva después). */
type Preparado<T> = { listo: Cotizacion } | ({ listo: null; copia: Cotizacion; version: string } & T);
/** Emitir encontró montos distintos a los revisados: se guardaron en el borrador y se pide confirmar. */
type PreciosCambiados = { listo: null; cambiados: { avisos: string[]; total: number; actualizada: string } };

const CAMPOS_CLIENTE: (keyof Cliente)[] = [
  'nombre',
  'rut',
  'giro',
  'telefono',
  'direccion',
  'comuna',
  'proyecto',
];

const decimal = (n: number) => n.toFixed(2).replace('.', ',');

/** «Medida especial 0,87 × 2,36 m: se cotiza con la referencia HUIL-M-4-E (0,90–0,95 × 2,40 m), …». */
function avisoMedidaEspecial(r: Extract<Resolucion, { ok: true }>) {
  const pedida = [r.anchoSolicitado, r.altoSolicitado].filter((n) => n !== null).map(metrosTexto).join(' × ');
  return `${r.producto.familia === 'PUERTA' ? 'Medida' : 'Largo'} especial ${pedida} m: se cotiza con la referencia ${r.producto.codigo} (${medidaReferencia(r.producto)}), la siguiente medida del catálogo.`;
}

/** Fecha elegida por la persona (YYYY-MM-DD) como mediodía UTC, para que no cambie de día al mostrarla. */
function fechaElegida(fecha: string): string | null {
  const soloDia = /^\d{4}-\d{2}-\d{2}$/.test(fecha);
  const t = Date.parse(soloDia ? `${fecha}T12:00:00.000Z` : fecha);
  if (Number.isNaN(t)) return null;
  const iso = new Date(t).toISOString();
  // «2026-02-31» no es un error para Date: se corre al 3 de marzo, y eso no es lo que la persona escribió.
  return soloDia && iso.slice(0, 10) !== fecha ? null : iso;
}

/**
 * Fachada de las acciones sobre cotizaciones. La edición se apoya en edicion.ts y el chat en chat.ts; las
 * reglas compartidas viven en src/negocio.
 */
export class Servicio {
  private readonly autor: string | null;
  private readonly admin: boolean;
  constructor(
    private catalogo: CatalogoConsultable,
    private llm: LLM,
    private almacen = new Almacen(),
    usuario: UsuarioServicio | null = null,
    /** Recibe cada mensaje del chat ya guardado; no cambia lo que se responde. */
    private diagnostico?: (d: DiagnosticoTurno) => void,
  ) {
    this.autor = usuario ? usuario.nombre || usuario.email : null;
    // Sin usuario (pruebas, scripts) no hay una sesión que restringir.
    this.admin = usuario ? !!usuario.admin : true;
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
      notas: [],
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

  /**
   * Lo que vale la cotización con el catálogo vigente, sin tocarla: las solicitudes normalizadas (modelo canónico,
   * madera con que se cotiza; son copias), los pendientes, el descuento, los montos y, si hubo que ajustarlas, las
   * reglas. Trae un aviso por cada línea que pasa a cotizarse con la siguiente medida del catálogo, cada precio
   * nuevo bajo el costo, cada ajuste del descuento y cada vano justo sobre el inicio de su tramo.
   */
  private calcular(q: Cotizacion) {
    const clave = (codigo: string, ancho: number | null, alto: number | null) => `${codigo}|${ancho}|${alto}`;
    const previas = new Set(q.montos.lineas.map((l) => clave(l.producto.codigo, l.anchoSolicitado, l.altoSolicitado)));
    const previasVano = new Set(
      q.montos.lineas.map((l) => `${clave(l.producto.codigo, l.anchoSolicitado, l.altoSolicitado)}|${l.tipoMedida}`),
    );
    const avisos: string[] = [];
    // La misma regla que el bulto de Starken (ver items-vigentes.ts).
    const vigentes = itemsVigentes(this.catalogo, q);
    for (const res of vigentes.siguienteMedida) {
      const k = clave(res.producto.codigo, res.anchoSolicitado, res.altoSolicitado);
      if (previas.has(k)) continue;
      avisos.push(avisoMedidaEspecial(res));
      previas.add(k);
    }
    // Vender bajo el costo se permite (hasta −50 %), pero se avisa cada vez que ese precio o ese costo es nuevo.
    for (const b of vigentes.bajoCosto) {
      const previa = q.montos.lineas.find((l) => l.indice === b.indice);
      const especial = !!q.solicitudes[b.indice]?.personalizado;
      if (
        previa &&
        previa.precioUnitario === b.precio &&
        (especial ? previa.producto.modelo === b.nombre : previa.producto.codigo === b.nombre && previa.precioFabrica === b.costo)
      )
        continue;
      avisos.push(`El precio de ${b.nombre} queda bajo el costo de fábrica (${pesos(b.costo)}).`);
    }
    const validos = vigentes.validos;
    const guardadas = q.reglas ?? REGLAS;
    let reglas = guardadas;
    let ajustadas: typeof guardadas | undefined;
    if (q.estado === 'borrador' && guardadas.descuentoMaximo > DESCUENTO_MAXIMO) {
      ajustadas = { ...guardadas, descuentoMaximo: DESCUENTO_MAXIMO,
        descuentosPorCantidad: guardadas.descuentosPorCantidad?.map((t) => ({ ...t, porcentaje: Math.min(t.porcentaje, DESCUENTO_MAXIMO) })) };
      // El cálculo de este paso usa el máximo ajustado con los tramos como estaban; los guardados ya van ajustados.
      reglas = { ...guardadas, descuentoMaximo: DESCUENTO_MAXIMO };
      avisos.push('El descuento máximo del borrador se ajustó a 50 %.');
    }
    let descuento = q.descuento;
    if (descuento > reglas.descuentoMaximo) {
      avisos.push(`Descuento ${descuento} % → ${reglas.descuentoMaximo} % por el máximo permitido.`);
      descuento = reglas.descuentoMaximo;
    }
    // El descuento por cantidad sigue a las puertas valorizadas (sin ellas no hay descuento); uno fijado a mano no se toca.
    if (!descuentoEsManual({ descuento, descuentoManual: q.descuentoManual }))
      descuento = descuentoAutomatico(reglas, contarPuertas(validos));
    const montos = validos.length
      ? cotizar(validos, reglas, {
          descuento,
          flete: q.flete,
          margenCotizacion: q.margenCotizacion ?? null,
        })
      : montosVacios();
    // Un vano justo sobre el inicio de su tramo: la hoja probablemente es del tramo anterior. Se avisa una vez.
    // Las líneas iguales (mismo producto, medidas y tipo) comparten un solo aviso que nombra todos sus ítems.
    const vanos = new Map<string, Linea[]>();
    for (const linea of montos.lineas) {
      const k = `${clave(linea.producto.codigo, linea.anchoSolicitado, linea.altoSolicitado)}|${linea.tipoMedida}`;
      if (!previasVano.has(k)) vanos.set(k, [...(vanos.get(k) ?? []), linea]);
    }
    for (const lineas of vanos.values()) {
      const indices = lineas.flatMap((l) => (l.indice === null ? [] : [l.indice]));
      const aviso = avisoVano(lineas[0], this.tramoAnterior(lineas[0].producto), indices);
      if (aviso) avisos.push(aviso);
    }
    return {
      solicitudes: vigentes.solicitudes,
      incompletos: vigentes.incompletos,
      montos,
      descuento,
      reglas: ajustadas,
      avisos,
    };
  }

  /**
   * Guarda en `q` lo que vale con el catálogo vigente (montos, pendientes, descuento, reglas ajustadas) y le da una
   * versión nueva. No cambia sus solicitudes: devuelve las normalizadas y quien llama las asigna. Trae los avisos
   * de `calcular`; para solo consultar, sin tocar la cotización, está `calcular`.
   */
  private recalcular(q: Cotizacion) {
    const { solicitudes, incompletos, montos, descuento, reglas, avisos } = this.calcular(q);
    q.incompletos = incompletos;
    if (reglas) q.reglas = reglas;
    q.descuento = descuento;
    q.montos = montos;
    q.actualizada = marca(q.actualizada);
    return { avisos, solicitudes };
  }

  /** Tramo de ancho inmediatamente menor del mismo modelo y madera; null si no hay o si el producto no es una puerta. */
  private tramoAnterior(p: Producto) {
    if (p.familia !== 'PUERTA' || p.anchoMin === null || p.codigo === CODIGO_PERSONALIZADO) return null;
    const menores = this.productosDe(p.modelo).filter(
      (o) => o.madera === p.madera && o.anchoMin !== null && o.anchoMax !== null && o.anchoMax < p.anchoMin! - 1e-9,
    );
    if (!menores.length) return null;
    const max = Math.max(...menores.map((o) => o.anchoMax!));
    const min = Math.min(...menores.filter((o) => Math.abs(o.anchoMax! - max) < 1e-9).map((o) => o.anchoMin!));
    return { min, max };
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
    if (s.personalizado)
      return [
        'personalizado',
        s.personalizado.familia,
        normalizar(s.modelo ?? ''),
        normalizar(s.madera ?? ''),
        claveMedida(s.ancho),
        claveMedida(s.alto, s.personalizado.familia),
        s.tipoMedida ?? '',
        s.descripcion ?? '',
        s.observaciones ?? '',
        s.cantidad ?? '',
        s.precioUnitario ?? '',
        s.costoFabrica ?? '',
        claveDescuento(s),
      ].join('|');
    const r = resolverItem(this.catalogo, s);
    if (r.ok)
      return [
        r.producto.codigo,
        r.cantidad,
        claveMedida(s.ancho),
        claveMedida(s.alto, r.producto.familia),
        r.medidaSolicitada ?? '',
        s.tipoMedida ?? '',
        s.descripcion ?? '',
        s.observaciones ?? '',
        s.margen ?? '',
        s.precioUnitario ?? '',
        claveDescuento(s),
      ].join('|');
    return [
      normalizar(s.modelo ?? ''),
      normalizar(s.madera ?? ''),
      claveMedida(s.ancho),
      claveMedida(s.alto, familiaItem(s, null, null, (m) => this.familiaDe(m))),
      s.medida ? normalizarMedida(s.medida) : '',
      s.tipoMedida ?? '',
      s.descripcion ?? '',
      s.observaciones ?? '',
      s.margen ?? '',
      s.cantidad ?? '',
      s.precioUnitario ?? '',
      claveDescuento(s),
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
      notas: [],
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
        `La cotización N° ${aprobada.numero} de esta misma serie ya fue aprobada${aprobada.notas.length ? ` (${textoNotas(aprobada.notas)})` : ''}. Duplica la cotización si necesitas un pedido nuevo.`,
        'serie_aprobada',
      );
  }

  private describir(s: SolicitudItem) {
    // Con el rango de su familia: el largo «360» de un guardapolvo es 3,60 m, no 0,36.
    const familia = familiaItem(s, null, null, (m) => this.familiaDe(m));
    const medida = (n: number | null) => (n === null ? null : decimal(metros(n, familia) ?? n));
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
      case 'asignar_fabricas':
        return this.almacen.transaccion((u) => {
          const q = this.obtener(u, accion.id);
          this.verificarVersion(q, accion.actualizada);
          return { cotizacion: this.asignarFabricas(q, u, accion.asignaciones).cotizacion };
        });
      case 'cambiar_numero':
        return this.cambiarNumero(accion);
      case 'pago':
        return this.registrarPago(accion);
      case 'restaurar_borrador':
        return this.almacen.transaccion((u) => {
          const q = u.restaurarBorrador(accion.id, accion.actualizada);
          // Sigue revisando su original solo si esta sigue emitida y sin otra revisión abierta: nunca dos.
          const origen = q.origen;
          q.origen = null;
          const original = origen != null ? u.porNumero(origen) : null;
          const avisos: string[] = [];
          if (original?.estado === 'emitida' && !u.revisionAbierta(original)) q.origen = origen;
          else if (origen != null) {
            const aviso = `La cotización N° ${origen} ${original?.estado === 'emitida' ? 'ya tiene otra revisión en borrador' : 'ya no está vigente'}: este borrador sigue como cotización nueva.`;
            q.historial.push({ rol: 'asistente', texto: aviso });
            u.registrarEvento(q.id, 'desvinculada', this.autor, aviso);
            avisos.push(aviso);
          }
          const recalculo = this.recalcular(q);
          q.solicitudes = recalculo.solicitudes;
          avisos.push(...recalculo.avisos);
          u.guardar(q);
          u.registrarEvento(q.id, 'modificada', this.autor, 'Borrador restaurado de la papelera');
          return { cotizacion: q, avisos };
        });
      case 'regenerar_pdf': {
        const { regenerarDocumento } = await import('./documentos');
        // Se imprime fuera del bloqueo. El PDF recuperado no se borra nunca: es el documento emitido (su snapshot) y
        // otra recuperación simultánea pudo entregarlo ya.
        const q = await this.almacen.transaccion((u) => {
          const q = this.obtener(u, accion.id);
          this.verificarVersion(q, accion.actualizada);
          return q;
        });
        const { archivo, regenerado, avisos } = await regenerarDocumento(this.almacen, q, accion.documento, accion.fabrica);
        if (!regenerado) return { cotizacion: q, archivo, avisos };
        return this.almacen.transaccion((u): Resultado => {
          const actual = this.obtener(u, accion.id);
          // Un cambio entretanto (un comentario, un pago) no lo invalida: sigue siendo el documento de la cotización y
          // se registra con su versión actual. Si ya no es su documento, se pide recargar y el archivo queda.
          const propio = accion.documento === 'nota' ? actual.notas.some((n) => n.pdf === archivo) : actual.pdf === archivo;
          if (!propio) throw new ErrorConflicto(VERSION_OBSOLETA);
          u.registrarEvento(actual.id, 'modificada', this.autor, 'PDF regenerado');
          return { cotizacion: actual, archivo, avisos };
        });
      }
      case 'desaprobar':
      case 'retroceder_operacion':
        return this.almacen.transaccion((u) => {
          const q = this.obtener(u, accion.id);
          this.verificarVersion(q, accion.actualizada);
          this.exigirAprobada(q);
          let retroceso = '';
          if (accion.tipo === 'desaprobar') {
            if (q.notas.length || q.pagos?.length || q.facturacion?.estado === 'facturada') throw new ErrorConflicto('Solo puedes quitar la aprobación sin nota, pagos ni factura.', 'estado_invalido');
            q.estado = 'emitida'; q.estadoComercial = 'enviada'; q.aprobadaPor = null; delete q.fechaAprobacion;
          } else {
            if (!accion.motivo.trim()) throw new ErrorUsuario('Indica el motivo del retroceso.');
            const previo = retrocesoOperativo(q);
            if (!previo) throw new ErrorConflicto('No hay un paso operativo anterior disponible.', 'estado_invalido');
            // En fábrica se deshace el último inicio o término registrado, en la nota de esa fábrica.
            const nota = previo.nota && q.notas.find((n) => !n.anulada && (n.fabrica ?? null) === previo.nota!.fabrica);
            if (nota) nota[previo.nota!.campo] = null;
            q.estadoOperativo = previo.destino;
            this.estadoPorPagos(q);
            // Con varias fábricas, la actividad dice en cuál se deshizo el paso.
            if (nota && q.notas.filter((n) => !n.anulada).length > 1) retroceso = ` · ${previo.desde} → ${previo.hasta}`;
          }
          q.actualizada = marca(q.actualizada); u.guardar(q);
          u.registrarEvento(q.id, 'modificada', this.autor, accion.tipo === 'desaprobar' ? 'Aprobación retirada' : `Paso operativo anterior: ${accion.motivo}${retroceso}`);
          return { cotizacion: q };
        });
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
          destino.solicitudes = this.recalcular(destino).solicitudes;
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
      case 'reordenar':
        return this.reordenar(accion);
      case 'restaurar_items':
        return this.restaurarItems(accion);
      case 'editar':
        return this.editar(accion);
      case 'agregar_producto':
        return this.agregarProducto(accion);
      case 'agregar_personalizado':
        return this.agregarPersonalizado(accion);
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
          const { avisos, solicitudes } = this.recalcular(q);
          q.solicitudes = solicitudes;
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
          return { cotizacion: q, avisos };
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
          // Un doble envío encuentra la cotización ya anulada: se devuelve igual, sin exigir la versión.
          if (q.estado === 'anulada') return { cotizacion: q };
          this.verificarVersion(q, accion.actualizada);
          return this.anularInterna(q, u, limpiarTexto(accion.motivo, 300));
        });
    }
  }

  /** Anula una emitida o aprobada (también al rechazarla el cliente); una ya anulada se devuelve igual. */
  private anularInterna(q: Cotizacion, u: Unidad, motivo: string | null): Resultado {
    if (q.estado === 'anulada') return { cotizacion: q };
    // La misma regla con que la pantalla ofrece (o explica) «Anular».
    const permiso = puedeAnular(q);
    if (!permiso.ok) throw new ErrorConflicto(permiso.motivo, 'estado_invalido');
    // Anular no devuelve lo pagado: queda registrado para resolverlo con el cliente.
    const pagado = permiso.pagado ? `Pagos registrados: ${pesos(permiso.pagado)} (anular no los devuelve)` : null;
    const fecha = new Date().toISOString();
    q.estado = 'anulada';
    q.estadoComercial = 'rechazada';
    q.anuladaPor = this.autor;
    q.fechaAnulacion = fecha;
    q.motivoAnulacion = motivo;
    for (const nota of q.notas) nota.anulada = true;
    // La fábrica integrada que ya recibió (o tiene en cola) el pedido se entera de la anulación; si nunca se encoló,
    // la bandeja lo descarta.
    for (const nota of q.notas)
      if (fabricaIntegrada(nota.fabrica))
        u.encolarIntegracion({ tipo: 'cancelacion', cotizacionId: q.id, fabrica: nota.fabrica, cancelacion: cancelacionDeNota(q, nota) });
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
      texto: `Cotización N° ${q.numero} anulada${q.notas.length ? ` junto con ${textoNotas(q.notas)}` : ''}${motivo ? `. Motivo: ${motivo}` : ''}${pagado ? `. ${pagado}` : ''}.`,
    });
    q.actualizada = marca(q.actualizada);
    u.guardar(q);
    u.registrarEvento(q.id, 'anulada', this.autor, [motivo, pagado].filter(Boolean).join(' · ') || null);
    return { cotizacion: q, ...(avisos.length ? { avisos } : {}) };
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
        ...(p.familia === 'PUERTA' && accion.ancho == null && accion.alto == null ? { medidaPorDefecto: true } : {}),
      };
      const res = resolverItem(this.catalogo, item);
      if (!res.ok || res.producto.codigo !== p.codigo)
        throw new ErrorUsuario(
          'Las medidas no corresponden a esta referencia. Selecciona el producto adecuado del catálogo.',
        );
      return this.agregarItem(u, accion, item);
    });
  }

  /**
   * Producto fuera de catálogo: queda solo en esta cotización (no se crea en el catálogo) con el precio escrito
   * y las referencias que entregó el cliente.
   */
  private agregarPersonalizado(accion: Extract<Accion, { tipo: 'agregar_personalizado' }>) {
    return this.almacen.transaccion((u): Resultado => {
      if (Boolean(accion.id) !== Boolean(accion.actualizada))
        throw new ErrorUsuario('Indica la versión de la cotización.');
      const d = accion.item;
      if (!Number.isInteger(d.cantidad) || d.cantidad < 1 || d.cantidad > 10000)
        throw new ErrorUsuario('La cantidad debe ser un entero entre 1 y 10.000.');
      if (!Number.isSafeInteger(d.precioUnitario) || d.precioUnitario <= 0 || d.precioUnitario > 100_000_000)
        throw new ErrorUsuario('El precio unitario debe ser un entero entre $1 y $100.000.000.');
      // Un ítem libre no tiene madera ni medidas: lo que llegue en esos campos no se guarda.
      const libre = d.familia === 'OTRO';
      const item: SolicitudItem = {
        modelo: textoCampo('modelo', d.nombre),
        madera: libre ? null : textoCampo('madera', d.madera),
        ancho: libre ? null : (d.ancho ?? null),
        alto: libre ? null : (d.alto ?? null),
        medida: null,
        cantidad: d.cantidad,
        precioUnitario: d.precioUnitario,
        margen: null,
        tipoMedida: libre ? null : (d.tipoMedida ?? 'no_especificado'),
        descripcion: textoCampo('descripcion', d.descripcion),
        observaciones: textoCampo('observaciones', d.observaciones),
        personalizado: { familia: d.familia },
        ...(d.referencias?.length ? { referencias: sanearReferencias(this.almacen.directorio, d.referencias) } : {}),
      };
      const r = productoPersonalizado(item, d.familia);
      // El ancho es de puerta (hasta 3 m); el alto o largo, de su familia (un accesorio llega a 6 m).
      if (!r.ok)
        throw new ErrorUsuario(
          r.campos.includes('ancho')
            ? errorMedida('ancho', d.familia)
            : r.campos.includes('alto')
              ? errorMedida('alto', d.familia)
              : libre
                ? 'Indica el nombre, la cantidad y el precio del ítem libre.'
                : 'Indica el nombre, la madera, la cantidad y el precio del producto personalizado.',
        );
      return this.agregarItem(u, accion, item);
    });
  }

  /** Suma un ítem al final de la cotización (o de un borrador nuevo) y registra el cambio. */
  private agregarItem(u: Unidad, accion: { id?: string; actualizada?: string }, item: SolicitudItem): Resultado {
    const q = accion.id ? this.obtener(u, accion.id) : this.nueva();
    this.exigirEditable(q);
    if (accion.id) this.verificarVersion(q, accion.actualizada!);
    if (q.solicitudes.length >= 100) throw new ErrorUsuario('Una cotización admite hasta 100 productos.');
    const antes = structuredClone(q.solicitudes);
    const destino = this.abrirEdicion(q, u);
    const descuentoAntes = descuentoDe(destino);
    destino.solicitudes.push(item);
    const { avisos, solicitudes } = this.recalcular(destino);
    destino.solicitudes = solicitudes;
    const cambios = this.cambios(antes, destino.solicitudes, q.cliente, destino.cliente);
    u.guardar(destino);
    const referencias = item.referencias?.length
      ? [`Referencias del cliente: ${item.referencias.map((r) => r.nombre).join(', ')}`]
      : [];
    u.registrarEvento(
      destino.id,
      'modificada',
      this.autor,
      textoCambios(cambios, [...cambioDescuento(descuentoAntes, destino), ...referencias]),
    );
    return { cotizacion: destino, cambios, ...(avisos.length ? { avisos } : {}) };
  }

  /** Reordena el borrador: solicitudes, líneas persistidas y el documento se recalculan en el mismo orden. */
  private reordenar(accion: Extract<Accion, { tipo: 'reordenar' }>) {
    return this.almacen.transaccion((u): Resultado => {
      const q = this.obtener(u, accion.id);
      this.exigirEditable(q);
      this.verificarVersion(q, accion.actualizada);
      if (
        !Number.isInteger(accion.desde) || !Number.isInteger(accion.hasta) ||
        accion.desde < 0 || accion.hasta < 0 ||
        accion.desde >= q.solicitudes.length || accion.hasta >= q.solicitudes.length
      ) throw new ErrorNoEncontrado('No se encontró la posición del ítem.');
      if (accion.desde === accion.hasta) return { cotizacion: q };
      const antes = structuredClone(q.solicitudes);
      const destino = this.abrirEdicion(q, u);
      const [item] = destino.solicitudes.splice(accion.desde, 1);
      destino.solicitudes.splice(accion.hasta, 0, item);
      destino.solicitudes = this.recalcular(destino).solicitudes;
      u.guardar(destino);
      const cambios = this.cambios(antes, destino.solicitudes, q.cliente, destino.cliente);
      u.registrarEvento(destino.id, 'modificada', this.autor, textoCambios(cambios, ['Se reordenaron los productos']));
      return { cotizacion: destino, ...(cambios ? { cambios } : {}) };
    });
  }

  /** Restaura una instantánea de ítems para Deshacer/Rehacer sin perder descripciones ni atributos manuales. */
  private restaurarItems(accion: Extract<Accion, { tipo: 'restaurar_items' }>) {
    return this.almacen.transaccion((u): Resultado => {
      const q = this.obtener(u, accion.id);
      this.exigirEditable(q);
      this.verificarVersion(q, accion.actualizada);
      if (accion.items.length > 100) throw new ErrorUsuario('Una cotización admite hasta 100 productos.');
      const antes = structuredClone(q.solicitudes);
      const destino = this.abrirEdicion(q, u);
      destino.solicitudes = accion.items.map((item) => {
        const limpio = sanearTextos(structuredClone(item));
        if (limpio.referencias) limpio.referencias = sanearReferencias(this.almacen.directorio, limpio.referencias);
        return limpio;
      });
      const { avisos, solicitudes } = this.recalcular(destino);
      destino.solicitudes = solicitudes;
      u.guardar(destino);
      const cambios = this.cambios(antes, destino.solicitudes, q.cliente, destino.cliente);
      u.registrarEvento(destino.id, 'modificada', this.autor, textoCambios(cambios, ['Se restauró el estado de los productos']));
      return { cotizacion: destino, ...(cambios ? { cambios } : {}), ...(avisos.length ? { avisos } : {}) };
    });
  }

  /**
   * Un precio o un descuento escrito en el detalle que queda fuera de regla se rechaza, con el campo abierto y
   * el rango en pesos: el pendiente de `recalcular` es para lo que llega sin pasar por el campo (catálogo,
   * deshacer, chat). Un ítem que ya estaba fuera de regla (`previa`, con el catálogo de hoy) se rechaza solo si
   * la edición tocó su precio, margen o descuento: editar otro dato no lo empeora.
   */
  private rechazarFueraDeRegla(destino: Cotizacion, previa: Cotizacion, precioTocado: Set<number>) {
    const dePrecio = (incompletos: Cotizacion['incompletos']) =>
      incompletos.filter((p) => p.rechazo.tipo === 'faltan_datos' && p.rechazo.campos.includes('precio'));
    const ahora = dePrecio(destino.incompletos);
    if (!ahora.length) return;
    const ya = new Set(dePrecio(this.calcular(previa).incompletos).map((p) => p.indice));
    const p = ahora.find((p) => !ya.has(p.indice) || precioTocado.has(p.indice));
    if (!p) return;
    const s = destino.solicitudes[p.indice];
    const r = s.precioUnitario && !s.personalizado ? resolverItem(this.catalogo, s) : null;
    const costo = r?.ok ? r.producto.precioNeto : null;
    // El mismo rango que deja el ítem pendiente en `itemsVigentes`.
    const rango = costo ? rangoPrecio(costo) : null;
    if (rango && (s.precioUnitario! < rango.min || s.precioUnitario! > rango.max))
      throw new ErrorUsuario(
        `El precio unitario ${pesos(s.precioUnitario!)} del ítem ${p.indice + 1} queda fuera de la ganancia permitida sobre el costo de fábrica (${RANGO_MARGEN}): debe estar entre ${pesos(Math.ceil(rango.min))} y ${pesos(Math.floor(rango.max))}.`,
      );
    throw new ErrorUsuario(p.pregunta);
  }

  private editar(accion: Extract<Accion, { tipo: 'editar' }>) {
    return this.almacen.transaccion((u): Resultado => {
      const q = this.obtener(u, accion.id);
      this.exigirEditable(q);
      this.verificarVersion(q, accion.actualizada);
      // Para saber qué deja fuera de regla esta edición y qué ya lo estaba (ver `rechazarFueraDeRegla`).
      const previa = structuredClone({ ...q, historial: [] });
      const { solicitudes, avisos: avisosItems } = aplicarCambiosItems(q.solicitudes, accion, {
        directorio: this.almacen.directorio,
        producto: (s, pareja) => this.producto(s, pareja),
      });
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
      const { flete, fleteCantidad, fleteDescripcion } = aplicarFlete(q, accion);
      const reglas = q.reglas ?? REGLAS;
      if (!descuentoValido(descuento, reglas.descuentoMaximo))
        throw new ErrorUsuario(
          `El descuento debe estar entre 0 % y ${reglas.descuentoMaximo} %, con hasta dos decimales.`,
        );
      if (!fleteValido(flete))
        throw new ErrorUsuario('El flete debe ser un monto entero en pesos sin IVA, desde $0.');
      const margenAntes = q.margenCotizacion ?? null;
      const margenPedido = accion.margenCotizacion === undefined ? margenAntes : accion.margenCotizacion;
      if (margenPedido !== null && !margenValido(margenPedido))
        throw new ErrorUsuario(
          `La ganancia especial de la cotización debe ser un porcentaje entre ${MARGEN_MIN * 100} % y ${MARGEN_MAX * 100} %, con hasta dos decimales.`,
        );
      const margenCotizacion = margenPedido === null ? null : redondearMargen(margenPedido);
      const extra = avisos.length ? { avisos } : {};
      const descuentoNuevo = aCentesimas(descuento);
      const observaciones =
        accion.observaciones === undefined
          ? q.observaciones
          : limpiarTexto(accion.observaciones, 2000);
      const despacho =
        accion.despacho === undefined || (accion.despacho !== null && !Object.keys(accion.despacho).length)
          ? q.despacho
          : accion.despacho === null
            ? null
            : aplicarDespacho(q.despacho, accion.despacho, flete).despacho;
      const tarifa = accion.tarifaStarken;
      if (tarifa) {
        if (!esStarken(despacho?.transporte))
          throw new ErrorUsuario('Elige Starken como transportista antes de aplicar su tarifa.');
        // El navegador no es de fiar para el costo: la firma la dio este servidor para esta cotización.
        // La firma va primero: una tarifa vencida o adulterada se explica así, aunque su huella tampoco calce.
        const firma = verificarTarifa(accion.id, tarifa);
        if (firma !== 'valida')
          throw new ErrorUsuario(
            firma === 'vencida'
              ? 'La tarifa de Starken venció. Vuelve a cotizar el despacho.'
              : 'La tarifa de Starken no es válida para esta cotización. Vuelve a cotizar el despacho.',
          );
        // El bulto del pedido ya editado, sin tocar la cotización.
        if (tarifa.huellaBulto !== huellaBulto(this.calcular({ ...q, solicitudes }).montos.lineas))
          throw new ErrorUsuario('El pedido cambió. Vuelve a cotizar el despacho.');
        if (flete !== netoDesdeIva(tarifa.costoTotal))
          throw new ErrorUsuario(
            `El valor de despacho debe ser el de la tarifa elegida sin IVA (${pesos(netoDesdeIva(tarifa.costoTotal))}).`,
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
        const recalculada = this.calcular(structuredClone(q));
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
        const todos = [...avisos, ...recalculada.avisos];
        return { cotizacion: destino, ...(todos.length ? { avisos: todos } : {}) };
      }
      const destino = this.abrirEdicion(q, u);
      const antes = structuredClone(destino.solicitudes),
        clienteAntes = destino.cliente;
      destino.solicitudes = solicitudes;
      destino.cliente = cliente;
      const descuentoAntes = descuentoDe(destino);
      const generales = { flete, fleteCantidad, fleteDescripcion, margenCotizacion, observaciones, despacho };
      const extras = textoActividad({
        destino,
        nuevos: generales,
        margenAntes,
        antes,
        solicitudes,
        lineas: q.montos.lineas,
        items: accion.items,
        tarifa,
        describir: (s) => this.describir(s),
      });
      destino.descuento = descuentoNuevo;
      destino.descuentoManual = descuentoManual;
      Object.assign(destino, generales);
      const recalculo = this.recalcular(destino);
      destino.solicitudes = recalculo.solicitudes;
      const todos = [...avisos, ...recalculo.avisos];
      const precioTocado = new Set(
        (accion.items ?? [])
          .filter(({ cambios: c }) =>
            [c.precioUnitario, c.margen, c.descuento, c.costoFabrica, c.personalizado].some((v) => v !== undefined),
          )
          .map((c) => c.indice),
      );
      this.rechazarFueraDeRegla(destino, previa, precioTocado);
      extras.unshift(...cambioDescuento(descuentoAntes, destino));
      u.guardar(destino);
      const cambios = this.cambios(antes, destino.solicitudes, clienteAntes, cliente);
      // Los avisos (siguiente medida, precio bajo el costo…) quedan en la actividad: la pantalla los muestra una vez.
      u.registrarEvento(destino.id, 'modificada', this.autor, textoCambios(cambios, [...extras, ...todos.map((a) => `Aviso: ${a}`)]));
      return { cotizacion: destino, ...(todos.length ? { avisos: todos } : {}), ...(cambios ? { cambios } : {}) };
    });
  }

  /**
   * Valida, comprueba Chromium y recién entonces reserva el número; genera el PDF fuera del bloqueo y
   * confirma solo si nadie cambió la cotización.
   */
  private async emitir(accion: Extract<Accion, { tipo: 'emitir' }>): Promise<Resultado> {
    const preparado = await this.almacen.transaccion(
      (u): Preparado<{ avisos: string[]; versionCatalogo: string | null }> | PreciosCambiados => {
        const q = this.obtener(u, accion.id);
        if (q.pdf) return { listo: q };
        if (q.estado !== 'borrador') this.exigirEditable(q);
        this.verificarVersion(q, accion.actualizada);
        this.verificarSerieNoAprobada(q, u);
        // M3: los montos se recalculan con el catálogo vigente al emitir, no con los guardados. `calcular` no toca
        // la cotización: `copia` es lo que se emitirá si nada cambió.
        const calculo = this.calcular(q);
        const copia: Cotizacion = {
          ...q,
          solicitudes: calculo.solicitudes,
          incompletos: calculo.incompletos,
          montos: calculo.montos,
          descuento: calculo.descuento,
          ...(calculo.reglas ? { reglas: calculo.reglas } : {}),
        };
        if (copia.incompletos.length || !copia.montos.lineas.length)
          throw new ErrorUsuario(
            'Completa o quita los ítems pendientes antes de generar el PDF.',
            'incompleta',
          );
        const medidasSinTipo = indicesMedidaSinTipo(copia);
        if (medidasSinTipo.length)
          throw new ErrorUsuario(
            `Confirma si la medida del ítem ${medidasSinTipo[0] + 1} corresponde a la hoja o al vano antes de emitir.`,
            'medida_sin_tipo',
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
        // La versión del catálogo con que se calcularon estos montos: una importación posterior no la cambia.
        return { listo: null, copia, avisos, version: q.actualizada, versionCatalogo: this.versionCatalogo() };
      },
    );
    if (preparado.listo) return { cotizacion: preparado.listo, archivo: preparado.listo.pdf! };
    if ('cambiados' in preparado)
      throw new ErrorConflicto(
        'Los precios del catálogo cambiaron desde que revisaste esta cotización. Revisa los montos actualizados antes de emitir.',
        'precios_cambiaron',
        preparado.cambiados,
      );
    const { copia, avisos, version, versionCatalogo } = preparado;
    // Al reservar y al confirmar, lo revisado sigue vigente: nadie emitió ni cambió la cotización.
    const vigente = (u: Unidad) => {
      const q = this.obtener(u, accion.id);
      if (q.pdf)
        throw new ErrorConflicto(
          `Otra persona emitió esta cotización mientras se generaba el PDF (N° ${q.numero}).`,
        );
      if (q.actualizada !== version) throw new ErrorConflicto(VERSION_OBSOLETA);
      this.verificarSerieNoAprobada(q, u);
      return q;
    };
    // Chromium se comprueba fuera del bloqueo y antes de reservar: si no arranca, el número no se gasta.
    await prepararPdf();
    // Reserva durable antes de generar: un fallo puede dejar un salto, jamás reutilizar un número. La marca «en
    // emisión» se toma en la misma transacción: otra emisión simultánea responde 409 sin gastar un número.
    const { numero, ficha } = await this.almacen.transaccion((u) => {
      vigente(u);
      return u.reservarCotizacionEnEmision(accion.id, accion.numero);
    });
    try {
      return await this.emitirReservada(numero, copia, avisos, versionCatalogo, vigente);
    } finally {
      this.almacen.liberarEmision(accion.id, ficha);
    }
  }

  /** Segunda mitad de `emitir`, con el número ya reservado y la marca «en emisión» tomada. */
  private async emitirReservada(
    numero: number,
    copia: Cotizacion,
    avisos: string[],
    versionCatalogo: string | null,
    vigente: (u: Unidad) => Cotizacion,
  ): Promise<Resultado> {
    // La vigencia cuenta días hábiles: antes se actualizan los feriados decretados (sin bloquear si no hay red).
    await prepararFeriados(this.almacen.baseDatos());
    const reglas = copia.reglas ?? REGLAS;
    const archivo = `cotizacion-${numero}.pdf`,
      fecha = new Date().toISOString(),
      vence = calcularVence(fecha, reglas.vigenciaDiasHabiles);
    const documento = { ...copia, numero, fechaEmision: fecha, vence, emitidaPor: this.autor };
    const html = await plantilla(
      documento,
      {
        tipo: 'cotizacion',
        numero,
        montos: copia.montos,
        fecha,
        vence,
        autor: this.autor,
        reglas,
        observaciones: copia.observaciones,
      },
      this.almacen.baseDatos(),
    );
    await generarPdf(this.almacen.directorio, archivo, html);
    try {
      return await this.almacen.transaccion((u): Resultado => {
        const q = vigente(u);
        q.montos = copia.montos;
        q.incompletos = [];
        q.numero = numero;
        q.pdf = archivo;
        q.fechaEmision = fecha;
        q.vence = vence;
        q.estado = 'emitida';
        q.estadoComercial = 'enviada';
        q.emitidaPor = this.autor;
        q.versionCatalogo = versionCatalogo;
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
        u.guardarDocumento(q.id, archivo, html);
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
        return { cotizacion: q, ...(q.notas.length ? { archivo: q.notas[0].pdf } : {}) };
      if (q.estado === 'anulada')
        throw new ErrorConflicto('Esta cotización está anulada y no se puede aprobar.', 'estado_invalido');
      if (q.estado === 'reemplazada')
        throw new ErrorConflicto('Esta cotización fue reemplazada y no se puede aprobar.', 'estado_invalido');
      if (q.estado !== 'emitida' || !q.pdf || q.numero === null)
        throw new ErrorConflicto(
          'Emite la cotización y genera su PDF antes de registrar la aprobación del cliente.',
          'estado_invalido',
        );
      // «Rechazada» siempre anula (ver `cambiarEstadoComercial`): la comprueba el caso «anulada» de arriba.
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
      q.fechaAprobacion = new Date().toISOString();
      q.actualizada = marca(q.actualizada);
      u.guardar(q);
      u.registrarEvento(q.id, 'aprobada', this.autor, `Aprobada por cliente · N° ${q.numero}`);
      const revision = u.revisionAbierta(q);
      if (revision) {
        revision.origen = null; revision.actualizada = marca(revision.actualizada); u.guardar(revision);
        const aviso = 'La revisión en borrador quedó como cotización nueva.';
        revision.historial.push({ rol: 'asistente', texto: aviso });
        u.registrarEvento(revision.id, 'desvinculada', this.autor, aviso);
      }
      this.reemplazarSerie(u, q);
      return { cotizacion: q, ...(revision ? { avisos: ['La revisión en borrador quedó como cotización nueva.'] } : {}) };
    });
  }

  /** Las demás emitidas de la serie de `q` quedan reemplazadas por ella: una sola aprobación por pedido. */
  private reemplazarSerie(u: Unidad, q: Cotizacion) {
    for (const otra of u.serie(q.id))
      if (otra.id !== q.id && otra.estado === 'emitida') {
        otra.estado = 'reemplazada';
        otra.reemplazadaPor = q.numero;
        otra.actualizada = marca(otra.actualizada);
        u.guardar(otra);
        u.registrarEvento(otra.id, 'reemplazada', this.autor, `Se aprobó la N° ${q.numero}`);
      }
  }

  private async registrarPago(accion: Extract<Accion, { tipo: 'pago' }>): Promise<Resultado> {
    return this.almacen.transaccion((u): Resultado => {
      const q = this.obtener(u, accion.id);
      this.exigirAprobada(q, 'Registra la aprobación del cliente antes de ingresar pagos.');
      this.verificarVersion(q, accion.actualizada);
      if (!Number.isSafeInteger(accion.monto) || accion.monto <= 0)
        throw new ErrorUsuario('El monto del pago debe ser un entero positivo en pesos.');
      const saldo = q.montos.total - totalPagado(q);
      if (accion.monto > saldo)
        throw new ErrorUsuario(`El pago supera el saldo pendiente de ${pesos(saldo)}.`);
      const fecha = this.fechaOperacion(q, u, accion.fecha, 'del pago');
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
    const pagado = totalPagado(q);
    const operacion = operacionDe(q);
    if (!q.notas.length && (operacion === 'sin_pedido' || operacion === 'anticipo_pagado'))
      q.estadoOperativo = pagado >= anticipoMinimo(q.montos.total) ? 'anticipo_pagado' : 'sin_pedido';
    else if (operacion === 'saldo_pendiente' || operacion === 'pagada')
      q.estadoOperativo = pagado >= q.montos.total ? 'pagada' : 'saldo_pendiente';
  }

  /**
   * Fecha de un pago o de una factura, como mediodía UTC del día elegido (o de hoy, en hora de Chile, si no se
   * eligió): así no cambia de día al mostrarla. No puede ser posterior a hoy ni anterior a la aprobación.
   */
  private fechaOperacion(q: Cotizacion, u: Unidad, elegida: string | null | undefined, de: string) {
    const fecha = elegida ? fechaElegida(elegida) : `${fechaLocal(new Date())}T12:00:00.000Z`;
    if (!fecha) throw new ErrorUsuario(`La fecha ${de} no es válida.`);
    // Una aprobación anterior a v23 no guardó su fecha: vale la de su evento, que se guarda para la próxima vez.
    q.fechaAprobacion ??= u.fechaEvento(q.id, 'aprobada') ?? undefined;
    const { min, max } = rangoFechaOperacion(q.fechaAprobacion);
    const dia = elegida && /^\d{4}-\d{2}-\d{2}$/.test(elegida) ? elegida : fechaLocal(fecha);
    if (dia > max) throw new ErrorUsuario(`La fecha ${de} no puede ser posterior a hoy (${fechaChilena(max)}).`);
    if (min && dia < min)
      throw new ErrorUsuario(`La fecha ${de} no puede ser anterior a la aprobación (${fechaChilena(min)}).`);
    return fecha;
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
      if (accion.estado === 'rechazada') return this.anularInterna(q, u, 'Rechazada por cliente');
      q.estadoComercial = accion.estado;
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
        `El valor del despacho (${pesos(q.flete)} sin IVA) quedó fijo al emitir la cotización y no se puede cambiar. Crea una revisión para modificarlo.`,
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
      const pagado = totalPagado(q);
      const paso = accion.paso;
      const produccion = paso === 'iniciar_produccion' || paso === 'produccion_terminada';
      if (accion.fabrica && !produccion)
        throw new ErrorUsuario('Solo el inicio y el término de producción se registran por fábrica.');
      // Cada fábrica inicia y termina su nota por separado; sin fábrica, el paso va a todas las que corresponda.
      const notas = q.notas.filter((n) => !n.anulada && (!accion.fabrica || n.fabrica === accion.fabrica));
      if (accion.fabrica && !notas.length)
        throw new ErrorConflicto(`La cotización no tiene una nota de pedido para ${nombreFabrica[accion.fabrica]}.`, 'estado_invalido');
      const etapa = paso === 'iniciar_produccion' ? 'pendiente' : 'en_produccion';
      let objetivo = produccion ? notas.filter((n) => etapaProduccion(n) === etapa) : [];
      // Un pedido «En producción» sin fechas por fábrica (datos de antes de llevarlas) termina en todas sus notas.
      if (paso === 'produccion_terminada' && q.estadoOperativo === 'en_produccion' && !objetivo.length && q.notas.every((n) => !n.inicioProduccion))
        objetivo = notas;
      const esPasoValido =
        (paso === 'iniciar_produccion' && (q.estadoOperativo === 'pedido_generado' || q.estadoOperativo === 'en_produccion') && objetivo.length > 0) ||
        (paso === 'produccion_terminada' && q.estadoOperativo === 'en_produccion' && objetivo.length > 0) ||
        (paso === 'lista_despacho' && q.estadoOperativo === 'pagada' && pagado >= q.montos.total) ||
        (paso === 'despachada' && q.estadoOperativo === 'lista_despacho') ||
        (paso === 'completada' && q.estadoOperativo === 'despachada');
      if (!esPasoValido) throw new ErrorConflicto('Esta acción no está disponible para el estado actual.', 'estado_invalido');
      // Anular un pago después de la nota puede dejar el pedido bajo el anticipo: la producción lo exige de nuevo.
      if (produccion && pagado < anticipoMinimo(q.montos.total))
        throw new ErrorConflicto(
          `La producción se habilita con al menos ${ANTICIPO_TEXTO} pagado (${pesos(anticipoMinimo(q.montos.total))}); hay ${pesos(pagado)} registrados.`,
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
      if (produccion) {
        const fecha = new Date().toISOString();
        for (const n of objetivo) {
          if (paso === 'produccion_terminada') n.inicioProduccion ??= fecha;
          n[paso === 'iniciar_produccion' ? 'inicioProduccion' : 'terminoProduccion'] = fecha;
        }
        q.estadoOperativo = operacionPorProduccion(q.notas, pagado, q.montos.total);
        // Con varias fábricas, la actividad dice cuál avanzó.
        if (q.notas.filter((n) => !n.anulada).length > 1)
          logistica = ` · ${objetivo.map((n) => `${fabricaDeNota(n)} (nota ${numeroNota(n)}): ${etiquetaEtapa[etapaProduccion(n)]}`).join(' · ')}`;
      } else
        q.estadoOperativo = ({
          lista_despacho: 'lista_despacho',
          despachada: 'despachada',
          completada: 'completada',
        } as const)[paso];
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
        const fecha = this.fechaOperacion(q, u, accion.fecha, 'de la factura');
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

  /**
   * Fábrica de cada línea valorizada de `q` con las `asignaciones` aplicadas y, para las que siguen sin asignar,
   * `porOmision`. Lanza `fabrica_sin_asignar` si a alguna le falta: ninguna nota se genera a medias.
   */
  private repartoFabricas(q: Cotizacion, asignaciones: AsignacionFabrica[] = [], porOmision?: Fabrica) {
    const elegidas = new Map(q.solicitudes.map((s, i) => [i, s.fabrica ?? null]));
    for (const a of asignaciones) {
      if (!q.solicitudes[a.indice]) throw new ErrorUsuario(`No existe el ítem ${a.indice + 1}.`);
      elegidas.set(a.indice, a.fabrica);
    }
    // Un ítem libre no lo hace ninguna fábrica: no va en las notas ni lleva fábrica.
    const libre = (i: number | null) => i !== null && esLibre(q.solicitudes[i]);
    const reparto = new Map<Fabrica, Linea[]>();
    const faltan: string[] = [];
    const lineasFabrica = q.montos.lineas.filter((l) => !libre(l.indice));
    if (!lineasFabrica.length)
      throw new ErrorUsuario(
        'La cotización solo tiene ítems libres, que no van a fábrica: no hay notas de pedido que generar.',
      );
    for (const l of lineasFabrica) {
      const fabrica = (l.indice !== null ? elegidas.get(l.indice) : null) ?? porOmision;
      if (!fabrica) faltan.push(l.indice !== null ? this.describir(q.solicitudes[l.indice]) : l.producto.codigo);
      else reparto.set(fabrica, [...(reparto.get(fabrica) ?? []), l]);
    }
    if (faltan.length)
      throw new ErrorUsuario(
        `Asigna la fábrica de cada ítem antes de generar las notas de pedido. Falta: ${faltan.join('; ')}.`,
        'fabrica_sin_asignar',
      );
    // Lo que queda guardado en los ítems: las asignaciones y la fábrica por omisión en los que no tenían.
    const fabricas = new Map([...elegidas].map(([i, f]) => [i, libre(i) ? null : (f ?? porOmision ?? null)]));
    return { reparto: FABRICAS.filter((f) => reparto.has(f)).map((f) => ({ fabrica: f, lineas: reparto.get(f)! })), fabricas };
  }

  /**
   * Montos de una nota: las líneas de su fábrica con los precios guardados, sin descuento ni flete, y a precio de
   * fábrica: ni el margen especial de la cotización ni el de las líneas intervienen. Un pedido especial va a su
   * costo de fábrica si se conoce; sin él, la nota lo imprime «Por definir» y no lo suma (fábrica lo valoriza).
   * Nunca va con el precio de venta al cliente.
   */
  private montosNota(q: Cotizacion, lineasFabrica: Linea[]): Montos {
    const lineas = lineasFabrica.flatMap((l) => {
      const s = l.indice != null ? q.solicitudes[l.indice] : undefined;
      if (!s?.personalizado) return [l];
      return s.costoFabrica ? [{ ...l, producto: { ...l.producto, precioNeto: s.costoFabrica } }] : [];
    });
    if (!lineas.length) return montosVacios();
    return cotizar(
      lineas.map((l) => ({
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
  }

  private async generarNotaPedido(accion: Extract<Accion, { tipo: 'generar_nota' }>): Promise<Resultado> {
    const preparado = await this.almacen.transaccion(
      (u): Preparado<{ notas: { fabrica: Fabrica; montos: Montos; items: number }[]; fabricas: Map<number, Fabrica | null> }> => {
        const q = this.obtener(u, accion.id);
        // Antes que la nota: una aprobada que después se anuló no se informa como aprobada.
        if (q.estado === 'anulada')
          throw new ErrorConflicto(
            `La cotización N° ${q.numero} está anulada${q.notas.length ? ` junto con ${textoNotas(q.notas)}` : ''} y no se puede aprobar. Duplícala para preparar una nueva.`,
            'estado_invalido',
          );
        if (q.notas.length) return { listo: q };
        // Aprobar es irreversible: exige una cotización ya emitida y revisada, nunca emite de paso.
        if (q.estado !== 'aprobada' || !q.pdf || q.numero === null)
          throw new ErrorConflicto(
            'Registra la aprobación del cliente antes de preparar la nota de pedido.',
            'estado_invalido',
          );
        this.verificarVersion(q, accion.actualizada);
        const pagado = totalPagado(q);
        if (pagado < anticipoMinimo(q.montos.total))
          throw new ErrorConflicto(`La nota de pedido se habilita al registrar al menos ${ANTICIPO_TEXTO} (${pesos(anticipoMinimo(q.montos.total))}).`, 'estado_invalido');
        this.verificarSerieNoAprobada(q, u);
        const { reparto, fabricas } = this.repartoFabricas(q, accion.asignaciones, accion.fabrica);
        const notas = reparto.map(({ fabrica, lineas }) => ({ fabrica, montos: this.montosNota(q, lineas), items: lineas.length }));
        const copia = structuredClone(q);
        // Cada nota imprime los ítems con la fábrica que se le asignó (los «Por definir» de su fábrica, por ejemplo).
        copia.solicitudes.forEach((s, i) => (s.fabrica = fabricas.get(i) ?? null));
        const despacho: Despacho = q.despacho ?? { direccion: null, transporte: null };
        copia.despacho = {
          direccion: limpiarTexto(despacho.direccion, 300),
          transporte: limpiarTexto(despacho.transporte, 120),
          entregaComprometida: limpiarTexto(despacho.entregaComprometida, 120),
          destino: despacho.destino ?? null,
          valor: q.flete,
        };
        return { listo: null, copia, notas, fabricas, version: q.actualizada };
      },
    );
    if (preparado.listo) return { cotizacion: preparado.listo, archivo: preparado.listo.notas[0].pdf };
    const { copia, notas, fabricas, version } = preparado;
    // Al reservar y al confirmar, lo revisado sigue vigente: nadie generó las notas ni cambió la cotización.
    const vigente = (u: Unidad) => {
      const q = this.obtener(u, accion.id);
      if (q.notas.length) throw new ErrorConflicto(`Otra persona generó ${textoNotas(q.notas)} de esta cotización.`);
      if (q.actualizada !== version || q.estado !== 'aprobada') throw new ErrorConflicto(VERSION_OBSOLETA);
      this.verificarSerieNoAprobada(q, u);
      return q;
    };
    // Igual que al emitir: Chromium se comprueba fuera del bloqueo y antes de gastar un número de nota.
    await prepararPdf();
    const { numeros, ficha } = await this.almacen.transaccion((u) => {
      vigente(u);
      return u.reservarNotasEnEmision(
        accion.id,
        notas.map((n) => n.fabrica),
      );
    });
    try {
      return await this.generarNotasReservadas(
        notas.map((n, i) => ({ ...n, numero: numeros[i] })),
        copia,
        fabricas,
        vigente,
      );
    } finally {
      this.almacen.liberarEmision(accion.id, ficha);
    }
  }

  /** Segunda mitad de `generarNotaPedido`, con los números ya reservados y la marca «en emisión» tomada. */
  private async generarNotasReservadas(
    notas: { numero: number; fabrica: Fabrica; montos: Montos; items: number }[],
    copia: Cotizacion,
    fabricas: Map<number, Fabrica | null>,
    vigente: (u: Unidad) => Cotizacion,
  ): Promise<Resultado> {
    const despacho: Despacho = copia.despacho ?? {
      direccion: null,
      transporte: null,
      entregaComprometida: null,
    };
    const fecha = new Date().toISOString();
    const generados: { nota: NotaPedido; html: string; doc: DocumentoPdf }[] = [];
    try {
      for (const { numero, fabrica, montos } of notas) {
        const archivo = `nota-pedido-${fabrica}-${numero}.pdf`;
        const doc: DocumentoPdf = {
          tipo: 'nota',
          numero,
          fabrica,
          montos,
          fecha,
          autor: this.autor,
          despacho,
          reglas: copia.reglas,
          observaciones: copia.observaciones,
          // Cada fábrica sabe que la cotización tiene otra nota, con su número.
          otrasNotas: notas.filter((o) => o.fabrica !== fabrica).map((o) => ({ fabrica: o.fabrica, numero: o.numero, items: o.items })),
        };
        const html = await plantilla(copia, doc, this.almacen.baseDatos());
        await generarPdf(this.almacen.directorio, archivo, html);
        generados.push({
          html,
          doc,
          nota: {
            numero,
            fabrica,
            pdf: archivo,
            montos,
            fecha,
            despacho: {
              direccion: despacho.direccion,
              transporte: despacho.transporte,
              ...(despacho.entregaComprometida ? { entregaComprometida: despacho.entregaComprometida } : {}),
              // Como al recargar desde SQLite: la nota trae el destino solo si lo hay.
              ...(despacho.destino ? { destino: despacho.destino } : {}),
              valor: despacho.valor ?? copia.flete,
            },
            observaciones: copia.observaciones,
            anulada: false,
            inicioProduccion: null,
            terminoProduccion: null,
          },
        });
      }
      // Las notas de una fábrica integrada se envían solas, con su orden de trabajo de la misma versión.
      const envios = await this.prepararEnvios(
        { ...copia, notas: generados.map((g) => g.nota) },
        generados.map(({ nota, doc }) => ({ nota, doc })),
      );
      return await this.almacen.transaccion((u): Resultado => {
        const q = vigente(u);
        for (const envio of envios) u.encolarIntegracion({ tipo: 'pedido', cotizacionId: q.id, envio });
        q.despacho = despacho;
        q.solicitudes.forEach((s, i) => (s.fabrica = fabricas.get(i) ?? null));
        q.notas = generados.map((g) => g.nota);
        q.estadoOperativo = 'pedido_generado';
        q.estadoComercial = 'vendida';
        const generadas = notas.length > 1 ? `Notas de pedido ${numerosNotas(q.notas)} generadas` : `Nota de pedido ${numeroNota(q.notas[0])} generada`;
        q.historial.push({ rol: 'asistente', texto: `${generadas} después de registrar el anticipo.` });
        q.actualizada = marca(q.actualizada);
        u.guardar(q);
        for (const { nota, html } of generados) {
          u.guardarDocumento(q.id, nota.pdf, html);
          u.registrarEvento(q.id, 'nota_generada', this.autor, `Nota de pedido ${numeroNota(nota)} · precio fábrica`);
        }
        // Las demás emitidas de la serie ya no pueden aprobarse: un solo pedido por serie.
        this.reemplazarSerie(u, q);
        return { cotizacion: q, archivo: q.notas[0].pdf, archivos: q.notas.map((n) => n.pdf) };
      });
    } catch (error) {
      for (const { nota } of generados) await rm(join(this.almacen.directorio, 'pdf', nota.pdf), { force: true });
      throw error;
    }
  }

  /**
   * Envíos a fábrica de las notas recién impresas de `q`: solo las de una fábrica integrada y configurada (hoy,
   * Panguipulli). Una nota de Santiago nunca entra aquí. Si preparar uno falla, la nota se genera igual (nunca se frena
   * el flujo comercial): queda en el registro y se puede encolar después con `npm run integracion -- encolar <N° cotización>`.
   */
  private async prepararEnvios(q: Cotizacion, notas: { nota: NotaPedido; doc: DocumentoPdf }[]): Promise<EnvioPreparado[]> {
    const envios: EnvioPreparado[] = [];
    for (const { nota, doc } of notas) {
      if (nota.anulada || !fabricaIntegrada(nota.fabrica) || !configuracionFabrica(nota.fabrica)) continue;
      try {
        envios.push(await prepararEnvio(q, nota, { db: this.almacen.baseDatos(), doc }));
      } catch (error) {
        registrarError('integracion', `No se preparó el envío de la nota ${numeroNota(nota)} (cotización N° ${q.numero}): ${(error as Error)?.message ?? error}`);
      }
    }
    return envios;
  }

  /**
   * Asigna la fábrica de cada ítem (null la quita) en un borrador, una emitida o una aprobada sin notas de pedido.
   * No es un cambio de la cotización del cliente: no crea una revisión ni toca su PDF. Devuelve el texto de lo
   * asignado (vacío si nada cambió); quien llama confirma la versión.
   */
  asignarFabricas(q: Cotizacion, u: Unidad, asignaciones: AsignacionFabrica[]) {
    if (q.estado === 'reemplazada' || q.estado === 'anulada') this.exigirEditable(q);
    if (q.notas.length)
      throw new ErrorConflicto(
        `${q.notas.length > 1 ? `Las notas de pedido ${numerosNotas(q.notas)} ya se generaron` : `La nota de pedido ${numeroNota(q.notas[0])} ya se generó`}: el reparto entre fábricas no se puede cambiar.`,
        'no_editable',
      );
    const cambios: string[] = [];
    const vistos = new Set<number>();
    for (const { indice, fabrica } of asignaciones) {
      const s = q.solicitudes[indice];
      if (!s) throw new ErrorUsuario(`No existe el ítem ${indice + 1}.`);
      if (vistos.has(indice)) throw new ErrorUsuario(`El ítem ${indice + 1} viene dos veces.`);
      vistos.add(indice);
      // Un ítem libre no va a fábrica: se ignora si viene en un reparto de todos los ítems.
      if (esLibre(s) || (s.fabrica ?? null) === fabrica) continue;
      s.fabrica = fabrica;
      cambios.push(`${this.describir(s)} → ${fabrica ? nombreFabrica[fabrica] : 'sin fábrica'}`);
    }
    if (!cambios.length) return { cotizacion: q, texto: '' };
    q.actualizada = marca(q.actualizada);
    u.guardar(q);
    const texto = cambios.join(' · ');
    u.registrarEvento(q.id, 'fabricas', this.autor, texto);
    return { cotizacion: q, texto };
  }

  /**
   * El documento cuyo número se cambiaría (la cotización o la nota de `fabrica`) y su número actual, comprobando que
   * se pueda: solo una cuenta administradora, en una cotización emitida o aprobada, y en una nota con fábrica. Con
   * `numero`, valida además que el nuevo esté libre y dentro del rango. Lo usa también el chat antes de proponerlo.
   */
  documentoRenumerable(
    u: Unidad,
    q: Cotizacion,
    documento: 'cotizacion' | 'nota',
    fabrica?: Fabrica | null,
    numero?: number,
  ): { actual: number; nota: NotaPedido | null } {
    if (!this.admin)
      throw new ErrorUsuario('Solo una cuenta administradora puede cambiar el número de un documento.', 'sin_permiso', 403);
    if (documento === 'cotizacion') {
      if ((q.estado !== 'emitida' && q.estado !== 'aprobada') || q.numero === null || !q.pdf)
        throw new ErrorConflicto(
          q.estado === 'borrador'
            ? 'La cotización todavía no se emite: elige su número al emitirla.'
            : `La cotización N° ${q.numero} está ${q.estado} y su número ya no se cambia.`,
          'estado_invalido',
        );
      if (numero !== undefined && numero !== q.numero) u.validarNumeroCotizacion(q.id, numero);
      return { actual: q.numero, nota: null };
    }
    const nota = fabrica ? q.notas.find((n) => n.fabrica === fabrica) : q.notas.length === 1 ? q.notas[0] : undefined;
    if (!nota)
      throw new ErrorConflicto(
        !q.notas.length
          ? `La cotización ${q.numero ? `N° ${q.numero} ` : ''}todavía no tiene notas de pedido.`
          : fabrica
            ? `La cotización N° ${q.numero} no tiene una nota de pedido para ${nombreFabrica[fabrica]}.`
            : `La cotización N° ${q.numero} tiene ${textoNotas(q.notas)}: indica la fábrica de la que quieres cambiar.`,
        'estado_invalido',
      );
    if (q.estado !== 'aprobada' || nota.anulada)
      throw new ErrorConflicto(`La nota de pedido ${numeroNota(nota)} está anulada y su número ya no se cambia.`, 'estado_invalido');
    if (!nota.fabrica)
      throw new ErrorConflicto(
        `La nota de pedido N° ${nota.numero} es anterior a separar las fábricas: asígnale una (npm run notas) antes de cambiar su número.`,
        'estado_invalido',
      );
    if (numero !== undefined && numero !== nota.numero) u.validarNumeroNota(nota.fabrica, numero, q.id);
    return { actual: nota.numero, nota };
  }

  /**
   * Cambia el número de la cotización emitida o de una de sus notas y vuelve a generar el PDF con el número nuevo,
   * con un nombre de archivo nuevo (un PDF emitido no se sobrescribe). Al cambiar el de la cotización también se
   * vuelven a generar sus notas, que la nombran. Los PDF anteriores se borran al confirmar. Como al emitir: los PDF
   * se generan fuera del bloqueo y se confirma solo si nadie cambió la cotización ni tomó el número entretanto.
   */
  private async cambiarNumero(accion: Extract<Accion, { tipo: 'cambiar_numero' }>): Promise<Resultado> {
    const preparado = await this.almacen.transaccion((u): Preparado<{ actual: number }> => {
      const q = this.obtener(u, accion.id);
      this.verificarVersion(q, accion.actualizada);
      const { actual } = this.documentoRenumerable(u, q, accion.documento, accion.fabrica, accion.numero);
      if (actual === accion.numero) return { listo: q };
      return { listo: null, copia: structuredClone(q), actual, version: q.actualizada };
    });
    if (preparado.listo) return { cotizacion: preparado.listo };
    const { copia, actual, version } = preparado;
    const numero = accion.numero;
    await prepararPdf();
    const db = this.almacen.baseDatos();
    // Lo que se vuelve a generar: el archivo nuevo de cada documento y el que reemplaza.
    const nuevos: { archivo: string; html: string; anterior: string; fabrica: Fabrica | null }[] = [];
    try {
      // Con el número nuevo. Las notas se reimprimen todas: dicen «Cotización N° …» y nombran a la otra nota.
      const cambiada = accion.documento === 'nota' ? copia.notas.find((n) => n.numero === actual && (!accion.fabrica || n.fabrica === accion.fabrica))! : null;
      const renumerada: Cotizacion = {
        ...copia,
        ...(accion.documento === 'cotizacion' ? { numero } : {}),
        notas: copia.notas.map((n) => (n === cambiada ? { ...n, numero } : n)),
      };
      if (accion.documento === 'cotizacion') {
        const archivo = this.almacen.archivoLibre(`cotizacion-${numero}`);
        const html = await plantilla(renumerada, documentoCotizacion(renumerada), db);
        await generarPdf(this.almacen.directorio, archivo, html);
        nuevos.push({ archivo, html, anterior: copia.pdf!, fabrica: null });
      }
      const docsNota = new Map<string, DocumentoPdf>();
      for (const nota of renumerada.notas.filter((n) => !n.anulada)) {
        const base = nota.fabrica ? `nota-pedido-${nota.fabrica}-${nota.numero}` : `nota-pedido-${nota.numero}`;
        const archivoNota = this.almacen.archivoLibre(base);
        const docNota = documentoNota(renumerada, nota);
        const htmlNota = await plantilla(renumerada, docNota, db);
        await generarPdf(this.almacen.directorio, archivoNota, htmlNota);
        nuevos.push({ archivo: archivoNota, html: htmlNota, anterior: nota.pdf, fabrica: nota.fabrica ?? null });
        docsNota.set(archivoNota, docNota);
      }
      // La nota reimpresa es otra revisión del pedido para la fábrica integrada (otro número en sus documentos). Solo
      // si ese pedido ya se había encolado: renumerar una nota anterior a la integración no la envía.
      const reimpresa: Cotizacion = {
        ...renumerada,
        ...(accion.documento === 'cotizacion' ? { pdf: nuevos[0].archivo } : {}),
        notas: renumerada.notas.map((n) => ({ ...n, pdf: nuevos.find((x) => x.anterior === n.pdf)?.archivo ?? n.pdf })),
      };
      const envios = await this.prepararEnvios(
        reimpresa,
        reimpresa.notas.flatMap((nota) => (docsNota.has(nota.pdf) ? [{ nota, doc: docsNota.get(nota.pdf)! }] : [])),
      );
      const resultado = await this.almacen.transaccion((u): Resultado => {
        const q = this.obtener(u, accion.id);
        if (q.actualizada !== version) throw new ErrorConflicto(VERSION_OBSOLETA);
        for (const envio of envios) u.encolarIntegracion({ tipo: 'pedido', cotizacionId: q.id, envio, soloSiYaEncolado: true });
        // Otra persona pudo tomar el número mientras se generaban los PDF.
        const { nota } = this.documentoRenumerable(u, q, accion.documento, accion.fabrica, numero);
        let detalle: string;
        // Cada documento reimpreso pasa a su archivo nuevo.
        for (const n of nuevos) {
          const notaQ = q.notas.find((x) => x.pdf === n.anterior);
          if (notaQ) notaQ.pdf = n.archivo;
        }
        if (accion.documento === 'cotizacion') {
          q.numero = numero;
          q.pdf = nuevos[0].archivo;
          u.avanzarCorrelativo({ tipo: 'cotizacion' }, numero);
          u.renumerarReferencias(q, actual);
          detalle = `Cotización N° ${actual} → N° ${numero}`;
          q.historial.push({
            rol: 'asistente',
            texto: `La cotización pasó del N° ${actual} al N° ${numero}. Su PDF${nuevos.length > 1 ? ' y los de sus notas de pedido se volvieron' : ' se volvió'} a generar con el número nuevo.`,
          });
        } else {
          nota!.numero = numero;
          u.avanzarCorrelativo({ tipo: 'nota', fabrica: nota!.fabrica! }, numero);
          detalle = `Nota de pedido de ${nombreFabrica[nota!.fabrica!]} N° ${actual} → N° ${numero}`;
          q.historial.push({
            rol: 'asistente',
            texto: `La nota de pedido de ${nombreFabrica[nota!.fabrica!]} pasó del N° ${actual} al N° ${numero}. Su PDF se volvió a generar con el número nuevo${nuevos.length > 1 ? ', y también el de la otra nota, que la nombra' : ''}.`,
          });
        }
        q.actualizada = marca(q.actualizada);
        u.guardar(q);
        for (const n of nuevos) {
          u.descartarDocumento(n.anterior);
          u.guardarDocumento(q.id, n.archivo, n.html);
        }
        u.registrarEvento(q.id, 'numero_cambiado', this.autor, detalle);
        // El documento que cambió de número: la cotización o la nota (las demás notas solo se reimprimieron).
        const propio = accion.documento === 'cotizacion' ? nuevos[0] : nuevos.find((n) => n.anterior === cambiada!.pdf)!;
        return { cotizacion: q, archivo: propio.archivo };
      });
      // El documento con el número anterior ya no es de nadie: se borra (si falla, solo queda un archivo huérfano).
      for (const n of nuevos) await rm(join(this.almacen.directorio, 'pdf', n.anterior), { force: true }).catch(() => {});
      return resultado;
    } catch (error) {
      for (const n of nuevos) await rm(join(this.almacen.directorio, 'pdf', n.archivo), { force: true });
      throw error;
    }
  }

  /** Familia de un modelo del catálogo (PUERTA, MARCO…); null si el catálogo no lo tiene. */
  private familiaDe(modelo: string) {
    return this.productosDe(modelo)[0]?.familia ?? null;
  }

  private productosDe(modelo: string) {
    const clave = normalizar(modelo);
    return 'productos' in this.catalogo
      ? this.catalogo.productos.filter((p) => normalizar(p.modelo) === clave)
      : this.catalogo.productosDeModelo(clave);
  }

  /** Un mensaje del chat: la orquestación vive en chat.ts y usa este servicio por medio de `ContextoChat`. */
  private chat(accion: Extract<Accion, { tipo: 'chat' }>): Promise<Resultado> {
    return procesarChat(this.contextoChat(), accion);
  }

  private contextoChat(): ContextoChat {
    return {
      catalogo: this.catalogo,
      llm: this.llm,
      almacen: this.almacen,
      autor: this.autor,
      diagnostico: this.diagnostico,
      nueva: () => this.nueva(),
      obtener: (u, id) => this.obtener(u, id),
      exigirEditable: (q) => this.exigirEditable(q),
      abrirEdicion: (q, u) => this.abrirEdicion(q, u),
      recalcular: (q) => this.recalcular(q),
      producto: (s, pareja) => this.producto(s, pareja),
      familiaDe: (modelo) => this.familiaDe(modelo),
      productosDe: (modelo) => this.productosDe(modelo),
      sinCambios: (q, solicitudes, cliente) => this.sinCambios(q, solicitudes, cliente),
      cambios: (antes, despues, clienteAntes, clienteDespues) => this.cambios(antes, despues, clienteAntes, clienteDespues),
      describir: (s) => this.describir(s),
      asignarFabricas: (q, u, asignaciones) => this.asignarFabricas(q, u, asignaciones),
      documentoRenumerable: (u, q, documento, fabrica, numero) => this.documentoRenumerable(u, q, documento, fabrica, numero),
    };
  }
}

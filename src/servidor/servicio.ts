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
  maderasCatalogo,
  metros,
  modelosCatalogo,
  normalizar,
  normalizarMedida,
  resolverItem,
  type CatalogoConsultable,
} from '../catalogo/resolver';
import { clienteVacio, type Cliente, type SolicitudItem } from '../catalogo/tipos';
import { mismoCliente, sanearCliente } from '../negocio/cliente';
import type { Cotizacion, Despacho } from '../negocio/estado';
import {
  cotizar,
  descuentoValido,
  fleteValido,
  montosVacios,
  pesos,
  REGLAS,
  type ItemPrecio,
  type Montos,
} from '../negocio/precios';
import { calcularVence, estaVencida, fechaChilena } from '../negocio/vigencia';
import { Almacen, type Unidad } from './almacen';
import { ErrorConflicto, ErrorNoEncontrado, ErrorUsuario, VERSION_OBSOLETA } from './errores';
import { generarPdf, plantilla } from './pdf';
import { resolverReferencia, type OpcionCotizacion } from './referencias';

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
    }
  | { tipo: 'quitar'; id: string; actualizada: string; indice: number }
  | { tipo: 'emitir'; id: string; actualizada: string }
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
      descuento?: number;
      flete?: number;
    };

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
}
export interface UsuarioServicio {
  nombre: string;
  email: string;
}

/** Resultado de la primera fase de emitir/aprobar: ya estaba hecho o número reservado. */
type Preparado<T> =
  { listo: Cotizacion } | ({ listo: null; copia: Cotizacion; numero: number; version: string } & T);

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
      creadaPor: this.autor,
      emitidaPor: null,
      aprobadaPor: null,
      anuladaPor: null,
      fechaAnulacion: null,
      motivoAnulacion: null,
      reemplazadaPor: null,
      versionCatalogo: null,
      nota: null,
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

  private recalcular(q: Cotizacion, tocar = true) {
    const validos: ItemPrecio[] = [];
    q.incompletos = [];
    for (const [indice, s] of q.solicitudes.entries()) {
      const res = resolverItem(this.catalogo, s);
      if (res.ok)
        validos.push({
          producto: res.producto,
          cantidad: res.cantidad,
          indice,
          anchoSolicitado: res.anchoSolicitado,
          altoSolicitado: res.altoSolicitado,
          medidaSolicitada: res.medidaSolicitada,
        });
      else q.incompletos.push({ indice, rechazo: res.rechazo, pregunta: pregunta(res.rechazo, s.modelo) });
    }
    q.montos = validos.length
      ? cotizar(validos, REGLAS, { descuento: q.descuento, flete: q.flete })
      : montosVacios();
    if (tocar) q.actualizada = marca(q.actualizada);
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

  private firma(s: SolicitudItem) {
    const m = (n: number | null) => {
      if (n === null) return '';
      const v = metros(n);
      return v === null ? `?${n}` : v.toFixed(4);
    };
    const r = resolverItem(this.catalogo, s);
    if (r.ok)
      return [r.producto.codigo, r.cantidad, m(s.ancho), m(s.alto), r.medidaSolicitada ?? ''].join('|');
    return [
      normalizar(s.modelo ?? ''),
      normalizar(s.madera ?? ''),
      m(s.ancho),
      m(s.alto),
      s.medida ? normalizarMedida(s.medida) : '',
      s.cantidad ?? '',
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
    return this.sinCambios(a, b.solicitudes, b.cliente) && a.descuento === b.descuento && a.flete === b.flete;
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
    return `${s.cantidad ?? '—'} × ${s.modelo ?? 'producto por definir'}${s.madera ? ` ${s.madera}` : ''}${medidas.length ? ` ${medidas.join(' × ')}` : ''}`;
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
          q.historial = [
            {
              rol: 'asistente',
              texto: origen.numero ? `Duplicada de N° ${origen.numero}.` : 'Duplicada de un borrador.',
            },
          ];
          this.recalcular(q);
          u.guardar(q);
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
          q.anuladaPor = this.autor;
          q.fechaAnulacion = fecha;
          q.motivoAnulacion = motivo;
          if (q.nota) q.nota.anulada = true;
          q.historial.push({
            rol: 'asistente',
            texto: `Cotización N° ${q.numero} anulada${q.nota ? ` junto con la nota de pedido N° ${q.nota.numero}` : ''}${motivo ? `. Motivo: ${motivo}` : ''}.`,
          });
          q.actualizada = marca(q.actualizada);
          u.guardar(q);
          return { cotizacion: q };
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
      const { cliente, avisos } = accion.cliente
        ? sanearCliente(accion.cliente, q.cliente)
        : { cliente: q.cliente, avisos: [] as string[] };
      const descuento = accion.descuento ?? q.descuento,
        flete = accion.flete ?? q.flete;
      if (!descuentoValido(descuento))
        throw new ErrorUsuario(
          `El descuento debe estar entre 0 % y ${REGLAS.descuentoMaximo} %, con hasta dos decimales.`,
        );
      if (!fleteValido(flete))
        throw new ErrorUsuario('El flete debe ser un monto neto entero en pesos, desde $0.');
      const extra = avisos.length ? { avisos } : {};
      if (
        JSON.stringify([solicitudes, cliente]) === JSON.stringify([q.solicitudes, q.cliente]) &&
        descuento === q.descuento &&
        flete === q.flete
      )
        return { cotizacion: q, ...extra };
      const destino = this.abrirEdicion(q, u);
      const antes = structuredClone(destino.solicitudes),
        clienteAntes = destino.cliente;
      destino.solicitudes = solicitudes;
      destino.cliente = cliente;
      destino.descuento = descuento;
      destino.flete = flete;
      this.recalcular(destino);
      u.guardar(destino);
      const cambios = this.cambios(antes, solicitudes, clienteAntes, cliente);
      return { cotizacion: destino, ...extra, ...(cambios ? { cambios } : {}) };
    });
  }

  /** Reserva el número, genera el PDF fuera del bloqueo y confirma solo si nadie cambió la cotización. */
  private async emitir(accion: Extract<Accion, { tipo: 'emitir' }>): Promise<Resultado> {
    const preparado = await this.almacen.transaccion((u): Preparado<{ avisos: string[] }> => {
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
      // Reserva durable antes de generar: un fallo puede dejar un salto, jamás reutilizar un número.
      const numero = u.reservarCotizacion();
      return { listo: null, copia, numero, avisos, version: q.actualizada };
    });
    if (preparado.listo) return { cotizacion: preparado.listo, archivo: preparado.listo.pdf! };
    const { copia, numero, avisos, version } = preparado;
    const archivo = `cotizacion-${numero}.pdf`,
      fecha = new Date().toISOString(),
      vence = calcularVence(fecha);
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
          }
        }
        u.guardar(q);
        return { cotizacion: q, archivo, ...(avisos.length ? { avisos } : {}) };
      });
    } catch (error) {
      await rm(join(this.almacen.directorio, 'pdf', archivo), { force: true });
      throw error;
    }
  }

  private async aprobar(accion: Extract<Accion, { tipo: 'aprobar' }>): Promise<Resultado> {
    const preparado = await this.almacen.transaccion((u): Preparado<{ montos: Montos }> => {
      const q = this.obtener(u, accion.id);
      if (q.nota) return { listo: q };
      // Aprobar es irreversible: exige una cotización ya emitida y revisada, nunca emite de paso.
      if (q.estado === 'borrador' || !q.pdf || q.numero === null)
        throw new ErrorConflicto(
          'Genera y revisa el PDF de la cotización antes de aprobarla.',
          'estado_invalido',
        );
      if (q.estado !== 'emitida') this.exigirEditable(q);
      this.verificarVersion(q, accion.actualizada);
      this.verificarSerieNoAprobada(q, u);
      if (estaVencida(q.vence) && !accion.confirmarVencida)
        throw new ErrorConflicto(
          `La cotización N° ${q.numero} venció el ${fechaChilena(q.vence!)}. Confirma que el cliente la aceptó igualmente para aprobarla.`,
          'cotizacion_vencida',
          { vence: q.vence },
        );
      // La nota usa los precios guardados sin ajuste, sin descuento ni flete.
      const montos = cotizar(
        q.montos.lineas.map((l) => ({
          producto: l.producto,
          cantidad: l.cantidad,
          indice: l.indice,
          anchoSolicitado: l.anchoSolicitado,
          altoSolicitado: l.altoSolicitado,
          medidaSolicitada: l.medidaSolicitada,
        })),
        { ...REGLAS, ajuste: 0 },
      );
      const numero = u.reservarNota();
      return { listo: null, copia: structuredClone(q), numero, montos, version: q.actualizada };
    });
    if (preparado.listo) return { cotizacion: preparado.listo, archivo: preparado.listo.nota!.pdf };
    const { copia, numero, montos, version } = preparado;
    const despacho: Despacho = {
      direccion: accion.despacho?.direccion?.replace(/\s+/g, ' ').trim().slice(0, 300) || null,
      transporte: accion.despacho?.transporte?.replace(/\s+/g, ' ').trim().slice(0, 120) || null,
    };
    const archivo = `nota-pedido-${numero}.pdf`,
      fecha = new Date().toISOString();
    await generarPdf(
      this.almacen.directorio,
      archivo,
      await plantilla(copia, { tipo: 'nota', numero, montos, fecha, autor: this.autor, despacho }),
    );
    try {
      return await this.almacen.transaccion((u): Resultado => {
        const q = this.obtener(u, accion.id);
        if (q.nota)
          throw new ErrorConflicto(`Otra persona aprobó esta cotización (nota N° ${q.nota.numero}).`);
        if (q.actualizada !== version || q.estado !== 'emitida') throw new ErrorConflicto(VERSION_OBSOLETA);
        this.verificarSerieNoAprobada(q, u);
        q.nota = { numero, pdf: archivo, montos, fecha, despacho, anulada: false };
        q.estado = 'aprobada';
        q.aprobadaPor = this.autor;
        q.historial.push({
          rol: 'asistente',
          texto: `Cotización N° ${q.numero} aprobada. Nota de pedido N° ${numero} lista para revisar.`,
        });
        q.actualizada = marca(q.actualizada);
        u.guardar(q);
        // Las demás emitidas de la serie ya no pueden aprobarse: una sola nota por pedido.
        for (const otra of u.serie(q.id))
          if (otra.id !== q.id && otra.estado === 'emitida') {
            otra.estado = 'reemplazada';
            otra.reemplazadaPor = q.numero;
            otra.actualizada = marca(otra.actualizada);
            u.guardar(otra);
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
      items[cambio.indice] = { ...items[cambio.indice], ...cambio.cambios };
    }
    for (const indice of quitar) {
      if (indice >= items.length || quitarIndices.has(indice) || actualizarIndices.has(indice)) return null;
      quitarIndices.add(indice);
    }
    for (const indice of [...quitarIndices].sort((a, b) => b - a)) items.splice(indice, 1);
    items.push(...(cambios.agregar ?? []));
    if (items.length > 100) return null;
    return { items, cliente: { ...base.cliente, ...(cambios.cliente ?? {}) } };
  }

  private async chat(accion: Extract<Accion, { tipo: 'chat' }>): Promise<Resultado> {
    // La IA puede tardar hasta el plazo configurado: se consulta sin retener el bloqueo del estado,
    // para no dejar esperando (ni fallar) las acciones de otra persona.
    const conversacion = accion.id ? this.almacen.obtener(accion.id) : null;
    if (accion.id && !conversacion) throw new ErrorNoEncontrado();
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
    const nuevo = previo ? null : this.nueva();
    const base = previo ?? nuevo!;
    let salida: unknown;
    try {
      salida = await this.llm.interpretar(
        contextoSeguro(
          accion.mensaje,
          base.solicitudes,
          base.cliente,
          modelosCatalogo(this.catalogo),
          maderasCatalogo(this.catalogo),
          base.historial,
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
        q = nuevo;
        u.guardar(q);
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
        const texto = `¿Confirmas la aprobación de la cotización N° ${numero}? Se generará la nota de pedido y la cotización quedará bloqueada.${vencida ? ` Atención: venció el ${fechaChilena(objetivo.vence!)}.` : ''}`;
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
      let propuesta: { items: SolicitudItem[]; cliente: Partial<Cliente> };
      if (res.name === 'actualizar_cotizacion') {
        if (modo === 'modificacion_anterior') return responder(NO_ENTENDI);
        propuesta = {
          items: res.input.items,
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
      const avisos = [...avisosItems, ...avisosCliente];
      const extra = avisos.length ? { avisos } : {};
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
      this.recalcular(destino);
      const exito =
        modo === 'modificacion_anterior'
          ? `Cotización actualizada${destino.origen ? ` como revisión de la N° ${destino.origen}` : ''}. Revisa el detalle y genera el PDF cuando esté listo.`
          : 'Cotización actualizada. Revisa el detalle y genera el PDF cuando esté listo.';
      this.registrar(
        destino,
        accion.mensaje,
        [
          ...avisos,
          destino.incompletos.length ? destino.incompletos.map((i) => i.pregunta).join('\n\n') : exito,
        ].join('\n\n'),
      );
      u.guardar(destino);
      const cambios = this.cambios(antes, solicitudes, clienteAntes, cliente);
      return { cotizacion: destino, ...extra, ...(cambios ? { cambios } : {}) };
    });
  }
}

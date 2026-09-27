import { ErrorIA, errorProveedor } from '../asistente/errores';
import { randomUUID } from 'node:crypto';
import type { CatalogoConsultable } from '../catalogo/resolver';
import { clienteVacio } from '../catalogo/tipos';
import {
  aliasMaderasCatalogo,
  aliasModelosCatalogo,
  maderasCatalogo,
  modelosCatalogo,
  resolverItem,
} from '../catalogo/resolver';
import { pregunta } from '../asistente/preguntas';
import type { ModificacionCotizacion } from '../asistente/esquemas';
import { contextoSeguro, type LLM } from '../asistente/llm';
import { salidaSchema } from '../asistente/esquemas';
import { cotizar, montosVacios, REGLAS } from '../negocio/precios';
import type { Cotizacion, Estado } from '../negocio/estado';
import { Almacen } from './almacen';
import { generarPdf, plantilla } from './pdf';
import { resolverReferencia, type OpcionCotizacion } from './referencias';
export type Accion =
  | { tipo: 'nueva' }
  | {
      tipo: 'chat';
      id?: string;
      mensaje: string;
      objetivoId?: string;
      objetivoActualizada?: string;
    }
  | { tipo: 'quitar'; id: string; indice: number }
  | { tipo: 'emitir' | 'aprobar'; id: string };
export interface Resultado {
  cotizacion: Cotizacion;
  archivo?: string;
  /** Opciones de cotización cuando la referencia del mensaje coincide con varios registros. */
  seleccion?: OpcionCotizacion[];
  /** Aprobación pedida por chat: la interfaz debe confirmarla con la acción explícita `aprobar`. */
  confirmar?: { id: string; numero: number };
}
export class ErrorUsuario extends Error {}
const NO_ENTENDI = 'No entendí, ¿puedes reformularlo?';
// Montos o términos comerciales en texto libre del modelo; palabras como «total» o «valor» solas no bastan.
const TEXTO_MONETARIO =
  /\$\s*\d|\d[\d.,]*\s*(?:CLP|USD|pesos|%)|\b(?:CLP|USD|costos?|m[aá]rgen(?:es)?|descuentos?)\b/i;
const SOLICITUD_APROBACION =
  /\b(?:aprueba|apruebe|aprobar|se aprob[oó]|haz(?:me)? (?:la )?nota|genera(?:r)? (?:la )?nota|prepara(?:r)? (?:la )?nota)\b/i;
export class Servicio {
  constructor(
    private catalogo: CatalogoConsultable,
    private llm: LLM,
    private almacen = new Almacen(),
  ) {}
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
      nota: null,
    };
  }
  private recalcular(q: Cotizacion) {
    const validos = [];
    q.incompletos = [];
    for (const [indice, s] of q.solicitudes.entries()) {
      const res = resolverItem(this.catalogo, s);
      if (res.ok) validos.push(res);
      else q.incompletos.push({ indice, rechazo: res.rechazo, pregunta: pregunta(res.rechazo, s.modelo) });
    }
    q.montos = validos.length ? cotizar(validos) : montosVacios();
    q.actualizada = new Date().toISOString();
  }
  private registrar(q: Cotizacion, usuario: string, asistente: string) {
    q.historial.push({ rol: 'usuario', texto: usuario }, { rol: 'asistente', texto: asistente });
    q.actualizada = new Date().toISOString();
  }
  private editable(q: Cotizacion, estado: Estado) {
    if (q.estado === 'aprobada')
      throw new ErrorUsuario('La cotización está aprobada y no se puede editar. Crea una nueva cotización.');
    if (q.estado === 'emitida') {
      const copia = {
        ...structuredClone(q),
        id: randomUUID(),
        numero: null,
        estado: 'borrador' as const,
        pdf: null,
        fechaEmision: null,
        origen: q.numero,
        nota: null,
        creada: new Date().toISOString(),
      };
      estado.cotizaciones.push(copia);
      return copia;
    }
    return q;
  }
  private async emitir(q: Cotizacion, estado: Estado, guardar: () => Promise<void>) {
    if (q.pdf) return q.pdf;
    if (q.incompletos.length || !q.montos.lineas.length)
      throw new ErrorUsuario('Completa o quita los ítems pendientes antes de generar el PDF.');
    // Reserva durable antes de generar: un fallo puede dejar un salto, jamás reutilizar un número.
    const numero = estado.siguienteCotizacion++;
    await guardar();
    const archivo = `cotizacion-${numero}.pdf`,
      fecha = new Date().toISOString();
    await generarPdf(this.almacen.directorio, archivo, await plantilla(q, numero, q.montos, false, fecha));
    q.numero = numero;
    q.pdf = archivo;
    q.fechaEmision = fecha;
    q.estado = 'emitida';
    q.actualizada = fecha;
    return archivo;
  }
  private async aprobar(q: Cotizacion, estado: Estado, guardar: () => Promise<void>) {
    if (q.nota) return q.nota.pdf;
    // Aprobar es irreversible: exige una cotización ya emitida y revisada, nunca emite de paso.
    if (!q.pdf || q.numero === null)
      throw new ErrorUsuario('Genera y revisa el PDF de la cotización antes de aprobarla.');
    const numero = estado.siguienteNota++;
    await guardar();
    const montos = cotizar(
      q.montos.lineas.map((l) => ({ producto: l.producto, cantidad: l.cantidad })),
      { ...REGLAS, ajuste: 0 },
    );
    const archivo = `nota-pedido-${numero}.pdf`,
      fecha = new Date().toISOString();
    await generarPdf(this.almacen.directorio, archivo, await plantilla(q, numero, montos, true, fecha));
    q.nota = { numero, pdf: archivo, montos, fecha };
    q.estado = 'aprobada';
    q.historial.push({
      rol: 'asistente',
      texto: `Cotización N° ${q.numero} aprobada. Nota de pedido N° ${numero} lista para revisar.`,
    });
    q.actualizada = fecha;
    return archivo;
  }
  async ejecutar(accion: Accion): Promise<Resultado> {
    if (accion.tipo === 'chat') return this.chat(accion);
    return this.almacen.transaccion(async (estado, guardar) => {
      if (accion.tipo === 'nueva') {
        const q = this.nueva();
        estado.cotizaciones.push(q);
        return { cotizacion: q };
      }
      let q = estado.cotizaciones.find((c) => c.id === accion.id);
      if (!q) throw new ErrorUsuario('No se encontró la cotización.');
      if (accion.tipo === 'emitir') return { cotizacion: q, archivo: await this.emitir(q, estado, guardar) };
      if (accion.tipo === 'aprobar')
        return { cotizacion: q, archivo: await this.aprobar(q, estado, guardar) };
      if (accion.tipo !== 'quitar') throw new ErrorUsuario('Acción inválida.');
      if (!q.solicitudes[accion.indice]) throw new ErrorUsuario('No se encontró el ítem.');
      q = this.editable(q, estado);
      q.solicitudes.splice(accion.indice, 1);
      this.recalcular(q);
      return { cotizacion: q };
    });
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
    return {
      items,
      cliente: { ...base.cliente, ...(cambios.cliente ?? {}) },
    };
  }
  private async chat(accion: Extract<Accion, { tipo: 'chat' }>): Promise<Resultado> {
    // La IA puede tardar hasta el plazo configurado: se consulta sin retener el bloqueo del estado,
    // para no dejar esperando (ni fallar) las acciones de otra persona.
    const inicial = await this.almacen.leer();
    const conversacion = accion.id ? inicial.cotizaciones.find((c) => c.id === accion.id) : undefined;
    if (accion.id && !conversacion) throw new ErrorUsuario('No se encontró la cotización.');
    let previo: Cotizacion | undefined;
    let modo: 'cotizacion_nueva' | 'modificacion_anterior' = 'cotizacion_nueva';
    if (accion.objetivoId) {
      previo = inicial.cotizaciones.find((c) => c.id === accion.objetivoId);
      if (!previo) throw new ErrorUsuario('No se encontró la cotización seleccionada.');
      if (!accion.objetivoActualizada || accion.objetivoActualizada !== previo.actualizada)
        throw new ErrorUsuario('La cotización cambió. Elige nuevamente la cotización que quieres modificar.');
      modo = 'modificacion_anterior';
    } else {
      const referencia = SOLICITUD_APROBACION.test(accion.mensaje)
        ? { tipo: 'ninguna' as const }
        : resolverReferencia(accion.mensaje, inicial.cotizaciones);
      if (referencia.tipo === 'multiples') {
        const cotizacionContexto =
          conversacion ?? inicial.cotizaciones.find((q) => q.id === referencia.opciones[0].id);
        if (!cotizacionContexto) throw new ErrorUsuario('No se encontró la cotización seleccionada.');
        return { cotizacion: cotizacionContexto, seleccion: referencia.opciones };
      }
      if (referencia.tipo === 'unica') {
        previo = referencia.cotizacion;
        modo = 'modificacion_anterior';
      } else previo = conversacion;
    }
    if (!previo) {
      const nueva = this.nueva();
      previo = await this.almacen.transaccion(async (estado) => {
        estado.cotizaciones.push(nueva);
        return structuredClone(nueva);
      });
    }
    if (previo.estado === 'aprobada')
      throw new ErrorUsuario('La cotización está aprobada y no se puede editar. Crea una nueva cotización.');
    let salida: unknown;
    try {
      salida = await this.llm.interpretar(
        contextoSeguro(
          accion.mensaje,
          previo.solicitudes,
          previo.cliente,
          modelosCatalogo(this.catalogo),
          maderasCatalogo(this.catalogo),
          previo.historial,
          modo,
          modo === 'modificacion_anterior' ? { numero: previo.numero, estado: previo.estado } : null,
          { modelos: aliasModelosCatalogo(this.catalogo), maderas: aliasMaderasCatalogo(this.catalogo) },
        ),
      );
    } catch (error) {
      if (error instanceof ErrorIA) throw error;
      throw errorProveedor();
    }
    return this.almacen.transaccion(async (estado) => {
      let q = estado.cotizaciones.find((c) => c.id === previo.id);
      if (!q) throw new ErrorUsuario('No se encontró la cotización.');
      // Control optimista: la respuesta se calculó sobre la versión leída antes de consultar a la IA.
      if (q.actualizada !== previo.actualizada)
        throw new ErrorUsuario(
          'La cotización cambió mientras se procesaba tu mensaje. Revisa el detalle y vuelve a enviarlo.',
        );
      const parsed = salidaSchema.safeParse(salida);
      if (!parsed.success) {
        this.registrar(q, accion.mensaje, NO_ENTENDI);
        return { cotizacion: q };
      }
      const res = parsed.data;
      if (res.name === 'aprobar_cotizacion') {
        const numero = res.input.numero;
        const objetivo = estado.cotizaciones.find((c) => c.numero === numero);
        if (!objetivo) {
          this.registrar(q, accion.mensaje, `No existe la cotización N° ${numero}. Genera primero su PDF.`);
          return { cotizacion: q };
        }
        if (objetivo.nota) {
          this.registrar(
            q,
            accion.mensaje,
            `La cotización N° ${numero} ya está aprobada con la nota de pedido N° ${objetivo.nota.numero}.`,
          );
          return { cotizacion: q, archivo: objetivo.nota.pdf };
        }
        this.registrar(
          q,
          accion.mensaje,
          `¿Confirmas la aprobación de la cotización N° ${numero}? Se generará la nota de pedido y la cotización quedará bloqueada.`,
        );
        return { cotizacion: q, confirmar: { id: objetivo.id, numero } };
      }
      if (res.name === 'actualizar_cotizacion') {
        if (modo === 'modificacion_anterior') {
          this.registrar(q, accion.mensaje, NO_ENTENDI);
          return { cotizacion: q };
        }
        const sinCambios =
          JSON.stringify([res.input.items, res.input.cliente]) === JSON.stringify([q.solicitudes, q.cliente]);
        if (q.estado === 'emitida' && sinCambios) {
          this.registrar(q, accion.mensaje, `No hay cambios respecto de la cotización N° ${q.numero}.`);
          return { cotizacion: q };
        }
        q = this.editable(q, estado);
        q.solicitudes = res.input.items;
        q.cliente = res.input.cliente;
        this.recalcular(q);
        this.registrar(
          q,
          accion.mensaje,
          q.incompletos.length
            ? q.incompletos.map((i) => i.pregunta).join('\n\n')
            : 'Cotización actualizada. Revisa el detalle y genera el PDF cuando esté listo.',
        );
        return { cotizacion: q };
      }
      if (res.name === 'modificar_cotizacion') {
        if (modo !== 'modificacion_anterior') {
          this.registrar(q, accion.mensaje, NO_ENTENDI);
          return { cotizacion: q };
        }
        const aplicado = this.aplicarModificacion(q, res.input);
        if (!aplicado) {
          this.registrar(q, accion.mensaje, NO_ENTENDI);
          return { cotizacion: q };
        }
        const sinCambios =
          JSON.stringify([aplicado.items, aplicado.cliente]) === JSON.stringify([q.solicitudes, q.cliente]);
        if (sinCambios) {
          this.registrar(
            q,
            accion.mensaje,
            `No hay cambios respecto de la cotización N° ${q.numero ?? 'en borrador'}.`,
          );
          return { cotizacion: q };
        }
        q = this.editable(q, estado);
        q.solicitudes = aplicado.items;
        q.cliente = aplicado.cliente;
        this.recalcular(q);
        this.registrar(
          q,
          accion.mensaje,
          q.incompletos.length
            ? q.incompletos.map((i) => i.pregunta).join('\n\n')
            : `Cotización actualizada${q.origen ? ` como revisión de la N° ${q.origen}` : ''}. Revisa el detalle y genera el PDF cuando esté listo.`,
        );
        return { cotizacion: q };
      }
      // No deja pasar montos inventados ni texto monetario desde el modelo.
      this.registrar(
        q,
        accion.mensaje,
        TEXTO_MONETARIO.test(res.input.texto)
          ? 'Puedo ayudarte con modelos, maderas, medidas, cantidades y datos del cliente. Los montos se muestran en la cotización.'
          : res.input.texto,
      );
      return { cotizacion: q };
    });
  }
}

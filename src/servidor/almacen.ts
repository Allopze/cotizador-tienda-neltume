import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import lockfile from 'proper-lockfile';
import type { DescuentoItem, Familia, Producto, ReferenciaItem, SolicitudItem } from '../catalogo/tipos';
import type { Rechazo } from '../catalogo/resolver';
import type {
  Cotizacion,
  ComentarioInterno,
  Estado,
  EstadoComercial,
  EstadoCotizacion,
  EventoCotizacion,
  Mensaje,
  Pago,
  ResumenCotizacion,
  TipoEvento,
} from '../negocio/estado';
import {
  cantidadFlete,
  etiquetaComercial,
  etiquetaOperativo,
  FABRICAS,
  leerEstadoOperativo,
  nombreFabrica,
  operacionDe,
  ordenarNotas,
  type EstadoOperativo,
  type Fabrica,
} from '../negocio/estado';
import type { Linea, Montos } from '../negocio/precios';
import { descuentoEsManual } from '../negocio/descuento-cantidad';
import { esLibre } from '../negocio/personalizados';
import { REGLAS, type ReglasComerciales } from '../negocio/precios';
import { calcularVence, estaVencida, inicioDiaSantiago, fechaLocal } from '../negocio/vigencia';
import { abrirBaseDatos, cerrarBaseDatos, directorioDatos, rutaBaseDatos } from './base-datos';
import { normalizarTexto, textoBusqueda } from './busqueda';
import { ErrorConflicto, ErrorUsuario, registrarError } from './errores';
import { encolarEnTransaccion, type Encolable } from './integracion-bandeja';
import { despertarIntegracion } from './integracion-envio';
import { cotizacionSchema, estadoPersistidoSchema, tramosDescuentoSchema } from './persistencia-esquemas';
import type { OrigenCatalogo } from '../catalogo/origenes';
import { guardarCatalogo, RepositorioCatalogoSqlite } from './repositorio-catalogo';

export { directorioDatos };

/**
 * Cuánto dura la marca «en emisión» si nadie la libera (un corte a media emisión): holgado sobre el plazo del PDF
 * (30 s) más la reserva y la confirmación.
 */
export const EMISION_VIGENTE_MS = 2 * 60_000;
/**
 * Plazo tras el cual proper-lockfile da por abandonado `data/.estado.lock` (lo renueva cada mitad de ese plazo). Lo
 * comparten el almacén, la migración desde JSON y la restauración, que lo usa para saber si el cotizador está activo.
 */
export const LOCK_ESTADO_VIGENTE_MS = 30_000;

export class ErrorOcupado extends ErrorConflicto {
  constructor() {
    super(
      'Otra operación está en curso. Espera unos segundos y vuelve a intentar; tu borrador está guardado.',
      'ocupado',
    );
    this.name = 'ErrorOcupado';
  }
}

/** Datos mínimos para resolver referencias por número, cliente, proyecto o comuna. */
export interface CandidataReferencia {
  id: string;
  actualizada: string;
  numero: number | null;
  estado: EstadoCotizacion;
  fechaEmision?: string | null;
  cliente: { nombre: string | null; proyecto: string | null; comuna: string | null };
  solicitudes: Pick<SolicitudItem, 'modelo' | 'cantidad'>[];
  nota?: { fecha: string } | null;
}

export interface FiltrosListado {
  vencenPronto?: boolean;
  saldoPendiente?: boolean;
  q?: string;
  estados?: EstadoCotizacion[];
  /** YYYY-MM-DD inclusive, sobre la fecha de emisión o, si no hay, la de creación (hora de Chile). */
  desde?: string;
  hasta?: string;
  /** Seguimiento comercial tal como lo muestra el historial (una anulada cuenta como «rechazada»). */
  comerciales?: EstadoComercial[];
  /** Estado operativo tal como lo muestra el historial (sin dato, «sin nota de pedido»). */
  operativos?: EstadoOperativo[];
  /** Quien creó la cotización (`creadaPor`), exacto. */
  vendedora?: string;
  pagina?: number;
  porPagina?: number;
}

type FilaCotizacion = {
  id: string;
  orden: number;
  numero: number | null;
  estado: EstadoCotizacion;
  cliente_nombre: string | null;
  cliente_rut: string | null;
  cliente_giro: string | null;
  cliente_telefono: string | null;
  cliente_direccion: string | null;
  cliente_comuna: string | null;
  cliente_proyecto: string | null;
  creada: string;
  actualizada: string;
  pdf: string | null;
  fecha_emision: string | null;
  fecha_emision_ausente: number;
  origen_id: string | null;
  origen_ausente: number;
  origen_numero: number | null;
  vence: string | null;
  descuento: number;
  descuento_manual: number;
  flete: number;
  flete_descripcion: string | null;
  flete_cantidad: number | null;
  margen_cotizacion: number | null;
  creada_por: string | null;
  emitida_por: string | null;
  aprobada_por: string | null;
  fecha_aprobacion: string | null;
  anulada_por: string | null;
  fecha_anulacion: string | null;
  motivo_anulacion: string | null;
  reemplazada_por: number | null;
  version_catalogo: string | null;
  observaciones: string | null;
  despacho_direccion: string | null;
  despacho_transporte: string | null;
  despacho_entrega: string | null;
  despacho_destino: string | null;
  despacho_valor: number | null;
  estado_comercial: 'pendiente' | 'enviada' | 'seguimiento' | 'aprobada' | 'rechazada' | 'vendida';
  /** Texto guardado: puede traer el antiguo «produccion_terminada» (ver `leerEstadoOperativo`). */
  estado_operativo: string | null;
  facturacion_estado: 'pendiente' | 'facturada';
  facturacion_tipo: 'factura' | 'boleta' | null;
  facturacion_id_externo: string | null;
  facturacion_fecha: string | null;
  reglas_json: string | null;
};

type FilaLinea = {
  cotizacion_id: string;
  codigo: string;
  modelo: string;
  familia: Producto['familia'];
  tipo: string | null;
  madera: string;
  medida: string;
  ancho_min: number | null;
  ancho_max: number | null;
  alto_min: number | null;
  alto_max: number | null;
  largo: number;
  precio_neto: number;
  descripcion: string;
  fila_origen: number;
  cantidad: number;
  precio_unitario: number;
  total: number;
  indice: number | null;
  ancho_solicitado: number | null;
  alto_solicitado: number | null;
  medida_solicitada: string | null;
  precio_unitario_personalizado: number | null;
  precio_fabrica: number | null;
  margen: number | null;
  margen_personalizado: number | null;
  precio_cliente: number | null;
  tipo_medida: 'hoja' | 'vano' | 'no_especificado' | null;
  observaciones: string | null;
  descripcion_documento: string | null;
  descuento_tipo: DescuentoItem['tipo'] | null;
  descuento_valor: number | null;
  descuento_unitario: number | null;
  /** Solo en `nota_lineas`: la fábrica de la nota a la que pertenece la línea (null en las anteriores a separarlas). */
  fabrica?: Fabrica | null;
};

type FilaPago = Pago & { cotizacion_id: string };
type FilaComentario = ComentarioInterno & { cotizacion_id: string };

type FilaMontos = {
  cotizacion_id: string;
  neto: number;
  iva: number;
  total: number;
  subtotal: number | null;
  descuento_porcentaje: number;
  descuento: number;
  flete: number;
};

type FilaNota = {
  fabrica: Fabrica | null;
  despacho_destino: string | null;
  despacho_valor: number | null;
  cotizacion_id: string;
  numero: number;
  pdf: string;
  fecha: string;
  neto: number;
  iva: number;
  total: number;
  despacho_direccion: string | null;
  despacho_transporte: string | null;
  despacho_entrega: string | null;
  observaciones: string | null;
  anulada: number;
  inicio_produccion: string | null;
  termino_produccion: string | null;
};

function reglasDesdeJson(valor: string | null): ReglasComerciales {
  if (!valor) return { ...REGLAS };
  try {
    const r = JSON.parse(valor) as Partial<ReglasComerciales>;
    if (
      Number.isFinite(r.ajuste) &&
      Number.isFinite(r.iva) &&
      Number.isInteger(r.vigenciaDiasHabiles) &&
      Number.isFinite(r.descuentoMaximo)
    ) {
      const margenes = r.margenes && typeof r.margenes === 'object' ? r.margenes : undefined;
      // Una lista ilegible se descarta entera: sin tramos (y no a medias) es lo que tenían las anteriores.
      const tramos = tramosDescuentoSchema.safeParse(r.descuentosPorCantidad);
      return {
        ajuste: r.ajuste!,
        iva: r.iva!,
        vigenciaDiasHabiles: r.vigenciaDiasHabiles!,
        descuentoMaximo: r.descuentoMaximo!,
        ...(tramos.success ? { descuentosPorCantidad: tramos.data } : {}),
        ...(margenes ? { margenes } : {}),
      };
    }
  } catch {
    // Se usa el valor predeterminado para que una cotización antigua no bloquee todo el listado.
  }
  return { ...REGLAS };
}

const lineaDesdeFila = (l: FilaLinea): Linea => ({
  producto: {
    codigo: l.codigo,
    modelo: l.modelo,
    familia: l.familia,
  tipo: l.tipo,
  madera: l.madera,
  medida: l.medida,
  anchoMin: l.ancho_min,
  anchoMax: l.ancho_max,
  ...(l.alto_min !== null ? { altoMin: l.alto_min } : {}),
  ...(l.alto_max !== null ? { altoMax: l.alto_max } : {}),
    largo: l.largo,
    precioNeto: l.precio_neto,
    descripcion: l.descripcion,
    filaOrigen: l.fila_origen,
  },
  cantidad: l.cantidad,
  precioUnitario: l.precio_unitario,
  precioFabrica: l.precio_fabrica ?? l.precio_neto,
  margen: l.margen ?? (l.precio_neto > 0 ? l.precio_unitario / l.precio_neto - 1 : 0),
  precioCliente: l.precio_cliente ?? l.precio_unitario,
  tipoMedida: l.tipo_medida,
  observaciones: l.observaciones,
  descripcionDocumento: l.descripcion_documento,
  total: l.total,
  indice: l.indice,
  anchoSolicitado: l.ancho_solicitado,
  altoSolicitado: l.alto_solicitado,
  medidaSolicitada: l.medida_solicitada,
  ...(l.precio_unitario_personalizado !== null
    ? { precioUnitarioPersonalizado: l.precio_unitario_personalizado }
    : {}),
  ...(l.descuento_tipo && l.descuento_valor !== null
    ? {
        descuentoItem: { tipo: l.descuento_tipo, valor: l.descuento_valor },
        descuentoUnitario: l.descuento_unitario ?? 0,
      }
    : {}),
  margenPersonalizado: !!l.margen_personalizado,
});

/** Una cotización anulada es siempre «rechazada»: también las que se anularon antes de fijarlo al anular. */
const estadoComercialGuardado = (estado: EstadoCotizacion, comercial: EstadoComercial): EstadoComercial =>
  estado === 'anulada' ? 'rechazada' : comercial;

function agrupar<T extends { cotizacion_id: string }>(filas: T[]) {
  const mapa = new Map<string, T[]>();
  for (const fila of filas) {
    const lista = mapa.get(fila.cotizacion_id);
    if (lista) lista.push(fila);
    else mapa.set(fila.cotizacion_id, [fila]);
  }
  return mapa;
}

const cantidadValida = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 10000;

/**
 * Carga cotizaciones completas con una consulta por tabla (sin N+1) dentro de una transacción de
 * lectura, para obtener una foto consistente. Una fila dañada se registra y se omite: nunca bloquea
 * el resto. Cantidades no enteras guardadas por versiones anteriores se reparan como pendientes.
 */
function cargar(db: Database.Database, ids: string[] | null): Cotizacion[] {
  return db.transaction(() => {
    const filtro = ids ? 'WHERE cotizacion_id IN (SELECT value FROM json_each(?))' : '';
    const param = ids ? [JSON.stringify(ids)] : [];
    const filas = db
      .prepare(
        `
        SELECT c.*, origen.numero AS origen_numero
        FROM cotizaciones AS c
        LEFT JOIN cotizaciones AS origen ON origen.id = c.origen_id
        ${ids ? 'WHERE c.id IN (SELECT value FROM json_each(?))' : ''}
        ORDER BY c.orden
      `,
      )
      .all(...param) as FilaCotizacion[];
    if (!filas.length) return [];
    const hijos = <T extends { cotizacion_id: string }>(sql: string) =>
      agrupar(db.prepare(sql.replace('$FILTRO', filtro)).all(...param) as T[]);
    const solicitudes = hijos<SolicitudItem & { cotizacion_id: string; precio_unitario: number | null; medida_por_defecto: number; familia_personalizada: Familia | null; item_libre: number; costo_fabrica: number | null; descuento_tipo: DescuentoItem['tipo'] | null; descuento_valor: number | null }>(`
      SELECT cotizacion_id, modelo, madera, ancho, alto, medida, cantidad, precio_unitario, margen, tipo_medida AS tipoMedida, medida_por_defecto, familia_personalizada, item_libre, costo_fabrica, descripcion, observaciones, modelo_original AS modeloOriginal, coincidencia_modelo AS coincidenciaModelo, fuente, descuento_tipo, descuento_valor, fabrica FROM solicitudes $FILTRO
      ORDER BY cotizacion_id, orden`);
    const referencias = hijos<ReferenciaItem & { cotizacion_id: string; item_orden: number }>(`
      SELECT cotizacion_id, item_orden, archivo, nombre, tipo, tamano, fecha FROM referencias_item $FILTRO
      ORDER BY cotizacion_id, item_orden, orden`);
    const incompletos = hijos<{
      cotizacion_id: string;
      indice: number;
      rechazo_json: string;
      pregunta: string;
    }>(`
      SELECT cotizacion_id, indice, rechazo_json, pregunta FROM incompletos $FILTRO ORDER BY cotizacion_id, indice`);
    const historial = hijos<Mensaje & { cotizacion_id: string }>(`
      SELECT cotizacion_id, rol, texto FROM historial $FILTRO ORDER BY cotizacion_id, orden`);
    const montos = hijos<FilaMontos>(`SELECT * FROM cotizacion_montos $FILTRO`);
    const lineas = hijos<FilaLinea>(`SELECT * FROM cotizacion_lineas $FILTRO ORDER BY cotizacion_id, orden`);
    const notas = hijos<FilaNota>(`SELECT * FROM notas_pedido $FILTRO`);
    const lineasNota = hijos<FilaLinea>(`SELECT * FROM nota_lineas $FILTRO ORDER BY cotizacion_id, orden`);
    // Los pagos del mismo día salen en el orden en que se registraron (rowid), no en el de su id aleatorio.
    const pagos = hijos<FilaPago>(`SELECT cotizacion_id, id, fecha, monto, observacion, usuario FROM pagos $FILTRO ORDER BY fecha, rowid`);
    const comentarios = hijos<FilaComentario>(`SELECT cotizacion_id, id, fecha, texto, usuario FROM comentarios_internos $FILTRO ORDER BY fecha, id`);

    const resultado: Cotizacion[] = [];
    for (const f of filas) {
      try {
        const m = montos.get(f.id)?.[0];
        if (!m) throw new Error('faltan los montos guardados');
        const referenciasPorItem = new Map<number, ReferenciaItem[]>();
        for (const { item_orden, archivo, nombre, tipo, tamano, fecha } of referencias.get(f.id) ?? [])
          referenciasPorItem.set(item_orden, [
            ...(referenciasPorItem.get(item_orden) ?? []),
            { archivo, nombre, tipo, tamano, fecha },
          ]);
        const reparadas = (solicitudes.get(f.id) ?? []).map((fila, orden): SolicitudItem => {
          const s: SolicitudItem = {
            modelo: fila.modelo,
            madera: fila.madera,
            ancho: fila.ancho,
            alto: fila.alto,
            medida: fila.medida,
            cantidad: fila.cantidad,
            tipoMedida: fila.tipoMedida,
            ...(fila.medida_por_defecto === 1 ? { medidaPorDefecto: true } : {}),
            descripcion: fila.descripcion,
            observaciones: fila.observaciones,
            margen: fila.margen,
            modeloOriginal: fila.modeloOriginal,
            coincidenciaModelo: fila.coincidenciaModelo,
            fuente: fila.fuente ?? null,
            ...(fila.item_libre
              ? { personalizado: { familia: 'OTRO' as const } }
              : fila.familia_personalizada
                ? { personalizado: { familia: fila.familia_personalizada } }
                : {}),
            ...(fila.familia_personalizada && fila.costo_fabrica !== null ? { costoFabrica: fila.costo_fabrica } : {}),
            ...(referenciasPorItem.has(orden) ? { referencias: referenciasPorItem.get(orden) } : {}),
            ...(fila.descuento_tipo && fila.descuento_valor !== null
              ? { descuento: { tipo: fila.descuento_tipo, valor: fila.descuento_valor } }
              : {}),
            ...(fila.fabrica ? { fabrica: fila.fabrica } : {}),
          };
          if (fila.precio_unitario !== null) s.precioUnitario = fila.precio_unitario;
          if (s.cantidad === null || cantidadValida(s.cantidad)) return s;
          registrarError('almacen', `Cantidad inválida ${s.cantidad} reparada como pendiente en ${f.id}.`);
          return { ...s, cantidad: null };
        });
        const reglas = reglasDesdeJson(f.reglas_json);
        const q: Cotizacion = {
          id: f.id,
          numero: f.numero,
          estado: f.estado,
          cliente: {
            nombre: f.cliente_nombre,
            rut: f.cliente_rut,
            giro: f.cliente_giro,
            telefono: f.cliente_telefono,
            direccion: f.cliente_direccion,
            comuna: f.cliente_comuna,
            proyecto: f.cliente_proyecto,
          },
          solicitudes: reparadas,
          montos: {
            lineas: (lineas.get(f.id) ?? []).map(lineaDesdeFila),
            subtotal: m.subtotal ?? m.neto,
            descuentoPorcentaje: m.descuento_porcentaje,
            descuento: m.descuento,
            flete: m.flete,
            neto: m.neto,
            iva: m.iva,
            total: m.total,
          },
          incompletos: (incompletos.get(f.id) ?? []).map((i) => ({
            indice: i.indice,
            rechazo: JSON.parse(i.rechazo_json) as Rechazo,
            pregunta: i.pregunta,
          })),
          historial: (historial.get(f.id) ?? []).map((h) => ({ rol: h.rol, texto: h.texto })),
          creada: f.creada,
          actualizada: f.actualizada,
          pdf: f.pdf,
          vence: f.vence ?? (f.fecha_emision ? calcularVence(f.fecha_emision, reglas.vigenciaDiasHabiles) : null),
          descuento: f.descuento,
          descuentoManual: !!f.descuento_manual,
          flete: f.flete,
          fleteDescripcion: f.flete_descripcion ?? null,
          fleteCantidad: f.flete_cantidad ?? 1,
          margenCotizacion: f.margen_cotizacion ?? null,
          observaciones: f.observaciones ?? null,
          despacho:
            f.despacho_direccion || f.despacho_transporte || f.despacho_entrega || f.despacho_destino || f.despacho_valor !== null
              ? {
                  direccion: f.despacho_direccion,
                  transporte: f.despacho_transporte,
                  entregaComprometida: f.despacho_entrega,
                  destino: f.despacho_destino,
                  valor: f.despacho_valor,
                }
              : null,
          reglas: reglasDesdeJson(f.reglas_json),
          creadaPor: f.creada_por,
          emitidaPor: f.emitida_por,
          aprobadaPor: f.aprobada_por,
          anuladaPor: f.anulada_por,
          fechaAnulacion: f.fecha_anulacion,
          motivoAnulacion: f.motivo_anulacion,
          reemplazadaPor: f.reemplazada_por,
          versionCatalogo: f.version_catalogo,
          notas: [],
          estadoComercial: estadoComercialGuardado(f.estado, f.estado_comercial),
          estadoOperativo: (leerEstadoOperativo(f.estado_operativo) as EstadoOperativo | null) ?? (f.estado === 'aprobada' ? 'pedido_generado' : 'sin_pedido'),
          pagos: pagos.get(f.id) ?? [],
          comentariosInternos: comentarios.get(f.id) ?? [],
          facturacion: {
            estado: f.facturacion_estado,
            tipo: f.facturacion_tipo,
            identificadorExterno: f.facturacion_id_externo,
            fecha: f.facturacion_fecha,
          },
        };
        if (!f.fecha_emision_ausente) q.fechaEmision = f.fecha_emision;
        if (f.fecha_aprobacion) q.fechaAprobacion = f.fecha_aprobacion;
        if (!f.origen_ausente) q.origen = f.origen_id ? f.origen_numero : null;
        const lineasDeNotas = lineasNota.get(f.id) ?? [];
        q.notas = ordenarNotas(
          (notas.get(f.id) ?? []).map((n) => {
            const ls = lineasDeNotas.filter((l) => (l.fabrica ?? null) === n.fabrica).map(lineaDesdeFila);
            const subtotal = ls.reduce((s, l) => s + l.total, 0);
            return {
              numero: n.numero,
              ...(n.fabrica !== null && { fabrica: n.fabrica }),
              pdf: n.pdf,
              fecha: n.fecha,
              montos: {
                lineas: ls,
                subtotal,
                descuentoPorcentaje: 0,
                descuento: 0,
                flete: 0,
                neto: n.neto,
                iva: n.iva,
                total: n.total,
              },
              despacho: {
                direccion: n.despacho_direccion,
                transporte: n.despacho_transporte,
                entregaComprometida: n.despacho_entrega,
                // Solo si existen: una nota anterior a v22 (o migrada desde JSON) no trae estas claves.
                ...(n.despacho_destino !== null && { destino: n.despacho_destino }),
                ...(n.despacho_valor !== null && { valor: n.despacho_valor }),
              },
              observaciones: n.observaciones ?? null,
              anulada: !!n.anulada,
              inicioProduccion: n.inicio_produccion,
              terminoProduccion: n.termino_produccion,
            };
          }),
        );
        const valida = cotizacionSchema.safeParse(q);
        if (!valida.success) throw new Error(valida.error.issues.map((i) => i.path.join('.')).join(', '));
        resultado.push(q);
      } catch (error) {
        registrarError(
          'almacen',
          `Cotización ${f.id} omitida por datos inválidos: ${(error as Error).message}`,
        );
      }
    }
    return resultado;
  })();
}

/** null si no existe; si existe pero no pasa la validación, error explícito (solo esa cotización). */
function cargarUna(db: Database.Database, id: string): Cotizacion | null {
  const q = cargar(db, [id])[0];
  if (q) return q;
  if (db.prepare('SELECT 1 FROM cotizaciones WHERE id = ?').get(id)) throw new ErrorCotizacionDanada();
  return null;
}

/**
 * Inserta las líneas de unos montos. Las de una nota de pedido (`nota`) llevan su fábrica y siguen el orden desde
 * `nota.desde`: todas las notas de una cotización comparten la numeración de `nota_lineas`.
 */
function insertarLineas(
  db: Database.Database,
  tabla: 'cotizacion_lineas' | 'nota_lineas',
  id: string,
  montos: Montos,
  nota?: { fabrica: Fabrica | null; desde: number },
) {
  const insertar = db.prepare(`
    INSERT INTO ${tabla} (
      cotizacion_id, orden, codigo, modelo, familia, tipo, madera, medida, ancho_min, ancho_max, alto_min, alto_max,
      largo, precio_neto, descripcion, fila_origen, cantidad, precio_unitario, total,
      indice, ancho_solicitado, alto_solicitado, medida_solicitada, precio_unitario_personalizado,
      precio_fabrica, margen, margen_personalizado, precio_cliente, tipo_medida, observaciones, descripcion_documento,
      descuento_tipo, descuento_valor, descuento_unitario${nota ? ', fabrica' : ''}
    ) VALUES (
      @cotizacion_id, @orden, @codigo, @modelo, @familia, @tipo, @madera, @medida,
      @ancho_min, @ancho_max, @alto_min, @alto_max, @largo, @precio_neto, @descripcion, @fila_origen,
      @cantidad, @precio_unitario, @total, @indice, @ancho_solicitado, @alto_solicitado, @medida_solicitada,
      @precio_unitario_personalizado, @precio_fabrica, @margen, @margen_personalizado, @precio_cliente, @tipo_medida, @observaciones, @descripcion_documento,
      @descuento_tipo, @descuento_valor, @descuento_unitario${nota ? ', @fabrica' : ''}
    )
  `);
  montos.lineas.forEach((l, orden) =>
    insertar.run({
      cotizacion_id: id,
      orden: orden + (nota?.desde ?? 0),
      ...(nota ? { fabrica: nota.fabrica } : {}),
      codigo: l.producto.codigo,
      modelo: l.producto.modelo,
      familia: l.producto.familia,
      tipo: l.producto.tipo,
      madera: l.producto.madera,
      medida: l.producto.medida,
      ancho_min: l.producto.anchoMin,
      ancho_max: l.producto.anchoMax,
      alto_min: l.producto.altoMin ?? null,
      alto_max: l.producto.altoMax ?? null,
      largo: l.producto.largo,
      precio_neto: l.producto.precioNeto,
      descripcion: l.producto.descripcion,
      fila_origen: l.producto.filaOrigen,
      cantidad: l.cantidad,
      precio_unitario: l.precioUnitario,
      total: l.total,
      indice: l.indice,
      ancho_solicitado: l.anchoSolicitado,
      alto_solicitado: l.altoSolicitado,
      medida_solicitada: l.medidaSolicitada,
      precio_unitario_personalizado: l.precioUnitarioPersonalizado,
      precio_fabrica: l.precioFabrica ?? l.producto.precioNeto,
      margen: l.margen ?? (l.producto.precioNeto > 0 ? l.precioUnitario / l.producto.precioNeto - 1 : 0),
      margen_personalizado: Number(!!l.margenPersonalizado),
      precio_cliente: l.precioCliente ?? l.precioUnitario,
      tipo_medida: l.tipoMedida ?? null,
      observaciones: l.observaciones ?? null,
      descripcion_documento: l.descripcionDocumento ?? null,
      descuento_tipo: l.descuentoItem?.tipo ?? null,
      descuento_valor: l.descuentoItem?.valor ?? null,
      descuento_unitario: l.descuentoItem ? (l.descuentoUnitario ?? 0) : null,
    }),
  );
}

/** Escribe una cotización y reemplaza sus filas hijas. Valida antes de tocar la base. */
function persistirCotizacion(db: Database.Database, q: Cotizacion) {
  const valida = cotizacionSchema.safeParse(q);
  if (!valida.success)
    throw new Error(
      `La cotización ${q.id} no cumple el esquema (${valida.error.issues.map((i) => i.path.join('.')).join(', ')}); no se guardó.`,
    );
  const origenAusente = !Object.hasOwn(q, 'origen');
  const fechaAusente = !Object.hasOwn(q, 'fechaEmision');
  const origen =
    q.origen == null
      ? undefined
      : (db.prepare('SELECT id FROM cotizaciones WHERE numero = ?').get(q.origen) as
          { id: string } | undefined);
  if (q.origen != null && !origen)
    throw new Error(`La cotización de origen ${q.origen} no existe en la base.`);
  const existente = db.prepare('SELECT orden FROM cotizaciones WHERE id = ?').get(q.id) as
    { orden: number } | undefined;
  const orden =
    existente?.orden ??
    (db.prepare('SELECT COALESCE(MAX(orden) + 1, 0) AS n FROM cotizaciones').get() as { n: number }).n;

  db.prepare(
    `
    INSERT INTO cotizaciones (
      id, orden, numero, estado, cliente_nombre, cliente_nombre_normalizado, cliente_rut, cliente_giro,
      cliente_telefono, cliente_direccion, cliente_comuna, cliente_comuna_normalizada,
      cliente_proyecto, cliente_proyecto_normalizado, creada, actualizada, pdf, fecha_emision,
      fecha_emision_ausente, origen_id, origen_ausente, vence, descuento, descuento_manual, flete, flete_descripcion, flete_cantidad, margen_cotizacion, creada_por, emitida_por,
      aprobada_por, anulada_por, fecha_anulacion, motivo_anulacion, reemplazada_por, version_catalogo, busqueda,
      observaciones, despacho_direccion, despacho_transporte, despacho_entrega, reglas_json,
      estado_comercial, estado_operativo, despacho_destino, despacho_valor,
      facturacion_estado, facturacion_tipo, facturacion_id_externo, facturacion_fecha, fecha_aprobacion
    ) VALUES (
      @id, @orden, @numero, @estado, @cliente_nombre, @cliente_nombre_normalizado, @cliente_rut, @cliente_giro,
      @cliente_telefono, @cliente_direccion, @cliente_comuna, @cliente_comuna_normalizada,
      @cliente_proyecto, @cliente_proyecto_normalizado, @creada, @actualizada, @pdf, @fecha_emision,
      @fecha_emision_ausente, @origen_id, @origen_ausente, @vence, @descuento, @descuento_manual, @flete, @flete_descripcion, @flete_cantidad, @margen_cotizacion, @creada_por, @emitida_por,
      @aprobada_por, @anulada_por, @fecha_anulacion, @motivo_anulacion, @reemplazada_por, @version_catalogo, @busqueda,
      @observaciones, @despacho_direccion, @despacho_transporte, @despacho_entrega, @reglas_json,
      @estado_comercial, @estado_operativo, @despacho_destino, @despacho_valor,
      @facturacion_estado, @facturacion_tipo, @facturacion_id_externo, @facturacion_fecha, @fecha_aprobacion
    ) ON CONFLICT(id) DO UPDATE SET
      numero = excluded.numero,
      estado = excluded.estado,
      cliente_nombre = excluded.cliente_nombre,
      cliente_nombre_normalizado = excluded.cliente_nombre_normalizado,
      cliente_rut = excluded.cliente_rut,
      cliente_giro = excluded.cliente_giro,
      cliente_telefono = excluded.cliente_telefono,
      cliente_direccion = excluded.cliente_direccion,
      cliente_comuna = excluded.cliente_comuna,
      cliente_comuna_normalizada = excluded.cliente_comuna_normalizada,
      cliente_proyecto = excluded.cliente_proyecto,
      cliente_proyecto_normalizado = excluded.cliente_proyecto_normalizado,
      creada = excluded.creada,
      actualizada = excluded.actualizada,
      pdf = excluded.pdf,
      fecha_emision = excluded.fecha_emision,
      fecha_emision_ausente = excluded.fecha_emision_ausente,
      origen_id = excluded.origen_id,
      origen_ausente = excluded.origen_ausente,
      vence = excluded.vence,
      descuento = excluded.descuento,
      descuento_manual = excluded.descuento_manual,
      flete = excluded.flete,
      flete_descripcion = excluded.flete_descripcion,
      flete_cantidad = excluded.flete_cantidad,
      margen_cotizacion = excluded.margen_cotizacion,
      creada_por = excluded.creada_por,
      emitida_por = excluded.emitida_por,
      aprobada_por = excluded.aprobada_por,
      anulada_por = excluded.anulada_por,
      fecha_anulacion = excluded.fecha_anulacion,
      motivo_anulacion = excluded.motivo_anulacion,
      reemplazada_por = excluded.reemplazada_por,
      version_catalogo = excluded.version_catalogo,
      busqueda = excluded.busqueda,
      observaciones = excluded.observaciones,
      despacho_direccion = excluded.despacho_direccion,
      despacho_transporte = excluded.despacho_transporte,
      despacho_entrega = excluded.despacho_entrega,
      reglas_json = excluded.reglas_json,
      estado_comercial = excluded.estado_comercial,
      estado_operativo = excluded.estado_operativo,
      despacho_destino = excluded.despacho_destino,
      despacho_valor = excluded.despacho_valor,
      facturacion_estado = excluded.facturacion_estado,
      facturacion_tipo = excluded.facturacion_tipo,
      facturacion_id_externo = excluded.facturacion_id_externo,
      facturacion_fecha = excluded.facturacion_fecha,
      fecha_aprobacion = excluded.fecha_aprobacion
  `,
  ).run({
    id: q.id,
    orden,
    numero: q.numero,
    estado: q.estado,
    cliente_nombre: q.cliente.nombre,
    cliente_nombre_normalizado: normalizarTexto(q.cliente.nombre),
    cliente_rut: q.cliente.rut,
    cliente_giro: q.cliente.giro,
    cliente_telefono: q.cliente.telefono,
    cliente_direccion: q.cliente.direccion,
    cliente_comuna: q.cliente.comuna,
    cliente_comuna_normalizada: normalizarTexto(q.cliente.comuna),
    cliente_proyecto: q.cliente.proyecto,
    cliente_proyecto_normalizado: normalizarTexto(q.cliente.proyecto),
    creada: q.creada,
    actualizada: q.actualizada,
    pdf: q.pdf,
    fecha_emision: q.fechaEmision ?? null,
    fecha_emision_ausente: Number(fechaAusente),
    origen_id: origen?.id ?? null,
    origen_ausente: Number(origenAusente),
    vence: q.vence,
    descuento: q.descuento,
    // Sin el dato (estado anterior al descuento automático) lo que ya había fue fijado por una persona.
    descuento_manual: Number(descuentoEsManual(q)),
    flete: q.flete,
    flete_descripcion: q.fleteDescripcion ?? null,
    flete_cantidad: cantidadFlete(q),
    margen_cotizacion: q.margenCotizacion ?? null,
    creada_por: q.creadaPor,
    emitida_por: q.emitidaPor,
    aprobada_por: q.aprobadaPor,
    anulada_por: q.anuladaPor,
    fecha_anulacion: q.fechaAnulacion,
    motivo_anulacion: q.motivoAnulacion,
    reemplazada_por: q.reemplazadaPor,
    version_catalogo: q.versionCatalogo,
    observaciones: q.observaciones ?? null,
    despacho_direccion: q.despacho?.direccion ?? null,
    despacho_transporte: q.despacho?.transporte ?? null,
    despacho_entrega: q.despacho?.entregaComprometida ?? null,
    estado_comercial: q.estadoComercial ?? (q.estado === 'aprobada' ? 'aprobada' : q.estado === 'emitida' ? 'enviada' : 'pendiente'),
    estado_operativo: operacionDe(q),
    despacho_destino: q.despacho?.destino ?? null,
    despacho_valor: q.despacho ? q.despacho.valor ?? q.flete : null,
    facturacion_estado: q.facturacion?.estado ?? 'pendiente',
    facturacion_tipo: q.facturacion?.tipo ?? null,
    facturacion_id_externo: q.facturacion?.identificadorExterno ?? null,
    facturacion_fecha: q.facturacion?.fecha ?? null,
    fecha_aprobacion: q.fechaAprobacion ?? null,
    reglas_json: JSON.stringify(q.reglas ?? REGLAS),
    busqueda: textoBusqueda({
      numero: q.numero,
      cliente: q.cliente,
      productos: [
        ...q.solicitudes.flatMap((s) => [s.modelo, s.madera]),
        ...q.montos.lineas.flatMap((l) => [l.producto.modelo, l.producto.madera]),
      ],
    }),
  });

  for (const tabla of [
    'solicitudes',
    'referencias_item',
    'incompletos',
    'historial',
    'cotizacion_montos',
    'cotizacion_lineas',
    'notas_pedido',
    'nota_lineas',
    'pagos',
    'comentarios_internos',
  ])
    db.prepare(`DELETE FROM ${tabla} WHERE cotizacion_id = ?`).run(q.id);

  const insSolicitud = db.prepare(`
    INSERT INTO solicitudes (cotizacion_id, orden, modelo, madera, ancho, alto, medida, cantidad, precio_unitario, margen, tipo_medida, medida_por_defecto, familia_personalizada, item_libre, costo_fabrica, descripcion, observaciones, modelo_original, coincidencia_modelo, fuente, descuento_tipo, descuento_valor, fabrica)
    VALUES (@cotizacion_id, @orden, @modelo, @madera, @ancho, @alto, @medida, @cantidad, @precio_unitario, @margen, @tipo_medida, @medida_por_defecto, @familia_personalizada, @item_libre, @costo_fabrica, @descripcion, @observaciones, @modelo_original, @coincidencia_modelo, @fuente, @descuento_tipo, @descuento_valor, @fabrica)
  `);
  const insReferencia = db.prepare(`
    INSERT INTO referencias_item (cotizacion_id, item_orden, orden, archivo, nombre, tipo, tamano, fecha)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  q.solicitudes.forEach((s, i) =>
    insSolicitud.run({
      cotizacion_id: q.id,
      orden: i,
      modelo: s.modelo,
      madera: s.madera,
      ancho: s.ancho,
      alto: s.alto,
      medida: s.medida,
      cantidad: s.cantidad,
      precio_unitario: s.precioUnitario ?? null,
      margen: s.margen ?? null,
      tipo_medida: s.tipoMedida ?? null,
      medida_por_defecto: s.medidaPorDefecto ? 1 : 0,
      familia_personalizada: esLibre(s) ? null : (s.personalizado?.familia ?? null),
      item_libre: esLibre(s) ? 1 : 0,
      costo_fabrica: s.personalizado && !esLibre(s) ? (s.costoFabrica ?? null) : null,
      descripcion: s.descripcion ?? null,
      observaciones: s.observaciones ?? null,
      modelo_original: s.modeloOriginal ?? null,
      coincidencia_modelo: s.coincidenciaModelo ?? null,
      fuente: s.fuente ?? null,
      descuento_tipo: s.descuento?.tipo ?? null,
      descuento_valor: s.descuento?.valor ?? null,
      fabrica: s.fabrica ?? null,
    }),
  );
  q.solicitudes.forEach((s, i) =>
    s.referencias?.forEach((r, orden) =>
      insReferencia.run(q.id, i, orden, r.archivo, r.nombre, r.tipo, r.tamano, r.fecha),
    ),
  );
  const insIncompleto = db.prepare(
    'INSERT INTO incompletos (cotizacion_id, indice, rechazo_json, pregunta) VALUES (?, ?, ?, ?)',
  );
  q.incompletos.forEach((i) => insIncompleto.run(q.id, i.indice, JSON.stringify(i.rechazo), i.pregunta));
  const insMensaje = db.prepare(
    'INSERT INTO historial (cotizacion_id, orden, rol, texto) VALUES (?, ?, ?, ?)',
  );
  q.historial.forEach((m, i) => insMensaje.run(q.id, i, m.rol, m.texto));
  const insPago = db.prepare('INSERT INTO pagos (id, cotizacion_id, fecha, monto, observacion, usuario) VALUES (?, ?, ?, ?, ?, ?)');
  for (const pago of q.pagos ?? [])
    insPago.run(pago.id, q.id, pago.fecha, pago.monto, pago.observacion, pago.usuario);
  const insComentario = db.prepare('INSERT INTO comentarios_internos (id, cotizacion_id, fecha, texto, usuario) VALUES (?, ?, ?, ?, ?)');
  for (const comentario of q.comentariosInternos ?? [])
    insComentario.run(comentario.id, q.id, comentario.fecha, comentario.texto, comentario.usuario);
  db.prepare(
    `
    INSERT INTO cotizacion_montos (cotizacion_id, neto, iva, total, subtotal, descuento_porcentaje, descuento, flete)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    q.id,
    q.montos.neto,
    q.montos.iva,
    q.montos.total,
    q.montos.subtotal,
    q.montos.descuentoPorcentaje,
    q.montos.descuento,
    q.montos.flete,
  );
  insertarLineas(db, 'cotizacion_lineas', q.id, q.montos);
  const insNota = db.prepare(
    `
    INSERT INTO notas_pedido (
      cotizacion_id, fabrica, numero, pdf, fecha, neto, iva, total, despacho_direccion, despacho_transporte,
      despacho_entrega, observaciones, anulada, despacho_destino, despacho_valor, inicio_produccion, termino_produccion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  );
  let desde = 0;
  for (const nota of q.notas) {
    insNota.run(
      q.id,
      nota.fabrica ?? null,
      nota.numero,
      nota.pdf,
      nota.fecha,
      nota.montos.neto,
      nota.montos.iva,
      nota.montos.total,
      nota.despacho.direccion,
      nota.despacho.transporte,
      nota.despacho.entregaComprometida,
      nota.observaciones,
      Number(nota.anulada),
      nota.despacho.destino ?? null,
      nota.despacho.valor ?? null,
      nota.inicioProduccion ?? null,
      nota.terminoProduccion ?? null,
    );
    insertarLineas(db, 'nota_lineas', q.id, nota.montos, { fabrica: nota.fabrica ?? null, desde });
    desde += nota.montos.lineas.length;
  }
}

/** Solo para la migración desde JSON: reemplaza todas las cotizaciones y los correlativos. */
export function guardarEstadoCompleto(db: Database.Database, estado: Estado) {
  const parsed = estadoPersistidoSchema.safeParse(estado);
  if (!parsed.success) throw new Error('El estado JSON no tiene una estructura válida.');
  db.transaction(() => {
    db.prepare('DELETE FROM cotizaciones').run();
    db.prepare('UPDATE correlativos SET siguiente_cotizacion = ?, siguiente_nota = ? WHERE id = 1').run(
      estado.siguienteCotizacion,
      estado.siguienteNota,
    );
    // Las validadas: una cotización del JSON con la `nota` única de antes llega convertida a `notas`.
    for (const q of parsed.data.cotizaciones) persistirCotizacion(db, q as Cotizacion);
  }).immediate();
}

/** Cuánto puede saltar un número de cotización elegido a mano sobre el último usado o reservado. */
const SALTO_MAXIMO_NUMERO = 1000;
/** Días que un borrador eliminado queda en la papelera antes de que `limpiar-borradores` lo borre (su `--dias`). */
export const DIAS_PAPELERA = 30;

/**
 * Último número de cotización usado o reservado (el mayor entre el correlativo y los guardados): un número a mano
 * debe ser mayor que él y no superarlo en más de `SALTO_MAXIMO_NUMERO`.
 */
function numeracionCotizacion(db: Database.Database) {
  const correlativo = db.prepare('SELECT siguiente_cotizacion FROM correlativos WHERE id = 1').get() as
    | { siguiente_cotizacion: number }
    | undefined;
  if (!correlativo) throw new Error('Faltan los correlativos en la base SQLite.');
  const maximo = (db.prepare('SELECT COALESCE(MAX(numero), 0) AS n FROM cotizaciones').get() as { n: number }).n;
  return { siguiente_cotizacion: correlativo.siguiente_cotizacion, ultimo: Math.max(maximo, correlativo.siguiente_cotizacion - 1) };
}

/** Correlativo de notas de una fábrica y el mayor número que ya usa (0 si ninguno). */
function numeracionNota(db: Database.Database, fabrica: Fabrica) {
  const fila = db
    .prepare(
      'SELECT siguiente, (SELECT COALESCE(MAX(numero), 0) FROM notas_pedido WHERE fabrica = ?) AS ultimo FROM correlativos_nota WHERE fabrica = ?',
    )
    .get(fabrica, fabrica) as { siguiente: number; ultimo: number } | undefined;
  if (!fila) throw new Error(`Falta el correlativo de notas de ${nombreFabrica[fabrica]} en la base SQLite.`);
  return fila;
}

function correlativos(db: Database.Database) {
  const fila = db
    .prepare('SELECT siguiente_cotizacion, siguiente_nota FROM correlativos WHERE id = 1')
    .get() as { siguiente_cotizacion: number; siguiente_nota: number } | undefined;
  if (!fila) throw new Error('Faltan los correlativos en la base SQLite.');
  return { siguienteCotizacion: fila.siguiente_cotizacion, siguienteNota: fila.siguiente_nota };
}

/** Lectura completa: la usan la migración y las pruebas. La aplicación lee por cotización. */
export function leerEstadoDeBase(db: Database.Database): Estado {
  return db.transaction(() => ({ ...correlativos(db), cotizaciones: cargar(db, null) }))();
}

/**
 * Unidad de trabajo dentro del bloqueo: carga solo las cotizaciones que usa la operación y las
 * escribe juntas al confirmar, en una transacción SQLite. Los correlativos se reservan al instante
 * (UPDATE … RETURNING) para que un fallo posterior deje un salto, nunca un número reutilizado.
 */
export class Unidad {
  private cache = new Map<string, Cotizacion>();
  private versiones = new Map<string, string | null>();
  private restauradas = new Set<string>();
  restaurarBorrador(id: string, version: string) {
    const fila = this.db.prepare("SELECT contenido FROM papelera WHERE tipo = 'borrador' AND id = ?").get(id) as { contenido: string } | undefined;
    if (!fila) throw new ErrorUsuario('No se encontró el borrador en la papelera.', 'no_encontrada', 404);
    const contenido = JSON.parse(fila.contenido) as { eventos?: unknown };
    const q = cotizacionSchema.parse(contenido) as Cotizacion;
    if (q.actualizada !== version || this.obtener(id)) throw new ErrorConflicto('El borrador cambió. Recarga la papelera.');
    q.actualizada = new Date(Math.max(Date.now(), Date.parse(q.actualizada) + 1)).toISOString();
    // La actividad anterior vuelve con el borrador, antes de lo que registre la restauración. Una entrada
    // ilegible se omite: no impide restaurar.
    const guardados = Array.isArray(contenido.eventos) ? (contenido.eventos as Partial<EventoCotizacion>[]) : [];
    for (const e of guardados)
      if (typeof e?.fecha === 'string' && typeof e.tipo === 'string')
        this.eventos.push({ id, fecha: e.fecha, tipo: e.tipo as TipoEvento, usuario: e.usuario ?? null, detalle: e.detalle ?? null });
    this.restauradas.add(id); this.guardar(q); return q;
  }
  private documentos: { id: string; archivo: string; html: string }[] = [];
  guardarDocumento(id: string, archivo: string, html: string) { this.documentos.push({ id, archivo, html }); }
  private integracion: Encolable[] = [];
  /** Un envío a la fábrica (integracion-bandeja.ts): se guarda al confirmar, en la misma transacción que la cotización. */
  encolarIntegracion(item: Encolable) { this.integracion.push(item); }
  /** Se encoló algo al confirmar: quien llama despierta el envío. */
  encoladosIntegracion = 0;
  private sucias = new Set<string>();
  private eliminadas = new Set<string>();
  private eventos: (EventoCotizacion & { id: string })[] = [];
  constructor(private db: Database.Database) {}

  /** Fecha del último evento `tipo` ya guardado de una cotización; null si no hay. */
  fechaEvento(id: string, tipo: TipoEvento): string | null {
    const fila = this.db
      .prepare('SELECT fecha FROM eventos WHERE cotizacion_id = ? AND tipo = ? ORDER BY id DESC LIMIT 1')
      .get(id, tipo) as { fecha: string } | undefined;
    return fila?.fecha ?? null;
  }

  /**
   * Marca la cotización «en emisión» de `documento` hasta que se libere (`Almacen.liberarEmision`) o venza. Se
   * toma en la misma transacción que reserva el número: una segunda emisión simultánea responde 409 sin gastar
   * otro número. Devuelve la ficha que libera solo esta marca.
   */
  private marcarEmision(id: string, documento: 'cotizacion' | 'nota') {
    const ahora = Date.now();
    this.db.prepare('DELETE FROM emisiones_en_curso WHERE vence <= ?').run(new Date(ahora).toISOString());
    if (this.db.prepare('SELECT 1 FROM emisiones_en_curso WHERE cotizacion_id = ?').get(id))
      throw new ErrorConflicto(
        documento === 'nota'
          ? 'Ya se está generando la nota de pedido de esta cotización. Espera unos segundos y recarga.'
          : 'Ya se está generando el PDF de esta cotización. Espera unos segundos y recarga.',
        'ocupado',
      );
    const ficha = randomUUID();
    this.db
      .prepare('INSERT INTO emisiones_en_curso (cotizacion_id, documento, ficha, vence) VALUES (?, ?, ?, ?)')
      .run(id, documento, ficha, new Date(ahora + EMISION_VIGENTE_MS).toISOString());
    return ficha;
  }

  /** Anota una entrada del registro de actividad; se escribe al confirmar, junto con la cotización. */
  registrarEvento(id: string, tipo: TipoEvento, usuario: string | null, detalle: string | null = null) {
    this.eventos.push({ id, tipo, usuario, detalle, fecha: new Date().toISOString() });
  }

  obtener(id: string): Cotizacion | null {
    if (this.eliminadas.has(id)) return null;
    const enCache = this.cache.get(id);
    if (enCache) return enCache;
    const q = cargarUna(this.db, id);
    this.versiones.set(id, q?.actualizada ?? null);
    if (q) this.cache.set(id, q);
    return q;
  }

  porNumero(numero: number): Cotizacion | null {
    for (const q of this.cache.values()) if (q.numero === numero) return q;
    const fila = this.db.prepare('SELECT id FROM cotizaciones WHERE numero = ?').get(numero) as
      { id: string } | undefined;
    return fila ? this.obtener(fila.id) : null;
  }

  /** Borrador de revisión abierto para una emitida; a lo más se mantiene uno por original. */
  revisionAbierta(original: Cotizacion): Cotizacion | null {
    if (original.numero === null) return null;
    for (const q of this.cache.values())
      if (q.estado === 'borrador' && q.origen === original.numero && !this.eliminadas.has(q.id)) return q;
    const fila = this.db
      .prepare(
        `
        SELECT id FROM cotizaciones WHERE origen_id = ? AND estado = 'borrador' AND numero IS NULL
        ORDER BY orden DESC LIMIT 1
      `,
      )
      .get(original.id) as { id: string } | undefined;
    return fila ? this.obtener(fila.id) : null;
  }

  /** Todas las cotizaciones de la misma serie (original y revisiones encadenadas por origen). */
  serie(id: string): Cotizacion[] {
    const ids = this.db
      .prepare(
        `
        WITH RECURSIVE
          arriba(id, origen_id) AS (
            SELECT id, origen_id FROM cotizaciones WHERE id = ?
            UNION SELECT c.id, c.origen_id FROM cotizaciones c JOIN arriba a ON c.id = a.origen_id
          ),
          abajo(id) AS (
            SELECT id FROM arriba WHERE origen_id IS NULL
            UNION SELECT c.id FROM cotizaciones c JOIN abajo b ON c.origen_id = b.id
          )
        SELECT id FROM abajo
      `,
      )
      .all(id) as { id: string }[];
    const miembros = new Map<string, Cotizacion>();
    for (const i of [id, ...ids.map((f) => f.id)]) {
      const q = this.obtener(i);
      if (q) miembros.set(q.id, q);
    }
    // Revisiones creadas en esta unidad y todavía no escritas.
    const numeros = new Set([...miembros.values()].map((q) => q.numero).filter((n) => n !== null));
    for (const q of this.cache.values()) if (q.origen != null && numeros.has(q.origen)) miembros.set(q.id, q);
    return [...miembros.values()];
  }

  guardar(q: Cotizacion) {
    if (!this.versiones.has(q.id)) this.versiones.set(q.id, (this.db.prepare('SELECT actualizada FROM cotizaciones WHERE id = ?').get(q.id) as { actualizada: string } | undefined)?.actualizada ?? null);
    this.eliminadas.delete(q.id);
    this.cache.set(q.id, q);
    this.sucias.add(q.id);
  }

  eliminar(id: string) {
    this.cache.delete(id);
    this.sucias.delete(id);
    this.eliminadas.add(id);
  }

  private reservar(columna: 'siguiente_cotizacion' | 'siguiente_nota') {
    return this.db
      .transaction(
        () =>
          (
            this.db
              .prepare(
                `UPDATE correlativos SET ${columna} = ${columna} + 1 WHERE id = 1 RETURNING ${columna} - 1 AS n`,
              )
              .get() as { n: number }
          ).n,
      )
      .immediate();
  }

  reservarCotizacion(numeroSolicitado?: number): number {
    return this.db.transaction(() => this.siguienteCotizacion(numeroSolicitado)).immediate();
  }

  /** Marca la cotización `id` «en emisión» y reserva su número, en una transacción (ver `marcarEmision`). */
  reservarCotizacionEnEmision(id: string, numeroSolicitado?: number) {
    return this.db
      .transaction(() => {
        const ficha = this.marcarEmision(id, 'cotizacion');
        return { numero: this.siguienteCotizacion(numeroSolicitado), ficha };
      })
      .immediate();
  }

  /**
   * Marca la cotización `id` «en emisión» de sus notas de pedido y reserva, en una transacción, el número de la nota
   * de cada fábrica (en el orden de `fabricas`).
   */
  reservarNotasEnEmision(id: string, fabricas: Fabrica[]) {
    return this.db
      .transaction(() => {
        const ficha = this.marcarEmision(id, 'nota');
        return { numeros: fabricas.map((f) => this.siguienteNota(f)), ficha };
      })
      .immediate();
  }

  /** Cotización dueña de la nota de pedido `numero` de `fabrica`. */
  porNota(fabrica: Fabrica, numero: number): Cotizacion | null {
    const fila = this.db
      .prepare('SELECT cotizacion_id AS id FROM notas_pedido WHERE fabrica = ? AND numero = ?')
      .get(fabrica, numero) as { id: string } | undefined;
    return fila ? this.obtener(fila.id) : null;
  }

  /**
   * Comprueba que `numero` sirva como nuevo número de la cotización `id`: entero, libre (ninguna otra lo usa) y sin
   * superar en más de `SALTO_MAXIMO_NUMERO` al último usado o reservado. Un número menor que el último sirve si nunca
   * se usó (un salto que dejó una emisión fallida).
   */
  validarNumeroCotizacion(id: string, numero: number) {
    const { ultimo } = numeracionCotizacion(this.db);
    if (!Number.isSafeInteger(numero) || numero < 1 || numero > ultimo + SALTO_MAXIMO_NUMERO)
      throw new ErrorUsuario(
        `El número de cotización debe ser un entero entre 1 y ${ultimo + SALTO_MAXIMO_NUMERO} (hasta 1.000 sobre el último usado, ${ultimo}).`,
        'numero_invalido',
      );
    const otra = this.db.prepare('SELECT id FROM cotizaciones WHERE numero = ? AND id <> ?').get(numero, id);
    if (otra) throw new ErrorConflicto(`La cotización N° ${numero} ya existe: elige un número libre.`, 'numero_usado');
  }

  /** Lo mismo que `validarNumeroCotizacion` para la nota de `fabrica`: el número es libre dentro de esa fábrica. */
  validarNumeroNota(fabrica: Fabrica, numero: number, cotizacionId: string) {
    const n = numeracionNota(this.db, fabrica);
    const ultimo = Math.max(n.ultimo, n.siguiente - 1);
    if (!Number.isSafeInteger(numero) || numero < 1 || numero > ultimo + SALTO_MAXIMO_NUMERO)
      throw new ErrorUsuario(
        `El número de nota de ${nombreFabrica[fabrica]} debe ser un entero entre 1 y ${ultimo + SALTO_MAXIMO_NUMERO} (hasta 1.000 sobre el último usado, ${ultimo}).`,
        'numero_invalido',
      );
    const otra = this.db
      .prepare('SELECT 1 FROM notas_pedido WHERE fabrica = ? AND numero = ? AND cotizacion_id <> ?')
      .get(fabrica, numero, cotizacionId);
    if (otra)
      throw new ErrorConflicto(
        `${nombreFabrica[fabrica]} ya tiene una nota de pedido N° ${numero}: elige un número libre.`,
        'numero_usado',
      );
  }

  /**
   * Tras cambiar a mano un número de cotización o de nota: si quedó en o sobre el siguiente del correlativo, este
   * sigue desde el número nuevo + 1, para que la próxima emisión no lo repita. Uno menor no mueve el correlativo.
   */
  avanzarCorrelativo(documento: { tipo: 'cotizacion' } | { tipo: 'nota'; fabrica: Fabrica }, numero: number) {
    if (documento.tipo === 'cotizacion')
      this.db
        .prepare('UPDATE correlativos SET siguiente_cotizacion = MAX(siguiente_cotizacion, ?) WHERE id = 1')
        .run(numero + 1);
    else
      this.db
        .prepare('UPDATE correlativos_nota SET siguiente = MAX(siguiente, ?) WHERE fabrica = ?')
        .run(numero + 1, documento.fabrica);
  }

  /**
   * La cotización `q` pasó del número `anterior` al actual: las que la nombran por número (`reemplazadaPor`, y el
   * `origen` de las ya cargadas en esta unidad) pasan a nombrar el nuevo. El `origen` guardado apunta por id y no
   * cambia.
   */
  renumerarReferencias(q: Cotizacion, anterior: number) {
    const ids = (
      this.db.prepare('SELECT id FROM cotizaciones WHERE reemplazada_por = ? AND id <> ?').all(anterior, q.id) as {
        id: string;
      }[]
    ).map((f) => f.id);
    for (const id of ids) {
      const otra = this.obtener(id);
      if (!otra || otra.reemplazadaPor !== anterior) continue;
      otra.reemplazadaPor = q.numero;
      otra.actualizada = new Date(Math.max(Date.now(), Date.parse(otra.actualizada) + 1)).toISOString();
      this.guardar(otra);
    }
    for (const otra of this.cache.values()) if (otra.id !== q.id && otra.origen === anterior) otra.origen = q.numero;
  }

  /** Un documento reemplazado por otro con otro nombre: su snapshot se borra al confirmar. */
  descartarDocumento(archivo: string) {
    this.descartados.push(archivo);
  }
  private descartados: string[] = [];

  private siguienteCotizacion(numeroSolicitado?: number) {
    const { siguiente_cotizacion, ultimo } = numeracionCotizacion(this.db);
    const numero = numeroSolicitado ?? ultimo + 1;
    if (!Number.isSafeInteger(numero) || numero <= ultimo || numero > ultimo + SALTO_MAXIMO_NUMERO)
      throw new ErrorConflicto(
        `El número de cotización debe ser entero y mayor que el último usado (${ultimo}) y no superar ${ultimo + SALTO_MAXIMO_NUMERO}.`,
        'numero_invalido',
      );
    this.db
      .prepare('UPDATE correlativos SET siguiente_cotizacion = ? WHERE id = 1')
      .run(Math.max(siguiente_cotizacion, numero + 1));
    return numero;
  }

  reservarNota(fabrica: Fabrica): number {
    return this.db.transaction(() => this.siguienteNota(fabrica)).immediate();
  }

  private siguienteNota(fabrica: Fabrica) {
    const { siguiente, ultimo } = numeracionNota(this.db, fabrica);
    const numero = Math.max(siguiente, ultimo + 1);
    this.db.prepare('UPDATE correlativos_nota SET siguiente = ? WHERE fabrica = ?').run(numero + 1, fabrica);
    return numero;
  }

  confirmar() {
    if (!this.sucias.size && !this.eliminadas.size && !this.eventos.length && !this.descartados.length && !this.integracion.length) return;
    this.db
      .transaction(() => {
        for (const [id, version] of this.versiones) {
          const vigente = (this.db.prepare('SELECT actualizada FROM cotizaciones WHERE id = ?').get(id) as { actualizada: string } | undefined)?.actualizada ?? null;
          if (vigente !== version) throw new ErrorConflicto('La cotización cambió durante la operación. Recarga y vuelve a intentar.');
        }
        for (const id of this.eliminadas) {
          const q = cargarUna(this.db, id);
          if (q?.estado !== 'borrador' || q.numero !== null) throw new ErrorConflicto('Solo los borradores sin número pueden ir a la papelera.', 'estado_invalido');
          // La actividad se borra en cascada con la cotización: va con ella a la papelera para restaurarla.
          const eventos = this.db
            .prepare('SELECT fecha, usuario, tipo, detalle FROM eventos WHERE cotizacion_id = ? ORDER BY id')
            .all(id) as EventoCotizacion[];
          this.db.prepare("INSERT INTO papelera VALUES ('borrador', ?, ?, ?) ON CONFLICT(tipo,id) DO UPDATE SET contenido=excluded.contenido, eliminada=excluded.eliminada").run(id, JSON.stringify({ ...q, eventos }), new Date().toISOString());
          this.db.prepare('DELETE FROM cotizaciones WHERE id = ?').run(id);
        }
        for (const id of this.restauradas) this.db.prepare("DELETE FROM papelera WHERE tipo = 'borrador' AND id = ?").run(id);
        // Primero las que ya existen o tienen número: una revisión nueva referencia a su original.
        const pendientes = [...this.sucias].map((id) => this.cache.get(id)!);
        pendientes.sort((a, b) => Number(a.origen != null) - Number(b.origen != null));
        for (const q of pendientes) persistirCotizacion(this.db, q);
        for (const archivo of this.descartados) this.db.prepare('DELETE FROM documentos_snapshot WHERE archivo = ?').run(archivo);
        for (const d of this.documentos) this.db.prepare('INSERT OR IGNORE INTO documentos_snapshot VALUES (?, ?, ?)').run(d.archivo, d.id, d.html);
        const insertar = this.db.prepare(
          'INSERT INTO eventos (cotizacion_id, fecha, usuario, tipo, detalle) VALUES (?, ?, ?, ?, ?)',
        );
        for (const e of this.eventos)
          if (!this.eliminadas.has(e.id)) insertar.run(e.id, e.fecha, e.usuario, e.tipo, e.detalle);
        for (const item of this.integracion) if (encolarEnTransaccion(this.db, item) !== null) this.encoladosIntegracion++;
      })
      .immediate();
    this.integracion = [];
    this.sucias.clear();
    this.eliminadas.clear();
    this.eventos = [];
    this.descartados = [];
  }
}

/**
 * Fecha que describe cada cotización en el listado: anulación, aprobación, emisión o, en un borrador,
 * su última edición. Ordena, agrupa y filtra con el mismo criterio que se muestra en pantalla.
 */
const FECHA_REFERENCIA =
  'COALESCE(c.fecha_anulacion, (SELECT MIN(n.fecha) FROM notas_pedido n WHERE n.cotizacion_id = c.id), c.fecha_emision, c.actualizada)';

const mapaEstados = new Set<EstadoCotizacion>(['borrador', 'emitida', 'aprobada', 'reemplazada', 'anulada']);

export class Almacen {
  public readonly directorio: string;
  private readonly rutaDb: string;

  constructor(directorio?: string, rutaDb?: string) {
    this.directorio = resolve(directorio ?? directorioDatos());
    this.rutaDb = resolve(
      rutaDb ?? (directorio ? join(this.directorio, 'cotizador.sqlite') : rutaBaseDatos()),
    );
  }

  private get db() {
    return abrirBaseDatos(this.rutaDb);
  }

  /** Conexión de esta base, para módulos que guardan datos propios (p. ej. feriados sincronizados). */
  baseDatos() {
    return this.db;
  }

  async leer(): Promise<Estado> {
    return leerEstadoDeBase(this.db);
  }

  correlativos() {
    return correlativos(this.db);
  }

  /** Próximo número de nota de pedido de cada fábrica (el que se asignará, sin reservarlo). */
  correlativosNota() {
    return Object.fromEntries(
      FABRICAS.map((f) => {
        const { siguiente, ultimo } = numeracionNota(this.db, f);
        return [f, Math.max(siguiente, ultimo + 1)];
      }),
    ) as Record<Fabrica, number>;
  }

  /**
   * Fija el próximo número de nota de una fábrica, p. ej. para seguir la numeración que ya traía en papel. Debe
   * superar al último número usado por esa fábrica: nunca se repite un número.
   */
  fijarCorrelativoNota(fabrica: Fabrica, siguiente: number) {
    this.db
      .transaction(() => {
        const { ultimo } = numeracionNota(this.db, fabrica);
        if (!Number.isSafeInteger(siguiente) || siguiente <= ultimo || siguiente < 1)
          throw new ErrorUsuario(
            `El próximo número de nota de ${nombreFabrica[fabrica]} debe ser un entero mayor que el último usado (${ultimo}).`,
          );
        this.db.prepare('UPDATE correlativos_nota SET siguiente = ? WHERE fabrica = ?').run(siguiente, fabrica);
      })
      .immediate();
  }

  /** Notas generadas antes de separar las fábricas, que todavía no tienen una asignada. */
  notasSinFabrica() {
    return this.db
      .prepare(
        `SELECT n.numero, c.numero AS cotizacion, c.cliente_nombre AS cliente, n.fecha
         FROM notas_pedido n JOIN cotizaciones c ON c.id = n.cotizacion_id
         WHERE n.fabrica IS NULL ORDER BY n.numero`,
      )
      .all() as { numero: number; cotizacion: number | null; cliente: string | null; fecha: string }[];
  }

  /**
   * Asigna la fábrica a una nota que no tiene. Su número no cambia (ni su PDF, que se generó sin fábrica), así
   * que no puede chocar con una nota de esa fábrica con el mismo número.
   */
  asignarFabricaNota(numero: number, fabrica: Fabrica) {
    this.db
      .transaction(() => {
        const nota = this.db
          .prepare('SELECT cotizacion_id FROM notas_pedido WHERE numero = ? AND fabrica IS NULL')
          .get(numero) as { cotizacion_id: string } | undefined;
        if (!nota) throw new ErrorUsuario(`No hay una nota de pedido N° ${numero} sin fábrica asignada.`);
        if (this.db.prepare('SELECT 1 FROM notas_pedido WHERE numero = ? AND fabrica = ?').get(numero, fabrica))
          throw new ErrorUsuario(`${nombreFabrica[fabrica]} ya tiene una nota de pedido N° ${numero}.`);
        this.db
          .prepare('UPDATE notas_pedido SET fabrica = ? WHERE cotizacion_id = ? AND fabrica IS NULL')
          .run(fabrica, nota.cotizacion_id);
        // Sus líneas y los ítems de la cotización (una nota de antes los llevaba todos) quedan en esa fábrica.
        this.db
          .prepare('UPDATE nota_lineas SET fabrica = ? WHERE cotizacion_id = ? AND fabrica IS NULL')
          .run(fabrica, nota.cotizacion_id);
        this.db
          .prepare('UPDATE solicitudes SET fabrica = ? WHERE cotizacion_id = ? AND fabrica IS NULL')
          .run(fabrica, nota.cotizacion_id);
        // La cotización cambia: las pantallas abiertas la recargan en vez de sobrescribirla con la versión anterior.
        const { actualizada } = this.db
          .prepare('SELECT actualizada FROM cotizaciones WHERE id = ?')
          .get(nota.cotizacion_id) as { actualizada: string };
        const fecha = new Date(Math.max(Date.now(), Date.parse(actualizada) + 1)).toISOString();
        this.db.prepare('UPDATE cotizaciones SET actualizada = ? WHERE id = ?').run(fecha, nota.cotizacion_id);
        this.db
          .prepare('INSERT INTO eventos (cotizacion_id, fecha, usuario, tipo, detalle) VALUES (?, ?, ?, ?, ?)')
          .run(nota.cotizacion_id, fecha, null, 'seguimiento', `Nota de pedido N° ${numero} asignada a ${nombreFabrica[fabrica]}`);
      })
      .immediate();
  }

  /**
   * Para los diálogos de emisión y de cambio de número: el último número de cotización usado y el rango de uno
   * elegido a mano, y lo mismo para las notas de cada fábrica. Solo lectura.
   */
  numeracion() {
    const { ultimo } = numeracionCotizacion(this.db);
    const notas = Object.fromEntries(
      FABRICAS.map((f) => {
        const n = numeracionNota(this.db, f);
        const ultimo = Math.max(n.ultimo, n.siguiente - 1);
        return [f, { ultimo, siguiente: ultimo + 1, tope: ultimo + SALTO_MAXIMO_NUMERO }];
      }),
    ) as Record<Fabrica, { ultimo: number; siguiente: number; tope: number }>;
    return { ultimo, siguiente: ultimo + 1, tope: ultimo + SALTO_MAXIMO_NUMERO, notas };
  }

  /**
   * Nombre libre para un PDF nuevo, `base.pdf` o, si ya existe ese archivo o su snapshot, `base-2.pdf`, `base-3.pdf`…:
   * un documento emitido nunca se sobrescribe (ver `generarPdf`).
   */
  archivoLibre(base: string) {
    const existeSnapshot = this.db.prepare('SELECT 1 FROM documentos_snapshot WHERE archivo = ?');
    for (let n = 1; ; n++) {
      const archivo = n === 1 ? `${base}.pdf` : `${base}-${n}.pdf`;
      if (!existsSync(join(this.directorio, 'pdf', archivo)) && !existeSnapshot.get(archivo)) return archivo;
    }
  }

  /** Quienes crearon cotizaciones (`creada_por`), para filtrar el historial por vendedora. */
  vendedoras(): string[] {
    return (
      this.db
        .prepare(
          "SELECT DISTINCT creada_por AS nombre FROM cotizaciones WHERE COALESCE(TRIM(creada_por), '') <> '' ORDER BY creada_por COLLATE NOCASE",
        )
        .all() as { nombre: string }[]
    ).map((f) => f.nombre);
  }

  obtener(id: string): Cotizacion | null {
    return cargarUna(this.db, id);
  }

  revisionAbierta(original: Cotizacion): Cotizacion | null {
    return new Unidad(this.db).revisionAbierta(original);
  }

  /**
   * Borradores sin número que nadie toca hace `dias` días. Sin `conItems`, solo los vacíos (sin ítems
   * ni datos del cliente), que no guardan trabajo de nadie.
   */
  borradoresAbandonados({ dias, conItems = false }: { dias: number; conItems?: boolean }) {
    const limite = new Date(Date.now() - dias * 86_400_000).toISOString();
    return this.db
      .prepare(
        `
        SELECT c.id, c.creada, c.actualizada, c.creada_por AS creadaPor, c.cliente_nombre AS cliente,
               (SELECT COUNT(*) FROM solicitudes s WHERE s.cotizacion_id = c.id) AS items
        FROM cotizaciones c
        WHERE c.estado = 'borrador' AND c.numero IS NULL AND c.actualizada < ?
          ${
            conItems
              ? ''
              : `AND NOT EXISTS (SELECT 1 FROM solicitudes s WHERE s.cotizacion_id = c.id)
                 AND COALESCE(c.cliente_nombre, c.cliente_rut, c.cliente_giro, c.cliente_telefono,
                              c.cliente_direccion, c.cliente_comuna, c.cliente_proyecto) IS NULL`
          }
        ORDER BY c.actualizada
      `,
      )
      .all(limite) as {
      id: string;
      creada: string;
      actualizada: string;
      creadaPor: string | null;
      cliente: string | null;
      items: number;
    }[];
  }

  /** Elimina borradores sin número dentro del bloqueo; ignora los que cambiaron de estado. */
  async eliminarBorradores(ids: string[]) {
    return this.transaccion((u) => {
      let eliminados = 0;
      for (const id of ids) {
        const q = u.obtener(id);
        if (q?.estado !== 'borrador' || q.numero !== null) continue;
        u.eliminar(id);
        eliminados++;
      }
      return eliminados;
    });
  }

  /**
   * Borradores en la papelera, del eliminado más reciente al más antiguo, con lo necesario para reconocerlos y
   * restaurarlos. Una entrada ilegible no se puede restaurar: se omite.
   */
  papelera(limite = 200): BorradorEnPapelera[] {
    return this.listarPapelera({ porPagina: limite }).borradores;
  }

  /**
   * Página de la papelera de borradores, con búsqueda en el servidor por cliente, comuna, proyecto o producto
   * (sin tildes ni mayúsculas, todas las palabras). El total cuenta solo las entradas legibles que coinciden: la
   * papelera se vacía a los `DIAS_PAPELERA` días, así que recorrerla entera es acotado.
   */
  listarPapelera(filtros: { q?: string; pagina?: number; porPagina?: number } = {}): {
    borradores: BorradorEnPapelera[];
    total: number;
    pagina: number;
    porPagina: number;
  } {
    const porPagina = Math.min(Math.max(Math.trunc(filtros.porPagina ?? 50), 1), 200);
    const pagina = Math.max(Math.trunc(filtros.pagina ?? 1), 1);
    const terminos = normalizarTexto(filtros.q ?? '').split(' ').filter(Boolean).slice(0, 8);
    const desde = (pagina - 1) * porPagina;
    const borradores: BorradorEnPapelera[] = [];
    let total = 0;
    const filas = this.db
      .prepare("SELECT contenido, eliminada FROM papelera WHERE tipo = 'borrador' ORDER BY eliminada DESC, id")
      .iterate() as Iterable<{ contenido: string; eliminada: string }>;
    for (const f of filas) {
      let leida;
      try {
        leida = cotizacionSchema.safeParse(JSON.parse(f.contenido));
      } catch {
        continue;
      }
      if (!leida.success) continue;
      const q = leida.data;
      const productos = resumenProductos(q.solicitudes);
      if (terminos.length) {
        const texto = normalizarTexto(
          [q.cliente.nombre, q.cliente.comuna, q.cliente.proyecto, q.cliente.rut, q.cliente.telefono, productos]
            .filter(Boolean)
            .join(' '),
        );
        if (!terminos.every((t) => texto.includes(t))) continue;
      }
      total++;
      if (total <= desde || borradores.length >= porPagina) continue;
      borradores.push({
        id: q.id,
        actualizada: q.actualizada,
        eliminada: f.eliminada,
        creada: q.creada,
        creadaPor: q.creadaPor,
        cliente: { nombre: q.cliente.nombre, comuna: q.cliente.comuna, proyecto: q.cliente.proyecto },
        items: q.solicitudes.length,
        productos,
        origen: q.origen ?? null,
        total: q.montos.total,
      });
    }
    return { borradores, total, pagina, porPagina };
  }

  /** Entradas de la papelera (borradores y productos manuales) eliminadas hace más de `dias` días. */
  papeleraAntigua(dias: number) {
    const limite = new Date(Date.now() - dias * 86_400_000).toISOString();
    return this.db
      .prepare('SELECT tipo, id, contenido, eliminada FROM papelera WHERE eliminada < ? ORDER BY eliminada')
      .all(limite) as { tipo: string; id: string; contenido: string; eliminada: string }[];
  }

  /** Borra de la papelera las entradas listadas; ignora las que se restauraron o se volvieron a eliminar. */
  async vaciarPapelera(entradas: { tipo: string; id: string; eliminada: string }[]) {
    return this.transaccion(() => {
      const borrar = this.db.prepare('DELETE FROM papelera WHERE tipo = ? AND id = ? AND eliminada = ?');
      return this.db.transaction(() => entradas.reduce((n, e) => n + borrar.run(e.tipo, e.id, e.eliminada).changes, 0))();
    });
  }

  /** Archivos de referencia del cliente que usa algún ítem de alguna cotización. */
  archivosReferencia(): Set<string> {
    const filas = this.db.prepare('SELECT DISTINCT archivo FROM referencias_item').all() as { archivo: string }[];
    // Los borradores en la papelera se pueden restaurar: sus referencias siguen en uso. Una entrada ilegible no
    // se puede restaurar, así que no protege nada ni detiene la limpieza.
    const papelera = this.db.prepare("SELECT contenido FROM papelera WHERE tipo = 'borrador'").all() as { contenido: string }[];
    const archivadas = papelera.flatMap((f) => {
      try {
        const q = cotizacionSchema.safeParse(JSON.parse(f.contenido));
        return q.success ? q.data.solicitudes.flatMap((s) => s.referencias?.map((r) => r.archivo) ?? []) : [];
      } catch {
        return [];
      }
    });
    // Los documentos emitidos (y las órdenes de trabajo en cola) muestran las imágenes del cliente: al regenerarlos
    // deben seguir ahí, aunque después se hayan quitado del ítem.
    const impresas = (
      this.db
        .prepare(
          `SELECT html FROM documentos_snapshot WHERE html LIKE '%neltume-referencia:%'
           UNION ALL SELECT html_produccion AS html FROM integracion_envios WHERE html_produccion LIKE '%neltume-referencia:%'`,
        )
        .all() as { html: string }[]
    ).flatMap((f) => [...f.html.matchAll(/neltume-referencia:([0-9a-f]{64}\.(?:jpg|png|webp))/g)].map((m) => m[1]));
    return new Set([...filas.map((f) => f.archivo), ...archivadas, ...impresas]);
  }

  /** Cotización dueña de un PDF emitido (cotización o nota de pedido). */
  porDocumento(archivo: string): Cotizacion | null {
    const fila = this.db
      .prepare(
        `SELECT id FROM cotizaciones WHERE pdf = ?
         UNION ALL SELECT cotizacion_id AS id FROM notas_pedido WHERE pdf = ? LIMIT 1`,
      )
      .get(archivo, archivo) as { id: string } | undefined;
    return fila ? cargarUna(this.db, fila.id) : null;
  }

  /** Registro de actividad de una cotización, del más antiguo al más reciente. */
  eventos(id: string): EventoCotizacion[] {
    return this.db
      .prepare('SELECT fecha, usuario, tipo, detalle FROM eventos WHERE cotizacion_id = ? ORDER BY id')
      .all(id) as EventoCotizacion[];
  }

  /** Datos livianos de todas las cotizaciones para resolver referencias: dos consultas. */
  candidatas(): CandidataReferencia[] {
    const db = this.db;
    return db.transaction(() => {
      const filas = db
        .prepare(
          `
          SELECT c.id, c.numero, c.estado, c.actualizada, c.fecha_emision, c.cliente_nombre,
                 c.cliente_proyecto, c.cliente_comuna,
                 (SELECT MIN(n.fecha) FROM notas_pedido n WHERE n.cotizacion_id = c.id) AS nota_fecha
          FROM cotizaciones c
          ORDER BY c.orden
        `,
        )
        .all() as {
        id: string;
        numero: number | null;
        estado: EstadoCotizacion;
        actualizada: string;
        fecha_emision: string | null;
        cliente_nombre: string | null;
        cliente_proyecto: string | null;
        cliente_comuna: string | null;
        nota_fecha: string | null;
      }[];
      const solicitudes = agrupar(
        db
          .prepare('SELECT cotizacion_id, modelo, cantidad FROM solicitudes ORDER BY cotizacion_id, orden')
          .all() as {
          cotizacion_id: string;
          modelo: string | null;
          cantidad: number | null;
        }[],
      );
      return filas.map((f) => ({
        id: f.id,
        actualizada: f.actualizada,
        numero: f.numero,
        estado: f.estado,
        fechaEmision: f.fecha_emision,
        cliente: { nombre: f.cliente_nombre, proyecto: f.cliente_proyecto, comuna: f.cliente_comuna },
        solicitudes: (solicitudes.get(f.id) ?? []).map((s) => ({ modelo: s.modelo, cantidad: s.cantidad })),
        nota: f.nota_fecha ? { fecha: f.nota_fecha } : null,
      }));
    })();
  }

  /** Página de resúmenes sin historial, con búsqueda y filtros; más recientes primero. */
  listar(filtros: FiltrosListado = {}): {
    cotizaciones: ResumenCotizacion[];
    total: number;
    pagina: number;
    porPagina: number;
  } {
    const db = this.db;
    const porPagina = Math.min(Math.max(Math.trunc(filtros.porPagina ?? 50), 1), 200);
    const pagina = Math.max(Math.trunc(filtros.pagina ?? 1), 1);
    const condiciones: string[] = [];
    const params: unknown[] = [];
    for (const termino of normalizarTexto(filtros.q ?? '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 8)) {
      condiciones.push("c.busqueda LIKE ? ESCAPE '\\'");
      params.push(`%${termino.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    const estados = (filtros.estados ?? []).filter((e) => mapaEstados.has(e));
    if (estados.length) {
      condiciones.push(`c.estado IN (${estados.map(() => '?').join(', ')})`);
      params.push(...estados);
    }
    if (filtros.desde) {
      condiciones.push(`${FECHA_REFERENCIA} >= ?`);
      params.push(inicioDiaSantiago(filtros.desde));
    }
    if (filtros.hasta) {
      condiciones.push(`${FECHA_REFERENCIA} < ?`);
      params.push(inicioDiaSantiago(sumarDiasCalendario(filtros.hasta, 1)));
    }
    const comerciales = (filtros.comerciales ?? []).filter((e) => e in etiquetaComercial);
    if (comerciales.length) {
      condiciones.push(
        `(CASE WHEN c.estado = 'anulada' THEN 'rechazada' ELSE c.estado_comercial END) IN (${comerciales.map(() => '?').join(', ')})`,
      );
      params.push(...comerciales);
    }
    const operativos = (filtros.operativos ?? []).filter((e) => e in etiquetaOperativo);
    if (operativos.length) {
      condiciones.push(
        `(CASE WHEN c.estado_operativo = 'produccion_terminada' THEN 'en_produccion' ELSE COALESCE(c.estado_operativo, 'sin_pedido') END) IN (${operativos.map(() => '?').join(', ')})`,
      );
      params.push(...operativos);
    }
    if (filtros.vendedora?.trim()) {
      condiciones.push('c.creada_por = ?');
      params.push(filtros.vendedora.trim());
    }
    if (filtros.vencenPronto) {
      condiciones.push("c.estado = 'emitida' AND c.vence >= ? AND c.vence <= ?");
      const hoy = fechaLocal(new Date()); params.push(hoy, sumarDiasCalendario(hoy, 7));
    }
    if (filtros.saldoPendiente) condiciones.push("c.estado = 'aprobada' AND (SELECT total FROM cotizacion_montos WHERE cotizacion_id = c.id) > COALESCE((SELECT SUM(monto) FROM pagos WHERE cotizacion_id = c.id), 0)");
    const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    return db.transaction(() => {
      const total = (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM cotizaciones c ${donde}`,
          )
          .get(...params) as { n: number }
      ).n;
      const filas = db
        .prepare(
          `
          SELECT c.*, ${FECHA_REFERENCIA} AS fecha_referencia, o.numero AS origen_numero, m.neto, m.iva, m.total, m.subtotal,
                 m.descuento AS descuento_monto, m.flete AS flete_monto,
                 (SELECT COUNT(*) FROM solicitudes s WHERE s.cotizacion_id = c.id) AS items,
                 (SELECT COUNT(*) FROM incompletos i WHERE i.cotizacion_id = c.id) AS pendientes,
                 COALESCE((SELECT SUM(p.monto) FROM pagos p WHERE p.cotizacion_id = c.id), 0) AS pagado,
                 (SELECT COUNT(*) FROM pagos p WHERE p.cotizacion_id = c.id) AS cantidad_pagos
          FROM cotizaciones c
          LEFT JOIN cotizaciones o ON o.id = c.origen_id
          LEFT JOIN cotizacion_montos m ON m.cotizacion_id = c.id
          ${donde}
          ORDER BY fecha_referencia DESC, c.orden DESC
          LIMIT ? OFFSET ?
        `,
        )
        .all(...params, porPagina, (pagina - 1) * porPagina) as (FilaCotizacion & {
        neto: number | null;
        iva: number | null;
        total: number | null;
        subtotal: number | null;
        descuento_monto: number | null;
        flete_monto: number | null;
        fecha_referencia: string;
        items: number;
        pendientes: number;
        pagado: number;
        cantidad_pagos: number;
      })[];
      const productos = agrupar(
        db
          .prepare(
            `
            SELECT cotizacion_id, modelo, madera, cantidad FROM solicitudes
            WHERE cotizacion_id IN (SELECT value FROM json_each(?)) ORDER BY cotizacion_id, orden
          `,
          )
          .all(JSON.stringify(filas.map((f) => f.id))) as {
          cotizacion_id: string;
          modelo: string | null;
          madera: string | null;
          cantidad: number | null;
        }[],
      );
      const notas = agrupar(
        db
          .prepare(
            `
            SELECT cotizacion_id, numero, fabrica, pdf, fecha, anulada FROM notas_pedido
            WHERE cotizacion_id IN (SELECT value FROM json_each(?))
          `,
          )
          .all(JSON.stringify(filas.map((f) => f.id))) as {
          cotizacion_id: string;
          numero: number;
          fabrica: Fabrica | null;
          pdf: string;
          fecha: string;
          anulada: number;
        }[],
      );
      const cotizaciones = filas.map((f): ResumenCotizacion => {
        const vence =
          f.vence ??
          (f.fecha_emision
            ? calcularVence(f.fecha_emision, reglasDesdeJson(f.reglas_json).vigenciaDiasHabiles)
            : null);
        return {
          id: f.id,
          numero: f.numero,
          estado: f.estado,
          cliente: {
            nombre: f.cliente_nombre,
            rut: f.cliente_rut,
            giro: f.cliente_giro,
            telefono: f.cliente_telefono,
            direccion: f.cliente_direccion,
            comuna: f.cliente_comuna,
            proyecto: f.cliente_proyecto,
          },
          subtotal: f.subtotal ?? f.neto ?? 0,
          descuento: f.descuento,
          descuentoMonto: f.descuento_monto ?? 0,
          flete: f.flete,
          neto: f.neto ?? 0,
          iva: f.iva ?? 0,
          total: f.total ?? 0,
          items: f.items,
          pendientes: f.pendientes,
          productos: resumenProductos(productos.get(f.id) ?? []),
          creada: f.creada,
          actualizada: f.actualizada,
          fecha: f.fecha_referencia,
          fechaEmision: f.fecha_emision,
          vence,
          vencida: f.estado === 'emitida' && estaVencida(vence),
          origen: f.origen_id ? f.origen_numero : null,
          reemplazadaPor: f.reemplazada_por,
          pdf: f.pdf,
          creadaPor: f.creada_por,
          emitidaPor: f.emitida_por,
          aprobadaPor: f.aprobada_por,
          anuladaPor: f.anulada_por,
          fechaAnulacion: f.fecha_anulacion,
          notas: ordenarNotas(
            (notas.get(f.id) ?? []).map((n) => ({
              numero: n.numero,
              ...(n.fabrica !== null && { fabrica: n.fabrica }),
              pdf: n.pdf,
              fecha: n.fecha,
              anulada: !!n.anulada,
            })),
          ),
          estadoComercial: estadoComercialGuardado(f.estado, f.estado_comercial),
          estadoOperativo: (leerEstadoOperativo(f.estado_operativo) as EstadoOperativo | null) ?? 'sin_pedido',
          pagado: f.pagado,
          saldoPendiente: Math.max(0, (f.total ?? 0) - f.pagado),
          porcentajePagado: f.total ? Math.min(100, (100 * f.pagado) / f.total) : 0,
          pagos: f.cantidad_pagos,
          facturacion: { estado: f.facturacion_estado },
        };
      });
      return { cotizaciones, total, pagina, porPagina };
    })();
  }

  /** Libera la marca «en emisión» tomada con `ficha`; si ya venció y otra emisión la tomó, no la toca. */
  liberarEmision(id: string, ficha: string) {
    try {
      this.db.prepare('DELETE FROM emisiones_en_curso WHERE cotizacion_id = ? AND ficha = ?').run(id, ficha);
    } catch (error) {
      // Si no se pudo borrar, la marca vence sola (EMISION_VIGENTE_MS): no se tapa el resultado de la emisión.
      registrarError('almacen', `No se liberó la marca de emisión de ${id}: ${(error as Error).message}`);
    }
  }

  /**
   * Importa una planilla dentro del mismo bloqueo que las escrituras de cotizaciones (ver `guardarCatalogo`): no
   * cambia el catálogo en medio de otra operación.
   */
  async guardarCatalogo(...args: Parameters<typeof guardarCatalogo> extends [unknown, ...infer R] ? R : never) {
    return this.transaccion(() => guardarCatalogo(this.db, ...args));
  }

  /** «Volver a la planilla anterior» con el mismo bloqueo que `guardarCatalogo`. */
  async restaurarImportacion(origen: OrigenCatalogo, version: string) {
    return this.transaccion(() => new RepositorioCatalogoSqlite(this.db).restaurarImportacion(origen, version));
  }

  async transaccion<T>(fn: (unidad: Unidad) => Promise<T> | T): Promise<T> {
    await mkdir(this.directorio, { recursive: true, mode: 0o700 });
    let release: () => Promise<void>;
    let comprometido = false;
    try {
      release = await lockfile.lock(this.directorio, {
        realpath: false,
        lockfilePath: join(this.directorio, '.estado.lock'),
        stale: LOCK_ESTADO_VIGENTE_MS,
        retries: { retries: 60, minTimeout: 100, maxTimeout: 500 },
        // Si el bloqueo se pierde (reloj, disco lento) se registra: lanzar aquí derribaría el proceso.
        onCompromised: (error) => { comprometido = true; registrarError('almacen', `Bloqueo comprometido: ${error.message}`); },
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ELOCKED') throw new ErrorOcupado();
      throw e;
    }
    try {
      const unidad = new Unidad(this.db);
      const resultado = await fn(unidad);
      if (comprometido) throw new ErrorOcupado();
      unidad.confirmar();
      // La nota ya quedó guardada: el envío a la fábrica corre aparte y nunca demora esta respuesta.
      if (unidad.encoladosIntegracion) despertarIntegracion(this);
      return resultado;
    } finally {
      await release().catch((error: Error) =>
        registrarError('almacen', `No se liberó el bloqueo: ${error.message}`),
      );
    }
  }
}

function sumarDiasCalendario(fecha: string, dias: number) {
  const d = new Date(`${fecha}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** «3 × HUILO HUILO PINO OREGON, MARCO (sin cantidad)»: los productos de una cotización en una línea. */
function resumenProductos(lista: { modelo: string | null; madera: string | null; cantidad: number | null }[]) {
  return lista
    .map(
      (p) =>
        `${p.cantidad === null ? '' : `${p.cantidad} × `}${p.modelo ?? 'producto por definir'}${p.madera ? ` ${p.madera}` : ''}${p.cantidad === null ? ' (sin cantidad)' : ''}`,
    )
    .join(', ');
}

/** Borrador eliminado tal como lo lista la papelera del historial. */
export interface BorradorEnPapelera {
  id: string;
  /** Versión guardada: `restaurar_borrador` la exige. */
  actualizada: string;
  eliminada: string;
  creada: string;
  creadaPor: string | null;
  cliente: { nombre: string | null; comuna: string | null; proyecto: string | null };
  items: number;
  productos: string;
  /** Número de la cotización emitida que revisaba; null si era una cotización nueva. */
  origen: number | null;
  total: number;
}

/** La cotización guardada no pasa la validación: se informa sin tumbar el resto del listado. */
class ErrorCotizacionDanada extends ErrorUsuario {
  constructor() {
    super(
      'La cotización guardada tiene datos dañados y no se puede abrir. Pide a quien administra el cotizador que la revise.',
      'estado_invalido',
      500,
    );
  }
}

export function cerrarAlmacen(ruta?: string) {
  cerrarBaseDatos(ruta);
}

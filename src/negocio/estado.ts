import type { Cliente, SolicitudItem } from '../catalogo/tipos';
import type { Rechazo } from '../catalogo/resolver';
import type { Montos, ReglasComerciales } from './precios';
import { ANTICIPO_MINIMO, ANTICIPO_TEXTO } from './limites';
import { fechaLocal } from './vigencia';
import { esLibre } from './personalizados';
export interface Mensaje {
  rol: 'usuario' | 'asistente';
  texto: string;
}
/** Turnos previos al borrador que viajan como contexto del siguiente mensaje. */
const MAX_CHARLA = 12;
/**
 * Mientras no hay borrador, cada intercambio (sin pedido todavía) se suma a la charla que acompaña al mensaje
 * siguiente. La usan la pantalla y las evaluaciones, para que la IA vea lo mismo en ambas.
 */
export const sumarCharla = (charla: Mensaje[], historial: Mensaje[]) =>
  [...charla, ...historial.slice(-2)].slice(-MAX_CHARLA);
/**
 * borrador → emitida → aprobada. Una emitida pasa a «reemplazada» cuando se emite su revisión o se
 * aprueba otra de la misma serie; «anulada» es definitiva. Solo el borrador se edita directamente.
 */
export type EstadoCotizacion = 'borrador' | 'emitida' | 'aprobada' | 'reemplazada' | 'anulada';
export const ESTADOS: readonly EstadoCotizacion[] = [
  'borrador',
  'emitida',
  'aprobada',
  'reemplazada',
  'anulada',
];
export interface Despacho {
  direccion: string | null;
  transporte: string | null;
  /** Texto libre o fecha acordada con el cliente. */
  entregaComprometida?: string | null;
  destino?: string | null;
  valor?: number | null;
  /**
   * Huella del pedido con que se aplicó la tarifa del transportista. Si el bulto cambia después, la tarifa ya no
   * corresponde y se avisa (auditoría BUG-013).
   */
  huella?: string | null;
}
export type EstadoComercial = 'pendiente' | 'enviada' | 'seguimiento' | 'aprobada' | 'rechazada' | 'vendida';
export const etiquetaComercial: Record<EstadoComercial, string> = {
  pendiente: 'Pendiente',
  enviada: 'Enviada',
  seguimiento: 'En seguimiento',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada / cancelada',
  vendida: 'Vendida',
};
export type EstadoOperativo =
  | 'sin_pedido'
  | 'anticipo_pagado'
  | 'pedido_generado'
  | 'en_produccion'
  | 'saldo_pendiente'
  | 'pagada'
  | 'lista_despacho'
  | 'despachada'
  | 'completada';
/**
 * Estado operativo tal como se guardó. «produccion_terminada» nunca se asignó (el paso «Producción terminada»
 * deja el pedido en «saldo_pendiente» o «pagada») y ya no existe: un dato antiguo que lo traiga se lee como
 * «en_produccion», el paso del que salía. Lo demás pasa igual (lo valida quien lo lee).
 */
export const leerEstadoOperativo = <T,>(valor: T): T | 'en_produccion' =>
  valor === 'produccion_terminada' ? 'en_produccion' : valor;
export const etiquetaOperativo: Record<EstadoOperativo, string> = {
  sin_pedido: 'Sin nota de pedido',
  anticipo_pagado: `${ANTICIPO_TEXTO} pagado`,
  pedido_generado: 'Nota de pedido generada',
  en_produccion: 'En producción',
  saldo_pendiente: 'Saldo pendiente',
  pagada: '100 % pagado',
  lista_despacho: 'Lista para despacho',
  despachada: 'Despachada',
  completada: 'Completada',
};
/**
 * Paso anterior de cada estado operativo: el que aplica `retroceder_operacion` en el servidor y el que anuncia
 * «Volver al paso anterior» en la pantalla. Sin nota de pedido, o recién generada, no hay paso anterior.
 */
export const PASO_ANTERIOR: Partial<Record<EstadoOperativo, EstadoOperativo>> = {
  completada: 'despachada',
  despachada: 'lista_despacho',
  lista_despacho: 'pagada',
  pagada: 'en_produccion',
  saldo_pendiente: 'en_produccion',
  en_produccion: 'pedido_generado',
};
export interface Pago {
  id: string;
  fecha: string;
  monto: number;
  observacion: string | null;
  usuario: string | null;
}
export interface ComentarioInterno {
  id: string;
  fecha: string;
  texto: string;
  usuario: string | null;
}
export interface Facturacion {
  estado: 'pendiente' | 'facturada';
  tipo: 'factura' | 'boleta' | null;
  identificadorExterno: string | null;
  fecha: string | null;
}
/** «Pendiente de facturación» o «Facturada · Factura N° 123». */
export function etiquetaFacturacion(f: Facturacion | undefined) {
  if (f?.estado !== 'facturada') return 'Pendiente de facturación';
  const documento = f.tipo === 'boleta' ? 'Boleta' : 'Factura';
  return `Facturada · ${documento}${f.identificadorExterno ? ` N° ${f.identificadorExterno}` : ''}`;
}
/** Fábricas que reciben notas de pedido; cada una lleva su propio correlativo. */
export const FABRICAS = ['panguipulli', 'santiago'] as const;
export type Fabrica = (typeof FABRICAS)[number];
export const nombreFabrica: Record<Fabrica, string> = { panguipulli: 'Panguipulli', santiago: 'Santiago' };
/** Lo que fabrica cada una, para elegir a cuál va la nota. */
export const productosFabrica: Record<Fabrica, string> = {
  panguipulli: 'Puertas sólidas',
  santiago: 'Puertas enchapadas y prepintadas',
};
export interface NotaPedido {
  numero: number;
  /**
   * Fábrica de destino: su número es único dentro de ella. Falta en las notas generadas antes de separar las
   * fábricas, hasta que se les asigne una con `npm run notas`.
   */
  fabrica?: Fabrica;
  pdf: string;
  /** Solo las líneas de esta fábrica, a precio de fábrica. */
  montos: Montos;
  fecha: string;
  despacho: Despacho;
  observaciones?: string | null;
  /** La cotización aprobada se anuló después: la nota ya no es válida para fábrica. */
  anulada: boolean;
  /** Cuándo entró el pedido a esta fábrica (ISO); null o ausente si todavía no. */
  inicioProduccion?: string | null;
  /** Cuándo la fábrica terminó su parte (ISO); null o ausente si todavía no. */
  terminoProduccion?: string | null;
}
/** «N° 12 · Panguipulli»; una nota sin fábrica asignada va solo con su número. */
export const numeroNota = (n: Pick<NotaPedido, 'numero' | 'fabrica'>) =>
  `N° ${n.numero}${n.fabrica ? ` · ${nombreFabrica[n.fabrica]}` : ''}`;
/** «N° 577 · Panguipulli y N° 59 · Santiago»: las notas de una cotización en una frase. */
export const numerosNotas = (notas: Pick<NotaPedido, 'numero' | 'fabrica'>[]) => {
  const textos = notas.map(numeroNota);
  return textos.length > 1 ? `${textos.slice(0, -1).join(', ')} y ${textos.at(-1)}` : (textos[0] ?? '');
};
/** «la nota de pedido N° 577 · Panguipulli» o «las notas de pedido N° 577 · Panguipulli y N° 59 · Santiago». */
export const textoNotas = (notas: Pick<NotaPedido, 'numero' | 'fabrica'>[]) =>
  `${notas.length > 1 ? 'las notas de pedido' : 'la nota de pedido'} ${numerosNotas(notas)}`;
/** Las notas en el orden de `FABRICAS`; una sin fábrica (anterior a separarlas) va primero. */
export const ordenarNotas = <T extends Pick<NotaPedido, 'fabrica'>>(notas: T[]) =>
  [...notas].sort((a, b) => (a.fabrica ? FABRICAS.indexOf(a.fabrica) + 1 : 0) - (b.fabrica ? FABRICAS.indexOf(b.fabrica) + 1 : 0));
export type EtapaProduccion = 'pendiente' | 'en_produccion' | 'terminada';
export const etapaProduccion = (n: Pick<NotaPedido, 'inicioProduccion' | 'terminoProduccion'>): EtapaProduccion =>
  n.terminoProduccion ? 'terminada' : n.inicioProduccion ? 'en_produccion' : 'pendiente';
export const etiquetaEtapa: Record<EtapaProduccion, string> = {
  pendiente: 'Sin iniciar',
  en_produccion: 'En producción',
  terminada: 'Producción terminada',
};
/** Nombre de la fábrica de una nota, o «la fábrica» si es anterior a separarlas. */
export const fabricaDeNota = (n: Pick<NotaPedido, 'fabrica'>) => (n.fabrica ? nombreFabrica[n.fabrica] : 'la fábrica');
export interface Cotizacion {
  id: string;
  numero: number | null;
  estado: EstadoCotizacion;
  cliente: Cliente;
  solicitudes: SolicitudItem[];
  montos: Montos;
  incompletos: { indice: number; rechazo: Rechazo; pregunta: string }[];
  historial: Mensaje[];
  creada: string;
  /** Versión para control optimista: toda acción que modifica la cotización debe enviarla. */
  actualizada: string;
  pdf: string | null;
  /** Ausente en estados guardados antes de registrar la fecha de emisión. */
  fechaEmision?: string | null;
  /** Número de la cotización emitida de la que se derivó esta revisión. */
  origen?: number | null;
  /**
   * Id de esa misma cotización. El número puede reasignarse (renumerar), así que la relación se resuelve por id;
   * `origen` queda para mostrarlo (auditoría BUG-025).
   */
  origenId?: string | null;
  /** Último día de validez (YYYY-MM-DD, inclusive), 10 días hábiles después de la emisión. */
  vence: string | null;
  /** Porcentaje 0–50 aplicado al neto del cliente antes del IVA. */
  descuento: number;
  /**
   * La persona fijó el descuento a mano: no cambia con las líneas hasta que restaure el automático. Si es
   * falso (o falta), `descuento` es el del tramo por cantidad que corresponde a las puertas de la cotización
   * (0 si sus reglas no tienen tramos).
   */
  descuentoManual?: boolean;
  /** Flete neto en pesos enteros (total de su línea): se suma al neto y no lleva descuento. */
  flete: number;
  /** Texto de la línea de flete; null (o ausente) usa el que se arma con el destino y el transportista. */
  fleteDescripcion?: string | null;
  /** Unidades de la línea de flete (1 si falta); el unitario es `flete / fleteCantidad`. */
  fleteCantidad?: number;
  /**
   * Margen especial de toda la cotización, como fracción (0,42 = 42 %). Pasa por encima del margen de la
   * categoría y por debajo del de cada línea; null (o ausente) usa el de cada categoría. La nota de pedido
   * no lo usa: se calcula a precio de fábrica.
   */
  margenCotizacion?: number | null;
  /** Texto comercial o instrucciones que deben acompañar al documento. */
  observaciones?: string | null;
  /** Datos de despacho que se pueden preparar antes de aprobar. */
  despacho?: Despacho | null;
  /** Reglas congeladas para que una cotización no cambie si luego se ajusta la configuración. */
  reglas?: ReglasComerciales;
  creadaPor: string | null;
  emitidaPor: string | null;
  aprobadaPor: string | null;
  /**
   * Instante en que el cliente la aprobó (ISO). Ausente antes de v23 o si se quitó la aprobación: entonces vale
   * la fecha del último evento «aprobada».
   */
  fechaAprobacion?: string | null;
  anuladaPor: string | null;
  fechaAnulacion: string | null;
  motivoAnulacion: string | null;
  /** Número de la revisión o cotización aprobada que dejó a esta como «reemplazada». */
  reemplazadaPor: number | null;
  /** Versión del catálogo (sha256:fecha) con la que se calcularon los montos al emitir. */
  versionCatalogo: string | null;
  /**
   * Notas de pedido, una por fábrica, en el orden de `FABRICAS`. Se generan juntas, una vez registrado el anticipo,
   * y cada una lleva solo las líneas asignadas a su fábrica (`SolicitudItem.fabrica`). Vacía antes de generarlas.
   */
  notas: NotaPedido[];
  /** Fases comerciales y operativas separadas del estado del documento. */
  estadoComercial?: EstadoComercial;
  estadoOperativo?: EstadoOperativo;
  pagos?: Pago[];
  comentariosInternos?: ComentarioInterno[];
  facturacion?: Facturacion;
}
/** Anticipo que habilita la nota de pedido y la producción: la mitad del total, redondeada hacia arriba. */
export const anticipoMinimo = (total: number) => Math.ceil(total * ANTICIPO_MINIMO);
/** «Otro» solo indica que falta el nombre: no identifica a quien lleva el pedido. */
export const sinTransportista = (transporte: string | null | undefined) =>
  !transporte?.trim() || transporte.trim().toLowerCase() === 'otro';
/** Código que muestra la línea de flete junto a los productos. */
export const CODIGO_FLETE = 'FLETE';
export const cantidadFlete = (q: Pick<Cotizacion, 'fleteCantidad'>) =>
  q.fleteCantidad && q.fleteCantidad > 0 ? q.fleteCantidad : 1;
/** El servidor guarda siempre `flete = cantidad × unitario`, así que la división es exacta. */
export const unitarioFlete = (q: Pick<Cotizacion, 'flete' | 'fleteCantidad'>) =>
  Math.round(q.flete / cantidadFlete(q));
/** Descripción de la línea de flete: la escrita por la persona o «Flete / despacho a Temuco · Starken». */
export function descripcionFlete(q: Pick<Cotizacion, 'fleteDescripcion' | 'despacho'>) {
  if (q.fleteDescripcion?.trim()) return q.fleteDescripcion.trim();
  const destino = q.despacho?.destino?.trim();
  const transporte = q.despacho?.transporte;
  return [
    `Flete / despacho${destino ? ` a ${destino}` : ''}`,
    !sinTransportista(transporte) && transporte!.trim(),
  ]
    .filter(Boolean)
    .join(' · ');
}
type FaseOperativa = Pick<Cotizacion, 'estado' | 'estadoOperativo'>;
/** Estado operativo guardado o, si falta (datos antiguos), el que corresponde a tener o no notas de pedido. */
export const operacionDe = (q: Pick<Cotizacion, 'estadoOperativo' | 'notas'>): EstadoOperativo =>
  q.estadoOperativo ?? (q.notas.length ? 'pedido_generado' : 'sin_pedido');
/**
 * Estado operativo de la producción según el avance de cada fábrica: «En producción» desde que una empieza y, cuando
 * todas terminaron, saldo pendiente o pagada. Sin ninguna iniciada, «Nota de pedido generada».
 */
export function operacionPorProduccion(notas: Pick<NotaPedido, 'inicioProduccion' | 'terminoProduccion' | 'anulada'>[], pagado: number, total: number): EstadoOperativo {
  const vigentes = notas.filter((n) => !n.anulada);
  if (vigentes.length && vigentes.every((n) => n.terminoProduccion)) return pagado < total ? 'saldo_pendiente' : 'pagada';
  return vigentes.some((n) => n.inicioProduccion) ? 'en_produccion' : 'pedido_generado';
}
/** Mientras la operación está en estas etapas, la producción avanza (y retrocede) nota por nota. */
const ETAPAS_PRODUCCION = new Set<EstadoOperativo>(['pedido_generado', 'en_produccion', 'saldo_pendiente', 'pagada']);
/**
 * El último paso de producción registrado (el inicio o el término de una fábrica): el que deshace «Volver al paso
 * anterior» mientras el pedido está en fábrica. null si ninguna fábrica empezó.
 */
export function ultimoPasoProduccion<T extends Pick<NotaPedido, 'inicioProduccion' | 'terminoProduccion' | 'anulada'>>(notas: T[]) {
  let ultimo: { nota: T; paso: 'inicioProduccion' | 'terminoProduccion'; fecha: string } | null = null;
  for (const nota of notas) {
    if (nota.anulada) continue;
    const paso = nota.terminoProduccion ? 'terminoProduccion' : nota.inicioProduccion ? 'inicioProduccion' : null;
    if (paso && (!ultimo || nota[paso]! >= ultimo.fecha)) ultimo = { nota, paso, fecha: nota[paso]! };
  }
  return ultimo;
}
/**
 * Lo que anuncia «Volver al paso anterior» (de qué paso a cuál) y el destino que aplica `retroceder_operacion`: solo
 * en una aprobada con un paso anterior. null si no hay a dónde volver. En fábrica, deshace el último inicio o término
 * de una fábrica (`nota`, con el campo que se borra); después de producir, vuelve al paso anterior de la operación.
 */
export function retrocesoOperativo(q: FaseOperativa & Pick<Cotizacion, 'notas' | 'pagos' | 'montos'>) {
  if (q.estado !== 'aprobada') return null;
  const actual = operacionDe(q);
  const ultimo = ETAPAS_PRODUCCION.has(actual) ? ultimoPasoProduccion(q.notas) : null;
  if (ultimo && (actual === 'en_produccion' || ultimo.paso === 'terminoProduccion')) {
    const notas = q.notas.map((n) => (n === ultimo.nota ? { ...n, [ultimo.paso]: null } : n));
    const destino = operacionPorProduccion(notas, totalPagado(q), q.montos.total);
    const fabrica = fabricaDeNota(ultimo.nota);
    // Con una sola nota se nombra la etapa de la operación, como antes de separar las fábricas.
    const una = q.notas.filter((n) => !n.anulada).length === 1;
    const desde = una ? etiquetaOperativo[actual] : `${etiquetaEtapa[etapaProduccion(ultimo.nota)]} en ${fabrica}`;
    const hasta = una
      ? etiquetaOperativo[destino]
      : `${ultimo.paso === 'terminoProduccion' ? etiquetaEtapa.en_produccion : etiquetaEtapa.pendiente} en ${fabrica}`;
    return { desde, hasta, destino, nota: { fabrica: ultimo.nota.fabrica ?? null, campo: ultimo.paso } };
  }
  const destino = PASO_ANTERIOR[actual];
  return destino ? { desde: etiquetaOperativo[actual], hasta: etiquetaOperativo[destino], destino, nota: null } : null;
}
/** Un pago se anula mientras la operación no llegue a «Lista para despacho» (ahí el saldo ya está pagado). */
export const pagoAnulable = (q: FaseOperativa) =>
  q.estado === 'aprobada' && !['lista_despacho', 'despachada', 'completada'].includes(q.estadoOperativo ?? '');
/** Suma de los pagos registrados. */
export const totalPagado = (q: Pick<Cotizacion, 'pagos'>) => (q.pagos ?? []).reduce((s, p) => s + p.monto, 0);
/**
 * ¿Se puede anular? Solo una emitida o una aprobada que no se despachó, completó ni facturó. Con `ok` trae lo
 * pagado (para advertirlo: anular no devuelve pagos); sin `ok`, el motivo que se muestra en vez del botón.
 * El servidor aplica esta misma regla.
 */
export function puedeAnular(
  q: Pick<Cotizacion, 'estado' | 'numero' | 'estadoOperativo' | 'facturacion' | 'pagos' | 'reemplazadaPor'>,
): { ok: true; pagado: number } | { ok: false; motivo: string } {
  if (q.estado === 'anulada') return { ok: false, motivo: `La cotización N° ${q.numero} ya está anulada.` };
  if (q.estado === 'borrador') return { ok: false, motivo: 'Un borrador no se anula: elimínalo.' };
  if (q.estado === 'reemplazada')
    return { ok: false, motivo: `La cotización N° ${q.numero} fue reemplazada y ya no está vigente.` };
  if (q.estadoOperativo === 'despachada' || q.estadoOperativo === 'completada' || q.facturacion?.estado === 'facturada')
    return { ok: false, motivo: 'No se puede anular una cotización despachada, completada o facturada.' };
  return { ok: true, pagado: totalPagado(q) };
}
/**
 * Días (YYYY-MM-DD, hora de Chile) que admite la fecha de un pago o de una factura: desde el día de la aprobación
 * (`aprobacion`, ISO; null si no se conoce) hasta hoy. Sirve de `min`/`max` del campo y el servidor lo exige.
 */
export const rangoFechaOperacion = (aprobacion: string | null | undefined, ahora: Date = new Date()) => ({
  min: aprobacion ? fechaLocal(aprobacion) : null,
  max: fechaLocal(ahora),
});
/** Con la cotización aprobada, los datos de despacho se editan hasta registrar el despacho. */
export const despachoEditable = (q: FaseOperativa) =>
  q.estado === 'aprobada' && !['despachada', 'completada'].includes(q.estadoOperativo ?? '');
/** Fila del listado: sin historial, solicitudes ni líneas. */
export interface ResumenCotizacion {
  id: string;
  numero: number | null;
  estado: EstadoCotizacion;
  cliente: Cliente;
  subtotal: number;
  /** Porcentaje de descuento. */
  descuento: number;
  /** Monto descontado en pesos. */
  descuentoMonto: number;
  flete: number;
  neto: number;
  iva: number;
  total: number;
  /** Cantidad de ítems pedidos y de ítems pendientes. */
  items: number;
  pendientes: number;
  /** Texto breve: «3 × MOLCO pino, 2 × MARCO». */
  productos: string;
  creada: string;
  actualizada: string;
  /** Fecha que describe el documento (anulación, aprobación, emisión o última edición); ordena el listado. */
  fecha: string;
  fechaEmision: string | null;
  vence: string | null;
  vencida: boolean;
  origen: number | null;
  reemplazadaPor: number | null;
  pdf: string | null;
  creadaPor: string | null;
  emitidaPor: string | null;
  aprobadaPor: string | null;
  anuladaPor: string | null;
  fechaAnulacion: string | null;
  notas: Pick<NotaPedido, 'numero' | 'fabrica' | 'pdf' | 'fecha' | 'anulada'>[];
  estadoComercial?: EstadoComercial;
  estadoOperativo?: EstadoOperativo;
  pagado?: number;
  saldoPendiente?: number;
  porcentajePagado?: number;
  pagos?: number;
  facturacion?: Pick<Facturacion, 'estado'>;
}
/** Entrada del registro de actividad de una cotización. */
export interface EventoCotizacion {
  fecha: string;
  usuario: string | null;
  tipo: TipoEvento;
  detalle: string | null;
}
export type TipoEvento =
  | 'creada'
  | 'revision'
  | 'duplicada'
  | 'modificada'
  | 'emitida'
  | 'aprobada'
  | 'anulada'
  | 'reemplazada'
  | 'desvinculada'
  | 'pago_registrado'
  | 'pago_anulado'
  | 'despacho_actualizado'
  | 'comentario'
  | 'seguimiento'
  | 'produccion'
  | 'produccion_terminada'
  | 'nota_generada'
  | 'fabricas'
  | 'numero_cambiado'
  | 'despachada'
  | 'lista_despacho'
  | 'completada'
  | 'facturada';
export const etiquetaEvento: Record<TipoEvento, string> = {
  creada: 'Creada',
  revision: 'Revisión creada',
  duplicada: 'Duplicada',
  modificada: 'Modificada',
  emitida: 'Emitida',
  aprobada: 'Aprobada',
  anulada: 'Anulada',
  reemplazada: 'Reemplazada',
  desvinculada: 'Queda como cotización nueva',
  pago_registrado: 'Pago registrado',
  pago_anulado: 'Pago anulado',
  despacho_actualizado: 'Despacho actualizado',
  comentario: 'Comentario interno',
  seguimiento: 'Seguimiento actualizado',
  produccion: 'Producción iniciada',
  produccion_terminada: 'Producción terminada',
  nota_generada: 'Nota de pedido generada',
  fabricas: 'Fábricas asignadas',
  numero_cambiado: 'Número cambiado',
  despachada: 'Despachada',
  lista_despacho: 'Lista para despacho',
  completada: 'Completada',
  facturada: 'Facturación actualizada',
};
export interface Estado {
  siguienteCotizacion: number;
  siguienteNota: number;
  cotizaciones: Cotizacion[];
}
export const CORRELATIVO_COTIZACION = 323;
/** Correlativo único de notas anterior a las fábricas (esquema < 24 y estado.json): ya no se usa. */
export const CORRELATIVO_NOTA = 1;
/**
 * Primer número de nota de pedido de cada fábrica: sigue la numeración que traía cada una al empezar a usar el
 * cotizador. Se aplica una sola vez, al crear el correlativo (migración v24); después se cambia con `npm run notas`.
 */
export const CORRELATIVOS_NOTA: Record<Fabrica, number> = { panguipulli: 577, santiago: 59 };
export const estadoInicial = (): Estado => ({
  siguienteCotizacion: CORRELATIVO_COTIZACION,
  siguienteNota: CORRELATIVO_NOTA,
  cotizaciones: [],
});
export const etiquetaEstado: Record<EstadoCotizacion, string> = {
  borrador: 'Borrador',
  emitida: 'Emitida',
  aprobada: 'Aprobada',
  reemplazada: 'Reemplazada',
  anulada: 'Anulada',
};
/** Solo un borrador admite cambios directos; editar una emitida crea (o reutiliza) su revisión. */
export const esEditable = (q: Pick<Cotizacion, 'estado'>) =>
  q.estado === 'borrador' || q.estado === 'emitida';

/** Aprobada con al menos una nota de pedido vigente: sus ítems se corrigen con `editar_pedido`, no con `editar`. */
export const pedidoGenerado = (q: Pick<Cotizacion, 'estado' | 'notas'>) =>
  q.estado === 'aprobada' && q.notas.some((n) => !n.anulada);

/**
 * El ítem de una aprobada con notas que todavía se puede corregir: su nota sigue vigente y su fábrica no empezó a
 * producirla. Un ítem libre no va a fábrica: se corrige mientras haya una nota vigente.
 */
export function itemCorregible(q: Pick<Cotizacion, 'estado' | 'notas' | 'solicitudes'>, indice: number) {
  const s = q.solicitudes[indice];
  if (!s || !pedidoGenerado(q)) return false;
  if (esLibre(s)) return true;
  const nota = q.notas.find((n) => !n.anulada && !!n.fabrica && n.fabrica === s.fabrica);
  return !!nota && !nota.inicioProduccion;
}

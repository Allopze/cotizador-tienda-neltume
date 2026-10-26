'use client';
import { Fragment, useEffect, useRef, useState, type RefObject } from 'react';
import {
  numeroNota,
  CODIGO_FLETE,
  cantidadFlete,
  descripcionFlete,
  despachoEditable,
  esEditable,
  etiquetaEstado,
  puedeAnular,
  sinTransportista,
  unitarioFlete,
  type Cotizacion,
} from '@/negocio/estado';
import { conDescuentoItem, descripcionLinea, pesos, precioConDescuento, textoDescuentoItem } from '@/negocio/precios';
import { metros } from '@/catalogo/resolver';
import { leerPesos } from '@/negocio/cifras';
import { LARGO_OBSERVACION_ITEM } from '@/negocio/limites';
import { esStarken } from '@/negocio/starken';
import { CampoEditable, type SugerenciaCampo } from './campo-editable';
import { CotizarStarken } from './cotizar-starken';
import { PreguntasPendientes, RESUMEN_FUERA_DE_REGLA, sinExplicacionRepetida } from './preguntas-pendientes';
import {
  ETIQUETA_PENDIENTE,
  faltantesItem,
  fueraDeRegla,
  preguntasPendientes,
  type CampoPendiente,
} from '@/negocio/pendientes';
import { bonito } from '@/asistente/preguntas';
import { metrosTexto } from '@/catalogo/escalones';
import { dimensionesEnMilimetros, indicesMedidaSinTipo } from '@/negocio/medidas';
import type { CambiosEdicion, Despacho } from './contrato';
import type { Familia } from '@/catalogo/tipos';
import type { ClienteAnterior } from '@/servidor/clientes';
import {
  ETIQUETA_CAMPO,
  SIN_CLIENTE,
  autoria,
  decimalCampo,
  errorMedida,
  fechaLarga,
  comportamientoScroll,
  leerMedida,
  medidaPedida,
  nombreProducto,
  numeroCotizacion,
  plural,
  referenciaCatalogo,
  validez,
  vencida,
} from './formato';
import { MargenCotizacion, MargenLinea, textoMargenLinea } from './margenes';
import { DescuentoLinea, descuentoEscrito, errorDescuentoItem, textoDescuentoLinea } from './descuento-item';
import { esPersonalizado, familiaEspecial, familiaItem, SIN_CATALOGO } from '@/negocio/personalizados';
import { ReferenciasItem } from './referencias-item';
import { MenuAcciones } from './menu-acciones';
import { Documento, Totales, type AccionesDocumentos } from './panel-totales';
import { SelectorDesplegable } from './selector-desplegable';
import { SeguimientoOperacion } from './seguimiento-operacion';
import { useCambioNumero } from './dialogos-cotizacion';
import { esSilencioso, pedirJSON } from './solicitud';

export type Operacion =
  'chat' | 'emitir' | 'aprobar' | 'quitar' | 'editar' | 'reordenar' | 'duplicar' | 'eliminar' | 'anular' | 'workflow';
export interface AccionesPanel {
  emitir: () => void;
  aprobar: () => void;
  quitar: (indice: number) => void;
  duplicar: () => void;
  eliminar: () => void;
  anular: () => void;
  /** Guarda cambios directos; `campo` identifica qué control muestra «Guardando…». */
  editar: (cambios: CambiosEdicion, campo: string) => Promise<boolean>;
  reordenar: (desde: number, hasta: number) => Promise<boolean>;
  deshacer: () => Promise<boolean>;
  rehacer: () => Promise<boolean>;
  puedeDeshacer: boolean;
  puedeRehacer: boolean;
  /** Datos de despacho de una cotización aprobada (antes de aprobar se editan con `editar`). */
  despacho: (cambios: Despacho, campo: string) => Promise<boolean>;
  /** Anula un pago registrado por error, previa confirmación. */
  anularPago: (pagoId: string) => Promise<boolean>;
  descargar: (archivo: string) => void;
  copiar: () => void;
  flujo: (accion: Record<string, unknown>) => Promise<boolean>;
}
interface Props {
  asistente: boolean;
  actual: Cotizacion | null;
  enCurso: Operacion | null;
  guardando: string | null;
  descargando: string | null;
  acciones: AccionesPanel;
  /** Ver y compartir los PDF de la cotización (`Documento`). */
  documentos?: AccionesDocumentos | null;
  tituloRef: RefObject<HTMLHeadingElement | null>;
  agregarProducto: () => void;
  cambioVisual: { indices: number[]; total: boolean; texto: string } | null;
  mostrarCotizacion: () => void;
  cargando: boolean;
  /** Cuenta administradora: cambia el número de la cotización y de sus notas desde sus documentos. */
  admin?: boolean;
}
/** Línea valorizada que corresponde al ítem i (los incompletos no tienen línea). */
function lineaDe(q: Cotizacion, i: number) {
  const pendiente = q.incompletos.find((p) => p.indice === i);
  if (pendiente) return { pendiente, linea: null };
  const porIndice = q.montos.lineas.find((l) => l.indice === i);
  if (porIndice) return { pendiente, linea: porIndice };
  const index = i - q.incompletos.filter((p) => p.indice < i).length;
  return { pendiente, linea: q.montos.lineas[index] ?? null };
}
export const descripcionItem = (q: Cotizacion, i: number) => {
  const { linea } = lineaDe(q, i);
  return nombreProducto(
    (linea && descripcionLinea(linea)) ||
      q.solicitudes[i]?.descripcion ||
      q.solicitudes[i]?.modelo ||
      'Producto por definir',
  );
};
/**
 * Descripción que arma el sistema para el ítem, sin la escrita a mano. Un ítem pendiente se muestra con su modelo;
 * null si aún no tiene modelo.
 */
function descripcionGenerada(q: Cotizacion, i: number) {
  const { linea } = lineaDe(q, i);
  if (!linea) return q.solicitudes[i]?.modelo || null;
  // Un personalizado se describe con su nombre y madera (servicio.ts, `recalcular`).
  return esPersonalizado(q.solicitudes[i])
    ? linea.producto.descripcion
    : descripcionLinea({ ...linea, descripcionDocumento: null });
}
/**
 * Descripción para el documento que se guarda: vacía o igual a la generada queda en null, así el documento
 * sigue al ítem si después cambian el modelo, la madera o las medidas.
 */
export function descripcionAGuardar(q: Cotizacion, i: number, texto: string) {
  const v = texto.trim();
  const generada = descripcionGenerada(q, i);
  return !v || (generada !== null && (v === generada || v === nombreProducto(generada))) ? null : v;
}
/**
 * Lo que ya se sabe de un ítem pendiente, aparte del modelo y la cantidad que muestra la fila. El largo se lee
 * con la familia del ítem: una moldura de 3,6 m no es una medida implausible.
 */
function entendido(s: Cotizacion['solicitudes'][number], familia: Familia) {
  const medida = (n: number | null) => {
    const m = n === null ? null : metros(n, familia);
    return m === null ? '—' : metrosTexto(m);
  };
  const medidas = s.medida
    ? `${s.medida}${s.alto !== null ? ` × ${medida(s.alto)} m` : ''}`
    : dimensionesEnMilimetros(
        s.ancho === null ? null : metros(s.ancho, 'PUERTA'),
        s.alto === null ? null : metros(s.alto, familia),
        s.tipoMedida,
      );
  return [s.madera && bonito(s.madera), medidas].filter(Boolean).join(' · ');
}
const textoFaltan = (campos: CampoPendiente[]) =>
  campos.map((c) => ETIQUETA_PENDIENTE[c].toLowerCase()).join(', ');

/** Frase que el panel sugiere agregar a las puertas sin tipo de medida; la escribe la persona, no el sistema. */
const RECTIFICAR_MEDIDA = 'Rectificar si la medida corresponde a hoja o vano.';

/**
 * El flete como una línea más del detalle: descripción, cantidad y unitario se editan igual que en un
 * producto, y su total es cantidad × unitario. No lleva descuento ni entra en la nota de pedido.
 */
function FilaFlete({
  actual,
  editable,
  conQuitar,
  guardando,
  editar,
  quitar,
  recienAgregada,
}: {
  actual: Cotizacion;
  editable: boolean;
  conQuitar: boolean;
  guardando: string | null;
  editar: AccionesPanel['editar'];
  quitar: () => void;
  /** Recién pedida con «Agregar flete»: abre el unitario para escribirlo. */
  recienAgregada: boolean;
}) {
  const descripcion = descripcionFlete(actual);
  const unitario = unitarioFlete(actual);
  const fila = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (recienAgregada) fila.current?.querySelector<HTMLButtonElement>('.celda-monto button')?.click();
  }, [recienAgregada]);
  return (
    <tr ref={fila} id="linea-flete" className="linea-flete">
      <td>
        <CampoEditable
          etiqueta="Descripción del flete"
          etiquetaOculta
          discreto
          valor={descripcion}
          mostrar={<strong>{descripcion}</strong>}
          editable={editable}
          guardando={guardando === 'flete.descripcion'}
          maxLength={300}
          guardar={(v) => editar({ fleteLinea: { descripcion: v || null } }, 'flete.descripcion')}
        />
        <small>{CODIGO_FLETE}</small>
        <small>Sin IVA · no lleva descuento</small>
      </td>
      <td className="celda-cantidad" data-etiqueta="Cant.">
        <CampoEditable
          etiqueta="Cantidad del flete"
          etiquetaOculta
          discreto
          valor={String(cantidadFlete(actual))}
          editable={editable}
          guardando={guardando === 'flete.cantidad'}
          tipo="number"
          min={1}
          max={10000}
          paso={1}
          validar={(v) => {
            const n = Number(v);
            return Number.isInteger(n) && n >= 1 && n <= 10000
              ? null
              : 'La cantidad debe ser un número entero entre 1 y 10.000.';
          }}
          guardar={(v) => editar({ fleteLinea: { cantidad: Number(v) } }, 'flete.cantidad')}
        />
      </td>
      <td className="celda-monto" data-etiqueta="Unitario">
        <CampoEditable
          etiqueta="Unitario del flete"
          etiquetaOculta
          discreto
          valor={unitario ? String(unitario) : ''}
          mostrar={pesos(unitario)}
          editable={editable}
          guardando={guardando === 'flete.unitario'}
          tipo="text"
          sufijo="$"
          validar={(v) => {
            const n = v ? leerPesos(v) : 0;
            return Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000
              ? null
              : 'El flete debe ser un monto entero en pesos, entre $0 y $100.000.000.';
          }}
          guardar={(v) => editar({ fleteLinea: { unitario: v ? leerPesos(v) : 0 } }, 'flete.unitario')}
        />
      </td>
      <td className="celda-monto celda-total" data-etiqueta="Total sin IVA">
        {pesos(actual.flete)}
      </td>
      {conQuitar && (
        <td className="celda-acciones">
          <button
            type="button"
            className="remove"
            onClick={quitar}
            disabled={!editable}
            aria-label={`Quitar línea de flete: ${descripcion}`}
          >
            ×
          </button>
        </td>
      )}
    </tr>
  );
}

const CAMPOS_CLIENTE = ['nombre', 'rut', 'giro', 'comuna', 'direccion', 'telefono', 'proyecto'] as const;
/** Datos que completa un cliente de otra cotización; el proyecto es de cada cotización y no se copia. */
const CAMPOS_CLIENTE_ANTERIOR = ['nombre', 'rut', 'giro', 'telefono', 'direccion', 'comuna'] as const;
/** Lo que trae el cliente elegido; un dato que no tiene no borra el ya escrito en esta cotización. */
export function datosClienteAnterior(c: ClienteAnterior): CambiosEdicion['cliente'] {
  const datos: NonNullable<CambiosEdicion['cliente']> = {};
  for (const campo of CAMPOS_CLIENTE_ANTERIOR) if (c[campo]) datos[campo] = c[campo];
  return datos;
}

/** «Otro» de la lista de transportistas no es un nombre (`sinTransportista`): pide escribirlo y no se guarda solo. */
export const esOtroTransportista = (t: string | null | undefined) => !!t?.trim() && sinTransportista(t);
const OPCION_OTRO = '__otro__';

function notaEstado(q: Cotizacion | null) {
  if (!q) return 'Revisa antes de compartir; tú decides cuándo emitirla.';
  switch (q.estado) {
    case 'anulada':
      return [
        `Anulada${q.anuladaPor ? ` por ${q.anuladaPor}` : ''}${q.fechaAnulacion ? ` el ${fechaLarga(q.fechaAnulacion)}` : ''}.`,
        q.motivoAnulacion && `Motivo: ${q.motivoAnulacion}.`,
        'Puedes duplicarla para preparar una nueva.',
      ]
        .filter(Boolean)
        .join(' ');
    case 'reemplazada':
      return `${q.reemplazadaPor ? `Reemplazada por la revisión N° ${q.reemplazadaPor}.` : 'Reemplazada por otra cotización de la misma serie.'} Ya no se puede aprobar ni editar.`;
    case 'aprobada':
      return q.notas.some((n) => n.anulada)
        ? 'Cotización aprobada; su nota de pedido fue anulada.'
        : 'Cotización aprobada y bloqueada para edición.';
    case 'emitida':
      // La fecha va en la cabecera y el aviso de revisión, en la franja superior: aquí solo se repetiría.
      return null;
    default:
      return q.origen
        ? `Revisión de la cotización N° ${q.origen}. Revisa antes de compartir; tú decides cuándo emitirla.`
        : 'Revisa antes de compartir; tú decides cuándo emitirla.';
  }
}

/** Medida en metros con coma decimal, como en el resto de la cotización («0,80»). */
const decimal = (n: number) =>
  n.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

export function CotizacionPanel({
  asistente,
  actual,
  enCurso,
  guardando,
  descargando,
  acciones,
  documentos,
  tituloRef,
  agregarProducto,
  cambioVisual,
  mostrarCotizacion,
  cargando,
  admin = false,
}: Props) {
  const ocupado = enCurso !== null;
  const [pedirNumero, dialogoNumero] = useCambioNumero();
  /** Pide el número nuevo de un documento y lo aplica: el servidor vuelve a generar su PDF. */
  async function cambiarNumero(datos: Parameters<typeof pedirNumero>[0]) {
    if (ocupado) return;
    const r = await pedirNumero(datos);
    if (r)
      await acciones.flujo({
        tipo: 'cambiar_numero',
        documento: datos.documento,
        ...(datos.fabrica ? { fabrica: datos.fabrica } : {}),
        numero: r.numero,
      });
  }
  // Una emitida solo muestra controles de edición cuando se pide modificarla: editarla crea una revisión.
  const [modificando, setModificando] = useState<string | null>(null);
  const [arrastrado, setArrastrado] = useState<number | null>(null);
  const [destinoArrastre, setDestinoArrastre] = useState<number | null>(null);
  const indiceArrastrado = useRef<number | null>(null);
  /** Cotización en la que se pidió «Agregar flete»: muestra la línea en $0 hasta que se guarde un valor. */
  const [agregandoFlete, setAgregandoFlete] = useState<string | null>(null);
  /**
   * Transportistas de Ajustes, leídos del servidor cada vez que se abre Despacho (sin copia local: un cambio en
   * Ajustes se ve sin recargar). null: aún no se leen; 'error': no se pudieron leer.
   */
  const [transportistas, setTransportistas] = useState<string[] | null | 'error'>(null);
  const cargaTransportistas = useRef<AbortController | null>(null);
  /** Cotización en la que se eligió «Otro»: se pide el nombre y nada se guarda hasta escribirlo. */
  const [eligiendoOtro, setEligiendoOtro] = useState<string | null>(null);
  useEffect(() => () => cargaTransportistas.current?.abort(), []);
  function cargarTransportistas() {
    cargaTransportistas.current?.abort();
    const control = new AbortController();
    cargaTransportistas.current = control;
    pedirJSON<{ configuracion?: { transportistas?: string[] } }>('/api/configuracion-negocio', {
      signal: control.signal,
      cache: 'no-store',
    })
      .then((d) => setTransportistas(d.configuracion?.transportistas ?? []))
      .catch((e) => {
        if (!esSilencioso(e) && !control.signal.aborted) setTransportistas((t) => (Array.isArray(t) ? t : 'error'));
      });
  }
  useEffect(() => {
    const alPresionar = (evento: KeyboardEvent) => {
      if (evento.defaultPrevented || evento.altKey || (!evento.metaKey && !evento.ctrlKey)) return;
      const objetivo = evento.target;
      if (
        objetivo instanceof HTMLElement &&
        (objetivo.isContentEditable || objetivo.matches('input, textarea, select'))
      ) return;
      const tecla = evento.key.toLowerCase();
      const rehacer = (tecla === 'z' && evento.shiftKey) || (tecla === 'y' && evento.ctrlKey && !evento.metaKey);
      const deshacer = tecla === 'z' && !evento.shiftKey;
      if (rehacer && acciones.puedeRehacer) {
        evento.preventDefault();
        void acciones.rehacer();
      } else if (deshacer && acciones.puedeDeshacer) {
        evento.preventDefault();
        void acciones.deshacer();
      }
    };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  }, [acciones]);
  if (!actual)
    return (
      <section
        id="panel-cotizacion"
        className="quote-panel quote-panel-empty"
        aria-label="Vista previa de la cotización"
      >
        <div className="panel-heading">
          <div>
            <h2 id="cotizacion-titulo" ref={tituloRef} tabIndex={-1}>
              Vista previa
            </h2>
          </div>
        </div>
        <div className="empty-quote">
          <div className="empty-quote-door" aria-hidden="true">
            <span />
          </div>
          <p className="empty-quote-step">TU PEDIDO, EN CLARO</p>
          <h3>La cotización aparecerá aquí.</h3>
          <p>
            Envía el pedido para ver el cliente, los productos y los valores. Podrás corregirlos antes de
            emitir el PDF.
          </p>
          <button
            type="button"
            className="button secondary"
            onClick={agregarProducto}
            disabled={ocupado || cargando}
          >
            Agregar producto del catálogo
          </button>
        </div>
      </section>
    );
  const puedeModificar = actual?.estado !== 'emitida' || modificando === actual.id;
  const admiteCambios = !!actual && esEditable(actual) && puedeModificar;
  const editable = admiteCambios && !ocupado;
  const conItems = !!actual?.montos.lineas.length;
  // El flete no depende de que los productos ya tengan precio: con todos pendientes sigue en la cotización.
  const conProductos = !!actual?.solicitudes.length;
  const medidasPendientes = indicesMedidaSinTipo(actual);
  const listo = conItems && !actual.incompletos.length && !medidasPendientes.length;
  const estado = actual.estado;
  const anulable = puedeAnular(actual);
  const esVencida = vencida(actual);
  const ayudaEmitir = !actual?.solicitudes.length
    ? 'Agrega al menos un producto para generar el PDF.'
    : actual.incompletos.length
      ? 'Completa o quita los ítems pendientes para generar el PDF.'
      : medidasPendientes.length
        ? 'Confirma si la medida corresponde a la hoja o al vano antes de emitir.'
      : null; // Lista para emitir: el diálogo de confirmación explica qué pasa.
  const irAPendiente = (indice: number) => {
    mostrarCotizacion();
    requestAnimationFrame(() => {
      const el = document.getElementById(`producto-${indice}`);
      el?.scrollIntoView({ behavior: comportamientoScroll(), block: 'center' });
      (el?.querySelector<HTMLButtonElement>('.measure-choice button') ??
        el?.nextElementSibling?.querySelector<HTMLElement>('summary'))?.focus({ preventScroll: true });
    });
  };
  // Desde la aprobación y hasta registrar el despacho, los datos logísticos se editan sin crear revisión.
  const editaDespacho = editable || (despachoEditable(actual) && !ocupado);
  const guardarDespacho = (cambios: Despacho, campo: string) =>
    editable ? acciones.editar({ despacho: cambios }, campo) : acciones.despacho(cambios, campo);
  /** Clientes de cotizaciones anteriores para lo escrito en el nombre o el RUT; elegir uno completa sus datos. */
  const sugerirCliente =
    (campo: 'nombre' | 'rut') =>
    async (texto: string, senal: AbortSignal): Promise<SugerenciaCampo[]> => {
      const { clientes } = await pedirJSON<{ clientes: ClienteAnterior[] }>(
        `/api/clientes?${new URLSearchParams({ q: texto, excluir: actual.id })}`,
        { signal: senal, cache: 'no-store' },
      );
      return clientes.map((c) => ({
        clave: `${c.rut ?? ''}|${c.nombre ?? ''}`,
        etiqueta: (campo === 'rut' ? c.rut : c.nombre) ?? c.nombre ?? c.rut ?? SIN_CLIENTE,
        detalle:
          [campo === 'rut' ? c.nombre : c.rut, c.giro, c.comuna].filter(Boolean).join(' · ') || undefined,
        aplicar: () => acciones.editar({ cliente: datosClienteAnterior(c) }, `cliente.${campo}`),
      }));
    };
  const quien = [
    autoria(actual),
    actual.fechaEmision && estado !== 'borrador' && fechaLarga(actual.fechaEmision),
  ]
    .filter(Boolean)
    .join(' · ');
  // Las bloqueadas no muestran el botón de quitar: no hay nada que hacer con él.
  const conQuitar = !!actual && esEditable(actual) && puedeModificar;
  const conFlete =
    !!actual && (actual.flete > 0 || !!actual.fleteDescripcion || agregandoFlete === actual.id);
  const indicePendiente = actual.incompletos[0]?.indice ?? medidasPendientes[0];
  const cantidadPendientes = actual.incompletos.length + medidasPendientes.length;
  const controlesEdicion = () => (
    <>
      <div className="quote-edit-history" aria-label="Historial de edición">
        <button
          type="button"
          className="button secondary small"
          aria-keyshortcuts="Control+Z Meta+Z"
          title="Deshacer · Ctrl/Cmd + Z"
          disabled={!editable || !acciones.puedeDeshacer}
          onClick={() => void acciones.deshacer()}
        >
          Deshacer
        </button>
        <button
          type="button"
          className="button secondary small"
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
          title="Rehacer · Ctrl/Cmd + Shift + Z"
          disabled={!editable || !acciones.puedeRehacer}
          onClick={() => void acciones.rehacer()}
        >
          Rehacer
        </button>
      </div>
      <button type="button" className="button secondary small" disabled={ocupado} onClick={agregarProducto}>
        + Agregar producto
      </button>
      {conProductos && !conFlete && (
        <button
          type="button"
          className="button secondary small"
          disabled={ocupado}
          onClick={() => setAgregandoFlete(actual.id)}
        >
          + Agregar flete
        </button>
      )}
    </>
  );
  // Todas las notas se generan juntas con el mismo despacho.
  const despacho = actual?.notas[0]?.despacho;
  const transporteNota = esOtroTransportista(despacho?.transporte) ? null : despacho?.transporte;
  const condicionDespacho =
    despacho && (despacho.direccion || transporteNota)
      ? `Despacho: ${[despacho.direccion, transporteNota].filter(Boolean).join(' · ')}`
      : actual?.montos.flete
        ? `Incluye flete por ${pesos(actual.montos.flete)} sin IVA`
        : 'Despacho por confirmar';
  const ocurrenciasItems = new Map<string, number>();
  // Transportista: la lista de Ajustes (sin «Otro», que se ofrece siempre al final) y, mientras se lee, el guardado.
  const transporte = actual.despacho?.transporte ?? '';
  const listaTransportistas = Array.isArray(transportistas) ? transportistas : null;
  const conocidos = (listaTransportistas ?? []).filter((t) => !esOtroTransportista(t));
  /** Escrito a mano: no está en la lista de Ajustes. «Otro» guardado literal (versiones anteriores) pide el nombre. */
  const transporteLibre = !!transporte && !esOtroTransportista(transporte) && !!listaTransportistas && !conocidos.includes(transporte);
  const valorTransportista =
    eligiendoOtro === actual.id || transporteLibre || esOtroTransportista(transporte) ? OPCION_OTRO : transporte;
  const opcionesTransportista = [
    { value: '', label: 'Seleccionar transportista' },
    ...conocidos.map((nombre) => ({ value: nombre, label: nombre })),
    ...(!listaTransportistas && transporte && !esOtroTransportista(transporte)
      ? [{ value: transporte, label: transporte }]
      : []),
    { value: OPCION_OTRO, label: transporteLibre ? `Otro · ${transporte}` : 'Otro' },
  ];
  return (
    <section id="panel-cotizacion" className={`quote-panel estado-${estado}`} aria-label="Cotización en curso">
      <div className="panel-heading">
        <div>
          <h2 id="cotizacion-titulo" ref={tituloRef} tabIndex={-1}>
            {/* Una revisión sin emitir se nombra por la cotización que reemplaza, no «Sin número». */}
            {!actual.numero && actual.origen
              ? `Revisión de N° ${actual.origen}`
              : numeroCotizacion(actual.numero)}
          </h2>
          {quien && <p className="autoria">{quien}</p>}
        </div>
        <span className="estado-badges">
          <span className={`status ${estado}`}>{etiquetaEstado[estado]}</span>
          {esVencida && <span className="status vencida">Vencida</span>}
        </span>
      </div>
      {actual?.estado === 'emitida' && esEditable(actual) && (
        // Informativa mientras solo se mira; ámbar al entrar en modo edición, que sí tiene consecuencias.
        <div className={`panel-aviso${puedeModificar ? ' editando' : ''}`} id="aviso-revision">
          <p>
            {puedeModificar
              ? 'Modo edición: el primer cambio crea una revisión (una versión nueva en borrador que reemplazará a esta al emitirla) y este PDF se conserva.'
              : 'Para cambiarla se crea una revisión: una versión nueva en borrador que reemplazará a esta al emitirla. Este PDF se conserva.'}
          </p>
          <button
            type="button"
            className="button secondary small"
            onClick={() => setModificando(puedeModificar ? null : actual.id)}
            disabled={ocupado}
            aria-pressed={puedeModificar}
          >
            {puedeModificar ? 'Terminar' : 'Modificar'}
          </button>
        </div>
      )}
      <div className="quote-overview">
        <strong>{actual.cliente.nombre || SIN_CLIENTE}</strong>
        <span>
          {[actual.cliente.proyecto, actual.cliente.comuna].filter(Boolean).join(' · ') ||
            'Cliente opcional · puedes completarlo después'}
        </span>
      </div>
      {actual.incompletos.length > 0 && (
        <div className="quote-pending-summary" role="status">
          <strong>{plural(actual.incompletos.length, 'producto pendiente', 'productos pendientes')}</strong>
          <p>
            Los productos pendientes no están incluidos en el total. Completa los campos indicados para
            emitir.
          </p>
        </div>
      )}
      <p className="quote-change-note" role="status">
        {cambioVisual?.texto || ''}
      </p>
      {/* El detalle mantiene juntos los importes y los campos editables de cada producto. */}
      <div className="quote-cuerpo">
        <div className="items-top">
          <span>Productos</span>
          <div className="items-heading-actions">
            <span>{plural(actual?.solicitudes.length ?? 0, 'ítem')}</span>
            {admiteCambios && (
              <button type="button" className="button secondary small quote-add-mobile" aria-label="Agregar producto" disabled={ocupado} onClick={agregarProducto}>
                + Producto
              </button>
            )}
            {admiteCambios && (
              <div className="items-heading-actions-desktop">
                {controlesEdicion()}
              </div>
            )}
            {admiteCambios && (
              <details className="quote-edit-menu">
                <summary>Editar</summary>
                <div>{controlesEdicion()}</div>
              </details>
            )}
          </div>
        </div>
        {actual?.solicitudes.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">PRODUCTO / CÓDIGO</th>
                  <th scope="col">CANT.</th>
                  <th scope="col">UNITARIO</th>
                  <th scope="col">TOTAL SIN IVA</th>
                  {conQuitar && (
                    <th>
                      <span className="sr-only">Acciones</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {actual.solicitudes.map((s, i) => {
                  const identidad = JSON.stringify([s.modelo, s.madera, s.fuente]);
                  const ocurrencia = ocurrenciasItems.get(identidad) ?? 0;
                  ocurrenciasItems.set(identidad, ocurrencia + 1);
                  const { pendiente, linea } = lineaDe(actual, i);
                  const medida = linea && medidaPedida(linea);
                  const descripcion = descripcionItem(actual, i);
                  // Puertas hasta 3 m; el largo de marcos, piezas T y molduras, hasta 6 m (`rangoMedidas`).
                  const familia = familiaItem(s, linea?.producto, pendiente?.rechazo);
                  const anchoMetros = s.ancho === null ? null : metros(s.ancho, 'PUERTA');
                  const altoMetros = s.alto === null ? null : metros(s.alto, familia);
                  const faltan = faltantesItem(actual, i) ?? [];
                  const falta = (campo: CampoPendiente) =>
                    faltan.includes(campo) ? ' item-campo-falta' : '';
                  const preguntasItem = pendiente
                    ? preguntasPendientes({ solicitudes: actual.solicitudes, incompletos: [pendiente] })
                    : [];
                  const sabido = pendiente ? entendido(s, familia) : '';
                  // Pendiente por un precio o un descuento fuera de regla: se corrige en la misma celda.
                  // La explicación se muestra una sola vez, bajo el producto (`pending-resumen`); el resumen del
                  // detalle y su pregunta solo ofrecen cómo corregirlo.
                  const explicacionPrecio = pendiente ? fueraDeRegla(actual, i) : null;
                  const precioPendiente = !linea && !!explicacionPrecio;
                  const descuentoPendiente = precioPendiente ? (s.descuento ?? null) : null;
                  const medidaSinTipo = medidasPendientes.includes(i);
                  // Fuera de catálogo: se titula con su nombre y su precio es el escrito, sin margen ni referencia de catálogo.
                  const personalizado = esPersonalizado(s);
                  return (
                    <Fragment key={`${identidad}#${ocurrencia}`}>
                      <tr
                        id={`producto-${i}`}
                        draggable={editable && actual.solicitudes.length > 1}
                        className={[
                          pendiente ? 'pending' : '',
                          cambioVisual?.indices.includes(i) ? 'item-actualizado' : '',
                          editable && actual.solicitudes.length > 1 ? 'item-arrastrable' : '',
                          arrastrado === i ? 'item-arrastrando' : '',
                          destinoArrastre === i && arrastrado !== i ? 'item-destino-arrastre' : '',
                        ].filter(Boolean).join(' ')}
                        onDragStart={(evento) => {
                          if (!editable) return;
                          evento.dataTransfer.effectAllowed = 'move';
                          evento.dataTransfer.setData('text/plain', String(i));
                          indiceArrastrado.current = i;
                          setArrastrado(i);
                        }}
                        onDragOver={(evento) => {
                          const desde = indiceArrastrado.current;
                          if (desde === null || desde === i) return;
                          evento.preventDefault();
                          evento.dataTransfer.dropEffect = 'move';
                          setDestinoArrastre(i);
                        }}
                        onDrop={(evento) => {
                          evento.preventDefault();
                          const desde = indiceArrastrado.current ?? Number(evento.dataTransfer.getData('text/plain'));
                          indiceArrastrado.current = null;
                          if (Number.isInteger(desde) && desde !== i) void acciones.reordenar(desde, i);
                          setArrastrado(null);
                          setDestinoArrastre(null);
                        }}
                        onDragEnd={() => {
                          indiceArrastrado.current = null;
                          setArrastrado(null);
                          setDestinoArrastre(null);
                        }}
                      >
                        <td>
                          <div className="quote-item-title">
                            {editable && actual.solicitudes.length > 1 && (
                              <span className="item-arrastre" aria-hidden="true" title="Arrastra para reordenar">
                                ⠿
                              </span>
                            )}
                            <strong>{personalizado ? s.modelo || 'Producto personalizado' : descripcion}</strong>
                          </div>
                          {personalizado ? (
                            <small className="item-personalizado">
                              Personalizado · fuera de catálogo{s.madera ? ` · ${s.madera}` : ''}
                            </small>
                          ) : (
                            <small>{linea?.producto.codigo || 'Pendiente de completar'}</small>
                          )}
                          {personalizado && s.descripcion && <small className="item-descripcion">{s.descripcion}</small>}
                          {medida && <small>{medida}</small>}
                          {/* Con la cotización editable, el margen se ve (y se cambia) en el bloque de edición de la línea. */}
                          {!editable && linea && !personalizado && textoMargenLinea(actual, linea) && (
                            <small className="margen-manual">{textoMargenLinea(actual, linea)}</small>
                          )}
                          {!editable && linea && textoDescuentoLinea(linea) && (
                            <small className="descuento-item-texto">{textoDescuentoLinea(linea)}</small>
                          )}
                          {((linea && !personalizado) || s.modeloOriginal || s.fuente) && (
                            <details className="item-provenance">
                              <summary>Ver referencia y origen del pedido</summary>
                              {linea && !personalizado && <small>{referenciaCatalogo(linea)}</small>}
                              {s.modeloOriginal && s.coincidenciaModelo && (
                                <small className={`match-confidence ${s.coincidenciaModelo}`}>
                                  {/* Lo que se escribió y no era el nombre exacto del catálogo: se dice en palabras simples. */}
                                  Lo escribiste como «{s.modeloOriginal}».{' '}
                                  {s.coincidenciaModelo === 'alias'
                                    ? 'Es otro nombre del mismo modelo.'
                                    : 'Revisa que sea el modelo correcto.'}
                                </small>
                              )}
                              {s.fuente && (
                                <small className="item-fuente" title="Lo que se escribió en el pedido">
                                  «{s.fuente}»
                                </small>
                              )}
                            </details>
                          )}
                          {/* `admiteCambios` y no `editable`: mientras se guarda, el bloque conserva su estado. */}
                          <ReferenciasItem
                            referencias={s.referencias ?? []}
                            editable={admiteCambios}
                            ocupado={ocupado}
                            producto={`ítem ${i + 1}: ${descripcion}`}
                            guardar={(referencias) =>
                              acciones.editar(
                                { items: [{ indice: i, cambios: { referencias } }] },
                                `item.${i}.referencias`,
                              )
                            }
                          />
                          {pendiente && <span className="pending-label">Incompleto · no suma al total</span>}
                          {pendiente && (
                            <small className="pending-resumen">
                              {sabido && <>Entendido: {sabido}. </>}
                              {faltan.length ? `Falta: ${textoFaltan(faltan)}.` : fueraDeRegla(actual, i)}
                            </small>
                          )}
                          {pendiente && editable && s.modelo && SIN_CATALOGO.has(pendiente.rechazo.tipo) && (
                            // Lo que no existe en el catálogo se cotiza como especial con el precio que se indique.
                            <div className="cotizar-especial">
                              <CampoEditable
                                etiqueta={`Precio sin IVA para cotizar como especial: ${descripcion}`}
                                etiquetaOculta
                                discreto
                                vacio="Cotizar como especial"
                                valor=""
                                editable={editable}
                                guardando={guardando === `item.${i}.especial`}
                                tipo="text"
                                modoEntrada="numeric"
                                sufijo="$"
                                validar={(v) => {
                                  const n = leerPesos(v);
                                  return Number.isSafeInteger(n) && n > 0 && n <= 100_000_000
                                    ? null
                                    : 'Escribe el precio unitario sin IVA en pesos, entre $1 y $100.000.000.';
                                }}
                                guardar={(v) =>
                                  acciones.editar(
                                    {
                                      items: [
                                        {
                                          indice: i,
                                          cambios: {
                                            personalizado: { familia: familiaEspecial(pendiente.rechazo, s) },
                                            precioUnitario: leerPesos(v),
                                          },
                                        },
                                      ],
                                    },
                                    `item.${i}.especial`,
                                  )
                                }
                              />
                            </div>
                          )}
                          {medidaSinTipo && (
                            <div className="measure-choice" role="group" aria-label={`Medida del ítem ${i + 1}`}>
                              <strong>Falta confirmar la medida</strong>
                              <span>¿La medida solicitada corresponde a la hoja o al vano?</span>
                              <small className="measure-choice-ayuda">
                                Hoja: la puerta misma. Vano: el hueco del muro donde va instalada.
                              </small>
                              {editable ? (
                                <div>
                                  <button type="button" disabled={ocupado} onClick={() => void acciones.editar(
                                    { items: [{ indice: i, cambios: { tipoMedida: 'hoja' } }] },
                                    `item.${i}.tipoMedida`,
                                  )}>Medida de hoja</button>
                                  <button type="button" disabled={ocupado} onClick={() => void acciones.editar(
                                    { items: [{ indice: i, cambios: { tipoMedida: 'vano' } }] },
                                    `item.${i}.tipoMedida`,
                                  )}>Medida de vano</button>
                                </div>
                              ) : <span>Tipo de medida no especificado en esta cotización.</span>}
                            </div>
                          )}
                        </td>
                        <td className="celda-cantidad" data-etiqueta="Cant.">
                          <CampoEditable
                            etiqueta={`Cantidad de ${descripcion}`}
                            etiquetaOculta
                            discreto
                            valor={s.cantidad === null ? '' : String(s.cantidad)}
                            mostrar={s.cantidad ?? '—'}
                            editable={editable}
                            guardando={guardando === `cantidad.${i}`}
                            tipo="number"
                            min={1}
                            max={10000}
                            paso={1}
                            validar={(v) => {
                              const n = Number(v);
                              return Number.isInteger(n) && n >= 1 && n <= 10000
                                ? null
                                : 'La cantidad debe ser un número entero entre 1 y 10.000.';
                            }}
                            guardar={(v) =>
                              acciones.editar(
                                { cantidades: [{ indice: i, cantidad: Number(v) }] },
                                `cantidad.${i}`,
                              )
                            }
                          />
                        </td>
                        <td className="celda-monto" data-etiqueta="Unitario">
                          {/* El mismo campo antes y después de corregir un pendiente: conserva el foco al valorizarse. */}
                          {linea || precioPendiente ? (
                            <CampoEditable
                              etiqueta="Precio unitario"
                              etiquetaOculta
                              valor={
                                s.precioUnitario === null || s.precioUnitario === undefined
                                  ? ''
                                  : String(s.precioUnitario)
                              }
                              mostrar={
                                !linea ? (
                                  s.precioUnitario != null ? pesos(s.precioUnitario) : undefined
                                ) : conDescuentoItem(linea) ? (
                                  <s className="precio-original" title="Precio original">
                                    {pesos(linea.precioUnitario)}
                                  </s>
                                ) : (
                                  pesos(linea.precioUnitario)
                                )
                              }
                              vacio="Precio de catálogo"
                              editable={editable}
                              discreto
                              guardando={guardando === `item.${i}.precioUnitario`}
                              tipo="text"
                              sufijo="$"
                              validar={(v) => {
                                const n = v ? leerPesos(v) : null;
                                if (n === null && personalizado)
                                  return 'Un producto personalizado necesita su precio unitario.';
                                return n === null || (Number.isSafeInteger(n) && n > 0 && n <= 100_000_000)
                                  ? null
                                  : 'El precio debe ser un entero entre $1 y $100.000.000.';
                              }}
                              guardar={(v) =>
                                acciones.editar(
                                  {
                                    items: [
                                      { indice: i, cambios: { precioUnitario: v ? leerPesos(v) : null } },
                                    ],
                                  },
                                  `item.${i}.precioUnitario`,
                                )
                              }
                            />
                          ) : (
                            '—'
                          )}
                          {linea && conDescuentoItem(linea) && (
                            <span className="precio-descuento" title="Precio con descuento especial">
                              {pesos(precioConDescuento(linea))}
                            </span>
                          )}
                          {descuentoPendiente && (
                            <CampoEditable
                              etiqueta="Descuento especial del ítem"
                              etiquetaOculta
                              discreto
                              valor={String(descuentoPendiente.valor).replace('.', ',')}
                              mostrar={`Descuento ${textoDescuentoItem(descuentoPendiente)}`}
                              editable={editable}
                              guardando={guardando === `item.${i}.descuento`}
                              tipo="text"
                              modoEntrada={descuentoPendiente.tipo === 'porcentaje' ? 'decimal' : 'numeric'}
                              sufijo={descuentoPendiente.tipo === 'porcentaje' ? '%' : '$'}
                              // Sin línea no se conoce el precio de catálogo: el tope en pesos lo revisa el servidor.
                              validar={(v) =>
                                errorDescuentoItem(
                                  descuentoPendiente.tipo,
                                  v,
                                  s.precioUnitario ?? Number.MAX_SAFE_INTEGER,
                                )
                              }
                              guardar={(v) =>
                                acciones.editar(
                                  {
                                    items: [
                                      { indice: i, cambios: { descuento: descuentoEscrito(descuentoPendiente.tipo, v) } },
                                    ],
                                  },
                                  `item.${i}.descuento`,
                                )
                              }
                            />
                          )}
                        </td>
                        <td className="celda-monto celda-total" data-etiqueta="Total sin IVA">
                          {linea && conDescuentoItem(linea) && (
                            <s className="precio-original" title="Total original">
                              {pesos(linea.cantidad * linea.precioUnitario)}
                            </s>
                          )}
                          {linea ? pesos(linea.total) : '—'}
                        </td>
                        {conQuitar && (
                          <td className="celda-acciones">
                            <div className="item-acciones">
                              <button
                                type="button"
                                className="move-item"
                                onClick={() => void acciones.reordenar(i, i - 1)}
                                disabled={!editable || i === 0}
                                aria-label={`Mover ítem ${i + 1} hacia arriba: ${descripcion}`}
                                title="Mover hacia arriba"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="move-item"
                                onClick={() => void acciones.reordenar(i, i + 1)}
                                disabled={!editable || i === actual.solicitudes.length - 1}
                                aria-label={`Mover ítem ${i + 1} hacia abajo: ${descripcion}`}
                                title="Mover hacia abajo"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className="remove"
                                onClick={() => acciones.quitar(i)}
                                disabled={!editable}
                                aria-label={`Quitar ítem ${i + 1}: ${descripcion}`}
                              >
                                ×
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                      {admiteCambios && (
                        <tr className="item-editor-row">
                          <td className="quote-item-editor-cell" colSpan={conQuitar ? 5 : 4}>
                            <details className="item-details" open={pendiente ? true : undefined}>
                              <summary aria-label={`Editar detalles del ítem ${i + 1}: ${descripcion}`}>
                                {pendiente ? 'Completar producto' : 'Editar detalles'}
                                <span>
                                  {pendiente
                                    ? faltan.length
                                      ? `Falta: ${textoFaltan(faltan)}`
                                      : explicacionPrecio
                                        ? RESUMEN_FUERA_DE_REGLA
                                        : pendiente.pregunta
                                    : linea && conDescuentoItem(linea)
                                      ? `Modelo, madera, medidas y condiciones · ${textoDescuentoLinea(linea)}`
                                      : 'Modelo, madera, medidas, condiciones y descuento'}
                                </span>
                              </summary>
                              <div
                                className="item-editor"
                                role="group"
                                aria-label={`Datos editables del ítem ${i + 1}`}
                              >
                                {preguntasItem.length > 0 && (
                                  <PreguntasPendientes
                                    preguntas={sinExplicacionRepetida(preguntasItem, explicacionPrecio)}
                                    asistente={asistente}
                                    editable={editable}
                                    guardando={guardando}
                                    responder={acciones.editar}
                                  />
                                )}
                                {linea?.producto.familia === 'PUERTA' &&
                                  (s.tipoMedida ?? 'no_especificado') === 'no_especificado' && (
                                    <div className="aviso-medida" role="note">
                                      <span>{RECTIFICAR_MEDIDA}</span>
                                      {!s.observaciones?.includes(RECTIFICAR_MEDIDA) && (
                                        <button
                                          type="button"
                                          className="button secondary small"
                                          aria-label={`Agregar como observación al ítem ${i + 1}: ${descripcion}`}
                                          onClick={() =>
                                            void acciones.editar(
                                              {
                                                items: [
                                                  {
                                                    indice: i,
                                                    cambios: {
                                                      observaciones: [s.observaciones, RECTIFICAR_MEDIDA]
                                                        .filter(Boolean)
                                                        .join(' '),
                                                    },
                                                  },
                                                ],
                                              },
                                              `item.${i}.observaciones`,
                                            )
                                          }
                                        >
                                          Agregar como observación
                                        </button>
                                      )}
                                    </div>
                                  )}
                                <div className="item-editor-heading">
                                  <strong>Datos del producto</strong>
                                  {linea && !personalizado && (
                                    <small className="precio-trazabilidad">
                                      Costo de fábrica {pesos(linea.precioFabrica ?? linea.producto.precioNeto)} · Precio
                                      al cliente {pesos(linea.precioCliente ?? linea.precioUnitario)}
                                    </small>
                                  )}
                                </div>
                                <div className="item-editables">
                                  <CampoEditable
                                    className="item-campo item-campo-descripcion"
                                    etiqueta="Descripción para el documento"
                                    // Abre con el texto que se ve para retocarlo, también en un ítem pendiente (su
                                    // modelo); sin modelo aún no hay descripción y se ve como campo vacío.
                                    valor={s.descripcion || (linea || s.modelo ? descripcion : '')}
                                    vacio="Agregar descripción"
                                    editable={editable}
                                    discreto
                                    cursorAlFinal
                                    maxLength={300}
                                    guardando={guardando === `item.${i}.descripcion`}
                                    guardar={(v) =>
                                      acciones.editar(
                                        { items: [{ indice: i, cambios: { descripcion: descripcionAGuardar(actual, i, v) } }] },
                                        `item.${i}.descripcion`,
                                      )
                                    }
                                  />
                                  <CampoEditable
                                    className={`item-campo${falta('modelo')}`}
                                    etiqueta={personalizado ? 'Nombre del producto' : 'Modelo'}
                                    valor={s.modelo ?? ''}
                                    vacio="Agregar modelo"
                                    editable={editable}
                                    discreto
                                    guardando={guardando === `item.${i}.modelo`}
                                    maxLength={300}
                                    guardar={(v) =>
                                      acciones.editar(
                                        { items: [{ indice: i, cambios: { modelo: v || null } }] },
                                        `item.${i}.modelo`,
                                      )
                                    }
                                  />
                                  <CampoEditable
                                    className={`item-campo${falta('madera')}`}
                                    etiqueta="Madera"
                                    valor={s.madera ?? ''}
                                    mostrar={s.madera ? nombreProducto(s.madera) : undefined}
                                    vacio="Agregar madera"
                                    editable={editable}
                                    discreto
                                    guardando={guardando === `item.${i}.madera`}
                                    maxLength={300}
                                    guardar={(v) =>
                                      acciones.editar(
                                        { items: [{ indice: i, cambios: { madera: v || null } }] },
                                        `item.${i}.madera`,
                                      )
                                    }
                                  />
                                  {linea?.producto.familia === 'PUERTA' ||
                                  s.ancho !== null ||
                                  (pendiente?.rechazo.tipo === 'faltan_datos' &&
                                    pendiente.rechazo.campos.includes('ancho')) ? (
                                    <CampoEditable
                                      className={`item-campo${falta('ancho')}`}
                                      etiqueta="Ancho (m)"
                                      valor={anchoMetros === null ? '' : decimalCampo(anchoMetros)}
                                      mostrar={anchoMetros === null ? undefined : decimal(anchoMetros)}
                                      vacio="Agregar ancho"
                                      editable={editable}
                                      discreto
                                      // Texto y no número: el navegador entregaba vacío ante «0,80» o «80 cm».
                                      tipo="text"
                                      modoEntrada="decimal"
                                      maxLength={20}
                                      sufijo="m"
                                      guardando={guardando === `item.${i}.ancho`}
                                      // Solo un accesorio puede quedar sin ancho: a una puerta le hace falta.
                                      validar={(v) =>
                                        (v ? leerMedida(v, familia, 'ancho') !== null : familia !== 'PUERTA')
                                          ? null
                                          : errorMedida('ancho', familia)
                                      }
                                      guardar={(v) =>
                                        acciones.editar(
                                          {
                                            items: [
                                              { indice: i, cambios: { ancho: v ? leerMedida(v, familia, 'ancho') : null } },
                                            ],
                                          },
                                          `item.${i}.ancho`,
                                        )
                                      }
                                    />
                                  ) : (
                                    <CampoEditable
                                      className={`item-campo${falta('medida')}`}
                                      etiqueta="Medida"
                                      valor={s.medida ?? ''}
                                      vacio="Agregar medida"
                                      editable={editable}
                                      discreto
                                      guardando={guardando === `item.${i}.medida`}
                                      maxLength={300}
                                      guardar={(v) =>
                                        acciones.editar(
                                          { items: [{ indice: i, cambios: { medida: v || null } }] },
                                          `item.${i}.medida`,
                                        )
                                      }
                                    />
                                  )}
                                  <CampoEditable
                                    className={`item-campo${falta('alto')}`}
                                    etiqueta="Alto / largo (m)"
                                    valor={altoMetros === null ? '' : decimalCampo(altoMetros)}
                                    mostrar={altoMetros === null ? undefined : decimal(altoMetros)}
                                    vacio="Agregar alto o largo"
                                    editable={editable}
                                    discreto
                                    tipo="text"
                                    modoEntrada="decimal"
                                    maxLength={20}
                                    sufijo="m"
                                    guardando={guardando === `item.${i}.alto`}
                                    validar={(v) => (leerMedida(v, familia) === null ? errorMedida('alto', familia) : null)}
                                    guardar={(v) =>
                                      acciones.editar(
                                        { items: [{ indice: i, cambios: { alto: leerMedida(v, familia) } }] },
                                        `item.${i}.alto`,
                                      )
                                    }
                                  />
                                  <div className="ia-field item-select-field item-campo">
                                    <span>La medida corresponde a</span>
                                    <SelectorDesplegable
                                      ariaLabel={`La medida corresponde a, ítem ${i + 1}`}
                                      value={s.tipoMedida ?? 'no_especificado'}
                                      opciones={[
                                        { value: 'no_especificado', label: 'No especificado' },
                                        { value: 'hoja', label: 'Hoja (la puerta)' },
                                        { value: 'vano', label: 'Vano (hueco del muro)' },
                                      ]}
                                      onChange={(valor) =>
                                        void acciones.editar(
                                          {
                                            items: [
                                              {
                                                indice: i,
                                                cambios: {
                                                  tipoMedida: valor as 'hoja' | 'vano' | 'no_especificado',
                                                },
                                              },
                                            ],
                                          },
                                          `item.${i}.tipoMedida`,
                                        )
                                      }
                                      disabled={!editable || ocupado}
                                    />
                                  </div>
                                  <CampoEditable
                                    className="item-campo item-campo-observacion"
                                    etiqueta="Observación del producto"
                                    valor={s.observaciones ?? ''}
                                    mostrar={
                                      s.observaciones ||
                                      'Agregar observación (ej. confirmar sentido de apertura)'
                                    }
                                    editable={editable}
                                    discreto
                                    cursorAlFinal
                                    maxLength={LARGO_OBSERVACION_ITEM}
                                    guardando={guardando === `item.${i}.observaciones`}
                                    guardar={(v) =>
                                      acciones.editar(
                                        { items: [{ indice: i, cambios: { observaciones: v || null } }] },
                                        `item.${i}.observaciones`,
                                      )
                                    }
                                  />
                                  {personalizado && (
                                    // Lo usa la nota de pedido; sin él, la línea va «Por definir» y fábrica la valoriza.
                                    <CampoEditable
                                      className="item-campo"
                                      etiqueta="Costo de fábrica (nota de pedido)"
                                      valor={s.costoFabrica ? String(s.costoFabrica) : ''}
                                      mostrar={s.costoFabrica ? pesos(s.costoFabrica) : undefined}
                                      vacio="Por definir"
                                      editable={editable}
                                      discreto
                                      tipo="text"
                                      modoEntrada="numeric"
                                      sufijo="$"
                                      guardando={guardando === `item.${i}.costoFabrica`}
                                      validar={(v) => {
                                        const n = v ? leerPesos(v) : 0;
                                        return !v || (Number.isSafeInteger(n) && n > 0 && n <= 100_000_000)
                                          ? null
                                          : 'El costo de fábrica debe ser un monto entero en pesos, entre $1 y $100.000.000.';
                                      }}
                                      guardar={(v) =>
                                        acciones.editar(
                                          { items: [{ indice: i, cambios: { costoFabrica: v ? leerPesos(v) : null } }] },
                                          `item.${i}.costoFabrica`,
                                        )
                                      }
                                    />
                                  )}
                                  {linea && !personalizado && (
                                    <MargenLinea
                                      actual={actual}
                                      linea={linea}
                                      indice={i}
                                      editable={editable}
                                      editar={acciones.editar}
                                    />
                                  )}
                                  {linea && (
                                    <DescuentoLinea
                                      actual={actual}
                                      linea={linea}
                                      indice={i}
                                      editable={editable}
                                      editar={acciones.editar}
                                    />
                                  )}
                                </div>
                              </div>
                            </details>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {conProductos && conFlete && (
                  <FilaFlete
                    actual={actual}
                    editable={editable}
                    conQuitar={conQuitar}
                    guardando={guardando}
                    editar={acciones.editar}
                    recienAgregada={agregandoFlete === actual.id && !actual.flete && !actual.fleteDescripcion}
                    quitar={() => {
                      setAgregandoFlete(null);
                      if (actual.flete > 0 || actual.fleteDescripcion)
                        void acciones.editar({ fleteLinea: null }, 'flete.quitar');
                    }}
                  />
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-items">
            <p>Este borrador todavía no tiene productos.</p>
            <span>Descríbelos en la conversación para completar el detalle y calcular el total.</span>
          </div>
        )}
      </div>
      <details key={`cliente-${actual.id}`} className="quote-client-section quote-details">
        <summary>
          <span>Cliente y facturación</span>
          <small>
            {[actual.cliente.nombre, actual.cliente.rut, actual.cliente.comuna].filter(Boolean).join(' · ') ||
              'Agregar datos del cliente'}
          </small>
        </summary>
        <div className="client">
          {CAMPOS_CLIENTE.map((campo) => {
            const valor = actual?.cliente[campo] ?? '';
            if (
              actual &&
              !admiteCambios &&
              !valor &&
              (campo === 'giro' || campo === 'rut' || campo === 'direccion')
            )
              return null;
            return (
              <CampoEditable
                key={campo}
                className={`cliente-campo cliente-${campo}`}
                etiqueta={ETIQUETA_CAMPO[campo]}
                valor={valor}
                mostrar={campo === 'nombre' ? valor || SIN_CLIENTE : undefined}
                editable={editable}
                discreto
                guardando={guardando === `cliente.${campo}`}
                maxLength={300}
                guardar={(v) => acciones.editar({ cliente: { [campo]: v || null } }, `cliente.${campo}`)}
                sugerir={campo === 'nombre' || campo === 'rut' ? sugerirCliente(campo) : undefined}
              />
            );
          })}
        </div>
      </details>
      {(admiteCambios || actual.observaciones || despachoEditable(actual) || actual.despacho) && (
        <div className="quote-custom-fields">
          {(admiteCambios || actual.observaciones) && (
            <details key={`observaciones-${actual.id}`} className="quote-details">
              <summary>
                <span>Observaciones</span>
                <small>{actual.observaciones || 'Agregar indicaciones para el documento'}</small>
              </summary>
              <CampoEditable
                etiqueta="Observaciones"
                valor={actual.observaciones ?? ''}
                vacio="Agregar observaciones"
                editable={editable}
                discreto
                area
                maxLength={2000}
                guardando={guardando === 'observaciones'}
                guardar={(v) => acciones.editar({ observaciones: v || null }, 'observaciones')}
              />
            </details>
          )}
          {(admiteCambios || despachoEditable(actual) || actual.despacho) && (
            <details
              id="despacho-details"
              key={`despacho-${actual.id}`}
              className="quote-details"
              onToggle={(e) => {
                if (e.currentTarget.open) cargarTransportistas();
              }}
            >
              <summary>
                <span>Despacho</span>
                <small>
                  {[
                    actual.despacho?.destino,
                    esOtroTransportista(transporte) ? null : transporte,
                    actual.flete ? `${pesos(actual.flete)} sin IVA` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'Destino, transporte y costo por confirmar'}
                </small>
              </summary>
              <div className="quote-dispatch-fields">
                <CampoEditable
                  etiqueta="Destino"
                  valor={actual.despacho?.destino ?? ''}
                  vacio="Agregar comuna o destino"
                  editable={editaDespacho}
                  discreto
                  guardando={guardando === 'despacho.destino'}
                  maxLength={300}
                  guardar={(v) => guardarDespacho({ destino: v || null }, 'despacho.destino')}
                />
                <CampoEditable
                  etiqueta="Dirección de despacho"
                  valor={actual.despacho?.direccion ?? ''}
                  vacio="Agregar dirección"
                  editable={editaDespacho}
                  discreto
                  guardando={guardando === 'despacho.direccion'}
                  maxLength={300}
                  guardar={(v) => guardarDespacho({ direccion: v || null }, 'despacho.direccion')}
                />
                <div className="ia-field item-select-field">
                  <span>Transportista</span>
                  <SelectorDesplegable
                    ariaLabel="Transportista"
                    value={valorTransportista}
                    opciones={opcionesTransportista}
                    onChange={(valor) => {
                      // «Otro» no se guarda: primero se escribe el nombre.
                      if (valor === OPCION_OTRO) return setEligiendoOtro(actual.id);
                      setEligiendoOtro(null);
                      void guardarDespacho({ transporte: valor || null }, 'despacho.transporte');
                    }}
                    disabled={!editaDespacho || ocupado}
                  />
                </div>
                {transportistas === 'error' && (
                  <p className="muted" role="status">
                    No se pudo leer la lista de transportistas.{' '}
                    <button type="button" className="enlace" onClick={cargarTransportistas}>
                      Reintentar
                    </button>
                  </p>
                )}
                {valorTransportista === OPCION_OTRO && (
                  <CampoEditable
                    etiqueta="Nombre del transportista"
                    valor={transporteLibre ? transporte : ''}
                    vacio="Escribir el nombre del transportista"
                    editable={editaDespacho}
                    discreto
                    abrirAlMontar={eligiendoOtro === actual.id && editaDespacho}
                    alCancelar={() => {
                      if (eligiendoOtro !== actual.id) return;
                      setEligiendoOtro(null);
                      requestAnimationFrame(() =>
                        document
                          .querySelector<HTMLButtonElement>('#despacho-details [role="combobox"][aria-label="Transportista"]')
                          ?.focus(),
                      );
                    }}
                    guardando={guardando === 'despacho.transporte'}
                    maxLength={120}
                    validar={(v) =>
                      !v.trim() || esOtroTransportista(v) ? 'Escribe el nombre del transportista.' : null
                    }
                    guardar={async (v) => {
                      const ok = await guardarDespacho({ transporte: v }, 'despacho.transporte');
                      if (ok) setEligiendoOtro(null);
                      return ok;
                    }}
                  />
                )}
                <p className="muted">
                  Valor de despacho: {actual.flete ? `${pesos(actual.flete)} sin IVA` : 'sin flete'}. Se edita en
                  la línea de flete del detalle del pedido.
                </p>
                <CampoEditable
                  etiqueta="Entrega comprometida"
                  valor={actual.despacho?.entregaComprometida ?? ''}
                  vacio="Agregar fecha o compromiso"
                  editable={editaDespacho}
                  discreto
                  guardando={guardando === 'despacho.entregaComprometida'}
                  maxLength={120}
                  guardar={(v) =>
                    guardarDespacho({ entregaComprometida: v || null }, 'despacho.entregaComprometida')
                  }
                />
                {/* `admiteCambios` y no `editable`: durante cada guardado `editable` se apaga y el bloque perdería su estado. */}
                {admiteCambios && esStarken(actual.despacho?.transporte) && (
                  <CotizarStarken
                    key={actual.id}
                    actual={actual}
                    aplicar={(cambios) => acciones.editar(cambios, 'despacho.valor')}
                    ocupado={ocupado}
                    guardando={guardando === 'despacho.valor'}
                  />
                )}
              </div>
            </details>
          )}
        </div>
      )}
      <div className="quote-pie">
        <div className="quote-pie-acciones">
          {/* Una sola acción principal a la vista; el resto va en «Más acciones». */}
          <MargenCotizacion
            actual={actual}
            admiteCambios={admiteCambios}
            editable={editable}
            guardando={guardando}
            editar={acciones.editar}
          />
          {actual && (actual.pdf || actual.notas.length > 0) && (
            <div className="quote-docs">
              {actual.pdf && (
                <Documento
                  nombre="PDF de la cotización"
                  descripcion={`cotización ${numeroCotizacion(actual.numero)}`}
                  archivo={actual.pdf}
                  descargando={descargando}
                  descargar={acciones.descargar}
                  acciones={documentos}
                  // El número se cambia desde el propio documento, mientras la cotización está vigente.
                  cambiarNumero={
                    admin && actual.numero !== null && (estado === 'emitida' || estado === 'aprobada')
                      ? () => void cambiarNumero({ documento: 'cotizacion', actual: actual.numero!, conNotas: actual.notas.length > 0 })
                      : undefined
                  }
                />
              )}
              {actual.notas.map((nota) => (
                <Documento
                  key={nota.pdf}
                  nombre={`Nota de pedido ${numeroNota(nota)}`}
                  descripcion={`nota de pedido ${numeroNota(nota)}`}
                  archivo={nota.pdf}
                  descargando={descargando}
                  descargar={acciones.descargar}
                  etiqueta={`Descargar nota de pedido ${numeroNota(nota)}`}
                  anulado={nota.anulada}
                  acciones={documentos}
                  cambiarNumero={
                    admin && estado === 'aprobada' && !nota.anulada && nota.fabrica
                      ? () => void cambiarNumero({ documento: 'nota', fabrica: nota.fabrica, actual: nota.numero })
                      : undefined
                  }
                />
              ))}
            </div>
          )}
          {/* En un borrador nuevo la nota solo repetía la ayuda del botón: se muestra cuando informa algo. */}
          {actual && notaEstado(actual) && (estado !== 'borrador' || actual.origen) && (
            <p className="review-note" id="nota-revision">
              {notaEstado(actual)}
            </p>
          )}
        </div>
        <Totales
          actual={actual}
          editable={editable && conItems}
          guardando={guardando}
          editar={acciones.editar}
        />
      </div>
      <div
        className={`quote-toolbar${cambioVisual?.total ? ' total-actualizado' : ''}`}
        role="region"
        aria-label="Resumen y acciones de la cotización"
      >
        <div className="quote-toolbar-total">
          <span>{actual.incompletos.length ? 'Total parcial' : 'Total del pedido'}</span>
          <strong>{pesos(actual.montos.total)}</strong>
          <small>IVA incluido · CLP</small>
        </div>
        {indicePendiente !== undefined && (
          <button
            type="button"
            className="quote-pending-link"
            onClick={() => irAPendiente(indicePendiente)}
          >
            {plural(cantidadPendientes, 'pendiente')} ↑
          </button>
        )}
        <div className="quote-actions">
          {estado === 'borrador' && (
            medidasPendientes.length > 0 && !actual.incompletos.length ? (
              <button type="button" className="button primary" onClick={() => irAPendiente(medidasPendientes[0])}>
                Resolver medida
              </button>
            ) : (
              <button
                type="button"
                className="button primary"
                disabled={!listo || ocupado}
                aria-describedby={ayudaEmitir ? 'ayuda-emitir' : undefined}
                onClick={acciones.emitir}
              >
                {enCurso === 'emitir' ? 'Emitiendo…' : 'Emitir y generar PDF'}
              </button>
            )
          )}
          {estado === 'emitida' && (
            <button
              type="button"
              className="button primary"
              disabled={ocupado}
              aria-describedby={esVencida ? 'ayuda-aprobar' : undefined}
              onClick={acciones.aprobar}
            >
              {enCurso === 'aprobar' ? 'Guardando…' : 'Registrar aprobación del cliente'}
            </button>
          )}
          {estado === 'aprobada' && (
            <button
              type="button"
              className="button primary"
              onClick={() => {
                mostrarCotizacion();
                requestAnimationFrame(() =>
                  document
                    .getElementById('seguimiento-title')
                    ?.scrollIntoView({ behavior: comportamientoScroll(), block: 'start' }),
                );
              }}
            >
              Ver seguimiento del pedido
            </button>
          )}
          <MenuAcciones
            deshabilitado={ocupado}
            opciones={[
              {
                etiqueta: enCurso === 'duplicar' ? 'Duplicando…' : 'Duplicar',
                alElegir: acciones.duplicar,
              },
              ...(conItems
                ? [
                    {
                      etiqueta: 'Copiar resumen',
                      alElegir: acciones.copiar,
                      titulo: 'Resumen en texto para pegar en un correo o WhatsApp',
                    },
                  ]
                : []),
              ...(estado === 'borrador' && actual.numero === null
                ? [{ etiqueta: 'Eliminar borrador', alElegir: acciones.eliminar, peligro: true }]
                : []),
              // Una despachada, completada o facturada ya no se anula: la opción queda con el motivo a la vista.
              ...(estado === 'emitida' || estado === 'aprobada'
                ? [
                    anulable.ok
                      ? { etiqueta: 'Anular', alElegir: acciones.anular, peligro: true }
                      : {
                          etiqueta: 'Anular',
                          alElegir: () => {},
                          peligro: true,
                          deshabilitada: true,
                          detalle: anulable.motivo,
                        },
                  ]
                : []),
            ]}
          />
          {/* La ayuda solo aparece cuando explica por qué no se puede o qué se pedirá confirmar. */}
          {estado === 'borrador' && ayudaEmitir && (
            <div className="ayuda" id="ayuda-emitir">
              <p>{ayudaEmitir}</p>
              {actual.incompletos.length > 0 && (
                <ul className="ayuda-pendientes">
                  {actual.incompletos.map((p) => {
                    const campos = faltantesItem(actual, p.indice) ?? [];
                    return (
                      <li key={p.indice}>
                        <button type="button" className="enlace" onClick={() => irAPendiente(p.indice)}>
                          Ítem {p.indice + 1} · {descripcionItem(actual, p.indice)}
                        </button>
                        <span>
                          {campos.length
                            ? ` · falta ${textoFaltan(campos)}`
                            : fueraDeRegla(actual, p.indice)
                              ? ' · revisar el precio o el descuento'
                              : ' · revisar'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {estado === 'emitida' && esVencida && (
            <p className="ayuda" id="ayuda-aprobar">
              La vigencia terminó: se pedirá confirmar antes de aprobar.
            </p>
          )}
        </div>
      </div>
      <div className="conditions">
        <span>Valores puestos en fábrica.</span>
        <span className={esVencida ? 'vencida-texto' : undefined}>
          {condicionDespacho} · {validez(actual)}
          {esVencida ? ' (vencida)' : ''}
        </span>
      </div>
      {actual.numero !== null && actual.estado !== 'anulada' && actual.estado !== 'reemplazada' && (
        // Un seguimiento por cotización: sus borradores (pago, factura, nota interna) no pasan a otra, y el
        // resto del panel no se vuelve a montar al abrir otra cotización ni al crear una revisión.
        <SeguimientoOperacion
          key={actual.id}
          actual={actual}
          ocupado={ocupado}
          flujo={acciones.flujo}
          anularPago={acciones.anularPago}
        />
      )}
      {dialogoNumero}
    </section>
  );
}

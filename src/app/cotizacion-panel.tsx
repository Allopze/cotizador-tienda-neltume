'use client';
import { Fragment, useEffect, useRef, useState, type RefObject } from 'react';
import {
  CODIGO_FLETE,
  cantidadFlete,
  descripcionFlete,
  despachoEditable,
  esEditable,
  etiquetaEstado,
  unitarioFlete,
  type Cotizacion,
} from '@/negocio/estado';
import { descripcionLinea, pesos } from '@/negocio/precios';
import { metros } from '@/catalogo/resolver';
import { leerPesos } from '@/negocio/cifras';
import { esStarken } from '@/negocio/starken';
import { CampoEditable } from './campo-editable';
import { CotizarStarken } from './cotizar-starken';
import { PreguntasPendientes } from './preguntas-pendientes';
import {
  ETIQUETA_PENDIENTE,
  faltantesItem,
  preguntasPendientes,
  type CampoPendiente,
} from '@/negocio/pendientes';
import { bonito } from '@/asistente/preguntas';
import { metrosTexto } from '@/catalogo/escalones';
import { dimensionesEnMilimetros } from '@/negocio/medidas';
import type { CambiosEdicion, Despacho } from './contrato';
import {
  ETIQUETA_CAMPO,
  SIN_CLIENTE,
  autoria,
  fechaLarga,
  comportamientoScroll,
  medidaPedida,
  nombreProducto,
  numeroCotizacion,
  plural,
  referenciaCatalogo,
  validez,
  vencida,
} from './formato';
import { MargenCotizacion, MargenLinea, textoMargenLinea } from './margenes';
import { MenuAcciones } from './menu-acciones';
import { Documento, Totales } from './panel-totales';
import { SelectorDesplegable } from './selector-desplegable';
import { SeguimientoOperacion } from './seguimiento-operacion';
import { pedirJSON } from './solicitud';

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
  tituloRef: RefObject<HTMLHeadingElement | null>;
  agregarProducto: () => void;
  cambioVisual: { indices: number[]; total: boolean; texto: string } | null;
  mostrarCotizacion: () => void;
  cargando: boolean;
}
/** Línea valorizada que corresponde al ítem i (los incompletos no tienen línea). */
export function lineaDe(q: Cotizacion, i: number) {
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
/** Lo que ya se sabe de un ítem pendiente, aparte del modelo y la cantidad que muestra la fila. */
function entendido(s: Cotizacion['solicitudes'][number]) {
  const medida = (n: number | null) => {
    const m = n === null ? null : metros(n);
    return m === null ? '—' : metrosTexto(m);
  };
  const medidas = s.medida
    ? `${s.medida}${s.alto !== null ? ` × ${medida(s.alto)} m` : ''}`
    : dimensionesEnMilimetros(
        s.ancho === null ? null : metros(s.ancho),
        s.alto === null ? null : metros(s.alto),
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
          key={`${actual.actualizada}-flete-descripcion`}
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
        <small>Neto · sin descuento</small>
      </td>
      <td className="celda-cantidad" data-etiqueta="Cant.">
        <CampoEditable
          key={`${actual.actualizada}-flete-cantidad`}
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
          key={`${actual.actualizada}-flete-unitario`}
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
      <td className="celda-monto celda-total" data-etiqueta="Total neto">
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
      return q.nota?.anulada
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
  tituloRef,
  agregarProducto,
  cambioVisual,
  mostrarCotizacion,
  cargando,
}: Props) {
  const ocupado = enCurso !== null;
  // Una emitida solo muestra controles de edición cuando se pide modificarla: editarla crea una revisión.
  const [modificando, setModificando] = useState<string | null>(null);
  const [arrastrado, setArrastrado] = useState<number | null>(null);
  const [destinoArrastre, setDestinoArrastre] = useState<number | null>(null);
  const indiceArrastrado = useRef<number | null>(null);
  /** Cotización en la que se pidió «Agregar flete»: muestra la línea en $0 hasta que se guarde un valor. */
  const [agregandoFlete, setAgregandoFlete] = useState<string | null>(null);
  const [transportistas, setTransportistas] = useState(['Starken', 'Transportes Paredes', 'Ignacio', 'Otro']);
  useEffect(() => {
    const abort = new AbortController();
    pedirJSON<{ configuracion?: { transportistas?: string[] } }>('/api/configuracion-negocio', {
      signal: abort.signal,
      cache: 'no-store',
    })
      .then((d) => {
        if (d.configuracion?.transportistas?.length) setTransportistas(d.configuracion.transportistas);
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);
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
            <p className="eyebrow">02 / COTIZACIÓN</p>
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
  const listo = conItems && !actual.incompletos.length;
  const estado = actual.estado;
  const esVencida = vencida(actual);
  const ayudaEmitir = !actual?.solicitudes.length
    ? 'Agrega al menos un producto para generar el PDF.'
    : actual.incompletos.length
      ? 'Completa o quita los ítems pendientes para generar el PDF.'
      : null; // Lista para emitir: el diálogo de confirmación explica qué pasa.
  const irAPendiente = (indice: number) => {
    mostrarCotizacion();
    requestAnimationFrame(() => {
      const el = document.getElementById(`producto-${indice}`);
      el?.scrollIntoView({ behavior: comportamientoScroll(), block: 'center' });
      el?.nextElementSibling?.querySelector('summary')?.focus({ preventScroll: true });
    });
  };
  // Desde la aprobación y hasta registrar el despacho, los datos logísticos se editan sin crear revisión.
  const editaDespacho = editable || (despachoEditable(actual) && !ocupado);
  const guardarDespacho = (cambios: Despacho, campo: string) =>
    editable ? acciones.editar({ despacho: cambios }, campo) : acciones.despacho(cambios, campo);
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
  const despacho = actual?.nota?.despacho;
  const condicionDespacho =
    despacho && (despacho.direccion || despacho.transporte)
      ? `Despacho: ${[despacho.direccion, despacho.transporte].filter(Boolean).join(' · ')}`
      : actual?.montos.flete
        ? `Incluye flete por ${pesos(actual.montos.flete)} neto`
        : 'Despacho por confirmar';
  const ocurrenciasItems = new Map<string, number>();
  return (
    <section id="panel-cotizacion" className="quote-panel" aria-label="Cotización en curso">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">02 / COTIZACIÓN</p>
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
              ? 'Modo edición: el primer cambio crea (o reutiliza) una revisión en borrador y conserva este PDF.'
              : 'Para cambiarla se crea una revisión en borrador; este PDF se conserva.'}
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
          <span>Detalle del pedido</span>
          <div className="items-heading-actions">
            <span>{plural(actual?.solicitudes.length ?? 0, 'ítem')}</span>
            {admiteCambios && (
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
            )}
            {admiteCambios && (
              <button
                type="button"
                className="button secondary small"
                disabled={ocupado}
                onClick={agregarProducto}
              >
                + Agregar producto
              </button>
            )}
            {admiteCambios && conItems && !conFlete && (
              <button
                type="button"
                className="button secondary small"
                disabled={ocupado}
                onClick={() => setAgregandoFlete(actual.id)}
              >
                + Agregar flete
              </button>
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
                  <th scope="col">TOTAL NETO</th>
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
                  const anchoMetros = s.ancho === null ? null : metros(s.ancho);
                  const altoMetros = s.alto === null ? null : metros(s.alto);
                  const faltan = faltantesItem(actual, i) ?? [];
                  const falta = (campo: CampoPendiente) =>
                    faltan.includes(campo) ? ' item-campo-falta' : '';
                  const preguntasItem = pendiente
                    ? preguntasPendientes({ solicitudes: actual.solicitudes, incompletos: [pendiente] })
                    : [];
                  const sabido = pendiente ? entendido(s) : '';
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
                            <strong>{descripcion}</strong>
                          </div>
                          <small>{linea?.producto.codigo || 'Pendiente de completar'}</small>
                          {linea && <small>{referenciaCatalogo(linea)}</small>}
                          {/* Con la cotización editable, el margen se ve (y se cambia) en el bloque de edición de la línea. */}
                          {!editable && linea && textoMargenLinea(actual, linea) && (
                            <small className="margen-manual">{textoMargenLinea(actual, linea)}</small>
                          )}
                          {s.modeloOriginal && s.coincidenciaModelo && (
                            <small className={`match-confidence ${s.coincidenciaModelo}`}>
                              {s.coincidenciaModelo === 'alias'
                                ? 'Normalizado desde'
                                : 'Revisar posible coincidencia'}
                              : {s.modeloOriginal}
                            </small>
                          )}
                          {medida && <small>{medida}</small>}
                          {s.fuente && (
                            <small className="item-fuente" title="Lo que se escribió en el pedido">
                              «{s.fuente}»
                            </small>
                          )}
                          {pendiente && <span className="pending-label">Incompleto · no suma al total</span>}
                          {pendiente && (
                            <small className="pending-resumen">
                              {sabido && <>Entendido: {sabido}. </>}
                              {faltan.length ? `Falta: ${textoFaltan(faltan)}.` : null}
                            </small>
                          )}
                          {linea?.producto.familia === 'PUERTA' &&
                            (s.tipoMedida ?? 'no_especificado') === 'no_especificado' && (
                              <small className="medida-por-confirmar">
                                Medida de hoja o vano por confirmar
                              </small>
                            )}
                        </td>
                        <td className="celda-cantidad" data-etiqueta="Cant.">
                          <CampoEditable
                            key={`${actual.actualizada}-${i}`}
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
                          {linea ? (
                            <CampoEditable
                              etiqueta="Precio unitario"
                              etiquetaOculta
                              valor={
                                s.precioUnitario === null || s.precioUnitario === undefined
                                  ? ''
                                  : String(s.precioUnitario)
                              }
                              mostrar={pesos(linea.precioUnitario)}
                              editable={editable}
                              discreto
                              guardando={guardando === `item.${i}.precioUnitario`}
                              tipo="text"
                              sufijo="$"
                              validar={(v) => {
                                const n = v ? leerPesos(v) : null;
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
                        </td>
                        <td className="celda-monto celda-total" data-etiqueta="Total neto">
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
                                      : pendiente.pregunta
                                    : 'Modelo, madera, medidas y condiciones'}
                                </span>
                              </summary>
                              <div
                                className="item-editor"
                                role="group"
                                aria-label={`Datos editables del ítem ${i + 1}`}
                              >
                                {preguntasItem.length > 0 && (
                                  <PreguntasPendientes
                                    preguntas={preguntasItem}
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
                                  {linea && (
                                    <small className="precio-trazabilidad">
                                      Fábrica {pesos(linea.precioFabrica ?? linea.producto.precioNeto)} →
                                      cliente {pesos(linea.precioCliente ?? linea.precioUnitario)}
                                    </small>
                                  )}
                                </div>
                                <div className="item-editables">
                                  <CampoEditable
                                    className="item-campo item-campo-descripcion"
                                    etiqueta="Descripción para el documento"
                                    valor={s.descripcion ?? ''}
                                    mostrar={s.descripcion || descripcion}
                                    editable={editable}
                                    discreto
                                    maxLength={300}
                                    guardando={guardando === `item.${i}.descripcion`}
                                    guardar={(v) =>
                                      acciones.editar(
                                        { items: [{ indice: i, cambios: { descripcion: v || null } }] },
                                        `item.${i}.descripcion`,
                                      )
                                    }
                                  />
                                  <CampoEditable
                                    className={`item-campo${falta('modelo')}`}
                                    etiqueta="Modelo"
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
                                      valor={anchoMetros === null ? '' : String(anchoMetros)}
                                      mostrar={anchoMetros === null ? undefined : decimal(anchoMetros)}
                                      vacio="Agregar ancho"
                                      editable={editable}
                                      discreto
                                      tipo="number"
                                      paso={0.001}
                                      min={0.3}
                                      max={3}
                                      sufijo="m"
                                      guardando={guardando === `item.${i}.ancho`}
                                      validar={(v) =>
                                        !v || (Number(v) >= 0.3 && Number(v) <= 3)
                                          ? null
                                          : 'Indica un ancho entre 0,3 y 3 metros.'
                                      }
                                      guardar={(v) =>
                                        acciones.editar(
                                          {
                                            items: [{ indice: i, cambios: { ancho: v ? Number(v) : null } }],
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
                                    valor={altoMetros === null ? '' : String(altoMetros)}
                                    mostrar={altoMetros === null ? undefined : decimal(altoMetros)}
                                    vacio="Agregar alto o largo"
                                    editable={editable}
                                    discreto
                                    tipo="number"
                                    paso={0.001}
                                    min={0.3}
                                    max={3}
                                    sufijo="m"
                                    guardando={guardando === `item.${i}.alto`}
                                    validar={(v) =>
                                      !v || (Number(v) >= 0.3 && Number(v) <= 3)
                                        ? null
                                        : 'Indica un alto o largo entre 0,3 y 3 metros.'
                                    }
                                    guardar={(v) =>
                                      acciones.editar(
                                        { items: [{ indice: i, cambios: { alto: v ? Number(v) : null } }] },
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
                                        { value: 'hoja', label: 'Hoja' },
                                        { value: 'vano', label: 'Vano' },
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
                                    maxLength={500}
                                    guardando={guardando === `item.${i}.observaciones`}
                                    guardar={(v) =>
                                      acciones.editar(
                                        { items: [{ indice: i, cambios: { observaciones: v || null } }] },
                                        `item.${i}.observaciones`,
                                      )
                                    }
                                  />
                                  {linea && (
                                    <MargenLinea
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
                {conItems && conFlete && (
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
                key={`${actual?.id}-${actual?.actualizada}-${campo}`}
                className={`cliente-campo cliente-${campo}`}
                etiqueta={ETIQUETA_CAMPO[campo]}
                valor={valor}
                mostrar={campo === 'nombre' ? valor || SIN_CLIENTE : undefined}
                editable={editable}
                discreto
                guardando={guardando === `cliente.${campo}`}
                maxLength={300}
                guardar={(v) => acciones.editar({ cliente: { [campo]: v || null } }, `cliente.${campo}`)}
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
            <details key={`despacho-${actual.id}`} className="quote-details">
              <summary>
                <span>Despacho</span>
                <small>
                  {[
                    actual.despacho?.destino,
                    actual.despacho?.transporte,
                    actual.flete ? `${pesos(actual.flete)} neto` : null,
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
                    value={
                      transportistas.includes(actual.despacho?.transporte ?? '')
                        ? (actual.despacho?.transporte ?? '')
                        : actual.despacho?.transporte
                          ? '__otro__'
                          : ''
                    }
                    opciones={[
                      { value: '', label: 'Seleccionar transportista' },
                      ...transportistas.map((nombre) => ({ value: nombre, label: nombre })),
                      ...(actual.despacho?.transporte && !transportistas.includes(actual.despacho.transporte)
                        ? [{ value: '__otro__', label: `Otro · ${actual.despacho.transporte}` }]
                        : []),
                    ]}
                    onChange={(valor) =>
                      void guardarDespacho(
                        {
                          transporte:
                            valor === '__otro__' ? (actual.despacho?.transporte ?? '') : valor || null,
                        },
                        'despacho.transporte',
                      )
                    }
                    disabled={!editaDespacho || ocupado}
                  />
                </div>
                {(actual.despacho?.transporte === 'Otro' ||
                  (!!actual.despacho?.transporte &&
                    !transportistas.includes(actual.despacho.transporte))) && (
                  <CampoEditable
                    etiqueta="Especificar transportista"
                    valor={actual.despacho?.transporte === 'Otro' ? '' : (actual.despacho?.transporte ?? '')}
                    mostrar={
                      actual.despacho?.transporte === 'Otro'
                        ? 'Especificar transportista'
                        : (actual.despacho?.transporte ?? '')
                    }
                    editable={editaDespacho}
                    discreto
                    guardando={guardando === 'despacho.transporte'}
                    maxLength={120}
                    guardar={(v) => guardarDespacho({ transporte: v || null }, 'despacho.transporte')}
                  />
                )}
                <p className="muted">
                  Valor de despacho: {actual.flete ? `${pesos(actual.flete)} neto` : 'sin flete'}. Se edita en
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
          {actual && (actual.pdf || actual.nota) && (
            <div className="quote-docs">
              {actual.pdf && (
                <Documento
                  nombre="PDF de la cotización"
                  descripcion={`cotización ${numeroCotizacion(actual.numero)}`}
                  archivo={actual.pdf}
                  descargando={descargando}
                  descargar={acciones.descargar}
                />
              )}
              {actual.nota && (
                <Documento
                  nombre={`Nota de pedido N° ${actual.nota.numero}`}
                  archivo={actual.nota.pdf}
                  descargando={descargando}
                  descargar={acciones.descargar}
                  etiqueta="Descargar nota de pedido"
                  anulado={actual.nota.anulada}
                />
              )}
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
        {actual.incompletos.length > 0 && (
          <button
            type="button"
            className="quote-pending-link"
            onClick={() => irAPendiente(actual.incompletos[0].indice)}
          >
            {plural(actual.incompletos.length, 'pendiente')} ↑
          </button>
        )}
        <div className="quote-actions">
          {estado === 'borrador' && (
            <button
              type="button"
              className="button primary"
              disabled={!listo || ocupado}
              aria-describedby={ayudaEmitir ? 'ayuda-emitir' : undefined}
              onClick={acciones.emitir}
            >
              {enCurso === 'emitir' ? 'Emitiendo…' : 'Emitir y generar PDF'}
            </button>
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
              ...(estado === 'emitida' || estado === 'aprobada'
                ? [{ etiqueta: 'Anular', alElegir: acciones.anular, peligro: true }]
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
                        <span>{campos.length ? ` — falta ${textoFaltan(campos)}` : ' — revisar'}</span>
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
    </section>
  );
}

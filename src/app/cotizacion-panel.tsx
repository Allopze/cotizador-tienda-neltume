'use client';
import { useEffect, useState, type RefObject } from 'react';
import {
  despachoEditable,
  esEditable,
  etiquetaComercial,
  etiquetaEstado,
  etiquetaFacturacion,
  etiquetaOperativo,
  pagoAnulable,
  type Cotizacion,
} from '@/negocio/estado';
import { descripcionLinea, pesos, porcentaje } from '@/negocio/precios';
import { leerPesos } from '@/negocio/cifras';
import { fechaLocal } from '@/negocio/vigencia';
import { CampoEditable } from './campo-editable';
import type { CambiosEdicion, Despacho } from './contrato';
import {
  ETIQUETA_CAMPO,
  SIN_CLIENTE,
  autoria,
  fechaLarga,
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
import { pedirJSON } from './solicitud';

export type Operacion =
  'chat' | 'emitir' | 'aprobar' | 'quitar' | 'editar' | 'duplicar' | 'eliminar' | 'anular' | 'workflow';
export interface AccionesPanel {
  emitir: () => void;
  aprobar: () => void;
  quitar: (indice: number) => void;
  duplicar: () => void;
  eliminar: () => void;
  anular: () => void;
  /** Guarda cambios directos; `campo` identifica qué control muestra «Guardando…». */
  editar: (cambios: CambiosEdicion, campo: string) => Promise<boolean>;
  /** Datos de despacho de una cotización aprobada (antes de aprobar se editan con `editar`). */
  despacho: (cambios: Despacho, campo: string) => Promise<boolean>;
  /** Anula un pago registrado por error, previa confirmación. */
  anularPago: (pagoId: string) => Promise<boolean>;
  descargar: (archivo: string) => void;
  copiar: () => void;
  flujo: (accion: Record<string, unknown>) => Promise<boolean>;
}
interface Props {
  actual: Cotizacion | null;
  enCurso: Operacion | null;
  guardando: string | null;
  descargando: string | null;
  acciones: AccionesPanel;
  tituloRef: RefObject<HTMLHeadingElement | null>;
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
    (linea && descripcionLinea(linea)) || q.solicitudes[i]?.descripcion || q.solicitudes[i]?.modelo || 'Producto por definir',
  );
};
/** Frase que el panel sugiere agregar a las puertas sin tipo de medida; la escribe la persona, no el sistema. */
const RECTIFICAR_MEDIDA = 'Rectificar si la medida corresponde a hoja o vano.';

const CAMPOS_CLIENTE = ['nombre', 'rut', 'giro', 'comuna', 'proyecto', 'telefono', 'direccion'] as const;

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

export function CotizacionPanel({ actual, enCurso, guardando, descargando, acciones, tituloRef }: Props) {
  const ocupado = enCurso !== null;
  // Una emitida solo muestra controles de edición cuando se pide modificarla: editarla crea una revisión.
  const [modificando, setModificando] = useState<string | null>(null);
  const [montoPago, setMontoPago] = useState('');
  const [fechaPago, setFechaPago] = useState(() => fechaLocal(new Date()));
  const [observacionPago, setObservacionPago] = useState('');
  const [tipoFactura, setTipoFactura] = useState<'factura' | 'boleta'>('factura');
  const [numeroFactura, setNumeroFactura] = useState('');
  const [fechaFactura, setFechaFactura] = useState(() => fechaLocal(new Date()));
  const [comentario, setComentario] = useState('');
  const [transportistas, setTransportistas] = useState(['Starken', 'Transportes Paredes', 'Ignacio', 'Otro']);
  useEffect(() => {
    const abort = new AbortController();
    pedirJSON<{ configuracion?: { transportistas?: string[] } }>('/api/configuracion-negocio', { signal: abort.signal, cache: 'no-store' })
      .then((d) => { if (d.configuracion?.transportistas?.length) setTransportistas(d.configuracion.transportistas); })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  if (!actual)
    return (
      <section className="quote-panel quote-panel-empty" aria-label="Vista previa de la cotización">
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
  const pagosRegistrados = actual.pagos ?? [];
  const pagado = pagosRegistrados.reduce((s, p) => s + p.monto, 0);
  const saldo = Math.max(0, actual.montos.total - pagado);
  const porcentajePagado = actual.montos.total ? Math.min(100, (100 * pagado) / actual.montos.total) : 0;
  const operacionActual = actual.estadoOperativo ?? (actual.nota ? 'pedido_generado' : 'sin_pedido');
  const estadoComercial = actual.estadoComercial ?? (actual.estado === 'emitida' ? 'enviada' : 'pendiente');
  const pagoMinimoNP = Math.ceil(actual.montos.total * 0.5);
  const aprobada = estado === 'aprobada';
  const puedeAnularPago = pagoAnulable(actual);
  // Desde la aprobación y hasta registrar el despacho, los datos logísticos se editan sin crear revisión.
  const editaDespacho = editable || (despachoEditable(actual) && !ocupado);
  const guardarDespacho = (cambios: Despacho, campo: string) =>
    editable ? acciones.editar({ despacho: cambios }, campo) : acciones.despacho(cambios, campo);
  const transportista = actual.despacho?.transporte ?? '';
  const sinTransportista = !transportista.trim() || transportista.trim().toLowerCase() === 'otro';
  async function registrarPago(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const monto = leerPesos(montoPago);
    if (!Number.isSafeInteger(monto) || monto <= 0 || monto > saldo || ocupado) return;
    if (await acciones.flujo({ tipo: 'pago', monto, fecha: fechaPago, observacion: observacionPago || null })) {
      setMontoPago('');
      setObservacionPago('');
    }
  }
  async function marcarFacturada(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (ocupado) return;
    if (
      await acciones.flujo({
        tipo: 'facturacion',
        estado: 'facturada',
        tipoDocumento: tipoFactura,
        identificadorExterno: numeroFactura.trim() || null,
        fecha: fechaFactura || null,
      })
    )
      setNumeroFactura('');
  }
  async function guardarComentario(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!comentario.trim() || ocupado) return;
    if (await acciones.flujo({ tipo: 'comentario', texto: comentario.trim() })) setComentario('');
  }
  const operar = (paso: string, extra: Record<string, unknown> = {}) =>
    acciones.flujo({ tipo: 'operacion', paso, ...extra });
  const quien = [
    autoria(actual),
    actual.fechaEmision && estado !== 'borrador' && fechaLarga(actual.fechaEmision),
  ]
    .filter(Boolean)
    .join(' · ');
  // Las bloqueadas no muestran el botón de quitar: no hay nada que hacer con él.
  const conQuitar = !!actual && esEditable(actual) && puedeModificar;
  const despacho = actual?.nota?.despacho;
  const condicionDespacho =
    despacho && (despacho.direccion || despacho.transporte)
      ? `Despacho: ${[despacho.direccion, despacho.transporte].filter(Boolean).join(' · ')}`
      : actual?.montos.flete
        ? `Incluye flete por ${pesos(actual.montos.flete)} neto`
        : 'Despacho por confirmar';
  return (
    <section className="quote-panel" aria-label="Cotización en curso">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">02 / COTIZACIÓN</p>
          <h2 id="cotizacion-titulo" ref={tituloRef} tabIndex={-1}>
            {numeroCotizacion(actual.numero)}
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
      <div className="client">
        {CAMPOS_CLIENTE.map((campo) => {
          const valor = actual?.cliente[campo] ?? '';
          if (actual && !editable && !valor && (campo === 'giro' || campo === 'rut' || campo === 'direccion'))
            return null;
          return (
            <CampoEditable
              key={`${actual?.id}-${actual?.actualizada}-${campo}`}
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
      {(editable || actual.observaciones || editaDespacho || actual.despacho) && (
        <div className="quote-custom-fields">
          {(editable || actual.observaciones) && (
            <CampoEditable
              etiqueta="Observaciones"
              valor={actual.observaciones ?? ''}
              mostrar={actual.observaciones || 'Agregar observaciones'}
              editable={editable}
              discreto
              area
              maxLength={2000}
              guardando={guardando === 'observaciones'}
              guardar={(v) => acciones.editar({ observaciones: v || null }, 'observaciones')}
            />
          )}
          {(editaDespacho || actual.despacho) && (
            <div className="quote-dispatch-fields">
              <span className="campo-etiqueta">Despacho</span>
              <CampoEditable
                etiqueta="Destino"
                valor={actual.despacho?.destino ?? ''}
                mostrar={actual.despacho?.destino || 'Agregar comuna o destino'}
                editable={editaDespacho}
                discreto
                guardando={guardando === 'despacho.destino'}
                maxLength={300}
                guardar={(v) => guardarDespacho({ destino: v || null }, 'despacho.destino')}
              />
              <CampoEditable
                etiqueta="Dirección de despacho"
                valor={actual.despacho?.direccion ?? ''}
                mostrar={actual.despacho?.direccion || 'Agregar dirección'}
                editable={editaDespacho}
                discreto
                guardando={guardando === 'despacho.direccion'}
                maxLength={300}
                guardar={(v) => guardarDespacho({ direccion: v || null }, 'despacho.direccion')}
              />
              <label className="ia-field item-select-field">
                <span>Transportista</span>
                <select
                  value={transportistas.includes(actual.despacho?.transporte ?? '') ? actual.despacho?.transporte ?? '' : actual.despacho?.transporte ? '__otro__' : ''}
                  onChange={(e) => void guardarDespacho({ transporte: e.target.value === '__otro__' ? actual.despacho?.transporte ?? '' : e.target.value || null }, 'despacho.transporte')}
                  disabled={!editaDespacho || ocupado}
                >
                  <option value="">Seleccionar transportista</option>
                  {transportistas.map((nombre) => <option key={nombre} value={nombre}>{nombre}</option>)}
                  {!!actual.despacho?.transporte && !transportistas.includes(actual.despacho.transporte) && <option value="__otro__">Otro · {actual.despacho.transporte}</option>}
                </select>
              </label>
              {(actual.despacho?.transporte === 'Otro' || (!!actual.despacho?.transporte && !transportistas.includes(actual.despacho.transporte))) && (
                <CampoEditable
                  etiqueta="Especificar transportista"
                  valor={actual.despacho?.transporte === 'Otro' ? '' : actual.despacho?.transporte ?? ''}
                  mostrar={actual.despacho?.transporte === 'Otro' ? 'Especificar transportista' : actual.despacho?.transporte ?? ''}
                  editable={editaDespacho}
                  discreto
                  guardando={guardando === 'despacho.transporte'}
                  maxLength={120}
                  guardar={(v) => guardarDespacho({ transporte: v || null }, 'despacho.transporte')}
                />
              )}
              <CampoEditable
                etiqueta="Valor de despacho"
                valor={String(actual.despacho?.valor ?? actual.flete)}
                mostrar={pesos(actual.despacho?.valor ?? actual.flete)}
                editable={editable}
                discreto
                guardando={guardando === 'despacho.valor'}
                tipo="text"
                sufijo="$"
                validar={(v) => { const n = v ? leerPesos(v) : 0; return Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000 ? null : 'Indica un monto entre $0 y $100.000.000.'; }}
                guardar={(v) => acciones.editar({ despacho: { valor: v ? leerPesos(v) : 0 } }, 'despacho.valor')}
              />
              <CampoEditable
                etiqueta="Entrega comprometida"
                valor={actual.despacho?.entregaComprometida ?? ''}
                mostrar={actual.despacho?.entregaComprometida || 'Agregar fecha o compromiso'}
                editable={editaDespacho}
                discreto
                guardando={guardando === 'despacho.entregaComprometida'}
                maxLength={120}
                guardar={(v) => guardarDespacho({ entregaComprometida: v || null }, 'despacho.entregaComprometida')}
              />
            </div>
          )}
        </div>
      )}
      {/* Zona central: la única que se desplaza cuando el pedido es largo; cabecera, cliente, acciones
          y totales quedan siempre a la vista. */}
      <div className="quote-cuerpo">
        <div className="items-top">
          <span>Detalle del pedido</span>
          <span>{plural(actual?.solicitudes.length ?? 0, 'ítem')}</span>
        </div>
        {actual?.solicitudes.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">PRODUCTO / CÓDIGO</th>
                  <th scope="col">CANT.</th>
                  <th scope="col">UNITARIO</th>
                  <th scope="col">TOTAL</th>
                  {conQuitar && (
                    <th>
                      <span className="sr-only">Acciones</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {actual.solicitudes.map((s, i) => {
                  const { pendiente, linea } = lineaDe(actual, i);
                  const medida = linea && medidaPedida(linea);
                  const descripcion = descripcionItem(actual, i);
                  const posible =
                    pendiente?.rechazo.tipo === 'modelo_posible'
                      ? { pregunta: pendiente.pregunta, sugerido: pendiente.rechazo.sugerido }
                      : null;
                  return (
                    <tr key={i} className={pendiente ? 'pending' : ''}>
                      <td>
                        <strong>{descripcion}</strong>
                        <small>{linea?.producto.codigo || 'Pendiente de completar'}</small>
                        {linea && <small>{referenciaCatalogo(linea)}</small>}
                        {/* Con la cotización editable, el margen se ve (y se cambia) en el bloque de edición de la línea. */}
                        {!editable && linea && textoMargenLinea(actual, linea) && (
                          <small className="margen-manual">{textoMargenLinea(actual, linea)}</small>
                        )}
                        {s.modeloOriginal && s.coincidenciaModelo && (
                          <small className={`match-confidence ${s.coincidenciaModelo}`}>
                            {s.coincidenciaModelo === 'alias' ? 'Normalizado desde' : 'Revisar posible coincidencia'}: {s.modeloOriginal}
                          </small>
                        )}
                        {medida && <small>{medida}</small>}
                        {pendiente && <span className="pending-label">Incompleto · no suma al total</span>}
                        {editable && posible && (
                          <div className="aviso-medida" role="note">
                            <span>{posible.pregunta}</span>
                            <button
                              type="button"
                              className="button secondary small"
                              aria-label={`Confirmar ${nombreProducto(posible.sugerido)} en el ítem ${i + 1}`}
                              onClick={() => void acciones.editar({ items: [{ indice: i, cambios: { modelo: posible.sugerido } }] }, `item.${i}.modelo`)}
                            >
                              Confirmar {nombreProducto(posible.sugerido)}
                            </button>
                          </div>
                        )}
                        {editable && linea?.producto.familia === 'PUERTA' && (s.tipoMedida ?? 'no_especificado') === 'no_especificado' && (
                          <div className="aviso-medida" role="note">
                            <span>{RECTIFICAR_MEDIDA}</span>
                            {!s.observaciones?.includes(RECTIFICAR_MEDIDA) && (
                              <button
                                type="button"
                                className="button secondary small"
                                aria-label={`Agregar como observación al ítem ${i + 1}: ${descripcion}`}
                                onClick={() => void acciones.editar({ items: [{ indice: i, cambios: { observaciones: [s.observaciones, RECTIFICAR_MEDIDA].filter(Boolean).join(' ') } }] }, `item.${i}.observaciones`)}
                              >
                                Agregar como observación
                              </button>
                            )}
                          </div>
                        )}
                        {editable && (
                          <div className="item-editables">
                            {linea && <small className="precio-trazabilidad">Fábrica {pesos(linea.precioFabrica ?? linea.producto.precioNeto)} → cliente {pesos(linea.precioCliente ?? linea.precioUnitario)}</small>}
                            <CampoEditable
                              etiqueta="Descripción para el documento"
                              valor={s.descripcion ?? ''}
                              mostrar={s.descripcion || descripcion}
                              editable={editable}
                              discreto
                              maxLength={300}
                              guardando={guardando === `item.${i}.descripcion`}
                              guardar={(v) => acciones.editar({ items: [{ indice: i, cambios: { descripcion: v || null } }] }, `item.${i}.descripcion`)}
                            />
                            <CampoEditable
                              etiqueta="Modelo"
                              etiquetaOculta
                              valor={s.modelo ?? ''}
                              mostrar={s.modelo || 'Modelo'}
                              editable={editable}
                              discreto
                              guardando={guardando === `item.${i}.modelo`}
                              maxLength={300}
                              guardar={(v) => acciones.editar({ items: [{ indice: i, cambios: { modelo: v || null } }] }, `item.${i}.modelo`)}
                            />
                            <CampoEditable
                              etiqueta="Madera"
                              etiquetaOculta
                              valor={s.madera ?? ''}
                              mostrar={s.madera || 'Madera'}
                              editable={editable}
                              discreto
                              guardando={guardando === `item.${i}.madera`}
                              maxLength={300}
                              guardar={(v) => acciones.editar({ items: [{ indice: i, cambios: { madera: v || null } }] }, `item.${i}.madera`)}
                            />
                            {linea?.producto.familia === 'PUERTA' ? (
                              <CampoEditable
                                etiqueta="Ancho"
                                etiquetaOculta
                                valor={s.ancho === null ? '' : String(s.ancho)}
                                mostrar={s.ancho ?? 'Ancho'}
                                editable={editable}
                                discreto
                                tipo="number"
                                paso={0.01}
                                guardando={guardando === `item.${i}.ancho`}
                                validar={(v) => (!v || Number.isFinite(Number(v)) ? null : 'Indica un ancho válido.')}
                                guardar={(v) => acciones.editar({ items: [{ indice: i, cambios: { ancho: v ? Number(v) : null } }] }, `item.${i}.ancho`)}
                              />
                            ) : (
                              <CampoEditable
                                etiqueta="Medida"
                                etiquetaOculta
                                valor={s.medida ?? ''}
                                mostrar={s.medida || 'Medida'}
                                editable={editable}
                                discreto
                                guardando={guardando === `item.${i}.medida`}
                                maxLength={300}
                                guardar={(v) => acciones.editar({ items: [{ indice: i, cambios: { medida: v || null } }] }, `item.${i}.medida`)}
                              />
                            )}
                            <CampoEditable
                              etiqueta="Alto / largo"
                              etiquetaOculta
                              valor={s.alto === null ? '' : String(s.alto)}
                              mostrar={s.alto ?? 'Alto / largo'}
                              editable={editable}
                              discreto
                              tipo="number"
                              paso={0.01}
                              guardando={guardando === `item.${i}.alto`}
                              validar={(v) => (!v || Number.isFinite(Number(v)) ? null : 'Indica un alto válido.')}
                              guardar={(v) => acciones.editar({ items: [{ indice: i, cambios: { alto: v ? Number(v) : null } }] }, `item.${i}.alto`)}
                            />
                            <label className="ia-field item-select-field">
                              <span>La medida corresponde a</span>
                              <select
                                value={s.tipoMedida ?? 'no_especificado'}
                                onChange={(e) => void acciones.editar({ items: [{ indice: i, cambios: { tipoMedida: e.target.value as 'hoja' | 'vano' | 'no_especificado' } }] }, `item.${i}.tipoMedida`)}
                                disabled={!editable || ocupado}
                              >
                                <option value="no_especificado">No especificado</option>
                                <option value="hoja">Hoja</option>
                                <option value="vano">Vano</option>
                              </select>
                            </label>
                            <CampoEditable
                              etiqueta="Observación del producto"
                              valor={s.observaciones ?? ''}
                              mostrar={s.observaciones || 'Agregar observación (ej. confirmar sentido de apertura)'}
                              editable={editable}
                              discreto
                              maxLength={500}
                              guardando={guardando === `item.${i}.observaciones`}
                              guardar={(v) => acciones.editar({ items: [{ indice: i, cambios: { observaciones: v || null } }] }, `item.${i}.observaciones`)}
                            />
                            {linea && (
                              <MargenLinea actual={actual} linea={linea} indice={i} editable={editable} editar={acciones.editar} />
                            )}
                          </div>
                        )}
                      </td>
                      <td className="celda-cantidad">
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
                            valor={s.precioUnitario === null || s.precioUnitario === undefined ? '' : String(s.precioUnitario)}
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
                            guardar={(v) => acciones.editar({ items: [{ indice: i, cambios: { precioUnitario: v ? leerPesos(v) : null } }] }, `item.${i}.precioUnitario`)}
                          />
                        ) : '—'}
                      </td>
                      <td className="celda-monto celda-total" data-etiqueta="Total">
                        {linea ? pesos(linea.total) : '—'}
                      </td>
                      {conQuitar && (
                        <td className="celda-acciones">
                          <button
                            type="button"
                            className="remove"
                            onClick={() => acciones.quitar(i)}
                            disabled={!editable}
                            aria-label={`Quitar ítem ${i + 1}: ${descripcion}`}
                          >
                            ×
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
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
      <div className="quote-pie">
        <div className="quote-pie-acciones">
          {/* Una sola acción principal a la vista; el resto va en «Más acciones». */}
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
              <p className="ayuda" id="ayuda-emitir">
                {ayudaEmitir}
              </p>
            )}
            {estado === 'emitida' && esVencida && (
              <p className="ayuda" id="ayuda-aprobar">
                La vigencia terminó: se pedirá confirmar antes de aprobar.
              </p>
            )}
          </div>
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
      <div className="conditions">
        <span>Valores puestos en fábrica.</span>
        <span className={esVencida ? 'vencida-texto' : undefined}>
          {condicionDespacho} · {validez(actual)}
          {esVencida ? ' (vencida)' : ''}
        </span>
      </div>
      {actual.numero !== null && actual.estado !== 'anulada' && actual.estado !== 'reemplazada' && (
        <section className="quote-workflow" aria-labelledby="seguimiento-title">
          <div className="workflow-heading">
            <div>
              <p className="eyebrow">SEGUIMIENTO DE LA OPERACIÓN</p>
              <h3 id="seguimiento-title">
                {aprobada || pagado > 0 ? `${pesos(pagado)} pagado · ${pesos(saldo)} pendiente` : 'Esperando la aprobación del cliente'}
              </h3>
            </div>
            {(aprobada || pagado > 0) && <span className="status">{porcentaje(porcentajePagado)} pagado</span>}
          </div>
          <div className="workflow-states">
            <span>Comercial: <strong>{etiquetaComercial[estadoComercial]}</strong></span>
            <span>Operación: <strong>{etiquetaOperativo[operacionActual]}</strong></span>
            {aprobada && <span>Facturación: <strong>{etiquetaFacturacion(actual.facturacion)}</strong></span>}
          </div>
          {estado === 'emitida' && (
            <div className="workflow-actions">
              {estadoComercial !== 'seguimiento' && <button type="button" className="button secondary small" disabled={ocupado} onClick={() => void acciones.flujo({ tipo: 'comercial', estado: 'seguimiento' })}>Marcar seguimiento</button>}
              <button type="button" className="button secondary small" disabled={ocupado} onClick={() => void acciones.flujo({ tipo: 'comercial', estado: 'rechazada' })}>Marcar rechazada</button>
              <p className="muted">Los pagos se registran cuando el cliente aprueba la cotización.</p>
            </div>
          )}
          {aprobada && (
            <form className="workflow-payment" onSubmit={registrarPago}>
              <label className="ia-field"><span>Monto recibido (máx. {pesos(saldo)})</span><input inputMode="numeric" value={montoPago} onChange={(e) => setMontoPago(e.target.value)} placeholder="0" disabled={ocupado || saldo <= 0} /></label>
              <label className="ia-field"><span>Fecha del pago</span><input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} disabled={ocupado || saldo <= 0} /></label>
              <label className="ia-field"><span>Observación</span><input value={observacionPago} onChange={(e) => setObservacionPago(e.target.value)} maxLength={500} placeholder="Transferencia, anticipo…" disabled={ocupado || saldo <= 0} /></label>
              <button type="submit" className="button secondary" disabled={ocupado || saldo <= 0 || leerPesos(montoPago) <= 0}>Registrar pago</button>
            </form>
          )}
          {pagosRegistrados.length > 0 && (
            <ul className="workflow-ledger">
              {pagosRegistrados.map((p) => (
                <li key={p.id}>
                  <span>{fechaLarga(p.fecha)}{p.observacion ? ` · ${p.observacion}` : ''}</span>
                  <span className="workflow-ledger-monto">
                    <strong>{pesos(p.monto)}</strong>
                    {puedeAnularPago && (
                      <button
                        type="button"
                        className="button secondary small"
                        disabled={ocupado}
                        aria-label={`Anular el pago de ${pesos(p.monto)} del ${fechaLarga(p.fecha)}`}
                        onClick={() => void acciones.anularPago(p.id)}
                      >
                        Anular
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {aprobada && !actual.nota && (
            <div className="workflow-actions">
              <p className="muted">Nota de pedido disponible desde {pesos(pagoMinimoNP)} (50 %).</p>
              <button type="button" className="button primary" disabled={ocupado || pagado < pagoMinimoNP} onClick={() => void acciones.flujo({ tipo: 'generar_nota' })}>Generar nota de pedido</button>
            </div>
          )}
          {actual.nota && (
            <div className="workflow-actions">
              {operacionActual === 'pedido_generado' && <button type="button" className="button secondary" disabled={ocupado} onClick={() => void operar('iniciar_produccion')}>Iniciar producción</button>}
              {operacionActual === 'en_produccion' && <button type="button" className="button secondary" disabled={ocupado} onClick={() => void operar('produccion_terminada')}>Marcar producción terminada</button>}
              {operacionActual === 'produccion_terminada' && pagado < actual.montos.total && <p className="muted">La producción terminó. Registra el saldo antes de habilitar el despacho.</p>}
              {(operacionActual === 'pagada' || operacionActual === 'produccion_terminada') && pagado >= actual.montos.total && <button type="button" className="button secondary" disabled={ocupado} onClick={() => void operar('lista_despacho')}>Marcar lista para despacho</button>}
              {operacionActual === 'lista_despacho' && <button type="button" className="button primary" disabled={ocupado || sinTransportista} onClick={() => void operar('despachada')}>Registrar despacho</button>}
              {operacionActual === 'lista_despacho' && sinTransportista && <p className="muted">Indica el transportista en «Despacho» para registrar el despacho.</p>}
              {operacionActual === 'despachada' && <button type="button" className="button secondary" disabled={ocupado} onClick={() => void operar('completada')}>Completar operación</button>}
            </div>
          )}
          {aprobada && (
            actual.facturacion?.estado === 'facturada' ? (
              <div className="workflow-actions">
                <p>
                  <strong>{etiquetaFacturacion(actual.facturacion)}</strong>
                  {actual.facturacion.fecha ? ` · ${fechaLarga(actual.facturacion.fecha)}` : ''}
                </p>
                <button type="button" className="button secondary small" disabled={ocupado} onClick={() => void acciones.flujo({ tipo: 'facturacion', estado: 'pendiente' })}>Volver a pendiente</button>
              </div>
            ) : (
              <form className="workflow-payment" onSubmit={marcarFacturada}>
                <label className="ia-field">
                  <span>Documento</span>
                  <select value={tipoFactura} onChange={(e) => setTipoFactura(e.target.value as 'factura' | 'boleta')} disabled={ocupado}>
                    <option value="factura">Factura</option>
                    <option value="boleta">Boleta</option>
                  </select>
                </label>
                <label className="ia-field"><span>N° o identificador externo</span><input value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} maxLength={120} placeholder="Ej. 1234" disabled={ocupado} /></label>
                <label className="ia-field"><span>Fecha de emisión</span><input type="date" value={fechaFactura} onChange={(e) => setFechaFactura(e.target.value)} disabled={ocupado} /></label>
                <button type="submit" className="button secondary" disabled={ocupado}>Marcar como facturada</button>
              </form>
            )
          )}
          <form className="workflow-comment" onSubmit={guardarComentario}>
            <label className="ia-field"><span>Nota interna</span><textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} maxLength={2000} placeholder="Seguimiento, acuerdos o instrucciones internas" disabled={ocupado} /></label>
            <button type="submit" className="button secondary small" disabled={ocupado || !comentario.trim()}>Agregar nota</button>
          </form>
          {(actual.comentariosInternos?.length ?? 0) > 0 && (
            <ul className="workflow-ledger internal-comments">
              {actual.comentariosInternos!.map((c) => <li key={c.id}><span>{fechaLarga(c.fecha)} · {c.usuario ?? 'Equipo'}: {c.texto}</span></li>)}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}

'use client';
import { useState, type RefObject } from 'react';
import { esEditable, etiquetaEstado, type Cotizacion } from '@/negocio/estado';
import { pesos } from '@/negocio/precios';
import { CampoEditable } from './campo-editable';
import type { CambiosEdicion } from './contrato';
import {
  ETIQUETA_CAMPO,
  SIN_CLIENTE,
  autoria,
  fechaLarga,
  medidaPedida,
  nombreProducto,
  numeroCotizacion,
  plural,
  validez,
  vencida,
} from './formato';
import { Documento, Totales } from './panel-totales';
import { Actividad } from './actividad';

export type Operacion =
  'chat' | 'emitir' | 'aprobar' | 'quitar' | 'editar' | 'duplicar' | 'eliminar' | 'anular';
export interface AccionesPanel {
  emitir: () => void;
  aprobar: () => void;
  quitar: (indice: number) => void;
  duplicar: () => void;
  eliminar: () => void;
  anular: () => void;
  /** Guarda cambios directos; `campo` identifica qué control muestra «Guardando…». */
  editar: (cambios: CambiosEdicion, campo: string) => Promise<boolean>;
  descargar: (archivo: string) => void;
  copiar: () => void;
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
export const descripcionItem = (q: Cotizacion, i: number) =>
  nombreProducto(
    lineaDe(q, i).linea?.producto.descripcion || q.solicitudes[i]?.modelo || 'Producto por definir',
  );

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
      return `${q.fechaEmision ? `Emitida el ${fechaLarga(q.fechaEmision)}. ` : ''}Si haces cambios, se creará una revisión en borrador y se conservará este PDF.`;
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
  const puedeModificar = actual?.estado !== 'emitida' || modificando === actual.id;
  const editable = !!actual && esEditable(actual) && puedeModificar && !ocupado;
  const conItems = !!actual?.montos.lineas.length;
  const listo = conItems && !actual.incompletos.length;
  const estado = actual?.estado ?? 'borrador';
  const esVencida = vencida(actual);
  const ayudaEmitir = !actual?.solicitudes.length
    ? 'Agrega al menos un producto para generar el PDF.'
    : actual.incompletos.length
      ? 'Completa o quita los ítems pendientes para generar el PDF.'
      : 'Asigna el siguiente número correlativo; después, los cambios crean una revisión.';
  const quien = actual ? autoria(actual) : '';
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
            {actual ? numeroCotizacion(actual.numero) : 'Nueva cotización'}
          </h2>
          {quien && <p className="autoria">{quien}</p>}
        </div>
        <span className="estado-badges">
          <span className={`status ${estado}`}>{etiquetaEstado[estado]}</span>
          {esVencida && <span className="status vencida">Vencida</span>}
        </span>
      </div>
      {actual?.estado === 'emitida' && esEditable(actual) && (
        <div className="panel-aviso" id="aviso-revision">
          <p>
            {puedeModificar
              ? 'Modo edición: el primer cambio crea (o reutiliza) una revisión en borrador y conserva este PDF.'
              : 'Cotización emitida. Para cambiarla se crea una revisión en borrador.'}
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
          // Sin cotización se muestran todos: el panel no cambia de forma al crear el borrador.
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
                return (
                  <tr key={i} className={pendiente ? 'pending' : ''}>
                    <td>
                      <strong>{descripcion}</strong>
                      <small>{linea?.producto.codigo || 'Pendiente de completar'}</small>
                      {medida && <small>{medida}</small>}
                      {pendiente && <span className="pending-label">Incompleto · no suma al total</span>}
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
                      {linea ? pesos(linea.precioUnitario) : '—'}
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
        <div className="empty-quote">
          <div className="door-icon" aria-hidden>
            <span />
          </div>
          <h3>El próximo proyecto empieza aquí.</h3>
          <p>
            Tu pedido aparecerá con sus medidas,
            <br />
            cantidades y valores, listo para revisar.
          </p>
        </div>
      )}
      <Totales
        actual={actual}
        editable={editable && conItems}
        guardando={guardando}
        editar={acciones.editar}
      />
      {/* Acciones que cambian el estado, separadas de las descargas. */}
      {estado === 'borrador' && (
        <div className="quote-actions">
          <button
            type="button"
            className="button primary"
            disabled={!listo || ocupado}
            aria-describedby="ayuda-emitir"
            onClick={acciones.emitir}
          >
            {enCurso === 'emitir' ? 'Emitiendo…' : 'Emitir y generar PDF'}
          </button>
          <p className="ayuda" id="ayuda-emitir">
            {ayudaEmitir}
          </p>
        </div>
      )}
      {estado === 'emitida' && (
        <div className="quote-actions">
          <button
            type="button"
            className="button primary"
            disabled={ocupado}
            aria-describedby="ayuda-aprobar"
            onClick={acciones.aprobar}
          >
            {enCurso === 'aprobar' ? 'Aprobando…' : 'Aprobar y generar nota de pedido'}
          </button>
          <p className="ayuda" id="ayuda-aprobar">
            {esVencida
              ? 'La vigencia terminó: se pedirá confirmar antes de aprobar.'
              : 'Genera la nota de pedido para fábrica y bloquea la cotización.'}
          </p>
        </div>
      )}
      {actual && (
        <div className="quote-more">
          <button
            type="button"
            className="button secondary small"
            onClick={acciones.duplicar}
            disabled={ocupado}
          >
            {enCurso === 'duplicar' ? 'Duplicando…' : 'Duplicar'}
          </button>
          {estado === 'borrador' && actual.numero === null && (
            <button
              type="button"
              className="button secondary small peligro"
              onClick={acciones.eliminar}
              disabled={ocupado}
            >
              {enCurso === 'eliminar' ? 'Eliminando…' : 'Eliminar borrador'}
            </button>
          )}
          {(estado === 'emitida' || estado === 'aprobada') && (
            <button
              type="button"
              className="button secondary small peligro"
              onClick={acciones.anular}
              disabled={ocupado}
            >
              {enCurso === 'anular' ? 'Anulando…' : 'Anular'}
            </button>
          )}
        </div>
      )}
      {actual && (actual.pdf || actual.nota || conItems) && (
        <div className="quote-docs">
          {actual.pdf && (
            <Documento
              nombre={`Cotización ${numeroCotizacion(actual.numero)}`}
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
          {conItems && (
            <div>
              <span className="doc-nombre muted">Resumen en texto para correo o WhatsApp</span>
              <button type="button" className="button secondary small" onClick={acciones.copiar}>
                Copiar resumen
              </button>
            </div>
          )}
        </div>
      )}
      <p className="review-note" id="nota-revision">
        {notaEstado(actual)}
      </p>
      <div className="conditions">
        <span>Valores puestos en fábrica.</span>
        <span className={esVencida ? 'vencida-texto' : undefined}>
          {condicionDespacho} · {validez(actual)}
          {esVencida ? ' (vencida)' : ''}
        </span>
      </div>
      {actual && <Actividad id={actual.id} version={actual.actualizada} />}
    </section>
  );
}

'use client';
import { useSyncExternalStore } from 'react';
import type { Cotizacion } from '@/negocio/estado';
import { conDosDecimales, leerPorcentaje } from '@/negocio/cifras';
import {
  contarPuertas,
  descuentoAutomatico,
  descuentoEsManual,
  siguienteTramo,
  textoPuertas,
  textoTramo,
  tramoAplicable,
} from '@/negocio/descuento-cantidad';
import { pesos, porcentaje, REGLAS, resumenDescuentosItems } from '@/negocio/precios';
import { CampoEditable } from './campo-editable';
import type { CambiosEdicion } from './contrato';
import { iva, pct } from './formato';

interface Props {
  actual: Cotizacion | null;
  editable: boolean;
  guardando: string | null;
  editar: (cambios: CambiosEdicion, campo: string) => Promise<boolean>;
}

/**
 * De dónde sale el descuento cuando la cotización tiene tramos por cantidad: el tramo que corresponde a
 * sus puertas (y el siguiente por alcanzar) o, si la persona lo fijó, el valor manual con la vuelta al
 * automático. Se muestra bajo la fila del descuento, con su misma visibilidad; es una región en vivo
 * porque cambia sola al editar las cantidades.
 */
function OrigenDescuento({ actual, editable, guardando, editar }: Props & { actual: Cotizacion }) {
  const tramos = actual.reglas?.descuentosPorCantidad ?? [];
  if (!tramos.length) return null;
  const puertas = contarPuertas(actual.montos.lineas);
  const siguiente = siguienteTramo(tramos, puertas);
  const manual = descuentoEsManual(actual);
  const automatico = manual ? descuentoAutomatico(actual.reglas ?? REGLAS, puertas) : 0;
  return (
    <div className="descuento-origen" data-testid="descuento-origen" aria-live="polite">
      {manual ? (
        <>
          <span>Descuento manual: {porcentaje(actual.descuento)}</span>
          {editable && (
            <button
              type="button"
              className="button secondary small"
              disabled={guardando === 'descuento'}
              onClick={() => void editar({ descuentoAutomatico: true }, 'descuento')}
            >
              Restaurar automático
            </button>
          )}
          <small>
            Automático: {automatico ? porcentaje(automatico) : 'sin descuento'} con {textoPuertas(puertas)}
          </small>
        </>
      ) : (
        <>
          <span>
            Descuento por cantidad:{' '}
            {tramoAplicable(tramos, puertas)
              ? `${textoPuertas(puertas)} → ${porcentaje(actual.descuento)}`
              : `aún no aplica (${textoPuertas(puertas)})`}
          </span>
          {siguiente && <small>Siguiente tramo: {textoTramo(siguiente)}</small>}
        </>
      )}
    </div>
  );
}

/**
 * Totales con el descuento (%) editable. El flete es una línea del detalle: el subtotal la incluye, pero el
 * descuento se calcula solo sobre los productos.
 */
export function Totales({ actual, editable, guardando, editar }: Props) {
  const m = actual?.montos;
  // Descuentos especiales por ítem: lo que habría costado sin ellos y lo que ahorran (ya restado del subtotal).
  const { ahorro, subtotalOriginal } = m ? resumenDescuentosItems(m) : { ahorro: 0, subtotalOriginal: 0 };
  return (
    <div className="totals">
      {!!ahorro && (
        <>
          <div className="total-original">
            <span>Subtotal original</span>
            <span data-testid="subtotal-original">{pesos(subtotalOriginal + (m?.flete ?? 0))}</span>
          </div>
          <div className="total-ahorro">
            <span>Descuentos especiales</span>
            <span data-testid="ahorro-items">−{pesos(ahorro)}</span>
          </div>
        </>
      )}
      {(!!m?.descuento || !!ahorro || editable) && (
        <div>
          <span>Subtotal</span>
          <span>{pesos((m?.subtotal ?? 0) + (m?.flete ?? 0))}</span>
        </div>
      )}
      {(!!m?.descuento || editable) && (
        <>
          <div className="total-editable">
            <CampoEditable
              etiqueta="Descuento"
              valor={String(actual?.descuento ?? 0).replace('.', ',')}
              mostrar={
                m?.descuento
                  ? `${pct(m.descuentoPorcentaje)}${m.flete ? ' sobre productos' : ''} · −${pesos(m.descuento)}`
                  : 'Sin descuento'
              }
              editable={editable}
              discreto
              guardando={guardando === 'descuento'}
              tipo="text"
              sufijo="%"
              validar={(v) => {
                const n = leerPorcentaje(v);
                const maximo = actual?.reglas?.descuentoMaximo ?? REGLAS.descuentoMaximo;
                if (!Number.isFinite(n) || n < 0 || n > maximo)
                  return `El descuento debe estar entre 0 y ${maximo}%.`;
                if (!conDosDecimales(n)) return 'Usa como máximo dos decimales.';
                return null;
              }}
              guardar={(v) => editar({ descuento: Math.round(leerPorcentaje(v) * 100) / 100 }, 'descuento')}
            />
          </div>
          {actual && (
            <OrigenDescuento actual={actual} editable={editable} guardando={guardando} editar={editar} />
          )}
        </>
      )}
      <div>
        <span>Total sin IVA</span>
        <span data-testid="neto">{pesos(m?.neto ?? 0)}</span>
      </div>
      <div>
        <span>
          IVA <small>{iva(actual?.reglas?.iva)}</small>
        </span>
        <span>{pesos(m?.iva ?? 0)}</span>
      </div>
      <div className="grand-total">
        <span>{actual?.incompletos.length ? 'Total parcial' : 'Total'}</span>
        <strong data-testid="total">{pesos(m?.total ?? 0)}</strong>
      </div>
    </div>
  );
}

/**
 * Lo que el cotizador agrega a los documentos sin pasar por el panel: abrir el PDF comprobando antes que
 * exista (si falta, ofrece regenerarlo) y compartirlo con la hoja del sistema.
 */
export interface AccionesDocumentos {
  /** Abre el PDF en una pestaña nueva; falso si el navegador no la abrió (se sigue el enlace normal). */
  ver: (archivo: string) => boolean;
  compartir: (archivo: string) => void;
  /** Solo el PDF de la cotización se comparte; la nota de pedido es para fábrica. */
  compartible: string | null;
}

let compartirArchivos: boolean | null = null;
/** Si el navegador comparte archivos (Web Share API con `files`): en general, teléfonos y tabletas. */
function admiteCompartir() {
  if (compartirArchivos === null)
    try {
      compartirArchivos =
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [new File(['%PDF'], 'cotizacion.pdf', { type: 'application/pdf' })] });
    } catch {
      compartirArchivos = false;
    }
  return compartirArchivos;
}
const sinSuscripcion = () => () => {};

export function Documento({
  nombre,
  archivo,
  descargando,
  descargar,
  etiqueta = 'Descargar cotización',
  anulado,
  descripcion = nombre,
  acciones,
  cambiarNumero,
}: {
  nombre: string;
  /** Cómo se nombra el documento para lectores de pantalla («Ver cotización N° 325…»). */
  descripcion?: string;
  archivo: string;
  descargando: string | null;
  descargar: (archivo: string) => void;
  etiqueta?: string;
  anulado?: boolean;
  /** Las del cotizador; sin ellas (otras pantallas), «Ver» sigue el enlace normal y no se ofrece «Compartir». */
  acciones?: AccionesDocumentos | null;
  /** Cambia el número de este documento (solo cuentas administradoras); sin ella no se ofrece. */
  cambiarNumero?: () => void;
}) {
  // Falso en el servidor y al hidratar: el botón aparece recién en el navegador que lo admite.
  const puedeCompartir = useSyncExternalStore(sinSuscripcion, admiteCompartir, () => false);
  return (
    <div>
      <span className="doc-nombre">
        {nombre}
        {anulado && <span className="status anulada">Anulada</span>}
      </span>
      <a
        className="button secondary small"
        href={`/api/documento/${encodeURIComponent(archivo)}?ver=1`}
        target="_blank"
        rel="noopener"
        aria-label={`Ver ${descripcion} en una pestaña nueva`}
        onClick={(e) => {
          // Con teclas modificadoras (otra ventana, guardar enlace) manda el navegador.
          if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
          if (acciones?.ver(archivo)) e.preventDefault();
        }}
      >
        Ver <span aria-hidden>↗</span>
      </a>
      <button
        type="button"
        className="button secondary small"
        onClick={() => descargar(archivo)}
        disabled={descargando === archivo}
        aria-label={etiqueta}
      >
        {descargando === archivo ? 'Descargando…' : 'Descargar'} <span aria-hidden>↓</span>
      </button>
      {puedeCompartir && acciones?.compartible === archivo && (
        <button
          type="button"
          className="button secondary small"
          onClick={() => acciones.compartir(archivo)}
          disabled={descargando === archivo}
          aria-label={`Compartir ${descripcion}`}
        >
          Compartir
        </button>
      )}
      {cambiarNumero && (
        <button
          type="button"
          className="button secondary small"
          onClick={cambiarNumero}
          disabled={descargando === archivo}
          aria-label={`Cambiar el número de ${descripcion}`}
        >
          Cambiar N°
        </button>
      )}
    </div>
  );
}

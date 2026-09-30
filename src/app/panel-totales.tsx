'use client';
import type { Cotizacion } from '@/negocio/estado';
import { conDosDecimales, leerPesos, leerPorcentaje } from '@/negocio/cifras';
import {
  contarPuertas,
  descuentoAutomatico,
  siguienteTramo,
  textoPuertas,
  textoTramo,
  tramoAplicable,
} from '@/negocio/descuento-cantidad';
import { pesos, porcentaje, REGLAS } from '@/negocio/precios';
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
 * sus puertas (y el siguiente por alcanzar) o, si la persona lo fijó, el valor manual con la vuelta al automático.
 */
function OrigenDescuento({ actual, editable, guardando, editar }: Props & { actual: Cotizacion }) {
  const tramos = actual.reglas?.descuentosPorCantidad ?? [];
  const manual = actual.descuentoManual ?? false;
  if (!tramos.length || !(editable || manual || actual.descuento > 0)) return null;
  const puertas = contarPuertas(actual.montos.lineas);
  const siguiente = siguienteTramo(tramos, puertas);
  if (manual) {
    const automatico = descuentoAutomatico(actual.reglas ?? REGLAS, puertas);
    return (
      <div className="descuento-origen" data-testid="descuento-origen">
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
      </div>
    );
  }
  return (
    <div className="descuento-origen" data-testid="descuento-origen">
      <span>
        Descuento por cantidad:{' '}
        {tramoAplicable(tramos, puertas)
          ? `${textoPuertas(puertas)} → ${porcentaje(actual.descuento)}`
          : `aún no aplica (${textoPuertas(puertas)})`}
      </span>
      {siguiente && <small>Siguiente tramo: {textoTramo(siguiente)}</small>}
    </div>
  );
}

/** Totales con descuento (%) y flete (CLP neto) editables. */
export function Totales({ actual, editable, guardando, editar }: Props) {
  const m = actual?.montos;
  const ajustes = !!(m?.descuento || m?.flete);
  return (
    <div className="totals">
      {(ajustes || editable) && (
        <div>
          <span>Subtotal</span>
          <span>{pesos(m?.subtotal ?? 0)}</span>
        </div>
      )}
      {(!!m?.descuento || editable) && (
        <div className="total-editable">
          <CampoEditable
            etiqueta="Descuento"
            valor={String(actual?.descuento ?? 0).replace('.', ',')}
            mostrar={
              m?.descuento ? `${pct(m.descuentoPorcentaje)} · −${pesos(m.descuento)}` : 'Sin descuento'
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
      )}
      {actual && (
        <OrigenDescuento actual={actual} editable={editable} guardando={guardando} editar={editar} />
      )}
      {(!!m?.flete || editable) && (
        <div className="total-editable">
          <CampoEditable
            etiqueta="Flete (neto)"
            valor={String(actual?.flete ?? 0)}
            mostrar={m?.flete ? pesos(m.flete) : 'Sin flete'}
            editable={editable}
            discreto
            guardando={guardando === 'flete'}
            tipo="text"
            sufijo="$"
            validar={(v) => {
              const n = leerPesos(v);
              if (!Number.isInteger(n) || n < 0 || n > 100_000_000)
                return 'El flete debe ser un monto entero en pesos, sin decimales.';
              return null;
            }}
            guardar={(v) => editar({ flete: leerPesos(v) }, 'flete')}
          />
        </div>
      )}
      <div>
        <span>Neto</span>
        <span data-testid="neto">{pesos(m?.neto ?? 0)}</span>
      </div>
      <div>
        <span>
          IVA <small>{iva(actual?.reglas?.iva)}</small>
        </span>
        <span>{pesos(m?.iva ?? 0)}</span>
      </div>
      <div className="grand-total">
        <span>Total</span>
        <strong data-testid="total">{pesos(m?.total ?? 0)}</strong>
      </div>
    </div>
  );
}

export function Documento({
  nombre,
  archivo,
  descargando,
  descargar,
  etiqueta = 'Descargar cotización',
  anulado,
  descripcion = nombre,
}: {
  nombre: string;
  /** Cómo se nombra el documento para lectores de pantalla («Ver cotización N° 325…»). */
  descripcion?: string;
  archivo: string;
  descargando: string | null;
  descargar: (archivo: string) => void;
  etiqueta?: string;
  anulado?: boolean;
}) {
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
    </div>
  );
}

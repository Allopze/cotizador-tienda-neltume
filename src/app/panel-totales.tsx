'use client';
import type { Cotizacion } from '@/negocio/estado';
import { conDosDecimales, leerPesos, leerPorcentaje } from '@/negocio/cifras';
import { pesos, REGLAS } from '@/negocio/precios';
import { CampoEditable } from './campo-editable';
import type { CambiosEdicion } from './contrato';
import { iva, pct } from './formato';

interface Props {
  actual: Cotizacion | null;
  editable: boolean;
  guardando: string | null;
  editar: (cambios: CambiosEdicion, campo: string) => Promise<boolean>;
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
            guardando={guardando === 'descuento'}
            tipo="text"
            sufijo="%"
            validar={(v) => {
              const n = leerPorcentaje(v);
              if (!Number.isFinite(n) || n < 0 || n > REGLAS.descuentoMaximo)
                return `El descuento debe estar entre 0 y ${REGLAS.descuentoMaximo}%.`;
              if (!conDosDecimales(n)) return 'Usa como máximo dos decimales.';
              return null;
            }}
            guardar={(v) => editar({ descuento: Math.round(leerPorcentaje(v) * 100) / 100 }, 'descuento')}
          />
        </div>
      )}
      {(!!m?.flete || editable) && (
        <div className="total-editable">
          <CampoEditable
            etiqueta="Flete (neto)"
            valor={String(actual?.flete ?? 0)}
            mostrar={m?.flete ? pesos(m.flete) : 'Sin flete'}
            editable={editable}
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
          IVA <small>{iva()}</small>
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
}: {
  nombre: string;
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
        aria-label={`Ver ${nombre} en una pestaña nueva`}
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

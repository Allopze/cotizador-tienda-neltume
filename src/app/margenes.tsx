'use client';
import type { Cotizacion } from '@/negocio/estado';
import { conDosDecimales, leerPorcentajeConSigno } from '@/negocio/cifras';
import { margenProducto, origenMargen, porcentaje, type Linea, type OrigenMargen } from '@/negocio/precios';
import { CampoEditable } from './campo-editable';
import type { CambiosEdicion } from './contrato';

type Editar = (cambios: CambiosEdicion, campo: string) => Promise<boolean>;

const ORIGEN: Record<OrigenMargen, string> = {
  linea: ' — modificado manualmente (línea)',
  cotizacion: ' — modificado manualmente (cotización)',
  precio: ' — según el precio unitario fijado a mano',
  categoria: '',
};

/** «Margen estándar: 55 % · Margen aplicado: 42 % — modificado manualmente (línea)». Márgenes en fracción. */
export const textoMargen = (estandar: number, aplicado: number, origen: OrigenMargen) =>
  `Margen estándar: ${porcentaje(estandar * 100)} · Margen aplicado: ${porcentaje(aplicado * 100)}${ORIGEN[origen]}`;

/** Margen de una línea: editable y, si fue modificado a mano, con la opción de volver al de la cotización o la categoría. */
export function MargenLinea({
  actual,
  linea,
  indice,
  editable,
  editar,
}: {
  actual: Cotizacion;
  linea: Linea;
  indice: number;
  editable: boolean;
  editar: Editar;
}) {
  const estandar = margenProducto(linea.producto, actual.reglas ?? { ajuste: 0.25 });
  const aplicado = linea.margen ?? estandar;
  const aplicadoPct = Number((aplicado * 100).toFixed(2));
  return (
    <div className="margen-linea">
      <label className="ia-field item-select-field">
        <span>Margen de la línea (%)</span>
        <input
          key={`${actual.actualizada}-${indice}-margen`}
          type="number"
          min={-50}
          max={500}
          step="0.01"
          defaultValue={aplicadoPct}
          disabled={!editable}
          readOnly={!editable}
          onBlur={(e) => {
            const nuevo = Number(e.currentTarget.value);
            if (e.currentTarget.value !== '' && Number.isFinite(nuevo) && Math.abs(nuevo - aplicadoPct) >= 0.001)
              void editar({ items: [{ indice, cambios: { margen: nuevo / 100 } }] }, `item.${indice}.margen`);
          }}
        />
        <small>{textoMargen(estandar, aplicado, origenMargen(linea, actual.margenCotizacion))}</small>
      </label>
      {editable && linea.margenPersonalizado && (
        <button
          type="button"
          className="button secondary small"
          onClick={() => void editar({ items: [{ indice, cambios: { margen: null } }] }, `item.${indice}.margen`)}
        >
          {actual.margenCotizacion != null ? 'Usar el margen de la cotización' : 'Usar el margen estándar'}
        </button>
      )}
    </div>
  );
}

/**
 * Margen especial de toda la cotización: reemplaza el de cada categoría, pero no el de una línea modificada
 * a mano. Se guarda como fracción; vacío o «Restaurar» vuelve al margen de cada categoría.
 */
export function MargenCotizacion({
  actual,
  editable,
  guardando,
  editar,
}: {
  actual: Cotizacion | null;
  editable: boolean;
  guardando: string | null;
  editar: Editar;
}) {
  const fijado = actual?.margenCotizacion ?? null;
  if (fijado === null && !editable) return null;
  const valor = fijado === null ? '' : String(Math.round(fijado * 10000) / 100).replace('.', ',');
  return (
    <div className="margen-cotizacion">
      <CampoEditable
        etiqueta="Margen especial de la cotización"
        valor={valor}
        mostrar={fijado === null ? 'Por categoría' : porcentaje(fijado * 100)}
        editable={editable}
        guardando={guardando === 'margenCotizacion'}
        tipo="text"
        sufijo="%"
        validar={(v) => {
          if (!v.trim()) return null;
          const n = leerPorcentajeConSigno(v);
          if (!Number.isFinite(n) || n < -50 || n > 500) return 'El margen debe estar entre -50 y 500 %.';
          if (!conDosDecimales(n)) return 'Usa como máximo dos decimales.';
          return null;
        }}
        guardar={(v) =>
          editar(
            { margenCotizacion: v.trim() ? Math.round(leerPorcentajeConSigno(v) * 100) / 10000 + 0 : null },
            'margenCotizacion',
          )
        }
      />
      {fijado !== null && editable && (
        <button
          type="button"
          className="button secondary small"
          disabled={guardando === 'margenCotizacion'}
          onClick={() => void editar({ margenCotizacion: null }, 'margenCotizacion')}
        >
          Restaurar margen por categoría
        </button>
      )}
      {fijado !== null && (
        <small>Reemplaza el margen de cada categoría; el de una línea modificada a mano tiene prioridad.</small>
      )}
    </div>
  );
}

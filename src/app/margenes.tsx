'use client';
import { useId, useRef, useState } from 'react';
import type { Cotizacion } from '@/negocio/estado';
import {
  errorMargenTexto,
  leerPorcentajeConSigno,
  margenAPorcentaje,
  porcentajeAMargen,
} from '@/negocio/cifras';
import { margenProducto, origenMargen, porcentaje, REGLAS, type Linea, type OrigenMargen } from '@/negocio/precios';
import { CampoEditable } from './campo-editable';
import { MARGEN_MAX, MARGEN_MIN } from '@/negocio/limites';
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
  `Margen estándar: ${porcentaje(margenAPorcentaje(estandar))} · Margen aplicado: ${porcentaje(margenAPorcentaje(aplicado))}${ORIGEN[origen]}`;

/** Lo que dice una línea de su margen cuando no se puede editar (cotización aprobada o anulada). */
export function textoMargenLinea(actual: Cotizacion, linea: Linea) {
  const origen = origenMargen(linea, actual.margenCotizacion);
  if (origen === 'categoria') return null;
  const estandar = margenProducto(linea.producto, actual.reglas ?? REGLAS);
  return textoMargen(estandar, linea.margen ?? estandar, origen);
}

/**
 * Margen de una línea: se guarda con Enter o al salir del campo, se valida antes de enviar y, si no se
 * pudo guardar, el campo vuelve al valor guardado. Si fue modificado a mano, se puede volver al de la
 * cotización o al de la categoría.
 */
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
  const id = useId();
  const entrada = useRef<HTMLInputElement>(null);
  const enCurso = useRef(false);
  const [error, setError] = useState('');
  const estandar = margenProducto(linea.producto, actual.reglas ?? REGLAS);
  const aplicado = linea.margen ?? estandar;
  const guardado = margenAPorcentaje(aplicado);

  async function guardar() {
    const campo = entrada.current;
    // Enter y la salida del campo llegan juntas: una sola petición a la vez.
    if (!campo || enCurso.current) return;
    const texto = campo.value;
    const problema = errorMargenTexto(texto);
    setError(problema ?? '');
    if (problema) return;
    const nuevo = leerPorcentajeConSigno(texto);
    if (Math.abs(nuevo - guardado) < 0.001) return;
    enCurso.current = true;
    try {
      const ok = await editar(
        { items: [{ indice, cambios: { margen: porcentajeAMargen(nuevo) } }] },
        `item.${indice}.margen`,
      );
      // El servidor lo rechazó (o se canceló): no se deja a la vista un valor que no quedó guardado.
      if (!ok && entrada.current) entrada.current.value = String(guardado);
    } finally {
      enCurso.current = false;
    }
  }

  return (
    <div className="margen-linea">
      <label className="ia-field item-select-field">
        <span>Margen de la línea (%)</span>
        <input
          ref={entrada}
          key={`${actual.actualizada}-${indice}-margen`}
          type="number"
          min={MARGEN_MIN * 100}
          max={MARGEN_MAX * 100}
          step="0.01"
          defaultValue={guardado}
          disabled={!editable}
          readOnly={!editable}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-info${error ? ` ${id}-error` : ''}`}
          onChange={() => setError('')}
          onBlur={() => void guardar()}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            void guardar();
          }}
        />
      </label>
      {error && (
        <small className="campo-error" id={`${id}-error`} role="alert">
          {error}
        </small>
      )}
      <small id={`${id}-info`}>{textoMargen(estandar, aplicado, origenMargen(linea, actual.margenCotizacion))}</small>
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
 * a mano. Se guarda como fracción; vacío o «Restaurar» vuelve al margen de cada categoría. Un margen fijado
 * siempre se ve; el control para fijarlo solo aparece mientras la cotización admite cambios (aunque no
 * tenga ítems todavía), y no desaparece mientras se guarda.
 */
export function MargenCotizacion({
  actual,
  admiteCambios,
  editable,
  guardando,
  editar,
}: {
  actual: Cotizacion | null;
  /** La cotización admite cambios directos; `editable` además exige que no haya otra operación en curso. */
  admiteCambios: boolean;
  editable: boolean;
  guardando: string | null;
  editar: Editar;
}) {
  const fijado = actual?.margenCotizacion ?? null;
  if (fijado === null && !admiteCambios) return null;
  const valor = fijado === null ? '' : String(margenAPorcentaje(fijado)).replace('.', ',');
  return (
    <div className="margen-cotizacion">
      <CampoEditable
        etiqueta="Margen especial de la cotización"
        valor={valor}
        mostrar={fijado === null ? 'Por categoría' : porcentaje(margenAPorcentaje(fijado))}
        editable={editable}
        guardando={guardando === 'margenCotizacion'}
        tipo="text"
        modoEntrada="decimal"
        sufijo="%"
        validar={(v) => (v.trim() ? errorMargenTexto(v) : null)}
        guardar={(v) =>
          editar({ margenCotizacion: v.trim() ? porcentajeAMargen(leerPorcentajeConSigno(v)) : null }, 'margenCotizacion')
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

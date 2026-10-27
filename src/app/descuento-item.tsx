'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { DescuentoItem } from '@/catalogo/tipos';
import type { Cotizacion } from '@/negocio/estado';
import { conDosDecimales, leerPesos, leerPorcentaje } from '@/negocio/cifras';
import {
  ahorroLinea,
  conDescuentoItem,
  pesos,
  porcentaje,
  precioConDescuento,
  textoDescuentoItem,
  type Linea,
} from '@/negocio/precios';
import type { CambiosEdicion } from './contrato';
import { SelectorDesplegable } from './selector-desplegable';

type Editar = (cambios: CambiosEdicion, campo: string) => Promise<boolean>;
type Tipo = DescuentoItem['tipo'];

const OPCIONES = [
  { value: 'porcentaje', label: 'Porcentaje (%)' },
  { value: 'monto', label: 'Monto por unidad ($)' },
] as const;

/** Lee el texto según el tipo: «15», «15,5 %» o «$5.000». Vacío es 0 (sin descuento). */
const leer = (tipo: Tipo, texto: string) => (tipo === 'porcentaje' ? leerPorcentaje(texto) : leerPesos(texto));

/** Descuento que se guarda con lo escrito (ya validado): vacío o 0 lo quita; un porcentaje lleva dos decimales. */
export function descuentoEscrito(tipo: Tipo, texto: string): DescuentoItem | null {
  const valor = leer(tipo, texto);
  if (!valor) return null;
  return { tipo, valor: tipo === 'porcentaje' ? Math.round(valor * 100) / 100 : valor };
}

/** Mensaje de error de un descuento escrito, o null si es válido. El monto nunca supera el precio unitario. */
export function errorDescuentoItem(tipo: Tipo, texto: string, precioUnitario: number): string | null {
  const n = leer(tipo, texto);
  if (!Number.isFinite(n) || n < 0) return 'Escribe un número positivo.';
  if (tipo === 'porcentaje') {
    if (n > 100) return 'El descuento no puede superar 100 %.';
    if (!conDosDecimales(n)) return 'Usa como máximo dos decimales.';
    return null;
  }
  if (!Number.isSafeInteger(n)) return 'Escribe un monto entero en pesos.';
  if (n > precioUnitario) return `El descuento no puede superar el precio unitario (${pesos(precioUnitario)}).`;
  return null;
}

/** «Descuento especial 15 % · Ahorro $36.000», para las líneas que ya no se pueden editar. */
export const textoDescuentoLinea = (l: Linea) =>
  conDescuentoItem(l) && l.descuentoItem
    ? `Descuento especial ${textoDescuentoItem(l.descuentoItem)} · Ahorro ${pesos(ahorroLinea(l))}`
    : null;

/**
 * Descuento especial de una línea, independiente de las demás: porcentaje o monto fijo por unidad sobre su
 * precio. Se guarda con Enter o al salir del campo, como el margen; vacío o 0 lo quita. Muestra el precio
 * original, lo descontado, el precio final y el ahorro de la línea.
 */
export function DescuentoLinea({
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
  const guardado = actual.solicitudes[indice]?.descuento ?? null;
  /** Tipo elegido en el selector y aún sin guardar; null sigue al guardado (también si otra persona lo cambia). */
  const [tipoElegido, setTipoElegido] = useState<Tipo | null>(null);
  const tipo = tipoElegido ?? guardado?.tipo ?? 'porcentaje';
  const [error, setError] = useState('');
  const textoGuardado = guardado && guardado.tipo === tipo ? String(guardado.valor).replace('.', ',') : '';
  // Lo guardado llega al campo solo si no se está escribiendo en él: al volver a la pestaña o cuando otra vendedora
  // guarda, lo escrito no se pierde.
  useEffect(() => {
    const campo = entrada.current;
    if (campo && document.activeElement !== campo) campo.value = textoGuardado;
  }, [textoGuardado]);

  async function guardar(cambio: DescuentoItem | null) {
    // Enter y la salida del campo llegan juntas: una sola petición a la vez.
    if (enCurso.current) return;
    enCurso.current = true;
    try {
      const ok = await editar({ items: [{ indice, cambios: { descuento: cambio } }] }, `item.${indice}.descuento`);
      // Guardado: el tipo vuelve a seguir al descuento guardado.
      if (ok) setTipoElegido(null);
      // El servidor lo rechazó (o se canceló): no se deja a la vista un valor que no quedó guardado.
      else if (entrada.current) entrada.current.value = textoGuardado;
    } finally {
      enCurso.current = false;
    }
  }

  function guardarEscrito() {
    const campo = entrada.current;
    if (!campo) return;
    const texto = campo.value.trim();
    const problema = errorDescuentoItem(tipo, texto, linea.precioUnitario);
    setError(problema ?? '');
    if (problema) return;
    const nuevo = descuentoEscrito(tipo, texto);
    if (!nuevo) {
      // Un campo vacío no quita el descuento: al cambiar el tipo el campo aparece vacío sin que la persona haya
      // borrado nada. Solo lo quitan «Quitar descuento» o un 0 escrito (auditoría BUG-010).
      return;
    }
    if (guardado?.tipo === tipo && Math.abs(guardado.valor - nuevo.valor) < 0.001) return;
    void guardar(nuevo);
  }

  const final = precioConDescuento(linea);
  return (
    <div className="descuento-linea" data-testid={`descuento-item-${indice}`}>
      <div className="descuento-linea-campos">
        <div className="ia-field item-select-field">
          <span>
            <label htmlFor={`${id}-valor`}>Descuento especial</label>
          </span>
          <span className="descuento-linea-entrada">
            {tipo === 'monto' && <span aria-hidden>$</span>}
            <input
              id={`${id}-valor`}
              ref={entrada}
              // Cambiar el tipo vuelve a mostrar lo guardado de ese tipo (vacío si no hay).
              key={tipo}
              type="text"
              inputMode={tipo === 'porcentaje' ? 'decimal' : 'numeric'}
              placeholder="0"
              defaultValue={textoGuardado}
              disabled={!editable}
              readOnly={!editable}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-info${error ? ` ${id}-error` : ''}`}
              onChange={() => setError('')}
              onBlur={guardarEscrito}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                guardarEscrito();
              }}
            />
            {tipo === 'porcentaje' && <span aria-hidden>%</span>}
          </span>
        </div>
        <div className="ia-field item-select-field">
          <span>Tipo</span>
          <SelectorDesplegable
            ariaLabel={`Tipo de descuento especial, ítem ${indice + 1}`}
            value={tipo}
            opciones={OPCIONES}
            disabled={!editable}
            onChange={(valor) => {
              // Cambiar el tipo no guarda nada: el descuento vigente sigue hasta escribir el nuevo valor.
              setTipoElegido(valor as Tipo);
              setError('');
              requestAnimationFrame(() => entrada.current?.focus());
            }}
          />
        </div>
      </div>
      {error && (
        <small className="campo-error" id={`${id}-error`} role="alert">
          {error}
        </small>
      )}
      <small id={`${id}-info`} className={conDescuentoItem(linea) ? 'descuento-linea-resumen activo' : 'descuento-linea-resumen'}>
        {conDescuentoItem(linea) && linea.descuentoItem ? (
          <>
            Precio original <s>{pesos(linea.precioUnitario)}</s> · Descuento{' '}
            {linea.descuentoItem.tipo === 'porcentaje'
              ? `${porcentaje(linea.descuentoItem.valor)} (−${pesos(linea.descuentoUnitario!)} c/u)`
              : `−${pesos(linea.descuentoUnitario!)} c/u`}{' '}
            · Precio con descuento <b>{pesos(final)}</b> · Ahorro <b>{pesos(ahorroLinea(linea))}</b>
            {linea.cantidad > 1 ? ` en ${linea.cantidad} unidades` : ''}
          </>
        ) : (
          `Sin descuento: mantiene su precio de ${pesos(linea.precioUnitario)} por unidad. Los demás ítems no cambian.`
        )}
      </small>
      {editable && guardado && (
        <button type="button" className="button secondary small" onClick={() => void guardar(null)}>
          Quitar descuento
        </button>
      )}
    </div>
  );
}

'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

/** Opciones del selector: valor y texto visible. */
export type OpcionFamilia = readonly [string, string];

/**
 * Selector de familia del cotizador. Lo comparten el alta de producto y la consulta del catálogo:
 * un solo control para la misma decisión, en vez del `<select>` nativo que traía el navegador.
 */
export function SelectorFamilia({
  id,
  value,
  opciones,
  vacio,
  disabled = false,
  seleccionar,
}: {
  /** Id del texto visible que nombra al control. */
  id: string;
  value: string;
  opciones: readonly OpcionFamilia[];
  /** Texto del disparador mientras no hay opción elegida. */
  vacio: string;
  disabled?: boolean;
  seleccionar: (familia: string) => void;
}) {
  const selector = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const actual = opciones.find(([valor]) => valor === value);
  const indiceSeleccionado = Math.max(
    0,
    opciones.findIndex(([valor]) => valor === value),
  );
  const listaId = `${id}-opciones`;

  useEffect(() => {
    if (!abierto) return;
    const cerrarFuera = (evento: PointerEvent) => {
      if (!selector.current?.contains(evento.target as Node)) setAbierto(false);
    };
    document.addEventListener('pointerdown', cerrarFuera);
    return () => document.removeEventListener('pointerdown', cerrarFuera);
  }, [abierto]);

  function abrir() {
    setActivo(indiceSeleccionado);
    setAbierto(true);
  }

  function cerrar(devolverFoco = false) {
    setAbierto(false);
    if (devolverFoco) trigger.current?.focus();
  }

  function elegir(familia: string) {
    seleccionar(familia);
    cerrar(true);
  }

  function manejarTeclado(evento: KeyboardEvent<HTMLButtonElement>) {
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (!abierto) {
        abrir();
        return;
      }
      setActivo((actual) =>
        evento.key === 'ArrowDown' ? Math.min(actual + 1, opciones.length - 1) : Math.max(actual - 1, 0),
      );
    } else if (evento.key === 'Home' || evento.key === 'End') {
      if (!abierto) return;
      evento.preventDefault();
      setActivo(evento.key === 'Home' ? 0 : opciones.length - 1);
    } else if (evento.key === 'Enter' || evento.key === ' ') {
      evento.preventDefault();
      if (!abierto) abrir();
      else elegir(opciones[activo][0]);
    } else if (evento.key === 'Escape' && abierto) {
      evento.preventDefault();
      cerrar(true);
    }
  }

  return (
    <div
      ref={selector}
      className="familia-selector"
      onBlur={(evento) => {
        if (!selector.current?.contains(evento.relatedTarget as Node | null)) setAbierto(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="familia-trigger"
        aria-labelledby={id}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={listaId}
        disabled={disabled}
        onClick={() => (abierto ? cerrar(true) : abrir())}
        onKeyDown={manejarTeclado}
      >
        <span>{actual?.[1] ?? vacio}</span>
        <span className="familia-chevron" aria-hidden="true">
          {abierto ? '⌃' : '⌄'}
        </span>
      </button>
      {abierto && (
        <div id={listaId} className="familia-popover" role="listbox" aria-labelledby={id}>
          {opciones.map(([valor, texto], indice) => (
            <div
              id={`${listaId}-${valor}`}
              key={valor}
              className="familia-option"
              role="option"
              aria-selected={value === valor}
              data-activo={indice === activo ? 'true' : undefined}
              onMouseDown={(evento) => evento.preventDefault()}
              onMouseMove={() => setActivo(indice)}
              onClick={() => elegir(valor)}
            >
              <span>{texto}</span>
              {value === valor && <span aria-hidden="true">✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

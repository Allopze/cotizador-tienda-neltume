'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export interface OpcionDesplegable {
  value: string;
  label: string;
}

interface Props {
  value: string;
  opciones: readonly OpcionDesplegable[];
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/** Selector de lista con el mismo comportamiento en escritorio y móvil, sin menú nativo del navegador. */
export function SelectorDesplegable({
  value,
  opciones,
  ariaLabel,
  placeholder = 'Seleccionar',
  disabled = false,
  onChange,
}: Props) {
  const id = useId();
  const selector = useRef<HTMLDivElement>(null);
  const disparador = useRef<HTMLButtonElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [abreArriba, setAbreArriba] = useState(false);
  const indiceSeleccionado = opciones.findIndex((opcion) => opcion.value === value);
  const [activo, setActivo] = useState(Math.max(0, indiceSeleccionado));
  const listaId = `selector-lista-${id}`;
  const activoId = `${listaId}-opcion-${activo}`;
  const actual = opciones.find((opcion) => opcion.value === value);

  useEffect(() => {
    if (!abierto) return;
    const cerrarFuera = (evento: PointerEvent) => {
      if (!selector.current?.contains(evento.target as Node)) setAbierto(false);
    };
    document.addEventListener('pointerdown', cerrarFuera);
    return () => document.removeEventListener('pointerdown', cerrarFuera);
  }, [abierto]);

  function abrir() {
    setActivo(Math.max(0, indiceSeleccionado));
    const limites = selector.current?.closest('.quote-panel')?.getBoundingClientRect();
    const caja = disparador.current?.getBoundingClientRect();
    if (caja) {
      const arriba = limites ? Math.max(0, limites.top) : 0;
      const abajo = limites ? Math.min(window.innerHeight, limites.bottom) : window.innerHeight;
      const altoLista = Math.min(280, opciones.length * 48 + 14);
      setAbreArriba(caja.bottom + altoLista > abajo && caja.top - arriba > abajo - caja.bottom);
    }
    setAbierto(true);
  }

  function elegir(opcion: OpcionDesplegable) {
    if (opcion.value !== value) onChange(opcion.value);
    setAbierto(false);
    disparador.current?.focus();
  }

  function manejarTeclado(evento: KeyboardEvent<HTMLButtonElement>) {
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (!abierto) {
        abrir();
        return;
      }
      setActivo((indice) =>
        evento.key === 'ArrowDown'
          ? Math.min(indice + 1, opciones.length - 1)
          : Math.max(indice - 1, 0),
      );
    } else if (evento.key === 'Home' || evento.key === 'End') {
      if (!opciones.length) return;
      evento.preventDefault();
      if (!abierto) abrir();
      setActivo(evento.key === 'Home' ? 0 : opciones.length - 1);
    } else if (evento.key === 'Enter' || evento.key === ' ') {
      evento.preventDefault();
      if (!abierto) abrir();
      else if (opciones[activo]) elegir(opciones[activo]);
    } else if (evento.key === 'Escape' && abierto) {
      evento.preventDefault();
      setAbierto(false);
    }
  }

  return (
    <div
      ref={selector}
      className="selector-desplegable"
      onBlur={(evento) => {
        if (!selector.current?.contains(evento.relatedTarget as Node | null)) setAbierto(false);
      }}
    >
      <button
        ref={disparador}
        type="button"
        className="selector-disparador"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        // Sin lista en el DOM mientras está cerrado, `aria-controls` apuntaría a un id inexistente (auditoría BUG-061).
        aria-controls={abierto ? listaId : undefined}
        aria-activedescendant={abierto && opciones.length ? activoId : undefined}
        disabled={disabled}
        onClick={() => (abierto ? setAbierto(false) : abrir())}
        onKeyDown={manejarTeclado}
      >
        <span className="selector-valor">{actual?.label ?? placeholder}</span>
        <svg className="selector-chevron" viewBox="0 0 20 20" aria-hidden="true">
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </button>
      {abierto && (
        <div
          id={listaId}
          className="selector-lista"
          role="listbox"
          aria-label={ariaLabel}
          data-abre-arriba={abreArriba ? 'true' : undefined}
        >
          {opciones.map((opcion, indice) => (
            <div
              id={`${listaId}-opcion-${indice}`}
              key={`${opcion.value}-${indice}`}
              className="selector-opcion"
              role="option"
              aria-selected={opcion.value === value}
              data-activo={indice === activo ? 'true' : undefined}
              onMouseDown={(evento) => evento.preventDefault()}
              onMouseMove={() => setActivo(indice)}
              onClick={() => elegir(opcion)}
            >
              <span>{opcion.label}</span>
              {opcion.value === value && (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m3 8 3.2 3.2L13 4.5" />
                </svg>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

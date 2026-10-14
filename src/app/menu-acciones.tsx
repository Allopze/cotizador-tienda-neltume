'use client';
import { useEffect, useId, useRef, useState } from 'react';

export interface OpcionMenu {
  etiqueta: string;
  alElegir: () => void;
  deshabilitada?: boolean;
  /** Acción destructiva: va al final, separada y en rojo. */
  peligro?: boolean;
  titulo?: string;
  /** Texto breve bajo la etiqueta, p. ej. por qué la opción está deshabilitada. */
  detalle?: string;
}

/**
 * «Más acciones»: agrupa las acciones secundarias para que el pie de la cotización muestre una sola
 * acción principal. Patrón de divulgación (botón + lista), se cierra con Escape, al tocar fuera o al elegir.
 */
export function MenuAcciones({
  opciones,
  deshabilitado,
}: {
  opciones: OpcionMenu[];
  deshabilitado?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null),
    boton = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAbierto(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setAbierto(false);
      boton.current?.focus();
    };
    document.addEventListener('pointerdown', fuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [abierto]);

  if (!opciones.length) return null;
  const normales = opciones.filter((o) => !o.peligro),
    peligrosas = opciones.filter((o) => o.peligro);
  const item = (o: OpcionMenu) => (
    <li key={o.etiqueta}>
      <button
        type="button"
        className={o.peligro ? 'peligro' : undefined}
        disabled={o.deshabilitada}
        title={o.titulo}
        onClick={() => {
          setAbierto(false);
          o.alElegir();
        }}
      >
        {o.etiqueta}
        {o.detalle && <small className="menu-detalle">{o.detalle}</small>}
      </button>
    </li>
  );
  return (
    <div ref={raiz} className="menu-acciones">
      <button
        ref={boton}
        type="button"
        className="button secondary small"
        aria-expanded={abierto}
        aria-controls={id}
        disabled={deshabilitado}
        onClick={() => setAbierto((v) => !v)}
      >
        Más acciones <span aria-hidden>▾</span>
      </button>
      {abierto && (
        <ul id={id}>
          {normales.map(item)}
          {!!normales.length && !!peligrosas.length && <li className="separador" role="separator" />}
          {peligrosas.map(item)}
        </ul>
      )}
    </div>
  );
}

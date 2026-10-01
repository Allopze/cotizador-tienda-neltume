'use client';
import { useEffect, useState } from 'react';

/**
 * Borrador de un formulario de Ajustes frente a lo guardado. Se reinicia solo cuando cambia lo guardado de
 * este formulario (comparado por `clave`), no cuando otro formulario guarda lo suyo: así una sección no pierde
 * lo que se está escribiendo porque otra se guardó.
 */
export function useBorrador<T>(guardado: T, clave: (valor: T) => string = JSON.stringify) {
  const claveGuardada = clave(guardado);
  const [base, setBase] = useState(claveGuardada);
  const [borrador, setBorrador] = useState(guardado);
  if (base !== claveGuardada) {
    setBase(claveGuardada);
    setBorrador(guardado);
  }
  return {
    borrador,
    setBorrador,
    sucio: clave(borrador) !== claveGuardada,
    descartar: () => setBorrador(guardado),
  };
}

/** Informa a la pantalla si el formulario tiene cambios sin guardar (marca la sección y avisa al salir). */
export function useAvisarCambios(sucio: boolean, alCambiar?: (sucio: boolean) => void) {
  useEffect(() => {
    alCambiar?.(sucio);
    return () => alCambiar?.(false);
  }, [sucio, alCambiar]);
}

/** Botonera común: guardar y descartar solo se activan con cambios, y se dice que hay cambios pendientes. */
export function AccionesGuardar({
  sucio,
  ocupado,
  descartar,
  etiqueta = 'Guardar cambios',
}: {
  sucio: boolean;
  ocupado: boolean;
  descartar: () => void;
  etiqueta?: string;
}) {
  return (
    <div className="ia-actions">
      {sucio && !ocupado && <span className="cambios-pendientes">Cambios sin guardar</span>}
      <button type="button" className="button secondary" onClick={descartar} disabled={ocupado || !sucio}>
        Descartar cambios
      </button>
      <button type="submit" className="button primary" disabled={ocupado || !sucio}>
        {ocupado ? 'Guardando…' : etiqueta}
      </button>
    </div>
  );
}

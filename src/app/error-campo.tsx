'use client';
import { useRef, useState } from 'react';

/** Correo con forma nombre@dominio.tld; el servidor hace la validación definitiva. */
export const correoValido = (texto: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto.trim());

/**
 * Error de un formulario con `noValidate`: un solo mensaje propio en español, pegado al campo que lo causa, ligado con
 * `aria-describedby` y `aria-invalid`, y con el foco en ese campo. `campo: null` es un error general (red, servidor)
 * que se muestra donde el formulario pinte `mensaje(null)`.
 */
export function useErrorCampo<C extends string>(prefijo: string, clase = 'login-error') {
  const [error, setError] = useState<{ campo: C | null; texto: string } | null>(null);
  const campos = useRef(new Map<C, HTMLInputElement | null>());
  const idError = (campo: C | null) => `${prefijo}-${campo ?? 'general'}-error`;

  return {
    error,
    /** Registra el input para poder enfocarlo. */
    ref: (campo: C) => (el: HTMLInputElement | null) => {
      campos.current.set(campo, el);
    },
    fallar(campo: C | null, texto: string) {
      setError({ campo, texto });
      // Tras el render (el campo puede estar deshabilitado mientras se envía).
      requestAnimationFrame(() => {
        if (campo) campos.current.get(campo)?.focus();
      });
    },
    limpiar: () => setError(null),
    /** Atributos ARIA para el input del campo. */
    atributos: (campo: C) =>
      error?.campo === campo ? { 'aria-invalid': true as const, 'aria-describedby': idError(campo) } : {},
    /** El mensaje, si el error es de este campo. */
    mensaje: (campo: C | null) =>
      error && error.campo === campo ? (
        <p className={clase} id={idError(campo)} role="alert">
          {error.texto}
        </p>
      ) : null,
  };
}

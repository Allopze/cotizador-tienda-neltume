'use client';
import { useRef, useState, type FormEvent } from 'react';
import type { TipoAviso } from './avisos';
import { ErrorSolicitud, esSilencioso, mensajeDe, pedirJSON } from './solicitud';

// Mismos límites que Better Auth (minPasswordLength / maxPasswordLength en autenticacion-config).
const MINIMO = 8,
  MAXIMO = 128;

interface Props {
  avisar: (tipo: TipoAviso, texto: string, extra?: { clave?: string }) => number;
}

/** Cambio de la contraseña propia (sección de «Ajustes»); cierra las demás sesiones de la cuenta. */
export function CambiarClave({ avisar }: Props) {
  const [actual, setActual] = useState(''),
    [nueva, setNueva] = useState(''),
    [repetida, setRepetida] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const primera = useRef<HTMLInputElement>(null);
  const escrito = !!(actual || nueva || repetida);

  function limpiar() {
    setActual('');
    setNueva('');
    setRepetida('');
    setError('');
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    if (nueva.length < MINIMO || nueva.length > MAXIMO)
      return setError(`La nueva contraseña debe tener entre ${MINIMO} y ${MAXIMO} caracteres.`);
    if (nueva !== repetida) return setError('La confirmación no coincide con la nueva contraseña.');
    if (nueva === actual) return setError('La nueva contraseña debe ser distinta de la actual.');
    setOcupado(true);
    setError('');
    try {
      await pedirJSON('/api/auth/change-password', {
        json: { currentPassword: actual, newPassword: nueva, revokeOtherSessions: true },
      });
      avisar('exito', 'Contraseña actualizada. Se cerraron las demás sesiones de tu cuenta.', {
        clave: 'clave',
      });
      limpiar();
    } catch (causa) {
      if (esSilencioso(causa)) return;
      setError(
        causa instanceof ErrorSolicitud && causa.status === 400
          ? 'La contraseña actual no es correcta.'
          : causa instanceof ErrorSolicitud && causa.status === 429
            ? 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.'
            : mensajeDe(causa),
      );
      primera.current?.focus();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={enviar} className="dialogo-campos" aria-label="Cambiar contraseña">
      <p className="catalog-modal-intro">
        Al cambiarla se cierran las demás sesiones abiertas con tu cuenta.
      </p>
      <label className="ia-field">
        <span>Contraseña actual</span>
        <input
          ref={primera}
          type="password"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          autoComplete="current-password"
          required
          disabled={ocupado}
        />
      </label>
      <label className="ia-field">
        <span>Nueva contraseña (mínimo {MINIMO} caracteres)</span>
        <input
          type="password"
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          autoComplete="new-password"
          minLength={MINIMO}
          maxLength={MAXIMO}
          required
          disabled={ocupado}
        />
      </label>
      <label className="ia-field">
        <span>Repite la nueva contraseña</span>
        <input
          type="password"
          value={repetida}
          onChange={(e) => setRepetida(e.target.value)}
          autoComplete="new-password"
          maxLength={MAXIMO}
          required
          disabled={ocupado}
        />
      </label>
      {error && (
        <p className="catalog-error" role="alert">
          {error}
        </p>
      )}
      <div className="ia-actions">
        <button type="button" className="button secondary" onClick={limpiar} disabled={ocupado || !escrito}>
          Descartar
        </button>
        <button type="submit" className="button primary" disabled={ocupado}>
          {ocupado ? 'Guardando…' : 'Cambiar contraseña'}
        </button>
      </div>
    </form>
  );
}

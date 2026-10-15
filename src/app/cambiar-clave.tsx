'use client';
import { useState, type FormEvent } from 'react';
import type { TipoAviso } from './avisos';
import { useAvisarCambios } from './ajustes/borrador';
import { useErrorCampo } from './error-campo';
import { ErrorSolicitud, esSilencioso, mensajeDe, pedirJSON } from './solicitud';

// Mismos límites que Better Auth (minPasswordLength / maxPasswordLength en autenticacion-config).
const MINIMO = 8,
  MAXIMO = 128;

interface Props {
  avisar: (tipo: TipoAviso, texto: string, extra?: { clave?: string }) => number;
  /** Avisa si hay algo escrito sin enviar (Ajustes lo marca y pide confirmar al salir). */
  alCambiar?: (sucio: boolean) => void;
}

/** Cambio de la contraseña propia (sección de «Ajustes»); cierra las demás sesiones de la cuenta. */
export function CambiarClave({ avisar, alCambiar }: Props) {
  const [actual, setActual] = useState(''),
    [nueva, setNueva] = useState(''),
    [repetida, setRepetida] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const errores = useErrorCampo<'actual' | 'nueva' | 'repetida'>('cambiar-clave', 'catalog-error');
  const escrito = !!(actual || nueva || repetida);
  useAvisarCambios(escrito, alCambiar);

  function limpiar() {
    setActual('');
    setNueva('');
    setRepetida('');
    errores.limpiar();
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (ocupado) return;
    if (!actual) return errores.fallar('actual', 'Escribe tu contraseña actual.');
    if (nueva.length < MINIMO || nueva.length > MAXIMO)
      return errores.fallar('nueva', `La nueva contraseña debe tener entre ${MINIMO} y ${MAXIMO} caracteres.`);
    if (nueva !== repetida) return errores.fallar('repetida', 'La confirmación no coincide con la nueva contraseña.');
    if (nueva === actual) return errores.fallar('nueva', 'La nueva contraseña debe ser distinta de la actual.');
    setOcupado(true);
    errores.limpiar();
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
      errores.fallar(
        'actual',
        causa instanceof ErrorSolicitud && causa.status === 400
          ? 'La contraseña actual no es correcta.'
          : causa instanceof ErrorSolicitud && causa.status === 429
            ? 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.'
            : mensajeDe(causa),
      );
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={enviar} className="dialogo-campos" aria-label="Cambiar contraseña" noValidate>
      <p className="catalog-modal-intro">
        Al cambiarla se cierran las demás sesiones abiertas con tu cuenta.
      </p>
      <label className="ia-field">
        <span>Contraseña actual</span>
        <input
          ref={errores.ref('actual')}
          {...errores.atributos('actual')}
          type="password"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          autoComplete="current-password"
          required
          disabled={ocupado}
        />
      </label>
      {errores.mensaje('actual')}
      <label className="ia-field">
        <span>Nueva contraseña (mínimo {MINIMO} caracteres)</span>
        <input
          ref={errores.ref('nueva')}
          {...errores.atributos('nueva')}
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
      {errores.mensaje('nueva')}
      <label className="ia-field">
        <span>Repite la nueva contraseña</span>
        <input
          ref={errores.ref('repetida')}
          {...errores.atributos('repetida')}
          type="password"
          value={repetida}
          onChange={(e) => setRepetida(e.target.value)}
          autoComplete="new-password"
          maxLength={MAXIMO}
          required
          disabled={ocupado}
        />
      </label>
      {errores.mensaje('repetida')}
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

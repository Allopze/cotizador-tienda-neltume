'use client';
import { useState, type FormEvent } from 'react';
import type { TipoAviso } from '../avisos';
import { ErrorSolicitud, esSilencioso, mensajeDe, pedirJSON } from '../solicitud';

const MINIMO = 8;
const MAXIMO = 128;

interface Props {
  avisar: (tipo: TipoAviso, texto: string, extra?: { clave?: string }) => number;
}

export function CrearUsuario({ avisar }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  function limpiar() {
    setNombre('');
    setEmail('');
    setPassword('');
    setRepetida('');
    setError('');
  }

  async function crear(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado) return;
    if (password.length < MINIMO || password.length > MAXIMO) {
      setError(`La contraseña debe tener entre ${MINIMO} y ${MAXIMO} caracteres.`);
      return;
    }
    if (password !== repetida) {
      setError('La confirmación no coincide con la contraseña.');
      return;
    }

    setOcupado(true);
    setError('');
    try {
      const data = await pedirJSON<{ usuario: { email: string; nombre: string; rol: 'admin' } }>(
        '/api/usuarios',
        {
          json: { nombre, email, password },
        },
      );
      limpiar();
      setAbierto(false);
      avisar(
        'exito',
        `Cuenta creada para ${data.usuario.email}. La persona podrá cambiar su contraseña desde Ajustes.`,
        {
          clave: 'usuarios',
        },
      );
    } catch (causa) {
      if (esSilencioso(causa)) return;
      setError(
        causa instanceof ErrorSolicitud && causa.status === 409
          ? 'Ya existe una cuenta con ese correo.'
          : mensajeDe(causa),
      );
    } finally {
      setOcupado(false);
    }
  }

  function cancelar() {
    if (ocupado) return;
    limpiar();
    setAbierto(false);
  }

  return (
    <div className="usuarios-admin">
      <h3 className="eyebrow ajustes-subtitulo">NUEVA CUENTA</h3>
      <p className="catalog-modal-intro">
        Define una contraseña inicial; la persona podrá cambiarla desde Ajustes.
      </p>
      {!abierto ? (
        <button type="button" className="button secondary" onClick={() => setAbierto(true)}>
          Crear cuenta
        </button>
      ) : (
        <form className="dialogo-campos usuario-crear-form" onSubmit={crear}>
          <div className="usuario-form-grid">
            <label className="ia-field">
              <span>Nombre</span>
              <input
                value={nombre}
                onChange={(evento) => setNombre(evento.target.value)}
                autoComplete="name"
                maxLength={120}
                required
                disabled={ocupado}
              />
            </label>
            <label className="ia-field">
              <span>Correo</span>
              <input
                type="email"
                value={email}
                onChange={(evento) => setEmail(evento.target.value)}
                autoComplete="email"
                maxLength={254}
                required
                disabled={ocupado}
              />
            </label>
            <label className="ia-field">
              <span>Contraseña inicial (mínimo {MINIMO} caracteres)</span>
              <input
                type="password"
                value={password}
                onChange={(evento) => setPassword(evento.target.value)}
                autoComplete="new-password"
                minLength={MINIMO}
                maxLength={MAXIMO}
                required
                disabled={ocupado}
              />
            </label>
            <label className="ia-field">
              <span>Repite la contraseña inicial</span>
              <input
                type="password"
                value={repetida}
                onChange={(evento) => setRepetida(evento.target.value)}
                autoComplete="new-password"
                maxLength={MAXIMO}
                required
                disabled={ocupado}
              />
            </label>
          </div>
          {error && (
            <p className="catalog-error" role="alert">
              {error}
            </p>
          )}
          <div className="ia-actions">
            <button type="button" className="button secondary" onClick={cancelar} disabled={ocupado}>
              Cancelar
            </button>
            <button type="submit" className="button primary" disabled={ocupado}>
              {ocupado ? 'Creando…' : 'Crear cuenta'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

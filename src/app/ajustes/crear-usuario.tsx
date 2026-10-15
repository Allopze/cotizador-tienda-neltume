'use client';
import { useState, type FormEvent } from 'react';
import type { TipoAviso } from '../avisos';
import { correoValido, useErrorCampo } from '../error-campo';
import { ErrorSolicitud, esSilencioso, mensajeDe, pedirJSON } from '../solicitud';
import { EVENTO_CUENTAS } from './usuarios';

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
  const errores = useErrorCampo<'nombre' | 'correo' | 'clave' | 'repetida'>('crear-usuario', 'catalog-error');
  const [ocupado, setOcupado] = useState(false);

  function limpiar() {
    setNombre('');
    setEmail('');
    setPassword('');
    setRepetida('');
    errores.limpiar();
  }

  async function crear(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado) return;
    if (!nombre.trim()) return errores.fallar('nombre', 'Escribe el nombre de la persona.');
    if (!email.trim()) return errores.fallar('correo', 'Escribe el correo de la cuenta.');
    if (!correoValido(email)) return errores.fallar('correo', 'Revisa el correo: debe tener la forma nombre@dominio.cl.');
    if (password.length < MINIMO || password.length > MAXIMO)
      return errores.fallar('clave', `La contraseña debe tener entre ${MINIMO} y ${MAXIMO} caracteres.`);
    if (password !== repetida) return errores.fallar('repetida', 'La confirmación no coincide con la contraseña.');

    setOcupado(true);
    errores.limpiar();
    try {
      const data = await pedirJSON<{ usuario: { email: string; nombre: string; rol: 'admin' } }>(
        '/api/usuarios',
        {
          json: { nombre, email, password },
        },
      );
      limpiar();
      setAbierto(false);
      window.dispatchEvent(new Event(EVENTO_CUENTAS));
      avisar(
        'exito',
        `Cuenta creada para ${data.usuario.email}. La persona podrá cambiar su contraseña desde Ajustes.`,
        {
          clave: 'usuarios',
        },
      );
    } catch (causa) {
      if (esSilencioso(causa)) return;
      if (causa instanceof ErrorSolicitud && causa.status === 409)
        errores.fallar('correo', 'Ya existe una cuenta con ese correo.');
      else errores.fallar(null, mensajeDe(causa));
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
        <form className="dialogo-campos usuario-crear-form" onSubmit={crear} noValidate>
          <div className="usuario-form-grid">
            <div>
              <label className="ia-field">
                <span>Nombre</span>
                <input
                  ref={errores.ref('nombre')}
                  {...errores.atributos('nombre')}
                  value={nombre}
                  onChange={(evento) => setNombre(evento.target.value)}
                  autoComplete="name"
                  maxLength={120}
                  required
                  disabled={ocupado}
                />
              </label>
              {errores.mensaje('nombre')}
            </div>
            <div>
              <label className="ia-field">
                <span>Correo</span>
                <input
                  type="email"
                  ref={errores.ref('correo')}
                  {...errores.atributos('correo')}
                  value={email}
                  onChange={(evento) => setEmail(evento.target.value)}
                  autoComplete="email"
                  maxLength={254}
                  required
                  disabled={ocupado}
                />
              </label>
              {errores.mensaje('correo')}
            </div>
            <div>
              <label className="ia-field">
                <span>Contraseña inicial (mínimo {MINIMO} caracteres)</span>
                <input
                  type="password"
                  ref={errores.ref('clave')}
                  {...errores.atributos('clave')}
                  value={password}
                  onChange={(evento) => setPassword(evento.target.value)}
                  autoComplete="new-password"
                  minLength={MINIMO}
                  maxLength={MAXIMO}
                  required
                  disabled={ocupado}
                />
              </label>
              {errores.mensaje('clave')}
            </div>
            <div>
              <label className="ia-field">
                <span>Repite la contraseña inicial</span>
                <input
                  type="password"
                  ref={errores.ref('repetida')}
                  {...errores.atributos('repetida')}
                  value={repetida}
                  onChange={(evento) => setRepetida(evento.target.value)}
                  autoComplete="new-password"
                  maxLength={MAXIMO}
                  required
                  disabled={ocupado}
                />
              </label>
              {errores.mensaje('repetida')}
            </div>
          </div>
          {errores.mensaje(null)}
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

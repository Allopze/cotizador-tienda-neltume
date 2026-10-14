'use client';

import { useState, type FormEvent } from 'react';
import Image from 'next/image';
import { ErrorSolicitud, MENSAJES, pedirJSON } from '../solicitud';

const MINIMO = 8;
const MAXIMO = 128;

/**
 * Se muestra en lugar del inicio de sesión mientras la base no tiene ninguna cuenta. Pide el código de un solo uso
 * que el servidor escribe en su registro, crea la primera cuenta administradora y entra con ella.
 */
export function PrimeraCuenta() {
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function crear(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (ocupado) return;
    if (password.length < MINIMO || password.length > MAXIMO)
      return setError(`La contraseña debe tener entre ${MINIMO} y ${MAXIMO} caracteres.`);
    if (password !== repetida) return setError('La confirmación no coincide con la contraseña.');
    setOcupado(true);
    setError('');
    try {
      await pedirJSON('/api/primer-arranque', { json: { codigo, nombre, email, password } });
    } catch (e) {
      const status = e instanceof ErrorSolicitud ? e.status : 0;
      // 404: otra persona creó la primera cuenta mientras tanto; se vuelve al inicio de sesión normal.
      if (status === 404) return window.location.replace('/login');
      setError(e instanceof ErrorSolicitud ? e.message : MENSAJES.general);
      setOcupado(false);
      return;
    }
    try {
      await pedirJSON('/api/auth/sign-in/email', { json: { email: email.trim(), password, callbackURL: '/' } });
      window.location.replace('/');
    } catch {
      // La cuenta ya existe: si el ingreso automático falla, se ingresa a mano.
      window.location.replace('/login');
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="primera-cuenta-titulo">
        <Image
          src="/logo-neltume.svg"
          alt="Neltume"
          className="login-logo"
          width={143}
          height={70}
          priority
          unoptimized
        />
        <p className="eyebrow">PRIMER USO · CUENTA ADMINISTRADORA</p>
        <h1 id="primera-cuenta-titulo">Crear la primera cuenta</h1>
        <p className="login-intro">
          Este cotizador todavía no tiene cuentas. Crea la tuya: tendrá permisos de administración y desde Ajustes podrás
          crear las demás.
        </p>
        <p className="login-aviso">
          El código de un solo uso aparece en el registro del servidor. Con Docker, en la carpeta de instalación:{' '}
          <code>docker compose logs cotizador</code>. Usa el último que aparezca; vence en 24 horas.
        </p>
        <form onSubmit={crear} className="login-form">
          <label htmlFor="codigo">Código del registro del servidor</label>
          <input
            id="codigo"
            name="codigo"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            required
            maxLength={64}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            disabled={ocupado}
          />
          <label htmlFor="nombre">Nombre</label>
          <input
            id="nombre"
            name="name"
            autoComplete="name"
            required
            maxLength={120}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            disabled={ocupado}
          />
          <label htmlFor="correo">Correo electrónico</label>
          <input
            id="correo"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={ocupado}
          />
          <label htmlFor="clave">Contraseña (mínimo {MINIMO} caracteres)</label>
          <input
            id="clave"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MINIMO}
            maxLength={MAXIMO}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={ocupado}
          />
          <label htmlFor="clave-repetida">Repite la contraseña</label>
          <input
            id="clave-repetida"
            name="password-repetida"
            type="password"
            autoComplete="new-password"
            required
            maxLength={MAXIMO}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'primera-cuenta-error' : undefined}
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
            disabled={ocupado}
          />
          {error && (
            <p className="login-error" id="primera-cuenta-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary login-submit" type="submit" disabled={ocupado}>
            {ocupado ? 'Creando la cuenta…' : 'Crear cuenta e ingresar'}
          </button>
        </form>
        <p className="login-help">
          Después crea una segunda cuenta administradora: si alguien olvida su contraseña, la otra puede restablecerla.
        </p>
      </section>
      <footer className="login-footer">
        NELTUME <span>/ Hecho en madera.</span>
      </footer>
    </main>
  );
}

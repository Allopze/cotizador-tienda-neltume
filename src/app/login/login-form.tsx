'use client';

import { useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { ErrorSolicitud, MENSAJES, pedirJSON } from '../solicitud';

export function LoginForm({ sesionExpirada = false }: { sesionExpirada?: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const clave = useRef<HTMLInputElement>(null);

  async function ingresar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setError('');
    try {
      await pedirJSON('/api/auth/sign-in/email', {
        json: { email: email.trim(), password, callbackURL: '/' },
      });
      // El cotizador restaura el borrador guardado en sessionStorage.
      window.location.replace('/');
    } catch (e) {
      const status = e instanceof ErrorSolicitud ? e.status : 0;
      // Sesión creada aunque la respuesta no traiga JSON: se continúa igual.
      if (status >= 200 && status < 300) return window.location.replace('/');
      setError(
        status === 0
          ? MENSAJES.red
          : status >= 500
            ? MENSAJES.servidor(status)
            : 'No se pudo iniciar sesión. Revisa tus datos o espera un momento antes de volver a intentar.',
      );
      setPassword('');
      setOcupado(false);
      // Tras un error el foco vuelve a la contraseña (ya vaciada) para reintentar.
      requestAnimationFrame(() => clave.current?.focus());
      return;
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <Image
          src="/logo-neltume.svg"
          alt="Neltume"
          className="login-logo"
          width={143}
          height={70}
          priority
          unoptimized
        />
        <p className="eyebrow">ESPACIO INTERNO · COTIZACIONES</p>
        <h1 id="login-title">Iniciar sesión</h1>
        <p className="login-intro">Ingresa con tu cuenta para continuar al cotizador.</p>
        {sesionExpirada && (
          <p className="login-aviso" role="status">
            Tu sesión expiró. Vuelve a ingresar; tu borrador se conservó.
          </p>
        )}
        <form onSubmit={ingresar} className="login-form">
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
            onChange={(event) => setEmail(event.target.value)}
            disabled={ocupado}
          />
          <label htmlFor="clave">Contraseña</label>
          <input
            ref={clave}
            id="clave"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'login-error' : undefined}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={ocupado}
          />
          {error && (
            <p className="login-error" id="login-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary login-submit" type="submit" disabled={ocupado}>
            {ocupado ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
        <p className="login-help">Si no tienes acceso, solicita una cuenta a la persona responsable.</p>
      </section>
      <footer className="login-footer">
        NELTUME <span>/ Hecho en madera.</span>
      </footer>
    </main>
  );
}

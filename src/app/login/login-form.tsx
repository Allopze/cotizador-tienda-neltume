'use client';

import { useState, type FormEvent } from 'react';
import Image from 'next/image';

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function ingresar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setError('');
    try {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, callbackURL: '/' }),
      });
      if (!response.ok) {
        setError('No se pudo iniciar sesión. Revisa tus datos o espera un momento antes de volver a intentar.');
        setPassword('');
        return;
      }
      window.location.replace('/');
    } catch {
      setError('No se pudo conectar con el cotizador. Intenta nuevamente.');
    } finally {
      setOcupado(false);
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
            id="clave"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={ocupado}
          />
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="button primary login-submit" type="submit" disabled={ocupado || !email || !password}>
            {ocupado ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
        <p className="login-help">Si no tienes acceso, solicita una cuenta a la persona responsable.</p>
      </section>
      <footer className="login-footer">NELTUME <span>/ Hecho en madera.</span></footer>
    </main>
  );
}

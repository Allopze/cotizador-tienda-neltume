'use client';

import { useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { correoValido, useErrorCampo } from '../error-campo';
import { ErrorSolicitud, esPantallaLogin, MENSAJES, PANTALLAS_LOGIN, pedirJSON } from '../solicitud';
import { avisoSesionExpirada } from './mensajes';
import { PuertaLogin } from './puerta-login';

export function LoginForm({
  sesionExpirada = false,
  desde = null,
}: {
  sesionExpirada?: boolean;
  /** Pantalla desde la que se llegó (`?desde=`); solo se usa si es una de las conocidas. */
  desde?: string | null;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [verClave, setVerClave] = useState(false);
  // Al ingresar, la puerta se abre y la cámara entra (solo con la escena 3D en marcha); luego se cambia de pantalla.
  const [entrando, setEntrando] = useState(false);
  const raiz = useRef<HTMLElement>(null);
  const botonIngresar = useRef<HTMLButtonElement>(null);
  const entrar = (destino_: string) => {
    const con3d = !!raiz.current?.querySelector('.door-side.gl-listo');
    setEntrando(true);
    window.setTimeout(() => window.location.replace(destino_), con3d ? 1100 : 0);
  };
  const errores = useErrorCampo<'correo' | 'clave'>('login');
  const origen = esPantallaLogin(desde) ? desde : null;
  // Tras ingresar se vuelve a la pantalla de origen (el cotizador restaura el borrador guardado en sessionStorage).
  const destino = origen ? PANTALLAS_LOGIN[origen] : '/';

  async function ingresar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ocupado) return;
    if (!email.trim()) return errores.fallar('correo', 'Escribe tu correo electrónico.');
    if (!correoValido(email)) return errores.fallar('correo', 'Revisa el correo: debe tener la forma nombre@dominio.cl.');
    if (!password) return errores.fallar('clave', 'Escribe tu contraseña.');
    setOcupado(true);
    errores.limpiar();
    try {
      await pedirJSON('/api/auth/sign-in/email', {
        json: { email: email.trim(), password, callbackURL: '/' },
      });
      entrar(destino);
    } catch (e) {
      const status = e instanceof ErrorSolicitud ? e.status : 0;
      // Sesión creada aunque la respuesta no traiga JSON: se continúa igual.
      if (status >= 200 && status < 300) return entrar(destino);
      setPassword('');
      setOcupado(false);
      // Tras un error el foco vuelve a la contraseña (ya vaciada) para reintentar.
      errores.fallar(
        'clave',
        status === 0
          ? MENSAJES.red
          : status >= 500
            ? e instanceof ErrorSolicitud
              ? e.message
              : MENSAJES.servidor(status)
            : // Dos causas distintas, dos mensajes: con un solo texto no se sabía si reescribir la clave o esperar.
              status === 429
              ? 'Demasiados intentos seguidos. Espera unos minutos antes de volver a intentar.'
              : 'Correo o contraseña incorrectos. Revísalos y vuelve a intentar.',
      );
      return;
    }
  }

  return (
    <main ref={raiz} className={`login${entrando ? ' entrando' : ''}`}>
      <PuertaLogin raiz={raiz} boton={botonIngresar} />
      <div className="login-side">
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
        <h1 id="login-title">Iniciar sesión</h1>
        <p className="login-intro">Ingresa con tu cuenta para continuar al cotizador.</p>
        {sesionExpirada && (
          <p className="login-aviso" role="status">
            {avisoSesionExpirada(origen)}
          </p>
        )}
        <form onSubmit={ingresar} className="login-form" noValidate>
          <label htmlFor="correo">Correo electrónico</label>
          <input
            id="correo"
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            maxLength={254}
            {...errores.atributos('correo')}
            ref={errores.ref('correo')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={ocupado}
          />
          {errores.mensaje('correo')}
          <label htmlFor="clave">Contraseña</label>
          <div className="login-clave">
            <input
              ref={errores.ref('clave')}
              id="clave"
              name="password"
              type={verClave ? 'text' : 'password'}
              autoComplete="current-password"
              required
              maxLength={128}
              {...errores.atributos('clave')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={ocupado}
            />
            {/* En el teléfono se escribe a ciegas: ver la clave evita errores de tipeo. */}
            <button
              type="button"
              className="login-ver-clave"
              aria-pressed={verClave}
              aria-controls="clave"
              onClick={() => setVerClave((v) => !v)}
              disabled={ocupado}
            >
              {verClave ? 'Ocultar' : 'Mostrar'}
              <span className="sr-only"> contraseña</span>
            </button>
          </div>
          {errores.mensaje('clave')}
          <button ref={botonIngresar} className="button primary login-submit" type="submit" disabled={ocupado}>
            {ocupado ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
        <p className="login-help">Si no tienes acceso, solicita una cuenta a la persona responsable.</p>
      </section>
      <footer className="login-footer">
        NELTUME <span>· Hecho en madera.</span>
      </footer>
      </div>
    </main>
  );
}

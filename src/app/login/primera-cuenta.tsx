'use client';

import { useState, type FormEvent } from 'react';
import Image from 'next/image';
import { useErrorCampo } from '../error-campo';
import {
  campoDelError,
  CLAVE_PRIMERA_CUENTA,
  validarPrimeraCuenta,
  type CampoPrimeraCuenta as Campo,
} from './mensajes';
import { ErrorSolicitud, MENSAJES, pedirJSON } from '../solicitud';

const { minimo: MINIMO, maximo: MAXIMO } = CLAVE_PRIMERA_CUENTA;

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
  const [ocupado, setOcupado] = useState(false);
  const errores = useErrorCampo<Campo>('primera-cuenta');

  async function crear(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (ocupado) return;
    const problema = validarPrimeraCuenta({ codigo, nombre, email, password, repetida });
    if (problema) return errores.fallar(problema.campo, problema.mensaje);
    setOcupado(true);
    errores.limpiar();
    try {
      await pedirJSON('/api/primer-arranque', { json: { codigo, nombre, email, password } });
    } catch (e) {
      const status = e instanceof ErrorSolicitud ? e.status : 0;
      // 404: otra persona creó la primera cuenta mientras tanto; se vuelve al inicio de sesión normal.
      if (status === 404) return window.location.replace('/login');
      setOcupado(false);
      const mensaje = e instanceof ErrorSolicitud ? e.message : MENSAJES.general;
      errores.fallar(campoDelError(status, mensaje), mensaje);
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
        <form onSubmit={crear} className="login-form" noValidate>
          <label htmlFor="codigo">Código del registro del servidor</label>
          <input
            id="codigo"
            name="codigo"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            required
            maxLength={64}
            {...errores.atributos('codigo')}
            ref={errores.ref('codigo')}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            disabled={ocupado}
          />
          {errores.mensaje('codigo')}
          <label htmlFor="nombre">Nombre</label>
          <input
            id="nombre"
            name="name"
            autoComplete="name"
            required
            maxLength={120}
            {...errores.atributos('nombre')}
            ref={errores.ref('nombre')}
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            disabled={ocupado}
          />
          {errores.mensaje('nombre')}
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
            onChange={(e) => setEmail(e.target.value)}
            disabled={ocupado}
          />
          {errores.mensaje('correo')}
          <label htmlFor="clave">Contraseña (mínimo {MINIMO} caracteres)</label>
          <input
            id="clave"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MINIMO}
            maxLength={MAXIMO}
            {...errores.atributos('clave')}
            ref={errores.ref('clave')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={ocupado}
          />
          {errores.mensaje('clave')}
          <label htmlFor="clave-repetida">Repite la contraseña</label>
          <input
            id="clave-repetida"
            name="password-repetida"
            type="password"
            autoComplete="new-password"
            required
            maxLength={MAXIMO}
            {...errores.atributos('repetida')}
            ref={errores.ref('repetida')}
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
            disabled={ocupado}
          />
          {errores.mensaje('repetida')}
          {errores.mensaje(null)}
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

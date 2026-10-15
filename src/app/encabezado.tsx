'use client';
import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { LogoutButton } from './logout-button';

interface Props {
  email: string;
  nombre: string;
  /** Pantalla actual: marca el enlace activo y el texto de la cabecera. La guía se abre desde el menú de cuenta. */
  pantalla: (typeof PANTALLAS)[number][0] | 'ayuda' | 'clientes';
  /** En el cotizador el logo empieza una cotización nueva; en las demás pantallas vuelve al inicio. */
  alLogo?: () => void;
  logoDeshabilitado?: boolean;
  /** Mientras el chat espera respuesta: salir de la pantalla la cortaría (el borrador nuevo quedaría huérfano). */
  navegacionBloqueada?: boolean;
}

const PANTALLAS = [
  ['cotizar', '/', 'Cotizar'],
  ['historial', '/historial', 'Historial'],
  ['catalogo', '/catalogo', 'Catálogo'],
  ['ajustes', '/ajustes', 'Ajustes'],
] as const;
/** Por qué no responden los enlaces mientras el chat espera: se anuncia (aria-describedby), no solo en `title`. */
const MOTIVO_BLOQUEO = 'Espera la respuesta del asistente o cancélala';

/** Cabecera común: logo, pantalla actual y menú de cuenta (compacto en móvil). */
export function Encabezado({ email, nombre, pantalla, alLogo, logoDeshabilitado, navegacionBloqueada }: Props) {
  const [menuCuenta, setMenuCuenta] = useState(false);
  const toggleCuenta = useRef<HTMLButtonElement>(null),
    cuenta = useRef<HTMLDivElement>(null);
  const idMotivo = useId();
  const motivo = navegacionBloqueada ? idMotivo : undefined;

  // Menú de cuenta (móvil): se cierra con Escape o al tocar fuera.
  useEffect(() => {
    if (!menuCuenta) return;
    const fuera = (e: PointerEvent) => {
      if (!cuenta.current?.contains(e.target as Node)) setMenuCuenta(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuCuenta(false);
      toggleCuenta.current?.focus();
    };
    document.addEventListener('pointerdown', fuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', fuera);
      document.removeEventListener('keydown', escape);
    };
  }, [menuCuenta]);

  const logo = (
    <Image src="/api/logo" alt="" className="logo" width={143} height={70} priority unoptimized />
  );
  return (
    <header className="masthead">
      {alLogo ? (
        <button
          type="button"
          className="logo-button"
          onClick={alLogo}
          disabled={logoDeshabilitado}
          aria-label="Neltume, inicio: empezar una cotización"
        >
          {logo}
        </button>
      ) : (
        <Link href="/" scroll={false} className="logo-button" aria-label="Neltume, volver a cotizaciones">
          {logo}
        </Link>
      )}
      {/* scroll={false}: cada pantalla restaura su propio scroll (useScrollRecordado). */}
      <nav className="header-nav" aria-label="Pantallas">
        {/* Bloqueados siguen enfocables (aria-disabled) y describen el motivo, para que el lector diga por qué no
            responden; el `title` queda para el mouse. */}
        {PANTALLAS.map(([id, href, texto]) => (
          <Link
            key={id}
            href={href}
            scroll={false}
            aria-current={pantalla === id ? 'page' : undefined}
            aria-disabled={navegacionBloqueada || undefined}
            aria-describedby={motivo}
            title={navegacionBloqueada ? MOTIVO_BLOQUEO : undefined}
            onClick={navegacionBloqueada ? (e) => e.preventDefault() : undefined}
          >
            {texto}
          </Link>
        ))}
      </nav>
      <div ref={cuenta} className={`account ${menuCuenta ? 'abierto' : ''}`}>
        <button
          ref={toggleCuenta}
          type="button"
          className="account-toggle"
          aria-expanded={menuCuenta}
          aria-controls="menu-cuenta"
          onClick={() => setMenuCuenta((v) => !v)}
        >
          Cuenta <span aria-hidden>▾</span>
        </button>
        <div id="menu-cuenta" className="account-controls">
          <span className="account-email" title={email}>
            {nombre && nombre !== email ? (
              <>
                <strong>{nombre}</strong> <small>{email}</small>
              </>
            ) : (
              email
            )}
          </span>
          {/* Cambiar la contraseña vive en «Ajustes». */}
          <Link
            href="/ayuda"
            scroll={false}
            className="ia-settings-button"
            aria-current={pantalla === 'ayuda' ? 'page' : undefined}
            aria-disabled={navegacionBloqueada || undefined}
            aria-describedby={motivo}
            title={navegacionBloqueada ? MOTIVO_BLOQUEO : undefined}
            onClick={navegacionBloqueada ? (e) => e.preventDefault() : () => setMenuCuenta(false)}
          >
            Cómo funciona
          </Link>
          <LogoutButton />
        </div>
      </div>
      {navegacionBloqueada && (
        <span id={idMotivo} className="sr-only">
          {MOTIVO_BLOQUEO}.
        </span>
      )}
    </header>
  );
}

'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { LogoutButton } from './logout-button';

interface Props {
  email: string;
  nombre: string;
  /** Pantalla actual: marca el enlace activo y el texto de la cabecera. */
  pantalla: (typeof PANTALLAS)[number][0];
  /** En el cotizador el logo empieza una cotización nueva; en las demás pantallas vuelve al inicio. */
  alLogo?: () => void;
  logoDeshabilitado?: boolean;
}

const PANTALLAS = [
  ['cotizar', '/', 'Cotizar'],
  ['historial', '/historial', 'Historial'],
  ['catalogo', '/catalogo', 'Catálogo'],
  ['ajustes', '/ajustes', 'Ajustes'],
] as const;

/** Cabecera común: logo, pantalla actual y menú de cuenta (compacto en móvil). */
export function Encabezado({ email, nombre, pantalla, alLogo, logoDeshabilitado }: Props) {
  const [menuCuenta, setMenuCuenta] = useState(false);
  const toggleCuenta = useRef<HTMLButtonElement>(null),
    cuenta = useRef<HTMLDivElement>(null);

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
    <Image src="/logo-neltume.svg" alt="" className="logo" width={143} height={70} priority unoptimized />
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
        {PANTALLAS.map(([id, href, texto]) => (
          <Link key={id} href={href} scroll={false} aria-current={pantalla === id ? 'page' : undefined}>
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
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}

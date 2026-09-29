'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { TipoAviso } from './avisos';
import { CambiarClave } from './cambiar-clave';
import { LogoutButton } from './logout-button';

interface Props {
  email: string;
  nombre: string;
  /** Pantalla actual: marca el enlace activo y el texto de la cabecera. */
  pantalla: 'cotizar' | 'historial' | 'configuracion';
  avisar: (tipo: TipoAviso, texto: string, extra?: { clave?: string }) => number;
  /** En el cotizador el logo empieza una cotización nueva; en las demás pantallas vuelve al inicio. */
  alLogo?: () => void;
  logoDeshabilitado?: boolean;
}

const PANTALLAS = [
  ['cotizar', '/', 'Cotizar'],
  ['historial', '/historial', 'Historial'],
  ['configuracion', '/configuracion', 'Catálogo y ajustes'],
] as const;

/** Cabecera común: logo, pantalla actual y menú de cuenta (compacto en móvil). */
export function Encabezado({ email, nombre, pantalla, avisar, alLogo, logoDeshabilitado }: Props) {
  const [menuCuenta, setMenuCuenta] = useState(false);
  const [cambiarClave, setCambiarClave] = useState(false);
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
        <Link href="/" className="logo-button" aria-label="Neltume, volver a cotizaciones">
          {logo}
        </Link>
      )}
      <nav className="header-nav" aria-label="Pantallas">
        {PANTALLAS.map(([id, href, texto]) => (
          <Link key={id} href={href} aria-current={pantalla === id ? 'page' : undefined}>
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
          <button
            type="button"
            className="ia-settings-button"
            onClick={() => {
              setMenuCuenta(false);
              setCambiarClave(true);
            }}
          >
            Cambiar contraseña
          </button>
          <LogoutButton />
        </div>
      </div>
      <CambiarClave abierta={cambiarClave} cerrar={() => setCambiarClave(false)} avisar={avisar} />
    </header>
  );
}

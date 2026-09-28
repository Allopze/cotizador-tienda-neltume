'use client';

import { useState } from 'react';
import { guardarBorrador } from './solicitud';

export function LogoutButton() {
  const [ocupado, setOcupado] = useState(false);

  async function salir() {
    if (ocupado) return;
    setOcupado(true);
    // Salir a propósito descarta el borrador; solo el vencimiento de sesión lo conserva.
    guardarBorrador({ texto: '', id: null });
    try {
      await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } finally {
      window.location.replace('/login');
    }
  }

  return (
    <button type="button" className="logout-button" onClick={salir} disabled={ocupado}>
      {ocupado ? 'Saliendo…' : 'Cerrar sesión'}
    </button>
  );
}

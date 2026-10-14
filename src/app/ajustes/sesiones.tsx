'use client';
import { useEffect, useState } from 'react';
import type { TipoAviso } from '../avisos';
import { esSilencioso, guardarBorrador, mensajeDe, pedirJSON } from '../solicitud';

interface SesionCuenta {
  id: string;
  creada: string;
  vence: string;
  dispositivo: string | null;
  ip: string | null;
  actual: boolean;
}

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** «Mi cuenta» → sesiones abiertas con la propia cuenta, con la opción de cerrar una o todas las demás. */
export function SesionesActivas({
  avisar,
}: {
  avisar: (tipo: TipoAviso, texto: string, extra?: { clave?: string }) => number;
}) {
  const [sesiones, setSesiones] = useState<SesionCuenta[] | null>(null);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState('');

  async function cargar() {
    setError('');
    try {
      setSesiones((await pedirJSON<{ sesiones: SesionCuenta[] }>('/api/sesiones', { cache: 'no-store' })).sesiones);
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    }
  }
  useEffect(() => {
    const tarea = window.setTimeout(() => void cargar(), 0);
    return () => window.clearTimeout(tarea);
  }, []);

  async function cerrarEsta() {
    setOcupado('actual');
    // Igual que «Cerrar sesión» del encabezado: salir a propósito descarta el borrador.
    guardarBorrador({ texto: '', id: null });
    try {
      await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } finally {
      window.location.replace('/login');
    }
  }

  async function enviar(json: { accion: 'cerrar'; id: string } | { accion: 'cerrar-demas' }, mensaje: string) {
    setOcupado(json.accion === 'cerrar' ? json.id : 'demas');
    setError('');
    try {
      setSesiones((await pedirJSON<{ sesiones: SesionCuenta[] }>('/api/sesiones', { json })).sesiones);
      avisar('exito', mensaje, { clave: 'sesiones' });
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
      void cargar();
    } finally {
      setOcupado('');
    }
  }

  const otras = sesiones?.filter((s) => !s.actual).length ?? 0;

  return (
    <section className="sesiones-cuenta" aria-labelledby="sesiones-titulo">
      <h3 id="sesiones-titulo" className="eyebrow ajustes-subtitulo">
        SESIONES ABIERTAS
      </h3>
      <p className="catalog-modal-intro">
        Los equipos y navegadores donde tu cuenta tiene una sesión abierta. Si no reconoces alguno, ciérralo y cambia
        tu contraseña.
      </p>
      {error && (
        <p className="catalog-error" role="alert">
          {error}{' '}
          <button type="button" className="link" onClick={() => void cargar()}>
            Reintentar
          </button>
        </p>
      )}
      {sesiones === null ? (
        !error && (
          <p className="muted" role="status">
            Cargando sesiones…
          </p>
        )
      ) : (
        <>
          <div className="catalogo-lista">
            <table>
              <thead>
                <tr>
                  <th>DISPOSITIVO</th>
                  <th>INICIO</th>
                  <th>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sesiones.map((s) => (
                  <tr key={s.id}>
                    <td data-etiqueta="Dispositivo">
                      <strong>{s.dispositivo ?? 'Dispositivo desconocido'}</strong>
                      <small>
                        {[s.actual ? 'Esta sesión' : null, s.ip ? `IP ${s.ip}` : null].filter(Boolean).join(' · ')}
                      </small>
                    </td>
                    <td data-etiqueta="Inicio">
                      {fechaHora(s.creada)}
                      <small>Vence: {fechaHora(s.vence)}</small>
                    </td>
                    <td className="celda-acciones">
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() =>
                          s.actual
                            ? void cerrarEsta()
                            : void enviar({ accion: 'cerrar', id: s.id }, 'Se cerró la sesión de ese dispositivo.')
                        }
                        disabled={!!ocupado}
                      >
                        {s.actual ? 'Cerrar esta sesión' : 'Cerrar sesión'}
                        {!s.actual && <span className="sr-only"> en {s.dispositivo ?? 'ese dispositivo'}</span>}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ia-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => void enviar({ accion: 'cerrar-demas' }, 'Se cerraron las demás sesiones de tu cuenta.')}
              disabled={!!ocupado || otras === 0}
            >
              {ocupado === 'demas' ? 'Cerrando…' : 'Cerrar las demás'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

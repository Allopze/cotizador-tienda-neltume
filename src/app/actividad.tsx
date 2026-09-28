'use client';
import { useEffect, useState } from 'react';
import { etiquetaEvento, type EventoCotizacion } from '@/negocio/estado';
import type { Detalle } from './contrato';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Registro de actividad: se carga al abrirlo y se relee cuando cambia la versión de la cotización. */
export function Actividad({ id, version }: { id: string; version: string }) {
  const [abierta, setAbierta] = useState(false);
  const [eventos, setEventos] = useState<EventoCotizacion[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!abierta) return;
    const control = new AbortController();
    pedirJSON<Detalle>(`/api/accion?id=${encodeURIComponent(id)}`, {
      signal: control.signal,
      cache: 'no-store',
    })
      .then((d) => {
        setEventos(d.eventos);
        setError('');
      })
      .catch((e) => {
        if (!esSilencioso(e)) setError(mensajeDe(e));
      });
    return () => control.abort();
  }, [abierta, id, version]);

  return (
    <details className="actividad" onToggle={(e) => setAbierta(e.currentTarget.open)}>
      <summary>Actividad</summary>
      {error ? (
        <p className="catalog-error" role="alert">
          {error}
        </p>
      ) : !eventos ? (
        <p className="muted">Cargando…</p>
      ) : !eventos.length ? (
        <p className="muted">
          Sin actividad registrada (las cotizaciones anteriores a este registro no la tienen).
        </p>
      ) : (
        <ol>
          {eventos
            .slice()
            .reverse()
            .map((e, i) => (
              <li key={i}>
                <time dateTime={e.fecha}>{fechaHora(e.fecha)}</time>
                <span>
                  <strong>{etiquetaEvento[e.tipo] ?? e.tipo}</strong>
                  {e.usuario ? ` · ${e.usuario}` : ''}
                </span>
                {e.detalle && <small>{e.detalle}</small>}
              </li>
            ))}
        </ol>
      )}
    </details>
  );
}

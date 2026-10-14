'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { etiquetaEstado } from '@/negocio/estado';
import { pesos } from '@/negocio/precios';
import type { ClienteDirectorio } from '@/servidor/clientes';
import { Encabezado } from '../encabezado';
import { EncabezadoPagina } from '../encabezado-pagina';
import { SIN_CLIENTE, SIN_NUMERO, fechaCorta, plural } from '../formato';
import { esSilencioso, mensajeDe, pedirJSON } from '../solicitud';

interface PaginaClientes {
  clientes: ClienteDirectorio[];
  total: number;
  pagina: number;
  porPagina: number;
}
const ESPERA_BUSQUEDA = 300;

/** Directorio de clientes: los de las cotizaciones anteriores, con búsqueda por nombre o RUT y sus cotizaciones. */
export function PantallaClientes({ email, nombre }: { email: string; nombre: string }) {
  const [q, setQ] = useState('');
  const [datos, setDatos] = useState<PaginaClientes | null>(null);
  const [error, setError] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [releer, setReleer] = useState(0);
  const primera = useRef(true);
  const termino = q.trim();
  const consulta = (pagina: number) => {
    const params = new URLSearchParams({ directorio: '1', pagina: String(pagina) });
    if (termino) params.set('q', termino);
    return `/api/clientes?${params}`;
  };

  useEffect(() => {
    const control = new AbortController();
    const t = setTimeout(
      () => {
        setBuscando(true);
        pedirJSON<PaginaClientes>(consulta(1), { signal: control.signal, cache: 'no-store' })
          .then((d) => {
            setDatos(d);
            setError('');
          })
          .catch((e) => {
            if (!esSilencioso(e)) setError(mensajeDe(e));
          })
          .finally(() => {
            if (!control.signal.aborted) setBuscando(false);
          });
      },
      primera.current ? 0 : ESPERA_BUSQUEDA,
    );
    primera.current = false;
    return () => {
      clearTimeout(t);
      control.abort();
    };
    // `consulta` depende solo de `termino`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termino, releer]);

  async function cargarMas() {
    if (!datos || buscando) return;
    setBuscando(true);
    try {
      const d = await pedirJSON<PaginaClientes>(consulta(datos.pagina + 1), { cache: 'no-store' });
      setDatos((previo) => previo && { ...d, clientes: [...previo.clientes, ...d.clientes] });
    } catch (e) {
      if (!esSilencioso(e)) setError(mensajeDe(e));
    } finally {
      setBuscando(false);
    }
  }

  const clientes = datos?.clientes ?? [];
  return (
    <div className="app-shell">
      <Encabezado email={email} nombre={nombre} pantalla="clientes" />
      <main className="pantalla-clientes">
        <EncabezadoPagina titulo="Clientes" id="clientes-titulo">
          <span className="heading-meta" aria-live="polite">
            {datos ? plural(datos.total, 'cliente') : ''}
          </span>
          <Link href="/historial" scroll={false} className="button secondary">
            Volver al historial
          </Link>
        </EncabezadoPagina>
        <section className="history superficie" aria-labelledby="clientes-titulo" aria-busy={buscando}>
          <div className="history-tools">
            <label className="history-search">
              <span className="sr-only">Buscar clientes</span>
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por nombre o RUT"
                maxLength={100}
                autoComplete="off"
              />
            </label>
          </div>
          {error && (
            <p className="history-empty catalog-error" role="alert">
              {error}{' '}
              <button type="button" className="link" onClick={() => setReleer((n) => n + 1)}>
                Reintentar
              </button>
            </p>
          )}
          {datos === null ? (
            !error && <p className="history-empty muted">Cargando clientes…</p>
          ) : !clientes.length ? (
            <p className="muted history-empty">
              {termino
                ? 'Ningún cliente coincide con la búsqueda.'
                : 'Aquí aparecerán los clientes de las cotizaciones que vayas preparando.'}
            </p>
          ) : (
            <>
              <ul className="clientes-lista">
                {clientes.map((c, i) => (
                  <Cliente key={`${c.rut ?? ''}|${c.nombre ?? ''}|${i}`} cliente={c} />
                ))}
              </ul>
              {clientes.length < datos.total && (
                <div className="history-mas">
                  <button type="button" className="button secondary" onClick={() => void cargarMas()} disabled={buscando}>
                    {buscando ? 'Cargando…' : `Cargar más (${clientes.length} de ${datos.total})`}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function Cliente({ cliente: c }: { cliente: ClienteDirectorio }) {
  const ultima = c.cotizaciones[0];
  const nombre = c.nombre || SIN_CLIENTE;
  return (
    <li>
      <details className="cliente-ficha">
        <summary aria-label={`${nombre}: ${plural(c.cantidad, 'cotización', 'cotizaciones')}`}>
          <span className="cliente-nombre">
            {nombre}
            <small>{[c.rut, c.comuna, c.telefono].filter(Boolean).join(' · ') || 'Sin RUT ni comuna'}</small>
          </span>
          <span className="cliente-resumen">
            {plural(c.cantidad, 'cotización', 'cotizaciones')}
            {ultima && <small>Última: {fechaCorta(ultima.actualizada)}</small>}
          </span>
        </summary>
        <div className="cliente-detalle">
          {(c.giro || c.direccion) && (
            <p className="muted">{[c.giro, c.direccion].filter(Boolean).join(' · ')}</p>
          )}
          <ul className="cliente-cotizaciones" aria-label={`Cotizaciones de ${nombre}`}>
            {c.cotizaciones.map((q) => (
              <li key={q.id}>
                <Link href={`/?cotizacion=${encodeURIComponent(q.id)}`} scroll={false}>
                  <span>{q.numero ? `N° ${q.numero}` : SIN_NUMERO}</span>
                  <span className={`status ${q.estado}`}>{etiquetaEstado[q.estado]}</span>
                  <span className="cliente-cotizacion-proyecto">
                    {q.proyecto || fechaCorta(q.actualizada)}
                  </span>
                  <strong>{pesos(q.total)}</strong>
                </Link>
              </li>
            ))}
          </ul>
          {c.cantidad > c.cotizaciones.length && (
            <p className="muted">
              Se muestran las {c.cotizaciones.length} más recientes. Las demás se buscan en el{' '}
              <Link href="/historial" scroll={false}>
                Historial
              </Link>
              .
            </p>
          )}
        </div>
      </details>
    </li>
  );
}

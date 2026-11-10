'use client';
import { useEffect, useRef, useState } from 'react';
import { pesos } from '@/negocio/precios';
import Link from 'next/link';
import type { RespuestaConsulta } from './contrato';
import { GruposBusqueda, LecturaBusqueda } from './lectura-busqueda';
import { medidaProducto, nombreProducto, sinMedida } from './formato';
import { guardarSesion, leerSesion } from './memoria-pantalla';
import { SelectorFamilia } from './selector-familia';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

/** La primera opción vacía es «todas»: el selector la muestra como el estado sin filtro. */
const FAMILIAS = [
  ['', 'Todas las familias'],
  ['PUERTA', 'Puertas'],
  ['MARCO', 'Marcos'],
  ['PIEZAS_T', 'Piezas T'],
  ['MOLDURA', 'Molduras'],
] as const;

/** Consulta del catálogo: modelos, maderas y medidas disponibles con el precio unitario de la cotización. */
export function CatalogoConsulta({ activa = true }: { activa?: boolean }) {
  const buscar = useRef<HTMLInputElement>(null);
  // Se entra al catálogo para buscar: foco en el buscador sin mover la página, salvo en pantallas táctiles
  // (abriría el teclado).
  useEffect(() => {
    if (activa && window.matchMedia?.('(pointer: fine)').matches)
      buscar.current?.focus({ preventScroll: true });
  }, [activa]);
  // La búsqueda se recuerda por pestaña: al volver al catálogo sigue la misma lista.
  const [q, setQ] = useState(() => leerSesion('catalogo:q', ''));
  const [familia, setFamilia] = useState(() => leerSesion('catalogo:familia', ''));
  useEffect(() => {
    guardarSesion('catalogo:q', q);
    guardarSesion('catalogo:familia', familia);
  }, [q, familia]);
  const [datos, setDatos] = useState<RespuestaConsulta | null>(null);
  const [error, setError] = useState('');
  /** Vuelve a consultar sin tocar la búsqueda: el aviso de error trae «Reintentar». */
  const [reintento, setReintento] = useState(0);

  useEffect(() => {
    const control = new AbortController();
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (familia) params.set('familia', familia);
      pedirJSON<RespuestaConsulta>(`/api/catalogo?${params}`, {
        signal: control.signal,
        cache: 'no-store',
      })
        .then((d) => {
          setDatos(d);
          setError('');
        })
        .catch((e) => {
          if (!esSilencioso(e)) setError(mensajeDe(e));
        });
    }, 250);
    return () => {
      clearTimeout(t);
      control.abort();
    };
  }, [q, familia, reintento]);

  return (
    <div className="catalogo-consulta">
      <p className="catalog-modal-intro">
        Busca como lo dice el cliente: modelo, madera y medida («willow mara 82 210», «ranco 1 metro»). Entiende
        los mismos nombres que el asistente.
      </p>
      <div className="catalogo-filtros">
        <label className="sr-only" htmlFor="catalogo-buscar">
          Buscar en el catálogo
        </label>
        <input
          ref={buscar}
          id="catalogo-buscar"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ej.: Molco oregón 0,80"
          maxLength={100}
        />
        <span id="catalogo-familia-label" className="sr-only">
          Familia
        </span>
        <SelectorFamilia
          id="catalogo-familia-label"
          value={familia}
          opciones={FAMILIAS}
          vacio="Todas las familias"
          seleccionar={setFamilia}
        />
      </div>
      {error ? (
        <p className="catalog-error" role="alert">
          {error}{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              setError('');
              setDatos(null);
              setReintento((n) => n + 1);
            }}
          >
            Reintentar
          </button>
        </p>
      ) : !datos ? (
        <p className="muted">Cargando catálogo…</p>
      ) : !datos.productos.length ? (
        <p className="muted">
          Sin productos que coincidan.
          {(q.trim() || familia) && (
            <>
              {' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setQ('');
                  setFamilia('');
                }}
              >
                Limpiar filtros
              </button>
            </>
          )}
        </p>
      ) : (
        <>
          <LecturaBusqueda datos={datos} consulta={q} />
          {datos.total > 40 && (datos.grupos?.length ?? 0) > 1 && (
            <details className="grupos-consulta">
              <summary>
                Ver por modelo y madera ({datos.grupos!.length})
              </summary>
              <GruposBusqueda
                grupos={datos.grupos!}
                elegir={(g) => setQ(`${nombreProducto(g.modelo)} ${nombreProducto(g.madera)}`)}
              />
            </details>
          )}
          <p className="muted" aria-live="polite">
            {datos.total > datos.productos.length
              ? `Mostrando ${datos.productos.length} de ${datos.total} productos: afina la búsqueda para ver el resto.`
              : `${datos.total} producto${datos.total === 1 ? '' : 's'}.`}
          </p>
          <div className="catalogo-lista" tabIndex={0} role="region" aria-label="Resultados del catálogo">
            <table>
              <thead>
                <tr>
                  <th scope="col">Producto / código</th>
                  <th scope="col">Medida</th>
                  <th scope="col">
                    Precio de venta
                    <small>costo de fábrica + ganancia, sin IVA</small>
                  </th>
                  <th scope="col">
                    <span className="sr-only">Cotizar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {datos.productos.map((p, i) => (
                  <tr key={p.codigo} className={i > 0 && datos.productos[i - 1].modelo === p.modelo ? undefined : 'catalogo-inicio-modelo'}>
                    <td>
                      <div className="catalogo-producto">
                        <span>
                          {/* En puertas la medida ya está en su columna: el nombre queda en modelo y madera. */}
                          {p.familia === 'PUERTA'
                            ? sinMedida(nombreProducto(p.descripcion))
                            : nombreProducto(p.descripcion)}
                          <small>
                            {p.codigo}
                            {p.manual ? ' · agregado manualmente' : ''}
                          </small>
                        </span>
                      </div>
                    </td>
                    <td data-etiqueta="Medida">{medidaProducto(p)}</td>
                    <td data-etiqueta="Precio de venta (sin IVA)">{pesos(p.unitario)}</td>
                    <td className="celda-acciones">
                      {/* Lo encontrado aquí se cotiza sin volver a buscarlo (auditoría 2026-11, N-42). */}
                      <Link
                        className="button secondary small"
                        href={`/?agregar=${encodeURIComponent(p.codigo)}`}
                        aria-label={`Cotizar ${nombreProducto(p.descripcion)} (${p.codigo})`}
                      >
                        Cotizar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

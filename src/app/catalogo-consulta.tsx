'use client';
import { useEffect, useRef, useState } from 'react';
import { pesos } from '@/negocio/precios';
import type { ProductoConsulta } from './contrato';
import { nombreProducto, sinMedida } from './formato';
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
const largo = (n: number) => `${n.toLocaleString('es-CL', { maximumFractionDigits: 2 })} m`;

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
  const [datos, setDatos] = useState<{ total: number; productos: ProductoConsulta[] } | null>(null);
  const [error, setError] = useState('');
  /** Vuelve a consultar sin tocar la búsqueda: el aviso de error trae «Reintentar». */
  const [reintento, setReintento] = useState(0);

  useEffect(() => {
    const control = new AbortController();
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (familia) params.set('familia', familia);
      pedirJSON<{ total: number; productos: ProductoConsulta[] }>(`/api/catalogo?${params}`, {
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
      <p className="catalog-modal-intro">Busca por modelo, madera, medida o código.</p>
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
          <p className="muted" aria-live="polite">
            {datos.total > datos.productos.length
              ? `Mostrando ${datos.productos.length} de ${datos.total} productos: afina la búsqueda para ver el resto.`
              : `${datos.total} producto${datos.total === 1 ? '' : 's'}.`}
          </p>
          <div className="catalogo-lista">
            <table>
              <thead>
                <tr>
                  <th scope="col">PRODUCTO / CÓDIGO</th>
                  <th scope="col">MEDIDA</th>
                  <th scope="col">UNITARIO NETO</th>
                </tr>
              </thead>
              <tbody>
                {datos.productos.map((p) => (
                  <tr key={p.codigo}>
                    <td>
                      {/* En puertas la medida ya está en su columna: el nombre queda en modelo y madera. */}
                      {p.familia === 'PUERTA'
                        ? sinMedida(nombreProducto(p.descripcion))
                        : nombreProducto(p.descripcion)}
                      <small>
                        {p.codigo}
                        {p.manual ? ' · agregado manualmente' : ''}
                      </small>
                    </td>
                    <td data-etiqueta="Medida">
                      {p.familia === 'PUERTA'
                        ? `${p.medida.replace(' A ', '–')} × ${largo(p.largo)}`
                        : `${p.medida} × ${largo(p.largo)}`}
                    </td>
                    <td data-etiqueta="Unitario neto">{pesos(p.unitario)}</td>
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

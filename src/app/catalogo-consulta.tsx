'use client';
import { useEffect, useRef, useState } from 'react';
import { pesos } from '@/negocio/precios';
import type { ProductoConsulta } from './contrato';
import { nombreProducto, sinMedida } from './formato';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

const FAMILIAS = [
  ['', 'Todas las familias'],
  ['PUERTA', 'Puertas'],
  ['MARCO', 'Marcos'],
  ['PIEZAS_T', 'Piezas T'],
  ['MOLDURA', 'Molduras'],
] as const;
const largo = (n: number) => `${n.toLocaleString('es-CL', { maximumFractionDigits: 2 })} m`;

/** Consulta del catálogo: modelos, maderas y medidas disponibles con el precio unitario de la cotización. */
export function CatalogoConsulta() {
  const buscar = useRef<HTMLInputElement>(null);
  // Se entra al catálogo para buscar: foco en el buscador, salvo en pantallas táctiles (abriría el teclado).
  useEffect(() => {
    if (window.matchMedia?.('(pointer: fine)').matches) buscar.current?.focus();
  }, []);
  const [q, setQ] = useState('');
  const [familia, setFamilia] = useState('');
  const [datos, setDatos] = useState<{ total: number; productos: ProductoConsulta[] } | null>(null);
  const [error, setError] = useState('');

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
  }, [q, familia]);

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
        <label className="sr-only" htmlFor="catalogo-familia">
          Familia
        </label>
        <select id="catalogo-familia" value={familia} onChange={(e) => setFamilia(e.target.value)}>
          {FAMILIAS.map(([valor, etiqueta]) => (
            <option key={valor} value={valor}>
              {etiqueta}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p className="catalog-error" role="alert">
          {error}
        </p>
      ) : !datos ? (
        <p className="muted">Cargando catálogo…</p>
      ) : !datos.productos.length ? (
        <p className="muted">Sin productos que coincidan.</p>
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

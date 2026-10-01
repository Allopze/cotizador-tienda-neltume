'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { pesos } from '@/negocio/precios';
import type { ProductoConsulta, ProductoElegido } from './contrato';
import { Dialogo } from './dialogo';
import { nombreProducto } from './formato';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

export function AgregarProducto({
  alCerrar,
  agregar,
  ocupado,
}: {
  alCerrar: () => void;
  agregar: (producto: ProductoElegido) => Promise<boolean>;
  ocupado: boolean;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [busqueda, setBusqueda] = useState('');
  const [datos, setDatos] = useState<{
    consulta: string;
    total: number;
    productos: ProductoConsulta[];
  } | null>(null);
  const [error, setError] = useState('');
  const [reintento, setReintento] = useState(0);
  const [seleccion, setSeleccion] = useState<ProductoConsulta | null>(null);
  const consulta = busqueda.trim();
  useEffect(() => {
    const control = new AbortController();
    const timer = setTimeout(() => {
      pedirJSON<{ total: number; productos: ProductoConsulta[] }>(
        `/api/catalogo?${new URLSearchParams({ q: consulta })}`,
        {
          signal: control.signal,
          cache: 'no-store',
        },
      )
        .then((d) => {
          setDatos({ ...d, consulta });
          setError('');
        })
        .catch((e) => {
          if (!esSilencioso(e)) setError(mensajeDe(e));
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      control.abort();
    };
  }, [consulta, reintento]);
  return (
    <Dialogo
      abierto
      alCerrar={alCerrar}
      titulo="Agregar producto"
      eyebrow="CATÁLOGO"
      focoInicial={entrada}
      cerrable={!ocupado}
      className="dialogo-productos"
    >
      {seleccion ? (
        <SeleccionProducto
          key={seleccion.codigo}
          producto={seleccion}
          agregar={agregar}
          ocupado={ocupado}
          volver={() => setSeleccion(null)}
        />
      ) : (
        <>
          <label className="catalogo-busqueda-label" htmlFor="producto-buscar">
            Busca por modelo, madera o código
          </label>
          <input
            ref={entrada}
            id="producto-buscar"
            className="producto-buscar"
            type="search"
            maxLength={100}
            value={busqueda}
            placeholder="Ej. Huilo Huilo oregón"
            onChange={(e) => {
              setBusqueda(e.target.value);
              setError('');
            }}
          />
          {error ? (
            <div role="alert" className="producto-error">
              <p>{error}</p>
              <button
                type="button"
                className="button secondary small"
                onClick={() => {
                  setDatos(null);
                  setError('');
                  setReintento((n) => n + 1);
                }}
              >
                Reintentar
              </button>
            </div>
          ) : datos?.consulta !== consulta ? (
            <p role="status" className="producto-resultados-ayuda">
              Buscando productos…
            </p>
          ) : (
            <>
              <p role="status" className="producto-resultados-ayuda">
                {datos.total
                  ? `${datos.total} resultados${datos.total > 24 ? ' · Mostrando los primeros 24; precisa tu búsqueda.' : ''}`
                  : 'No encontramos productos. Prueba otro modelo, madera o código.'}
              </p>
              <ul className="producto-resultados">
                {datos.productos.slice(0, 24).map((p) => (
                  <li key={p.codigo}>
                    <button type="button" onClick={() => setSeleccion(p)}>
                      <span>
                        <strong>{nombreProducto(p.descripcion)}</strong>
                        <small>
                          {p.codigo} · {nombreProducto(p.madera)}
                        </small>
                      </span>
                      <span>
                        <strong>{pesos(p.unitario)}</strong>
                        <small>unitario neto de referencia</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Dialogo>
  );
}

function SeleccionProducto({
  producto: p,
  agregar,
  ocupado,
  volver,
}: {
  producto: ProductoConsulta;
  agregar: (producto: ProductoElegido) => Promise<boolean>;
  ocupado: boolean;
  volver: () => void;
}) {
  const [cantidad, setCantidad] = useState('1');
  const [error, setError] = useState('');
  const [ancho, setAncho] = useState(String(p.anchoMax ?? p.anchoMin ?? ''));
  const [alto, setAlto] = useState(String(p.altoMax ?? p.largo));
  const [tipoMedida, setTipoMedida] = useState<NonNullable<ProductoElegido['tipoMedida']>>('no_especificado');
  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await agregar({
        codigo: p.codigo,
        cantidad: Number(cantidad),
        ...(p.familia === 'PUERTA' ? { ancho: Number(ancho), tipoMedida } : {}),
        alto: Number(alto),
      });
    } catch (e) {
      setError(mensajeDe(e));
    }
  }
  return (
    <form onSubmit={enviar} className="producto-seleccion">
      <button type="button" className="producto-volver" onClick={volver} disabled={ocupado}>
        ← Volver a resultados
      </button>
      <div className="producto-elegido">
        <strong>{nombreProducto(p.descripcion)}</strong>
        <small>
          {p.codigo} · {pesos(p.unitario)} neto unitario de referencia
        </small>
      </div>
      <p className="ayuda">El precio final se calcula con las condiciones de esta cotización.</p>
      <div className="producto-medidas">
        <label>
          Cantidad
          <input
            autoFocus
            type="number"
            min={1}
            max={10000}
            step={1}
            required
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            disabled={ocupado}
          />
        </label>
        {p.familia === 'PUERTA' && (
          <label>
            Ancho (m)
            <input
              type="number"
              min={p.anchoMin ?? 0.3}
              max={p.anchoMax ?? 3}
              step="0.001"
              required
              value={ancho}
              onChange={(e) => setAncho(e.target.value)}
              disabled={ocupado}
            />
          </label>
        )}
        <label>
          {p.familia === 'PUERTA' ? 'Alto (m)' : 'Largo (m)'}
          <input
            type="number"
            min={p.altoMin ?? p.largo}
            max={p.altoMax ?? p.largo}
            step="0.001"
            required
            value={alto}
            onChange={(e) => setAlto(e.target.value)}
            disabled={ocupado}
          />
        </label>
        {p.familia === 'PUERTA' && (
          <label>
            La medida corresponde a
            <select
              value={tipoMedida}
              onChange={(e) => setTipoMedida(e.target.value as typeof tipoMedida)}
              disabled={ocupado}
            >
              <option value="no_especificado">Por confirmar</option>
              <option value="hoja">Hoja</option>
              <option value="vano">Vano</option>
            </select>
          </label>
        )}
      </div>
      {error && (
        <p role="alert" className="producto-error">
          {error}
        </p>
      )}
      <div className="dialogo-acciones">
        <button type="submit" className="button primary" disabled={ocupado}>
          {ocupado ? 'Agregando…' : 'Agregar al pedido'}
        </button>
      </div>
    </form>
  );
}

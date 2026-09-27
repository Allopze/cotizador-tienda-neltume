import { useMemo, useState } from 'react';
import { etiquetaEstado, type Cotizacion } from '@/negocio/estado';
import { pesos } from '@/negocio/precios';
type Filtro = 'todas' | Cotizacion['estado'];
const FILTROS: [Filtro, string][] = [
  ['todas', 'Todas'],
  ['borrador', 'Borradores'],
  ['emitida', 'Emitidas'],
  ['aprobada', 'Aprobadas'],
];
interface Props {
  lista: Cotizacion[];
  actualId: string | null;
  cargando: boolean;
  ocupado: boolean;
  abrir: (q: Cotizacion) => void;
}
const zona = { timeZone: 'America/Santiago' } as const;
const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CL', { ...zona, day: 'numeric', month: 'short', year: 'numeric' });
const mes = (iso: string) => {
  const s = new Date(iso).toLocaleDateString('es-CL', { ...zona, month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Fecha que mejor describe el documento: aprobación, emisión o última edición del borrador.
const fechaReferencia = (q: Cotizacion) => q.nota?.fecha ?? q.fechaEmision ?? q.actualizada;
export function Historial({ lista, actualId, cargando, ocupado, abrir }: Props) {
  const [busqueda, setBusqueda] = useState(''),
    [filtro, setFiltro] = useState<Filtro>('todas');
  // Los borradores sin ítems son ruido (conversaciones sin pedido); se muestran solo si están abiertos.
  const visibles = useMemo(
    () => lista.filter((q) => q.estado !== 'borrador' || q.solicitudes.length || q.id === actualId),
    [lista, actualId],
  );
  const conteos = useMemo(() => {
    const c: Record<Filtro, number> = { todas: visibles.length, borrador: 0, emitida: 0, aprobada: 0 };
    for (const q of visibles) c[q.estado]++;
    return c;
  }, [visibles]);
  const grupos = useMemo(() => {
    const termino = sinTildes(busqueda.trim()).replace(/^n[°º]?\s*/, '');
    const filtradas = visibles
      .filter((q) => filtro === 'todas' || q.estado === filtro)
      .filter(
        (q) =>
          !termino ||
          sinTildes(
            [
              q.numero,
              q.nota?.numero && `nota ${q.nota.numero}`,
              q.cliente.nombre,
              q.cliente.comuna,
              q.cliente.proyecto,
              q.cliente.rut,
            ]
              .filter(Boolean)
              .join(' '),
          ).includes(termino),
      )
      .sort((a, b) => fechaReferencia(b).localeCompare(fechaReferencia(a)));
    const porMes = new Map<string, Cotizacion[]>();
    for (const q of filtradas) {
      const k = mes(fechaReferencia(q));
      porMes.set(k, [...(porMes.get(k) ?? []), q]);
    }
    return [...porMes];
  }, [visibles, filtro, busqueda]);
  const total = grupos.reduce((n, [, qs]) => n + qs.length, 0);
  return (
    <section className="history" aria-labelledby="historial-titulo">
      <div className="history-heading">
        <h2 id="historial-titulo">Cotizaciones anteriores</h2>
        <span>
          {total === visibles.length ? `${visibles.length} registros` : `${total} de ${visibles.length}`}
        </span>
      </div>
      {cargando ? (
        <p>Cargando cotizaciones…</p>
      ) : !visibles.length ? (
        <p className="muted">Aquí encontrarás las cotizaciones que vayas preparando.</p>
      ) : (
        <>
          <div className="history-tools">
            <label className="history-search">
              <span className="sr-only">Buscar cotizaciones</span>
              <input
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por N°, cliente, comuna o proyecto"
              />
            </label>
            <div className="history-filters" role="group" aria-label="Filtrar por estado">
              {FILTROS.map(([f, etiqueta]) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filtro === f}
                  onClick={() => setFiltro(f)}
                  disabled={!conteos[f] && f !== 'todas'}
                >
                  {etiqueta} <span>{conteos[f]}</span>
                </button>
              ))}
            </div>
          </div>
          {!total ? (
            <p className="muted history-empty">
              Sin resultados.{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setBusqueda('');
                  setFiltro('todas');
                }}
              >
                Limpiar filtros
              </button>
            </p>
          ) : (
            grupos.map(([titulo, qs]) => (
              <div key={titulo} className="history-group">
                <h3>{titulo}</h3>
                <ul className="history-list">
                  {qs.map((q) => (
                    <li key={q.id}>
                      <button
                        type="button"
                        disabled={ocupado}
                        aria-current={actualId === q.id ? 'true' : undefined}
                        onClick={() => abrir(q)}
                      >
                        <span className="history-number">
                          {q.numero ? `N° ${q.numero}` : <span className="muted">Sin número</span>}
                          {q.origen ? <small>Revisión de N° {q.origen}</small> : null}
                        </span>
                        <span className="history-client">
                          {q.cliente.nombre || 'Cliente sin nombre'}
                          <small>
                            {[q.cliente.comuna || 'Sin comuna', q.cliente.proyecto]
                              .filter(Boolean)
                              .join(' · ')}
                          </small>
                        </span>
                        <span className="history-meta">
                          {fecha(fechaReferencia(q))}
                          <small>
                            {q.solicitudes.length} {q.solicitudes.length === 1 ? 'ítem' : 'ítems'}
                            {q.incompletos.length
                              ? ` · ${q.incompletos.length} ${q.incompletos.length === 1 ? 'pendiente' : 'pendientes'}`
                              : ''}
                            {q.nota ? ` · Nota N° ${q.nota.numero}` : ''}
                          </small>
                        </span>
                        <span className={`status ${q.estado}`}>{etiquetaEstado[q.estado]}</span>
                        <strong>{pesos(q.montos.total)}</strong>
                        <span aria-hidden>↗</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </>
      )}
    </section>
  );
}

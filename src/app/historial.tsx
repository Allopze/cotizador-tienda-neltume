'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  etiquetaComercial,
  etiquetaEstado,
  etiquetaOperativo,
  type EstadoCotizacion,
  type ResumenCotizacion,
} from '@/negocio/estado';
import { pesos } from '@/negocio/precios';
import type { BorradorEnPapelera } from '@/servidor/almacen';
import type { Listado, Resultado } from './contrato';
import { EncabezadoPagina } from './encabezado-pagina';
import { guardarSesion, leerSesion } from './memoria-pantalla';
import { SIN_CLIENTE, SIN_NUMERO, estadoPago, fechaCorta, mesAnio, nombreProducto, plural } from './formato';
import { codigoDe, esSilencioso, guardarArchivo, mensajeDe, pedirArchivo, pedirJSON } from './solicitud';
import { Actividad } from './actividad';

/** Un estado, o una vista: las que vencen pronto, las que tienen saldo por cobrar o la papelera de borradores. */
type Filtro = 'todas' | EstadoCotizacion | 'vencen' | 'saldo' | 'papelera';
const FILTROS: [Filtro, string, string?][] = [
  ['todas', 'Todas'],
  ['borrador', 'Borradores'],
  ['emitida', 'Emitidas'],
  ['aprobada', 'Aprobadas'],
  ['reemplazada', 'Reemplazadas', 'Cambiadas por una revisión emitida: se consultan, pero ya no se aprueban'],
  ['anulada', 'Anuladas', 'Sin efecto (por ejemplo, rechazadas por el cliente): su número no se reutiliza'],
  ['vencen', 'Vencen pronto', 'Emitidas que vencen en los próximos 7 días'],
  ['saldo', 'Con saldo pendiente', 'Aprobadas con pagos por completar'],
  ['papelera', 'Papelera', 'Borradores eliminados: se pueden restaurar'],
];
const POR_PAGINA = 30;
const ESPERA_BUSQUEDA = 300;
export interface Filtros {
  q: string;
  estado: Filtro;
  desde: string;
  hasta: string;
}
const SIN_FILTROS: Filtros = { q: '', estado: 'todas', desde: '', hasta: '' };
// «N° 323», «nº323», «nro. 323» o «n 323» buscan el número; «Nuñez» queda intacto.
const limpiarTermino = (s: string) => s.trim().replace(/^(?:n[°º]|nro\.?(?=\s*\d)|n(?=\s*\d))\s*/i, '');

/** Filtros del listado como parámetros de /api/accion (los comparte la exportación). La papelera se lista aparte. */
export function parametros(f: Filtros) {
  const params = new URLSearchParams();
  const q = limpiarTermino(f.q);
  if (q) params.set('q', q);
  if (f.estado === 'vencen') params.set('vencenPronto', 'true');
  else if (f.estado === 'saldo') params.set('saldoPendiente', 'true');
  else if (f.estado !== 'todas' && f.estado !== 'papelera') params.set('estado', f.estado);
  if (f.desde) params.set('desde', f.desde);
  if (f.hasta) params.set('hasta', f.hasta);
  return params;
}

/** Listado paginado del servidor con búsqueda diferida; la cotizadora lo recarga tras cada acción. */
export function useHistorial(alListar: (d: Listado) => void) {
  // Filtros y filas cargadas se recuerdan por pestaña: al volver al historial se ve la misma lista, del
  // mismo largo, y el scroll restaurado cae sobre la misma fila. Montar solo en el cliente (useEsCliente).
  const [filtros, setFiltros] = useState<Filtros>(() => {
    const guardados = { ...SIN_FILTROS, ...leerSesion<Partial<Filtros>>('historial:filtros', {}) };
    // Un filtro guardado que ya no existe vuelve a «Todas».
    return FILTROS.some(([f]) => f === guardados.estado) ? guardados : { ...guardados, estado: 'todas' };
  });
  const cargadosPrevios = useRef(leerSesion<number>('historial:cargados', 0));
  useEffect(() => guardarSesion('historial:filtros', filtros), [filtros]);
  const [items, setItems] = useState<ResumenCotizacion[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true),
    [buscando, setBuscando] = useState(false),
    [error, setError] = useState('');
  const control = useRef<AbortController | null>(null);
  const vigentes = useRef({ filtros, cargados: 0, alListar });
  useEffect(() => {
    vigentes.current.filtros = filtros;
    vigentes.current.alListar = alListar;
  });

  const cargar = useCallback(async (f: Filtros, pag: number, agregar: boolean, porPagina = POR_PAGINA) => {
    control.current?.abort();
    const c = new AbortController();
    control.current = c;
    const params = parametros(f);
    params.set('pagina', String(pag));
    params.set('porPagina', String(porPagina));
    setBuscando(true);
    try {
      const d = await pedirJSON<Listado>(`/api/accion?${params}`, { signal: c.signal, cache: 'no-store' });
      setItems((prev) => {
        const nuevos = agregar
          ? [...prev, ...d.cotizaciones.filter((x) => !prev.some((p) => p.id === x.id))]
          : d.cotizaciones;
        vigentes.current.cargados = nuevos.length;
        guardarSesion('historial:cargados', nuevos.length);
        return nuevos;
      });
      setTotal(d.total);
      setPagina(agregar ? pag : Math.max(1, Math.ceil(porPagina / POR_PAGINA)));
      setError('');
      vigentes.current.alListar(d);
    } catch (e) {
      if (!esSilencioso(e)) setError(mensajeDe(e));
      throw e;
    } finally {
      if (control.current === c) {
        setBuscando(false);
        setCargando(false);
      }
    }
  }, []);

  // Búsqueda y filtros en el servidor, diferidos mientras se escribe.
  const primera = useRef(true);
  const cargaInicial = useRef(true);
  useEffect(() => {
    // La papelera tiene su propio listado (ver Papelera): mientras se mira, el historial no se consulta.
    if (filtros.estado === 'papelera') return;
    const t = setTimeout(
      () => {
        // La primera carga trae tantas filas como había al salir (hasta 200); las siguientes, una página.
        // Se decide al arrancar la carga, no al programarla: en desarrollo el efecto se monta dos veces.
        const previos = cargaInicial.current ? cargadosPrevios.current : 0;
        cargaInicial.current = false;
        const porPagina = Math.min(200, Math.max(POR_PAGINA, Math.ceil(previos / POR_PAGINA) * POR_PAGINA));
        cargar(filtros, 1, false, porPagina).catch(() => {});
      },
      primera.current ? 0 : ESPERA_BUSQUEDA,
    );
    primera.current = false;
    return () => clearTimeout(t);
  }, [filtros, cargar]);
  useEffect(() => () => control.current?.abort(), []);

  /** Relee lo ya cargado (hasta 200 filas) con los filtros vigentes. */
  const recargar = useCallback(
    () =>
      cargar(
        vigentes.current.filtros,
        1,
        false,
        Math.min(200, Math.max(POR_PAGINA, Math.ceil(vigentes.current.cargados / POR_PAGINA) * POR_PAGINA)),
      ),
    [cargar],
  );
  const cargarMas = useCallback(
    () => cargar(vigentes.current.filtros, pagina + 1, true).catch(() => {}),
    [cargar, pagina],
  );
  return { filtros, setFiltros, items, total, cargando, buscando, error, recargar, cargarMas };
}
export type EstadoHistorial = ReturnType<typeof useHistorial>;

const hayFiltros = (f: Filtros) => !!(f.q.trim() || f.estado !== 'todas' || f.desde || f.hasta);

interface Props {
  historial: EstadoHistorial;
  /** Cotización abierta en el cotizador de esta pestaña: se marca en el listado. */
  actualId: string | null;
  duplicar: (id: string) => void;
  /** Id de la cotización que se está duplicando (bloquea los demás «Duplicar»). */
  duplicando: string | null;
}
export function Historial({ historial, actualId, duplicar, duplicando }: Props) {
  const { filtros, setFiltros, items, total, cargando, buscando, error, recargar, cargarMas } = historial;
  const cambiar = (c: Partial<Filtros>) => setFiltros((f) => ({ ...f, ...c }));
  // El servidor ordena por última actualización: los grupos por mes siguen ese orden.
  const grupos: [string, ResumenCotizacion[]][] = [];
  for (const q of items) {
    // Misma fecha con que el servidor ordena y filtra, y la que muestra cada fila.
    const k = mesAnio(q.fecha);
    const g = grupos.at(-1);
    if (g?.[0] === k) g[1].push(q);
    else grupos.push([k, [q]]);
  }
  const filtrado = hayFiltros(filtros);
  const papelera = filtros.estado === 'papelera';
  const [exportando, setExportando] = useState(false),
    [errorExportar, setErrorExportar] = useState('');
  async function exportar() {
    setExportando(true);
    setErrorExportar('');
    try {
      const params = parametros(filtros);
      params.set('formato', 'csv');
      const { blob, nombre } = await pedirArchivo(`/api/accion?${params}`);
      guardarArchivo(blob, nombre ?? 'cotizaciones.csv');
    } catch (e) {
      if (!esSilencioso(e)) setErrorExportar(mensajeDe(e));
    } finally {
      setExportando(false);
    }
  }
  return (
    <>
      <EncabezadoPagina titulo="Historial de cotizaciones" id="historial-titulo">
        <span className="heading-meta" aria-live="polite">
          {cargando || papelera ? '' : filtrado ? plural(total, 'resultado') : plural(total, 'registro')}
        </span>
        {!papelera && (
          <button
            type="button"
            className="button secondary"
            onClick={exportar}
            disabled={exportando || cargando || !total}
            title="Descarga las cotizaciones del listado, con los filtros aplicados, para abrir en Excel"
          >
            {exportando ? 'Exportando…' : 'Exportar CSV'}
          </button>
        )}
      </EncabezadoPagina>
      <section className="history superficie" aria-labelledby="historial-titulo" aria-busy={!papelera && buscando}>
        <div className="history-tools">
          <label className="history-search">
            <span className="sr-only">Buscar cotizaciones</span>
            <input
              id="buscar-cotizaciones"
              type="search"
              aria-keyshortcuts="Control+K Meta+K"
              value={filtros.q}
              onChange={(e) => cambiar({ q: e.target.value })}
              placeholder={papelera ? 'Buscar cliente o producto en la papelera' : 'Buscar N°, cliente, RUT, teléfono o producto'}
              title={
                papelera
                  ? 'Busca los borradores eliminados por cliente, comuna, proyecto o producto'
                  : 'Busca por número, cliente, RUT, teléfono, comuna, proyecto o producto'
              }
              maxLength={200}
            />
          </label>
          {!papelera && (
            <div className="history-fechas">
              <label>
                <span>Desde</span>
                <input
                  type="date"
                  value={filtros.desde}
                  max={filtros.hasta || undefined}
                  onChange={(e) => cambiar({ desde: e.target.value })}
                />
              </label>
              <label>
                <span>Hasta</span>
                <input
                  type="date"
                  value={filtros.hasta}
                  min={filtros.desde || undefined}
                  onChange={(e) => cambiar({ hasta: e.target.value })}
                />
              </label>
            </div>
          )}
          <div className="history-filters" role="group" aria-label="Filtrar por estado">
            {FILTROS.map(([f, etiqueta, ayuda]) => (
              <button
                key={f}
                type="button"
                aria-pressed={filtros.estado === f}
                onClick={() => cambiar({ estado: f })}
                title={ayuda}
              >
                {etiqueta}
              </button>
            ))}
          </div>
        </div>
        {errorExportar && (
          <p className="history-empty catalog-error" role="alert">
            {errorExportar}
          </p>
        )}
        {error && !papelera && (
          <p className="history-empty catalog-error" role="alert">
            {error}{' '}
            <button type="button" className="link" onClick={() => recargar().catch(() => {})}>
              Reintentar
            </button>
          </p>
        )}
        {papelera ? (
          <Papelera q={filtros.q} />
        ) : cargando ? (
          <p className="history-empty muted">Cargando cotizaciones…</p>
        ) : !items.length ? (
          filtrado ? (
            <p className="muted history-empty">
              Sin resultados.{' '}
              <button type="button" className="link" onClick={() => setFiltros(SIN_FILTROS)}>
                Limpiar filtros
              </button>
            </p>
          ) : (
            !error && (
              <p className="muted history-empty">Aquí encontrarás las cotizaciones que vayas preparando.</p>
            )
          )
        ) : (
          <>
            {grupos.map(([titulo, qs]) => (
              <div key={titulo} className="history-group">
                <h2>{titulo}</h2>
                <ul className="history-list">
                  {qs.map((q) => (
                    <Fila
                      key={q.id}
                      q={q}
                      actual={actualId === q.id}
                      duplicar={duplicar}
                      duplicando={duplicando}
                    />
                  ))}
                </ul>
              </div>
            ))}
            {items.length < total && (
              <div className="history-mas">
                <button type="button" className="button secondary" onClick={cargarMas} disabled={buscando}>
                  {buscando ? 'Cargando…' : `Cargar más (${items.length} de ${total})`}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

const plano = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Borradores eliminados, con «Restaurar»: vuelven al historial tal como estaban. */
function Papelera({ q }: { q: string }) {
  const [borradores, setBorradores] = useState<BorradorEnPapelera[] | null>(null);
  const [error, setError] = useState('');
  const [releer, setReleer] = useState(0);
  const [restaurando, setRestaurando] = useState<string | null>(null);
  const [restaurado, setRestaurado] = useState<{ id: string; cliente: string; avisos: string[] } | null>(null);

  useEffect(() => {
    const control = new AbortController();
    pedirJSON<{ borradores: BorradorEnPapelera[] }>('/api/accion?papelera=1', {
      signal: control.signal,
      cache: 'no-store',
    })
      .then((d) => {
        setBorradores(d.borradores);
        setError('');
      })
      .catch((e) => {
        if (!esSilencioso(e)) setError(mensajeDe(e));
      });
    return () => control.abort();
  }, [releer]);

  async function restaurar(b: BorradorEnPapelera) {
    if (restaurando) return;
    setRestaurando(b.id);
    setError('');
    setRestaurado(null);
    try {
      const r = await pedirJSON<Resultado>('/api/accion', {
        json: { tipo: 'restaurar_borrador', id: b.id, actualizada: b.actualizada },
      });
      setBorradores((lista) => lista && lista.filter((x) => x.id !== b.id));
      setRestaurado({ id: r.cotizacion.id, cliente: b.cliente.nombre || SIN_CLIENTE, avisos: r.avisos ?? [] });
    } catch (e) {
      if (esSilencioso(e)) return;
      setError(mensajeDe(e));
      // Otra persona ya lo restauró o lo volvió a eliminar: la papelera se relee.
      const codigo = codigoDe(e);
      if (codigo === 'no_encontrada' || codigo === 'version_obsoleta') setReleer((n) => n + 1);
    } finally {
      setRestaurando(null);
    }
  }

  const terminos = plano(limpiarTermino(q)).split(/\s+/).filter(Boolean);
  const visibles = (borradores ?? []).filter((b) => {
    const texto = plano([b.cliente.nombre, b.cliente.comuna, b.cliente.proyecto, b.productos].filter(Boolean).join(' '));
    return terminos.every((t) => texto.includes(t));
  });
  return (
    <>
      {restaurado && (
        <p className="notice notice-success" role="status">
          Borrador de {restaurado.cliente} restaurado: volvió al historial.{' '}
          <Link href={`/?cotizacion=${encodeURIComponent(restaurado.id)}`} scroll={false}>
            Abrirlo
          </Link>
          {restaurado.avisos.map((aviso) => (
            <span key={aviso}>
              <br />
              {aviso}
            </span>
          ))}
        </p>
      )}
      {error && (
        <p className="history-empty catalog-error" role="alert">
          {error}{' '}
          <button type="button" className="link" onClick={() => setReleer((n) => n + 1)}>
            Reintentar
          </button>
        </p>
      )}
      {borradores === null ? (
        !error && <p className="history-empty muted">Cargando la papelera…</p>
      ) : !visibles.length ? (
        <p className="muted history-empty">
          {borradores.length
            ? 'Ningún borrador eliminado coincide con la búsqueda.'
            : 'La papelera está vacía. Aquí quedan los borradores que se eliminan, por si hay que restaurarlos.'}
        </p>
      ) : (
        <div className="history-group">
          <h2>Borradores eliminados · {visibles.length}</h2>
          <ul className="history-list">
            {visibles.map((b) => (
              <li key={b.id}>
                <div className="history-fila">
                  <span className="history-number">
                    <span className="muted">{SIN_NUMERO}</span>
                    {b.origen ? <small>Revisión de N° {b.origen}</small> : null}
                  </span>
                  <span className="history-client">
                    {b.cliente.nombre || SIN_CLIENTE}
                    <small>{[b.cliente.comuna || 'Sin comuna', b.cliente.proyecto].filter(Boolean).join(' · ')}</small>
                    {b.productos && <small className="history-productos">{nombreProducto(b.productos)}</small>}
                  </span>
                  <span className="history-meta">
                    Eliminado {fechaCorta(b.eliminada)}
                    <small>{plural(b.items, 'ítem')}</small>
                    <small>Creado {fechaCorta(b.creada)}</small>
                    {b.creadaPor && <small>por {b.creadaPor}</small>}
                  </span>
                  <span className="history-estado">
                    <span className="status borrador">{etiquetaEstado.borrador}</span>
                  </span>
                  <strong>{pesos(b.total)}</strong>
                  <span aria-hidden />
                </div>
                <button
                  type="button"
                  className="button secondary small history-duplicar"
                  onClick={() => void restaurar(b)}
                  disabled={restaurando !== null}
                  aria-label={`Restaurar borrador de ${b.cliente.nombre || SIN_CLIENTE}`}
                >
                  {restaurando === b.id ? 'Restaurando…' : 'Restaurar'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Fila({
  q,
  actual,
  duplicar,
  duplicando,
}: {
  q: ResumenCotizacion;
  actual: boolean;
  duplicar: (id: string) => void;
  duplicando: string | null;
}) {
  const autor = q.anuladaPor ?? q.aprobadaPor ?? q.emitidaPor ?? q.creadaPor;
  const vencida = q.vencida && q.estado === 'emitida';
  const pago = estadoPago(q);
  return (
    <li>
      {/* Enlace y no botón: abre la cotización en el cotizador (también en otra pestaña). */}
      <Link
        href={`/?cotizacion=${encodeURIComponent(q.id)}`}
        scroll={false}
        className="history-fila"
        aria-current={actual ? 'true' : undefined}
      >
        <span className="history-number">
          {q.numero ? `N° ${q.numero}` : <span className="muted">{SIN_NUMERO}</span>}
          {q.origen ? <small>Revisión de N° {q.origen}</small> : null}
          {q.reemplazadaPor ? <small>Reemplazada por N° {q.reemplazadaPor}</small> : null}
        </span>
        <span className="history-client">
          {q.cliente.nombre || SIN_CLIENTE}
          <small>{[q.cliente.comuna || 'Sin comuna', q.cliente.proyecto].filter(Boolean).join(' · ')}</small>
          {q.productos && <small className="history-productos">{nombreProducto(q.productos)}</small>}
        </span>
        <span className="history-meta">
          {fechaCorta(q.fecha)}
          <small>
            {plural(q.items, 'ítem')}
            {q.pendientes ? ` · ${plural(q.pendientes, 'pendiente')}` : ''}
            {q.nota ? ` · Nota N° ${q.nota.numero}${q.nota.anulada ? ' (anulada)' : ''}` : ''}
          </small>
          <small>Actualizada {fechaCorta(q.actualizada)}</small>
          {autor && <small>por {autor}</small>}
        </span>
        <span className="history-estado">
          <span className={`status ${q.estado}`}>{etiquetaEstado[q.estado]}</span>
          {vencida && <span className="status vencida">Vencida</span>}
          <small>{etiquetaComercial[q.estadoComercial ?? (q.estado === 'emitida' ? 'enviada' : 'pendiente')]}</small>
          {q.nota && <small>{etiquetaOperativo[q.estadoOperativo ?? 'pedido_generado']}</small>}
          {pago && <small>{pago}{q.pagado ? ` · ${pesos(q.pagado)}` : ''}</small>}
        </span>
        <strong>{pesos(q.total)}</strong>
        <span aria-hidden>›</span>
      </Link>
      <button
        type="button"
        className="button secondary small history-duplicar"
        onClick={() => duplicar(q.id)}
        disabled={duplicando !== null}
        aria-label={`Duplicar cotización ${q.numero ? `N° ${q.numero}` : SIN_NUMERO} de ${q.cliente.nombre || SIN_CLIENTE}`}
      >
        {duplicando === q.id ? 'Duplicando…' : 'Duplicar'}
      </button>
      <Actividad id={q.id} version={q.actualizada} />
    </li>
  );
}

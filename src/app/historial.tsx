'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  numeroNota,
  etiquetaComercial,
  etiquetaEstado,
  etiquetaOperativo,
  type EstadoComercial,
  type EstadoCotizacion,
  type EstadoOperativo,
  type ResumenCotizacion,
} from '@/negocio/estado';
import { pesos } from '@/negocio/precios';
import type { BorradorEnPapelera } from '@/servidor/almacen';
import { MAX_EXPORTACION, partesExportacion } from '@/servidor/exportar';
import type { Listado, Resultado } from './contrato';
import { EncabezadoPagina } from './encabezado-pagina';
import { guardarSesion, leerSesion } from './memoria-pantalla';
import { SIN_CLIENTE, SIN_NUMERO, estadoPago, fechaCorta, mesAnio, nombreProducto, plural } from './formato';
import {
  ErrorSolicitud,
  codigoDe,
  esSilencioso,
  guardarArchivo,
  mensajeDe,
  pedirArchivo,
  pedirJSON,
} from './solicitud';
import { Actividad } from './actividad';
import { PasosMini } from './linea-pasos';

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
  /** Seguimiento comercial («seguimiento», «rechazada»…); vacío, todos. */
  comercial?: EstadoComercial | '';
  /** Estado operativo («en_produccion», «despachada»…); vacío, todos. */
  operativo?: EstadoOperativo | '';
  /** Quien creó la cotización; vacío, todas. */
  vendedora?: string;
}
const SIN_FILTROS: Filtros = { q: '', estado: 'todas', desde: '', hasta: '', comercial: '', operativo: '', vendedora: '' };
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
  if (f.comercial) params.set('comercial', f.comercial);
  if (f.operativo) params.set('operativo', f.operativo);
  if (f.vendedora) params.set('vendedora', f.vendedora);
  return params;
}

/** Partes en que se descarga el CSV cuando el listado pasa de `MAX_EXPORTACION` filas (null si cabe en una). */
export function partesCsv(total: number, porParte = MAX_EXPORTACION) {
  const partes = partesExportacion(total, porParte);
  if (partes < 2) return null;
  return Array.from({ length: partes }, (_, i) => ({
    parte: i + 1,
    desde: i * porParte + 1,
    hasta: Math.min(total, (i + 1) * porParte),
  }));
}

/** Listado paginado del servidor con búsqueda diferida; la cotizadora lo recarga tras cada acción. */
export function useHistorial(alListar: (d: Listado) => void) {
  // Filtros y filas cargadas se recuerdan por pestaña: al volver al historial se ve la misma lista, del
  // mismo largo, y el scroll restaurado cae sobre la misma fila. Montar solo en el cliente (useEsCliente).
  const [filtros, setFiltros] = useState<Filtros>(() => {
    const guardados = { ...SIN_FILTROS, ...leerSesion<Partial<Filtros>>('historial:filtros', {}) };
    // Un filtro guardado que ya no existe vuelve a «Todas»; un seguimiento que ya no existe, a todos.
    if (guardados.comercial && !(guardados.comercial in etiquetaComercial)) guardados.comercial = '';
    if (guardados.operativo && !(guardados.operativo in etiquetaOperativo)) guardados.operativo = '';
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

const hayFiltros = (f: Filtros) =>
  !!(f.q.trim() || f.estado !== 'todas' || f.desde || f.hasta || f.comercial || f.operativo || f.vendedora);

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
  const [exportando, setExportando] = useState<number | null>(null),
    [errorExportar, setErrorExportar] = useState(''),
    // Listado más largo que un archivo: total y filtros con que se calcularon las partes.
    [porPartes, setPorPartes] = useState<{ total: number; clave: string } | null>(null);
  const claveFiltros = parametros(filtros).toString();
  const partes = porPartes?.clave === claveFiltros ? partesCsv(porPartes.total) : null;
  const vendedoras = useVendedoras(!papelera);
  /** Sin `parte`, descarga el listado entero si cabe en un archivo; si no, ofrece las partes (nunca corta). */
  async function exportar(parte?: number) {
    setErrorExportar('');
    if (parte === undefined && partesCsv(total)) {
      setPorPartes({ total, clave: claveFiltros });
      return;
    }
    setExportando(parte ?? 0);
    const params = parametros(filtros);
    params.set('formato', 'csv');
    if (parte !== undefined) params.set('parte', String(parte));
    try {
      const { blob, nombre } = await pedirArchivo(`/api/accion?${params}`);
      guardarArchivo(blob, nombre ?? 'cotizaciones.csv');
    } catch (e) {
      if (esSilencioso(e)) return;
      // El listado creció desde que se cargó: el servidor dice cuántas hay y en cuántas partes.
      if (e instanceof ErrorSolicitud && e.status === 409 && parte === undefined) {
        const detalle = await pedirJSON(`/api/accion?${params}`).then(
          () => null,
          (r) => (r instanceof ErrorSolicitud && r.codigo === 'exportacion_por_partes' ? r.detalle : null),
        );
        if (typeof detalle?.total === 'number') {
          setPorPartes({ total: detalle.total, clave: claveFiltros });
          return;
        }
      }
      setErrorExportar(mensajeDe(e));
    } finally {
      setExportando(null);
    }
  }
  return (
    <>
      <EncabezadoPagina titulo="Historial de cotizaciones" id="historial-titulo">
        <span className="heading-meta" aria-live="polite">
          {cargando || papelera ? '' : filtrado ? plural(total, 'resultado') : plural(total, 'registro')}
        </span>
        {/* Directorio de clientes: los de todas las cotizaciones, con las suyas. */}
        <Link href="/clientes" scroll={false} className="button secondary">
          Clientes
        </Link>
        {!papelera && (
          <button
            type="button"
            className="button secondary"
            onClick={() => void exportar()}
            disabled={exportando !== null || cargando || !total}
            title="Descarga las cotizaciones del listado, con los filtros aplicados, para abrir en Excel"
          >
            {exportando === 0 ? 'Exportando…' : 'Exportar CSV'}
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
          {!papelera && (
            <div className="history-seguimiento" role="group" aria-label="Filtrar por seguimiento y vendedora">
              <label>
                <span>Seguimiento</span>
                <select
                  value={filtros.comercial ?? ''}
                  onChange={(e) => cambiar({ comercial: e.target.value as EstadoComercial | '' })}
                >
                  <option value="">Todos</option>
                  {(Object.entries(etiquetaComercial) as [EstadoComercial, string][]).map(([valor, etiqueta]) => (
                    <option key={valor} value={valor}>
                      {etiqueta}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Operación</span>
                <select
                  value={filtros.operativo ?? ''}
                  onChange={(e) => cambiar({ operativo: e.target.value as EstadoOperativo | '' })}
                >
                  <option value="">Todas</option>
                  {(Object.entries(etiquetaOperativo) as [EstadoOperativo, string][]).map(([valor, etiqueta]) => (
                    <option key={valor} value={valor}>
                      {etiqueta}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Vendedora</span>
                <select value={filtros.vendedora ?? ''} onChange={(e) => cambiar({ vendedora: e.target.value })}>
                  <option value="">Todas</option>
                  {/* Una vendedora guardada en el filtro sigue elegible aunque la lista aún no llegue. */}
                  {[...new Set([...(filtros.vendedora ? [filtros.vendedora] : []), ...vendedoras])].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
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
        {partes && !papelera && (
          <div className="notice history-partes" role="status">
            <p>
              Hay {porPartes!.total.toLocaleString('es-CL')} cotizaciones con estos filtros y un archivo CSV admite{' '}
              {MAX_EXPORTACION.toLocaleString('es-CL')}. Descárgalas en {partes.length} partes, de la más reciente a la
              más antigua, o acota «Desde» y «Hasta» para un archivo por período.
            </p>
            <div className="history-partes-botones">
              {partes.map((p) => (
                <button
                  key={p.parte}
                  type="button"
                  className="button secondary small"
                  onClick={() => void exportar(p.parte)}
                  disabled={exportando !== null}
                >
                  {exportando === p.parte
                    ? 'Exportando…'
                    : `Parte ${p.parte}: ${p.desde.toLocaleString('es-CL')} a ${p.hasta.toLocaleString('es-CL')}`}
                </button>
              ))}
              <button type="button" className="link" onClick={() => setPorPartes(null)}>
                Cerrar
              </button>
            </div>
          </div>
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

/** Borradores por página de la papelera, como el listado. */
const POR_PAGINA_PAPELERA = 30;
interface PaginaPapelera {
  borradores: BorradorEnPapelera[];
  total: number;
  pagina: number;
  /** Días que un borrador eliminado queda en la papelera antes de borrarse para siempre. */
  plazoDias: number;
}

/** Quienes crearon cotizaciones, para el filtro «Vendedora». Si no llega, el filtro queda con «Todas». */
function useVendedoras(activo: boolean) {
  const [vendedoras, setVendedoras] = useState<string[]>([]);
  useEffect(() => {
    if (!activo) return;
    const control = new AbortController();
    pedirJSON<{ vendedoras: string[] }>('/api/accion?vendedoras=1', { signal: control.signal, cache: 'no-store' })
      .then((d) => setVendedoras(d.vendedoras))
      .catch(() => {});
    return () => control.abort();
  }, [activo]);
  return vendedoras;
}

/**
 * Borradores eliminados, con «Restaurar»: vuelven al historial tal como estaban. Paginada y con búsqueda en el
 * servidor; dice cuándo se vacía.
 */
function Papelera({ q }: { q: string }) {
  const [datos, setDatos] = useState<PaginaPapelera | null>(null);
  const [error, setError] = useState('');
  const [releer, setReleer] = useState(0);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [restaurando, setRestaurando] = useState<string | null>(null);
  const [restaurado, setRestaurado] = useState<{ id: string; cliente: string; avisos: string[] } | null>(null);
  const termino = limpiarTermino(q);
  const consulta = (pagina: number) => {
    const params = new URLSearchParams({ papelera: '1', pagina: String(pagina), porPagina: String(POR_PAGINA_PAPELERA) });
    if (termino) params.set('q', termino);
    return `/api/accion?${params}`;
  };
  const primera = useRef(true);

  useEffect(() => {
    const control = new AbortController();
    // La primera carga es inmediata; mientras se escribe, se espera como en el listado.
    const t = setTimeout(
      () => {
        pedirJSON<PaginaPapelera>(consulta(1), { signal: control.signal, cache: 'no-store' })
          .then((d) => {
            setDatos(d);
            setError('');
          })
          .catch((e) => {
            if (!esSilencioso(e)) setError(mensajeDe(e));
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
  }, [releer, termino]);

  async function cargarMas() {
    if (!datos || cargandoMas) return;
    setCargandoMas(true);
    try {
      const d = await pedirJSON<PaginaPapelera>(consulta(datos.pagina + 1), { cache: 'no-store' });
      setDatos((previo) =>
        previo && {
          ...d,
          borradores: [...previo.borradores, ...d.borradores.filter((b) => !previo.borradores.some((p) => p.id === b.id))],
        },
      );
    } catch (e) {
      if (!esSilencioso(e)) setError(mensajeDe(e));
    } finally {
      setCargandoMas(false);
    }
  }

  async function restaurar(b: BorradorEnPapelera) {
    if (restaurando) return;
    setRestaurando(b.id);
    setError('');
    setRestaurado(null);
    try {
      const r = await pedirJSON<Resultado>('/api/accion', {
        json: { tipo: 'restaurar_borrador', id: b.id, actualizada: b.actualizada },
      });
      setDatos((d) => d && { ...d, total: d.total - 1, borradores: d.borradores.filter((x) => x.id !== b.id) });
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

  const borradores = datos?.borradores ?? [];
  return (
    <>
      {datos && (
        <p className="muted history-plazo">
          Los borradores eliminados se guardan {plural(datos.plazoDias, 'día')} en la papelera; después se borran
          para siempre y ya no se pueden restaurar.
        </p>
      )}
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
      {datos === null ? (
        !error && <p className="history-empty muted">Cargando la papelera…</p>
      ) : !borradores.length ? (
        <p className="muted history-empty">
          {termino
            ? 'Ningún borrador eliminado coincide con la búsqueda.'
            : 'La papelera está vacía. Aquí quedan los borradores que se eliminan, por si hay que restaurarlos.'}
        </p>
      ) : (
        <div className="history-group">
          <h2>Borradores eliminados · {datos.total}</h2>
          <ul className="history-list">
            {borradores.map((b) => (
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
          {borradores.length < datos.total && (
            <div className="history-mas">
              <button type="button" className="button secondary" onClick={() => void cargarMas()} disabled={cargandoMas}>
                {cargandoMas ? 'Cargando…' : `Cargar más (${borradores.length} de ${datos.total})`}
              </button>
            </div>
          )}
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
            {q.notas.length
              ? ` · ${q.notas.length > 1 ? 'Notas' : 'Nota'} ${q.notas.map((n) => `${numeroNota(n)}${n.anulada ? ' (anulada)' : ''}`).join(', ')}`
              : ''}
          </small>
          <small className="sr-only">Actualizada {fechaCorta(q.actualizada)}</small>
          {autor && <small className="sr-only">por {autor}</small>}
        </span>
        <span className="history-estado">
          <span className={`status ${q.estado}`}>{etiquetaEstado[q.estado]}</span>
          {vencida && <span className="status vencida">Vencida</span>}
          {(q.estado === 'borrador' || q.estado === 'emitida' || q.estado === 'aprobada') && (
            <PasosMini
              datos={{
                estado: q.estado,
                operacion: q.estadoOperativo ?? 'sin_pedido',
                notas: q.notas.filter((n) => !n.anulada).length,
                pagado: q.pagado ?? 0,
                total: q.total,
                facturada: q.facturacion?.estado === 'facturada',
              }}
            />
          )}
          {/* El texto de cada fase sigue en la fila para el lector de pantalla; a la vista va la mini-barra. */}
          <small className="sr-only">
            {etiquetaComercial[q.estadoComercial ?? (q.estado === 'emitida' ? 'enviada' : 'pendiente')]}
            {q.notas.length > 0 ? ` · ${etiquetaOperativo[q.estadoOperativo ?? 'pedido_generado']}` : ''}
          </small>
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

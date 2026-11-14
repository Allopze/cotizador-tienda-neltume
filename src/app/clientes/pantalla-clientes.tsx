'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ClienteRegistrado } from '@/negocio/cliente-registro';
import type { ClienteDirectorio } from '@/servidor/clientes';
import { useConfirmacion } from '../dialogo';
import { Encabezado } from '../encabezado';
import { EncabezadoPagina } from '../encabezado-pagina';
import { SIN_CLIENTE, plural } from '../formato';
import { esSilencioso, mensajeDe, pedirJSON } from '../solicitud';
import { ClienteFila } from './cliente-fila';
import { DialogoCliente, type ModoClienteDialogo } from './dialogo-cliente';

interface PaginaClientes {
  clientes: ClienteDirectorio[];
  total: number;
  pagina: number;
  porPagina: number;
}
const ESPERA_BUSQUEDA = 300;

function directorARegistrado(c: ClienteDirectorio): ClienteRegistrado {
  return {
    id: c.id ?? '',
    nombre: c.nombre ?? '',
    rut: c.rut,
    giro: c.giro,
    telefono: c.telefono,
    direccion: c.direccion,
    comuna: c.comuna,
    correo: c.correo ?? null,
    notas: c.notas ?? null,
    documentoHabitual: c.documentoHabitual ?? null,
    receptorFacturacion: c.receptorFacturacion ?? null,
    creado: c.actualizado ?? '',
    actualizado: c.actualizado ?? '',
    creadoPor: null,
    actualizadoPor: null,
  };
}

/** Directorio editable de clientes frecuentes y clientes de cotizaciones anteriores. */
export function PantallaClientes({
  email,
  nombre,
  esAdmin = false,
}: {
  email: string;
  nombre: string;
  esAdmin?: boolean;
}) {
  const [q, setQ] = useState('');
  const [datos, setDatos] = useState<PaginaClientes | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const [modo, setModo] = useState<ModoClienteDialogo | null>(null);
  const [releer, setReleer] = useState(0);
  const [confirmar, dialogConfirmacion] = useConfirmacion();
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

  async function darDeBaja(c: ClienteDirectorio) {
    if (!esAdmin || !c.registrado || !c.id || eliminandoId) return;
    const titulo = c.nombre || SIN_CLIENTE;
    const ok = await confirmar({
      titulo: `¿Eliminar a «${titulo}»?`,
      mensaje: (
        <p>
          Dejará de aparecer en el registro de clientes frecuentes. Las cotizaciones existentes y sus PDF no se borran ni
          cambian.
        </p>
      ),
      aceptar: 'Eliminar cliente',
      eyebrow: 'CLIENTES',
    });
    if (!ok) return;
    setEliminandoId(c.id);
    setError('');
    try {
      await pedirJSON('/api/clientes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, ...(c.actualizado ? { actualizado: c.actualizado } : {}) }),
      });
      setAviso(`Cliente «${titulo}» eliminado del registro.`);
      setReleer((n) => n + 1);
    } catch (e) {
      if (!esSilencioso(e)) setError(mensajeDe(e));
    } finally {
      setEliminandoId(null);
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
          <button type="button" className="button primary" onClick={() => setModo({ tipo: 'nuevo' })}>
            Nuevo cliente
          </button>
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
          {aviso && (
            <p className="cliente-aviso" role="status">
              {aviso}
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
            !error && <p className="history-empty muted">Cargando clientes…</p>
          ) : !clientes.length ? (
            <p className="muted history-empty">
              {termino
                ? 'Ningún cliente coincide con la búsqueda.'
                : 'Agrega clientes frecuentes con «Nuevo cliente» o prepara cotizaciones para verlos aquí.'}
            </p>
          ) : (
            <>
              <ul className="clientes-lista">
                {clientes.map((c, i) => (
                  <ClienteFila
                    key={c.id ?? `${c.rut ?? ''}|${c.nombre ?? ''}|${i}`}
                    cliente={c}
                    esAdmin={esAdmin}
                    ocupado={eliminandoId === c.id}
                    alEditar={() => setModo({ tipo: 'editar', cliente: directorARegistrado(c) })}
                    alGuardarDesdeHistorial={() =>
                      setModo({
                        tipo: 'nuevo',
                        inicial: {
                          nombre: c.nombre ?? '',
                          rut: c.rut,
                          giro: c.giro,
                          telefono: c.telefono,
                          direccion: c.direccion,
                          comuna: c.comuna,
                        },
                      })
                    }
                    alEliminar={() => void darDeBaja(c)}
                  />
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
      <DialogoCliente
        modo={modo}
        alCerrar={() => setModo(null)}
        alGuardado={(guardado, accion) => {
          setModo(null);
          setError('');
          setAviso(
            accion === 'editar'
              ? `Cambios guardados en «${guardado.nombre}».`
              : `Cliente frecuente «${guardado.nombre}» guardado.`,
          );
          setReleer((n) => n + 1);
        }}
        alAbrirExistente={(existente) => setModo({ tipo: 'editar', cliente: existente })}
      />
      {dialogConfirmacion}
    </div>
  );
}

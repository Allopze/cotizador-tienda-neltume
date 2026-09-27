'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { Cotizacion } from '@/negocio/estado';
import type { OpcionCotizacion } from '@/servidor/referencias';
import { CotizacionPanel } from './cotizacion-panel';
import { Historial } from './historial';
const ejemplo = 'Cotiza 3 Huilo Huilo en oregón de 80 × 2,10 para Juan Pérez, Temuco';
export default function Page() {
  const [lista, setLista] = useState<Cotizacion[]>([]),
    [actual, setActual] = useState<Cotizacion | null>(null);
  const [mensaje, setMensaje] = useState(''),
    [ocupado, setOcupado] = useState(false),
    [error, setError] = useState('');
  const [seleccion, setSeleccion] = useState<{
    mensaje: string;
    contextoId: string | null;
    opciones: OpcionCotizacion[];
  } | null>(null);
  const [cargando, setCargando] = useState(true),
    [configurado, setConfigurado] = useState(true),
    [archivo, setArchivo] = useState<string | null>(null);
  const fin = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    fetch('/api/accion')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setLista(d.cotizaciones);
        setActual(d.cotizaciones.at(-1) ?? null);
        setConfigurado(d.asistenteConfigurado);
      })
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, []);
  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [actual?.historial.length, ocupado, seleccion?.opciones.length]);
  async function peticion(body: Record<string, unknown>) {
    const r = await fetch('/api/accion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? 'No se pudo completar la operación.');
    return data as {
      cotizacion: Cotizacion;
      archivo?: string;
      confirmar?: { id: string; numero: number };
      seleccion?: OpcionCotizacion[];
    };
  }
  function confirmarAprobacion(numero: number) {
    return window.confirm(
      `¿Aprobar la cotización N° ${numero}?\n\nSe generará la nota de pedido para fábrica y la cotización quedará bloqueada. Esta acción no se puede deshacer.`,
    );
  }
  function recibir(q: Cotizacion) {
    setActual(q);
    setLista((prev) => [...prev.filter((c) => c.id !== q.id), q]);
  }
  function nuevaCotizacion() {
    // El borrador se crea recién con el primer mensaje: evita acumular cotizaciones vacías.
    setActual(null);
    setArchivo(null);
    setError('');
    setSeleccion(null);
    setMensaje('');
    input.current?.focus();
  }
  async function accion(tipo: 'emitir' | 'aprobar' | 'quitar', indice?: number, id = actual?.id) {
    if (tipo === 'aprobar' && actual?.estado === 'emitida' && id === actual.id && actual.numero !== null)
      if (!confirmarAprobacion(actual.numero)) return;
    setOcupado(true);
    setError('');
    setArchivo(null);
    try {
      const d = await peticion({ tipo, id, ...(indice !== undefined ? { indice } : {}) });
      recibir(d.cotizacion);
      if (d.archivo) descargar(d.archivo);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  function descargar(nombre: string) {
    setArchivo(nombre);
    const a = document.createElement('a');
    a.href = `/api/documento/${nombre}`;
    a.download = nombre;
    a.click();
  }
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!mensaje.trim() || ocupado) return;
    setOcupado(true);
    setError('');
    setArchivo(null);
    const texto = mensaje;
    try {
      const d = await peticion({
        tipo: 'chat',
        ...(actual ? { id: actual.id } : {}),
        mensaje: texto,
      });
      setMensaje('');
      if (d.seleccion) {
        setSeleccion({ mensaje: texto, contextoId: actual?.id ?? null, opciones: d.seleccion });
        return;
      }
      setSeleccion(null);
      recibir(d.cotizacion);
      if (d.archivo) descargar(d.archivo);
      if (d.confirmar && confirmarAprobacion(d.confirmar.numero)) {
        const aprobada = await peticion({ tipo: 'aprobar', id: d.confirmar.id });
        recibir(aprobada.cotizacion);
        if (aprobada.archivo) descargar(aprobada.archivo);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
      input.current?.focus();
    }
  }
  async function elegirReferencia(opcion: OpcionCotizacion) {
    if (!seleccion || ocupado) return;
    const pendiente = seleccion;
    setOcupado(true);
    setError('');
    setArchivo(null);
    setSeleccion(null);
    try {
      const d = await peticion({
        tipo: 'chat',
        ...(pendiente.contextoId ? { id: pendiente.contextoId } : {}),
        objetivoId: opcion.id,
        objetivoActualizada: opcion.actualizada,
        mensaje: pendiente.mensaje,
      });
      if (d.seleccion) {
        setSeleccion({ ...pendiente, opciones: d.seleccion });
        return;
      }
      recibir(d.cotizacion);
      if (d.archivo) descargar(d.archivo);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
      input.current?.focus();
    }
  }
  const bloqueada = actual?.estado === 'aprobada';
  return (
    <div className="app-shell">
      <header className="masthead">
        <Link href="/" aria-label="Neltume, inicio">
          <Image
            src="/logo-neltume.svg"
            alt="Neltume"
            className="logo"
            width={143}
            height={70}
            priority
            unoptimized
          />
        </Link>
        <div className="header-label">
          PUERTAS DE MADERA <span>/</span> COTIZACIONES
        </div>
        <span className="internal">
          <i /> Espacio interno
        </span>
      </header>
      <div className="page-heading">
        <div>
          <p className="eyebrow">DEL PEDIDO A LA FÁBRICA</p>
          <h1>Cotizar, con claridad.</h1>
          <p className="intro">Tú conoces el proyecto. Aquí armamos los detalles.</p>
        </div>
        <button className="button secondary" onClick={nuevaCotizacion} disabled={ocupado || cargando}>
          <span aria-hidden>＋</span> Nueva cotización
        </button>
      </div>
      <main className="workspace">
        <section className="chat-panel" aria-label="Asistente de cotizaciones">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">01 / CONVERSACIÓN</p>
              <h2>Cuéntame el pedido</h2>
            </div>
            <span className="live-dot" title="Asistente interno" />
          </div>
          <div className="messages" aria-live="polite" aria-busy={ocupado}>
            <div className="welcome">
              <span className="speaker">NELTUME</span>
              <p>Empecemos con una puerta.</p>
              <div>
                Indica el modelo, la madera, las medidas y la cantidad. También puedes incluir los datos del
                cliente.
              </div>
              {!actual?.historial.length && (
                <button
                  className="example"
                  onClick={() => {
                    setMensaje(ejemplo);
                    input.current?.focus();
                  }}
                  disabled={ocupado}
                >
                  <span>POR EJEMPLO</span>“3 Huilo Huilo en oregón de 80 × 2,10 para Juan Pérez, Temuco”
                  <b aria-hidden>↗</b>
                </button>
              )}
            </div>
            {actual?.historial.map((m, i) => (
              <div key={i} className={`message ${m.rol}`}>
                <span className="speaker">{m.rol === 'usuario' ? 'TÚ' : 'NELTUME'}</span>
                <p>{m.texto}</p>
              </div>
            ))}
            {seleccion && (
              <>
                <div className="message usuario">
                  <span className="speaker">TÚ</span>
                  <p>{seleccion.mensaje}</p>
                </div>
                <div
                  className="reference-selection"
                  role="group"
                  aria-label="Seleccionar cotización anterior"
                >
                  <span className="speaker">NELTUME</span>
                  <p>Encontré varias cotizaciones que podrían ser. Elige cuál quieres modificar:</p>
                  <div className="reference-options">
                    {seleccion.opciones.map((opcion) => {
                      const numero = opcion.numero ? `N° ${opcion.numero}` : 'Borrador';
                      const fecha = new Date(opcion.fecha).toLocaleDateString('es-CL', {
                        timeZone: 'America/Santiago',
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      });
                      return (
                        <button
                          type="button"
                          key={opcion.id}
                          disabled={ocupado}
                          onClick={() => elegirReferencia(opcion)}
                          aria-label={`Elegir cotización ${numero} de ${opcion.cliente}`}
                        >
                          <strong>
                            {numero} · {opcion.cliente}
                          </strong>
                          <small>
                            {[fecha, opcion.proyecto, opcion.comuna, opcion.detalle]
                              .filter(Boolean)
                              .join(' · ')}
                          </small>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
            {ocupado && (
              <div className="thinking" role="status">
                Preparando los detalles<span> · · ·</span>
              </div>
            )}
            <div ref={fin} />
          </div>
          {!configurado && (
            <div className="notice">
              Para usar el chat, configura la clave de CommandCode en <code>.env.local</code>.
            </div>
          )}
          <form onSubmit={enviar} className="composer">
            <label className="sr-only" htmlFor="mensaje">
              Escribe tu pedido
            </label>
            <textarea
              ref={input}
              id="mensaje"
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              placeholder={
                bloqueada
                  ? 'Cotización aprobada. Crea una nueva para continuar.'
                  : 'Escribe el pedido o agrega un detalle…'
              }
              disabled={ocupado || bloqueada || cargando || !!seleccion}
              rows={3}
              maxLength={6000}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="composer-bottom">
              <span>Enter para enviar · ⇧ Enter para nueva línea</span>
              <button
                type="submit"
                aria-label="Enviar mensaje"
                disabled={!mensaje.trim() || ocupado || bloqueada || cargando || !!seleccion}
              >
                Enviar <span aria-hidden>↗</span>
              </button>
            </div>
          </form>
          <p className="chat-footnote">Puertas sólidas y accesorios · Medidas de la puerta</p>
        </section>
        <CotizacionPanel actual={actual} ocupado={ocupado} accion={accion} />
      </main>
      {error && (
        <div role="alert" className="error-banner">
          {error}
          <button aria-label="Cerrar aviso" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      {archivo && (
        <div className="download-banner" role="status">
          Documento listo.{' '}
          <a href={`/api/documento/${archivo}`} download>
            Descargar {archivo}
          </a>
        </div>
      )}
      <Historial
        lista={lista}
        actualId={actual?.id ?? null}
        cargando={cargando}
        ocupado={ocupado}
        abrir={(q) => {
          setActual(q);
          setSeleccion(null);
          setArchivo(null);
          setError('');
        }}
      />
      <footer className="site-footer">
        <span>
          NELTUME <span className="muted">/ Hecho en madera.</span>
        </span>
        <span>Asistente de cotizaciones · Uso interno</span>
      </footer>
    </div>
  );
}

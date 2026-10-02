'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  anticipoMinimo,
  esEditable,
  etiquetaEstado,
  type Cotizacion,
  type Despacho,
  type Mensaje,
} from '@/negocio/estado';
import { pesos } from '@/negocio/precios';
import type { OpcionCotizacion } from '@/servidor/referencias';
import { CotizacionPanel, descripcionItem, type AccionesPanel, type Operacion } from './cotizacion-panel';
import { Encabezado } from './encabezado';
import { antesDeNavegar, useScrollRecordado } from './memoria-pantalla';
import { Avisos, useAvisos } from './avisos';
import { TextoMensaje } from './texto-mensaje';
import { PreguntasPendientes } from './preguntas-pendientes';
import { preguntasPendientes } from '@/negocio/pendientes';
import { AgregarProducto } from './agregar-producto';
import { useConfirmacion } from './dialogo';
import { useAnulacion, useAnulacionPago, useAprobacion, useEmision } from './dialogos-cotizacion';
import type {
  CambiosEdicion,
  Despacho as CambiosDespacho,
  Detalle,
  ProductoElegido,
  Resultado,
} from './contrato';
import {
  SIN_CLIENTE,
  comportamientoScroll,
  copiarTexto,
  enterEnvia,
  fechaCorta,
  fechaLarga,
  numeroCotizacion,
  plural,
  resumenCambios,
  resumenTexto,
  vencida,
} from './formato';
import {
  ErrorCancelado,
  ErrorSolicitud,
  codigoDe,
  alExpirarSesion,
  esSilencioso,
  guardarArchivo,
  guardarBorrador,
  leerAbierta,
  leerBorrador,
  mensajeDe,
  pedirArchivo,
  pedirJSON,
  recordarAbierta,
} from './solicitud';

const ejemplo = 'Cotiza 3 Huilo Huilo en oregón de 80 × 2,10 para Juan Pérez, Temuco';
const LIMITE = 6000,
  AVISO_LIMITE = 5000;
/** Quita del texto las preguntas de los ítems pendientes: el bloque estructurado las reemplaza. */
function sinPreguntas(texto: string, q: Cotizacion) {
  const preguntas = new Set(q.incompletos.flatMap((p) => p.pregunta.split('\n')));
  return texto
    .split('\n')
    .filter((linea) => !preguntas.has(linea))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
const SIN_ASISTENTE = 'El asistente no está configurado. Pide a quien administra el cotizador que lo active.';
interface Seleccion {
  mensaje: string;
  contextoId: string | null;
  opciones: OpcionCotizacion[];
}
/** Nota local (no guardada) al final de la conversación: cancelaciones y resumen de cambios. */
interface NotaLocal {
  id: string | null;
  texto: string;
  tipo?: 'cambios';
}

/** Id propuesto para el borrador que cree el próximo mensaje (sin contexto seguro no hay UUID). */
const idNuevo = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined;

export function Cotizador({
  email,
  nombre,
  abrirId,
}: {
  email: string;
  nombre: string;
  /** Cotización pedida por URL (`/?cotizacion=…`), p. ej. desde el historial. */
  abrirId: string | null;
}) {
  const router = useRouter();
  const [actual, setActual] = useState<Cotizacion | null>(null);
  const [asistenteContraido, setAsistenteContraido] = useState(false);
  const [vistaMobile, setVistaMobile] = useState<'pedido' | 'cotizacion'>(abrirId ? 'cotizacion' : 'pedido');
  const [agregandoProducto, setAgregandoProducto] = useState(false);
  const [cambioVisual, setCambioVisual] = useState<{
    id: string;
    indices: number[];
    total: boolean;
    texto: string;
  } | null>(null);
  useEffect(() => {
    if (!cambioVisual) return;
    const timer = setTimeout(() => setCambioVisual(null), 4500);
    return () => clearTimeout(timer);
  }, [cambioVisual]);
  const [mensaje, setMensaje] = useState(''),
    [textoConservado, setTextoConservado] = useState(false),
    [enCurso, setEnCurso] = useState<Operacion | null>(null),
    [guardando, setGuardando] = useState<string | null>(null),
    [descargando, setDescargando] = useState<string | null>(null);
  /** Intercambio sin borrador (preguntas, aprobaciones) mientras no hay cotización abierta. */
  const [charla, setCharla] = useState<Mensaje[]>([]);
  /** Id del borrador que creará el mensaje en curso; sobrevive a una cancelación para no duplicar. */
  const idPendiente = useRef<string | null>(null);
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null);
  /** Totales de las opciones en selección: se leen aparte, el asistente nunca recibe montos. */
  const [totalesOpciones, setTotalesOpciones] = useState<Record<string, number>>({});
  const [notaLocal, setNotaLocal] = useState<NotaLocal | null>(null);
  const [anuncio, setAnuncio] = useState('');
  const [restaurando, setRestaurando] = useState(true),
    [configurado, setConfigurado] = useState(true);
  const [enfocar, setEnfocar] = useState(0);
  const { avisos, avisar, cerrar: cerrarAviso, limpiar } = useAvisos();
  const [confirmar, confirmacion] = useConfirmacion();
  const [pedirAprobacion, dialogoAprobacion] = useAprobacion();
  const [pedirAnulacion, dialogoAnulacion] = useAnulacion();
  const [pedirAnulacionPago, dialogoAnulacionPago] = useAnulacionPago();
  const [pedirEmision, dialogoEmision] = useEmision();
  const mensajes = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    workspace = useRef<HTMLElement>(null),
    titulo = useRef<HTMLHeadingElement>(null);
  const abortar = useRef<AbortController | null>(null);
  const ocupado = enCurso !== null;
  const ocupadoRef = useRef(false);
  const volverAlCompositor = useRef(false);
  useEffect(() => {
    ocupadoRef.current = ocupado;
  }, [ocupado]);

  const cargando = restaurando;
  // Al volver desde otra pantalla, el cotizador sigue a la misma altura. Si llega una cotización pedida
  // por URL (desde el historial), en cambio, la vista va a esa cotización.
  useScrollRecordado('cotizar', !cargando, !abrirId);

  /** Detalle completo de una cotización (el listado solo trae resúmenes). */
  const leerDetalle = useCallback(
    async (id: string, signal?: AbortSignal) => {
      const d = await pedirJSON<Detalle>(`/api/accion?id=${encodeURIComponent(id)}`, {
        signal,
        cache: 'no-store',
      });
      setConfigurado(d.asistenteConfigurado);
      return d.cotizacion;
    },
    [setConfigurado],
  );
  /** Relee la cotización abierta; sin `forzar` no la toca durante una operación. */
  const recargarActual = useCallback(
    async (id: string, forzar = false) => {
      const q = await leerDetalle(id);
      if (forzar || !ocupadoRef.current) setActual((prev) => (prev?.id === id ? q : prev));
      return q;
    },
    [leerDetalle],
  );

  // Carga inicial: parte en «Nueva cotización» (no abre la última de otra persona). Reabre, en este
  // orden, la pedida por URL, el borrador de esta pestaña o la que quedó abierta al ir a otra pantalla.
  useEffect(() => {
    const control = new AbortController();
    const b = leerBorrador();
    const id = abrirId ?? b?.id ?? leerAbierta();
    const fin = () => {
      if (!control.signal.aborted) setRestaurando(false);
    };
    if (abrirId) window.history.replaceState(null, '', '/');
    Promise.resolve()
      .then(async () => {
        if (b && (!abrirId || b.id === abrirId)) setMensaje(b.texto);
        if (id) setActual(await leerDetalle(id, control.signal));
        if (abrirId) setEnfocar((n) => n + 1);
      })
      .catch((e) => {
        if (!esSilencioso(e) && id) avisar('info', 'No se pudo reabrir la cotización.');
      })
      .finally(fin);
    // El listado ya no vive aquí: el estado del asistente se lee de los ajustes.
    pedirJSON<{ asistenteConfigurado: boolean }>('/api/ajustes', {
      signal: control.signal,
      cache: 'no-store',
    })
      .then((d) => setConfigurado(d.asistenteConfigurado))
      .catch(() => {});
    return () => control.abort();
  }, [leerDetalle, avisar, abrirId]);

  // Al volver a la pestaña se relee el listado y la cotización abierta: la otra persona pudo cambiarlos.
  const idAbierta = useRef<string | null>(null);
  useEffect(() => {
    idAbierta.current = actual?.id ?? null;
  });
  useEffect(() => {
    let ultimo = Date.now();
    const alVolver = () => {
      if (document.visibilityState !== 'visible' || Date.now() - ultimo < 5000) return;
      ultimo = Date.now();
      if (idAbierta.current && !ocupadoRef.current) recargarActual(idAbierta.current).catch(() => {});
    };
    window.addEventListener('focus', alVolver);
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [recargarActual]);

  // Borrador persistente del compositor (por pestaña) y cotización abierta al cambiar de pantalla.
  const actualId = actual?.id ?? null;
  useEffect(() => {
    if (!cargando) guardarBorrador({ texto: mensaje, id: actualId });
  }, [mensaje, actualId, cargando]);
  useEffect(() => {
    if (!cargando) recordarAbierta(actualId);
  }, [actualId, cargando]);
  useEffect(() => {
    const salir = () => recordarAbierta(null);
    window.addEventListener('pagehide', salir);
    return () => window.removeEventListener('pagehide', salir);
  }, []);

  // Sesión vencida: aviso no destructivo; el borrador y la cotización abierta quedan guardados.
  const estadoSesion = useRef({ mensaje, actualId });
  useEffect(() => {
    estadoSesion.current = { mensaje, actualId };
  });
  useEffect(
    () =>
      alExpirarSesion(() => {
        guardarBorrador({ texto: estadoSesion.current.mensaje, id: estadoSesion.current.actualId }, true);
        avisar('error', 'Tu sesión expiró. Vuelve a ingresar; tu borrador se conservó.', {
          clave: 'sesion',
          accion: {
            etiqueta: 'Volver a ingresar',
            fn: () => window.location.replace('/login?motivo=sesion'),
          },
        });
      }),
    [avisar],
  );

  // Solo se desplaza el contenedor de mensajes (no la ventana) cuando llega algo nuevo.
  const largoHistorial = actual?.historial.length ?? 0;
  useEffect(() => {
    const el = mensajes.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: comportamientoScroll() });
  }, [actualId, largoHistorial, seleccion, notaLocal, charla]);

  useEffect(() => {
    if (!seleccion) return;
    const control = new AbortController();
    for (const { id } of seleccion.opciones)
      pedirJSON<Detalle>(`/api/accion?id=${encodeURIComponent(id)}`, {
        signal: control.signal,
        cache: 'no-store',
      })
        .then((d) => setTotalesOpciones((t) => ({ ...t, [id]: d.cotizacion.montos.total })))
        .catch(() => {});
    return () => control.abort();
  }, [seleccion]);

  // Al abrir desde el historial: llevar la vista al área de trabajo y el foco al título.
  useEffect(() => {
    if (!enfocar) return;
    workspace.current?.scrollIntoView({ behavior: comportamientoScroll(), block: 'start' });
    titulo.current?.focus({ preventScroll: true });
  }, [enfocar]);

  // Devolver el foco al compositor cuando termina el chat (ya habilitado).
  useEffect(() => {
    if (!ocupado && volverAlCompositor.current) {
      volverAlCompositor.current = false;
      input.current?.focus();
    }
  }, [ocupado]);

  const peticion = (body: Record<string, unknown>, signal?: AbortSignal) =>
    pedirJSON<Resultado>('/api/accion', { json: body, signal });

  /** Abre una cotización por id (detalle completo) y lleva la vista a ella. */
  async function abrirPorId(id: string, enfocarTitulo = true) {
    const q = await leerDetalle(id);
    setActual(q);
    setSeleccion(null);
    setNotaLocal(null);
    setCharla([]);
    idPendiente.current = null;
    if (enfocarTitulo) {
      setVistaMobile('cotizacion');
      setEnfocar((n) => n + 1);
    }
    return q;
  }

  /** `pendiente`: id del borrador que iba a crear un primer mensaje cancelado. */
  function fallo(e: unknown, q: Cotizacion | null = actual, pendiente: string | null = null) {
    if (e instanceof ErrorCancelado) {
      avisar(
        'info',
        'Se canceló la espera; si el asistente alcanzó a responder, verás el cambio al actualizar.',
        {
          clave: 'operacion',
          accion: {
            etiqueta: 'Actualizar',
            fn: () => {
              if (q) recargarActual(q.id, true).catch((x) => fallo(x, null));
              else if (pendiente) abrirPendiente(pendiente);
            },
          },
        },
      );
      return;
    }
    if (esSilencioso(e)) return;
    const codigo = e instanceof ErrorSolicitud ? e.codigo : undefined;
    // El mensaje ya se había procesado antes de cancelar la espera: se abre su cotización.
    if (codigo === 'mensaje_procesado' && e instanceof ErrorSolicitud && typeof e.detalle?.id === 'string') {
      idPendiente.current = null;
      setMensaje('');
      avisar('info', mensajeDe(e), { clave: 'operacion' });
      abrirPorId(e.detalle.id).catch((x) => fallo(x, null));
      return;
    }
    // Revisión ya abierta de esta emitida: se abre esa en vez de fallar.
    if (codigo === 'revision_abierta' && e instanceof ErrorSolicitud && typeof e.detalle?.id === 'string') {
      avisar('info', `${mensajeDe(e)} Se abrió la revisión en curso.`, { clave: 'operacion' });
      abrirPorId(e.detalle.id).catch((x) => fallo(x, null));
      return;
    }
    if (codigo === 'version_obsoleta') {
      avisar('error', `${mensajeDe(e)} Se cargó la versión actual: revísala y vuelve a intentarlo.`, {
        clave: 'operacion',
      });
    } else avisar('error', mensajeDe(e), { clave: 'operacion' });
    // Conflictos (409): otra persona o pestaña cambió algo; se trae la versión vigente.
    if (e instanceof ErrorSolicitud && e.status === 409) {
      if (q) recargarActual(q.id, true).catch(() => {});
    }
  }

  /** Tras cancelar el primer mensaje: abre su borrador si el servidor alcanzó a crearlo. */
  function abrirPendiente(id: string) {
    abrirPorId(id)
      .then(() => {
        setMensaje('');
      })
      .catch((x) => {
        if (x instanceof ErrorSolicitud && x.status === 404)
          avisar('info', 'El mensaje no alcanzó a crear una cotización. Puedes reenviarlo.', {
            clave: 'operacion',
          });
        else if (!esSilencioso(x)) avisar('error', mensajeDe(x), { clave: 'operacion' });
      });
  }

  /** Aplica un resultado: cotización nueva (puede ser otra: revisión o duplicado), avisos y cambios. */
  function recibir(d: Resultado, opciones: { anunciar?: boolean; previa?: Cotizacion | null } = {}) {
    const q = d.cotizacion,
      previa = opciones.previa ?? actual;
    if (d.efimera) {
      // Sin pedido todavía: se muestra el intercambio, pero no se abre un borrador vacío.
      setActual(null);
      setCharla((c) => [...c, ...q.historial.slice(-2)].slice(-12));
      for (const a of d.avisos ?? []) avisar('info', a);
      const ultimo = q.historial.at(-1);
      if (opciones.anunciar && ultimo?.rol === 'asistente') setAnuncio(ultimo.texto);
      return;
    }
    setCharla([]);
    if (!d.eliminada) {
      const indices = q.solicitudes.flatMap((s, i) =>
        JSON.stringify(s) !== JSON.stringify(previa?.solicitudes[i]) ? [i] : [],
      );
      const cantidades = indices.flatMap((i) => {
        const antes = previa?.solicitudes[i]?.cantidad;
        const despues = q.solicitudes[i].cantidad;
        return antes != null && despues != null && antes !== despues
          ? [`Cantidad: ${antes} → ${despues}`]
          : [];
      });
      const total = !!previa && previa.montos.total !== q.montos.total;
      setCambioVisual(
        indices.length || total
          ? {
              id: q.id,
              indices,
              total,
              texto: [
                ...cantidades,
                total ? `Total actualizado: ${pesos(q.montos.total)}` : 'Pedido actualizado',
              ].join(' · '),
            }
          : null,
      );
    }
    if (d.eliminada) {
      setActual(null);
      setNotaLocal(null);
    } else setActual(q);
    for (const a of d.avisos ?? []) avisar('info', a);
    if (
      previa &&
      !d.eliminada &&
      previa.id !== q.id &&
      previa.estado === 'emitida' &&
      q.origen === previa.numero
    )
      avisar('info', `Se abrió la revisión de la N° ${previa.numero}; el PDF emitido se conserva.`, {
        clave: 'revision',
      });
    const cambios = resumenCambios(d.cambios);
    setNotaLocal(cambios ? { id: q.id, texto: `Cambios aplicados: ${cambios}.`, tipo: 'cambios' } : null);
    const ultimo = q.historial.at(-1);
    if (opciones.anunciar && ultimo?.rol === 'asistente')
      setAnuncio(cambios ? `${ultimo.texto} ${cambios}` : ultimo.texto);
    if (d.archivo) void descargar(d.archivo);
  }

  function nuevaCotizacion() {
    if (ocupado) return;
    // El borrador se crea recién con el primer mensaje: evita acumular cotizaciones vacías.
    // El texto escrito se conserva, pero se señala que venía de otra conversación.
    setTextoConservado(!!mensaje.trim() && (!!actual || charla.length > 0 || !!seleccion));
    setActual(null);
    setAsistenteContraido(false);
    setVistaMobile('pedido');
    setCambioVisual(null);
    setSeleccion(null);
    setNotaLocal(null);
    setCharla([]);
    idPendiente.current = null;
    limpiar('operacion');
    input.current?.focus();
  }

  async function descargar(archivo: string) {
    setDescargando(archivo);
    try {
      const { blob, nombre } = await pedirArchivo(`/api/documento/${encodeURIComponent(archivo)}`);
      guardarArchivo(blob, nombre ?? archivo);
      avisar('exito', `Documento listo: se descargó ${nombre ?? archivo}.`, { clave: 'descarga' });
    } catch (e) {
      fallo(e);
    } finally {
      setDescargando(null);
    }
  }

  /** Ejecuta una acción sobre la cotización abierta con su versión (`actualizada`). */
  async function ejecutar(op: Operacion, cuerpo: Record<string, unknown>, q = actual) {
    if (!q) return false;
    setEnCurso(op);
    limpiar('operacion');
    try {
      recibir(await peticion({ ...cuerpo, id: q.id }), { previa: q });
      return true;
    } catch (e) {
      fallo(e, q);
      return false;
    } finally {
      setEnCurso(null);
    }
  }

  const versionDe = (q: Cotizacion) => ({ actualizada: q.actualizada });

  /** Aprobar con despacho; si el servidor avisa que venció, se confirma y se reintenta. */
  async function aprobar(q: {
    id: string;
    numero: number | null;
    actualizada: string;
    vence: string | null;
    vencida: boolean;
    despacho: Despacho | null;
  }) {
    const datos = await pedirAprobacion({
      numero: q.numero,
      despacho: q.despacho,
      vence: q.vence,
      vencida: q.vencida,
    });
    if (!datos) return false;
    setEnCurso('aprobar');
    limpiar('operacion');
    const cuerpo = {
      tipo: 'aprobar',
      id: q.id,
      actualizada: q.actualizada,
      ...(Object.keys(datos.despacho).length ? { despacho: datos.despacho } : {}),
      ...(datos.confirmarVencida ? { confirmarVencida: true } : {}),
    };
    try {
      try {
        recibir(await peticion(cuerpo));
      } catch (e) {
        if (!(e instanceof ErrorSolicitud && e.codigo === 'cotizacion_vencida')) throw e;
        const vence = typeof e.detalle?.vence === 'string' ? e.detalle.vence : null;
        const ok = await confirmar({
          titulo: 'La cotización está vencida',
          mensaje: (
            <p>
              {mensajeDe(e)}
              {vence ? ` Venció el ${fechaCorta(vence)}.` : ''} ¿Aprobarla de todos modos con los valores
              emitidos?
            </p>
          ),
          aceptar: 'Aprobar de todos modos',
        });
        if (!ok) return false;
        recibir(await peticion({ ...cuerpo, confirmarVencida: true }));
      }
      return true;
    } catch (e) {
      fallo(e);
      return false;
    } finally {
      setEnCurso(null);
    }
  }

  const EDITAR_EMITIDA = (
    <>
      <p>
        Esta cotización ya fue emitida. El cambio se guardará en una revisión en borrador (se crea o se
        reutiliza la que ya existe).
      </p>
      <p>El PDF emitido se conserva sin cambios.</p>
    </>
  );

  const acciones: AccionesPanel = {
    async flujo(accion) {
      const q = actual;
      if (!q || ocupado) return false;
      setEnCurso('workflow');
      limpiar('operacion');
      try {
        recibir(await peticion({ ...accion, id: q.id, ...versionDe(q) }));
        return true;
      } catch (e) {
        fallo(e, q);
        return false;
      } finally {
        setEnCurso(null);
      }
    },
    async emitir() {
      const q = actual;
      if (!q || ocupado) return;
      const emision = await pedirEmision({ total: q.montos.total });
      if (!emision) return;
      setEnCurso('emitir');
      limpiar('operacion');
      try {
        try {
          recibir(
            await peticion({
              tipo: 'emitir',
              id: q.id,
              ...versionDe(q),
              ...(emision.numero === null ? {} : { numero: emision.numero }),
            }),
            { previa: q },
          );
        } catch (e) {
          // El catálogo cambió: el servidor ya guardó los montos nuevos en el borrador y no emitió.
          if (!(e instanceof ErrorSolicitud && e.codigo === 'precios_cambiaron')) throw e;
          const vigente = await recargarActual(q.id, true);
          const avisos = Array.isArray(e.detalle?.avisos) ? e.detalle.avisos.map(String) : [];
          const reconfirmado = await confirmar({
            titulo: 'Los precios cambiaron',
            mensaje: (
              <>
                <p>{mensajeDe(e)}</p>
                {avisos.length > 0 && (
                  <ul>
                    {avisos.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                )}
                <p>
                  Nuevo total: <strong>{pesos(vigente.montos.total)}</strong> (IVA incluido).
                </p>
              </>
            ),
            aceptar: 'Emitir con los montos actualizados',
          });
          if (!reconfirmado) return;
          recibir(
            await peticion({
              tipo: 'emitir',
              id: vigente.id,
              ...versionDe(vigente),
              ...(emision.numero === null ? {} : { numero: emision.numero }),
            }),
            { previa: vigente },
          );
        }
      } catch (e) {
        fallo(e, q);
      } finally {
        setEnCurso(null);
      }
    },
    async aprobar() {
      const q = actual;
      if (!q || ocupado) return;
      await aprobar({
        ...q,
        vencida: vencida(q),
        despacho: q.despacho ?? {
          direccion: q.cliente.direccion,
          transporte: null,
          entregaComprometida: null,
        },
      });
    },
    async quitar(indice) {
      const q = actual;
      if (!q || ocupado) return;
      const ok = await confirmar({
        titulo: 'Quitar ítem',
        mensaje: (
          <>
            <p>¿Quitar «{descripcionItem(q, indice)}» de la cotización?</p>
            {q.estado === 'emitida' && <p>Se creará un nuevo borrador; el PDF emitido se conserva.</p>}
          </>
        ),
        aceptar: 'Quitar ítem',
      });
      if (ok) await ejecutar('quitar', { tipo: 'quitar', indice, ...versionDe(q) }, q);
    },
    async duplicar() {
      if (actual) await duplicar(actual.id, actual.numero);
    },
    async eliminar() {
      const q = actual;
      if (!q || ocupado) return;
      const ok = await confirmar({
        titulo: 'Eliminar borrador',
        mensaje: (
          <p>
            ¿Eliminar este borrador{q.cliente.nombre ? ` de ${q.cliente.nombre}` : ''}? Se borran su
            conversación y sus ítems; no se puede deshacer.
          </p>
        ),
        aceptar: 'Eliminar borrador',
      });
      if (ok && (await ejecutar('eliminar', { tipo: 'eliminar', ...versionDe(q) }, q)))
        avisar('exito', 'Borrador eliminado.', { clave: 'operacion' });
    },
    async anular() {
      const q = actual;
      if (!q || ocupado) return;
      const datos = await pedirAnulacion(q.numero, q.estado === 'aprobada');
      if (!datos) return;
      if (
        await ejecutar(
          'anular',
          { tipo: 'anular', ...versionDe(q), ...(datos.motivo ? { motivo: datos.motivo } : {}) },
          q,
        )
      )
        avisar('exito', `Cotización ${numeroCotizacion(q.numero)} anulada.`, { clave: 'operacion' });
    },
    async anularPago(pagoId) {
      const q = actual;
      const pago = q?.pagos?.find((p) => p.id === pagoId);
      if (!q || !pago || ocupado) return false;
      // Con la nota ya generada, quedar bajo el 50 % frena la producción hasta volver a registrar el anticipo.
      const restante = (q.pagos ?? []).reduce((s, p) => s + p.monto, 0) - pago.monto;
      const minimo = anticipoMinimo(q.montos.total);
      const frenaProduccion =
        !!q.nota &&
        ['pedido_generado', 'en_produccion'].includes(q.estadoOperativo ?? '') &&
        restante < minimo;
      const datos = await pedirAnulacionPago({
        monto: pesos(pago.monto),
        fecha: fechaLarga(pago.fecha),
        ...(frenaProduccion
          ? {
              aviso: `La nota de pedido ya está generada y quedarían ${pesos(restante)} pagados, menos del 50 % (${pesos(minimo)}): la producción no podrá ${q.estadoOperativo === 'pedido_generado' ? 'iniciarse' : 'terminarse'} hasta volver a registrar el anticipo.`,
            }
          : {}),
      });
      if (!datos) return false;
      const ok = await ejecutar(
        'workflow',
        { tipo: 'anular_pago', pagoId, ...versionDe(q), ...(datos.motivo ? { motivo: datos.motivo } : {}) },
        q,
      );
      if (ok) avisar('exito', `Pago de ${pesos(pago.monto)} anulado.`, { clave: 'operacion' });
      return ok;
    },
    async despacho(cambios: CambiosDespacho, campo: string) {
      const q = actual;
      if (!q || ocupado) return false;
      setGuardando(campo);
      try {
        return await ejecutar('workflow', { tipo: 'despacho', despacho: cambios, ...versionDe(q) }, q);
      } finally {
        setGuardando(null);
      }
    },
    async editar(cambios: CambiosEdicion, campo: string) {
      const q = actual;
      if (!q || ocupado) return false;
      if (q.estado === 'emitida') {
        const ok = await confirmar({
          titulo: 'Editar una cotización emitida',
          mensaje: EDITAR_EMITIDA,
          aceptar: 'Guardar en la revisión',
        });
        if (!ok) return false;
      }
      setGuardando(campo);
      try {
        return await ejecutar('editar', { tipo: 'editar', ...versionDe(q), ...cambios }, q);
      } finally {
        setGuardando(null);
      }
    },
    descargar: (archivo) => void descargar(archivo),
    copiar: () => void copiar(),
  };

  async function agregarProducto(producto: ProductoElegido) {
    if (ocupado) return false;
    const q = actual;
    if (
      q?.estado === 'emitida' &&
      !(await confirmar({
        titulo: 'Editar una cotización emitida',
        mensaje: EDITAR_EMITIDA,
        aceptar: 'Guardar en la revisión',
      }))
    )
      return false;
    setEnCurso('editar');
    limpiar('operacion');
    try {
      const d = await peticion({
        tipo: 'agregar_producto',
        ...(q ? { id: q.id, ...versionDe(q) } : {}),
        ...producto,
      });
      recibir(d, { previa: q });
      setAgregandoProducto(false);
      setVistaMobile('cotizacion');
      avisar('exito', 'Producto agregado al pedido.', { clave: 'operacion' });
      return true;
    } catch (e) {
      fallo(e, q);
      throw e; // El selector muestra el error dentro del diálogo y conserva el producto.
    } finally {
      setEnCurso(null);
    }
  }

  async function duplicar(id: string, numero: number | null) {
    if (ocupado) return;
    setEnCurso('duplicar');
    limpiar('operacion');
    try {
      const d = await peticion({ tipo: 'duplicar', id });
      recibir(d, { previa: null });
      setSeleccion(null);
      setEnfocar((n) => n + 1);
      avisar(
        'exito',
        `Se creó un borrador nuevo a partir de ${numero ? `la N° ${numero}` : 'la cotización'}.`,
        {
          clave: 'operacion',
        },
      );
    } catch (e) {
      fallo(e, null);
    } finally {
      setEnCurso(null);
    }
  }

  async function aprobarDesdeChat(
    c: NonNullable<Resultado['confirmar']>,
    conversacion: Cotizacion,
    efimera = false,
  ) {
    if (c.id !== conversacion.id) {
      const texto = `Abriendo cotización N° ${c.numero}`;
      avisar('info', `${texto}.`, { clave: 'operacion' });
      setAnuncio(texto);
    }
    const ok = await aprobar({
      id: c.id,
      numero: c.numero,
      actualizada: c.actualizada,
      vence: c.vence,
      vencida: c.vencida,
      despacho:
        c.id === conversacion.id
          ? (conversacion.despacho ?? {
              direccion: conversacion.cliente.direccion,
              transporte: null,
              entregaComprometida: null,
            })
          : null,
    });
    if (!ok) {
      if (efimera) setCharla((m) => [...m, { rol: 'asistente', texto: 'Aprobación cancelada.' }]);
      else setNotaLocal({ id: conversacion.id, texto: 'Aprobación cancelada.' });
      setAnuncio('Aprobación cancelada.');
    }
  }

  async function responder(d: Resultado, previa: Cotizacion | null) {
    recibir(d, { anunciar: true, previa });
    if (d.confirmar) await aprobarDesdeChat(d.confirmar, d.cotizacion, !!d.efimera);
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const texto = mensaje;
    if (!texto.trim() || ocupado || bloqueada || !configurado || seleccion) return;
    const control = new AbortController();
    abortar.current = control;
    setEnCurso('chat');
    setNotaLocal(null);
    limpiar('operacion');
    const previa = actual;
    if (!previa && !idPendiente.current) idPendiente.current = idNuevo() ?? null;
    const nuevoId = previa ? null : idPendiente.current;
    try {
      const d = await peticion(
        {
          tipo: 'chat',
          ...(previa
            ? { id: previa.id, actualizada: previa.actualizada }
            : {
                ...(nuevoId ? { nuevoId } : {}),
                ...(charla.length ? { contexto: charla } : {}),
              }),
          mensaje: texto,
        },
        control.signal,
      );
      idPendiente.current = null;
      setMensaje('');
      setTextoConservado(false);
      if (d.seleccion) {
        setSeleccion({ mensaje: texto, contextoId: previa?.id ?? null, opciones: d.seleccion });
        setAnuncio('Encontré varias cotizaciones que podrían ser. Elige cuál quieres modificar.');
        return;
      }
      setSeleccion(null);
      await responder(d, previa);
    } catch (e) {
      // Tras cancelar o perder la red el servidor pudo procesarlo: el mismo id evita un duplicado.
      if (!(e instanceof ErrorCancelado || codigoDe(e) === 'red')) idPendiente.current = null;
      fallo(e, previa, nuevoId);
    } finally {
      abortar.current = null;
      volverAlCompositor.current = true;
      setEnCurso(null);
    }
  }

  async function elegirReferencia(opcion: OpcionCotizacion) {
    if (!seleccion || ocupado) return;
    const pendiente = seleccion;
    const previa = actual;
    const control = new AbortController();
    abortar.current = control;
    setEnCurso('chat');
    limpiar('operacion');
    setSeleccion(null);
    try {
      const d = await peticion(
        {
          tipo: 'chat',
          ...(pendiente.contextoId && previa?.id === pendiente.contextoId
            ? { id: previa.id, actualizada: previa.actualizada }
            : {}),
          objetivoId: opcion.id,
          objetivoActualizada: opcion.actualizada,
          mensaje: pendiente.mensaje,
        },
        control.signal,
      );
      if (d.seleccion) {
        setSeleccion({ ...pendiente, opciones: d.seleccion });
        return;
      }
      await responder(d, previa);
    } catch (e) {
      // La elección no se aplicó: se vuelve a ofrecer y el mensaje queda disponible para reenviar.
      setSeleccion(pendiente);
      setMensaje(pendiente.mensaje);
      fallo(e, previa);
    } finally {
      abortar.current = null;
      volverAlCompositor.current = true;
      setEnCurso(null);
    }
  }

  function descartarSeleccion() {
    if (!seleccion || ocupado) return;
    // «Ninguna de estas»: el pedido se trata como una cotización nueva; el texto vuelve al compositor.
    setMensaje(seleccion.mensaje);
    setSeleccion(null);
    setActual(null);
    setNotaLocal(null);
    setCharla([]);
    requestAnimationFrame(() => input.current?.focus());
  }

  async function copiar() {
    if (!actual) return;
    const ok = await copiarTexto(resumenTexto(actual));
    if (ok) avisar('exito', 'Resumen copiado al portapapeles.', { clave: 'copiar' });
    else
      avisar('error', 'No se pudo copiar. Selecciona el detalle y cópialo manualmente.', { clave: 'copiar' });
  }

  // Atajos: Ctrl/⌘+K abre el historial con el buscador; Alt+N empieza una cotización nueva.
  const irAlHistorial = () => {
    antesDeNavegar();
    router.push('/historial', { scroll: false });
  };
  const atajos = useRef({ nuevaCotizacion, historial: irAlHistorial });
  useEffect(() => {
    atajos.current = { nuevaCotizacion, historial: irAlHistorial };
  });
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        atajos.current.historial();
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyN') {
        e.preventDefault();
        atajos.current.nuevaCotizacion();
      }
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, []);

  // Aprobadas, reemplazadas y anuladas no admiten cambios (ni por chat).
  const bloqueada = !!actual && !esEditable(actual);
  // Las preguntas con botones solo en un borrador: en una emitida, responder crearía una revisión.
  const preguntasChat = actual?.estado === 'borrador' ? preguntasPendientes(actual) : [];
  const composerDeshabilitado = ocupado || bloqueada || cargando || !!seleccion || !configurado;
  const ayudaCompositor = [!configurado && 'aviso-asistente', mensaje.length >= AVISO_LIMITE && 'contador']
    .filter(Boolean)
    .join(' ');
  function responderOpcion(respuesta: string) {
    setTextoConservado(false);
    setMensaje((m) => (m.trim() ? `${m.trim()}; ${respuesta}` : respuesta));
    input.current?.focus();
  }
  const inicio = !actual && !charla.length && !seleccion && enCurso !== 'chat';
  // Con conversación en curso la bienvenida solo ocupa espacio.
  const conConversacion = !!actual?.historial.length || !!actual?.solicitudes.length || !!charla.length;
  // El historial guarda lo que se respondió en su momento («genera el PDF…»); tras emitir, esta línea
  // dice el estado real y qué pasa si se escribe un cambio.
  const estadoChat =
    actual?.estado === 'emitida' && esEditable(actual)
      ? `${numeroCotizacion(actual.numero)} emitida${actual.fechaEmision ? ` el ${fechaLarga(actual.fechaEmision)}` : ''}. Si escribes un cambio, se creará una revisión en borrador y se conservará este PDF.`
      : null;
  const mostrarNueva = !!actual || !!charla.length || !!seleccion;
  return (
    <div
      className={`app-shell pantalla-cotizador${actual ? ' con-pedido' : ''}${asistenteContraido ? ' asistente-contraido' : ''}`}
    >
      <Encabezado
        email={email}
        nombre={nombre}
        pantalla="cotizar"
        alLogo={nuevaCotizacion}
        logoDeshabilitado={ocupado}
      />
      {/* La pestaña activa ya dice «Cotizar»: un título visible solo lo repetiría. */}
      <h1 className="sr-only">Cotizar</h1>
      <nav className="cotizador-vistas" aria-label="Vista del cotizador">
        <button
          type="button"
          aria-pressed={vistaMobile === 'pedido'}
          aria-controls="panel-pedido"
          onClick={() => setVistaMobile('pedido')}
        >
          Pedido
        </button>
        <button
          type="button"
          aria-pressed={vistaMobile === 'cotizacion'}
          aria-controls="panel-cotizacion"
          onClick={() => setVistaMobile('cotizacion')}
        >
          Cotización{actual?.incompletos.length ? ` (${actual.incompletos.length} pendientes)` : ''}
        </button>
      </nav>
      <main className="workspace" ref={workspace} data-vista={vistaMobile}>
        <section
          id="panel-pedido"
          className={`chat-panel${inicio ? ' inicio' : ''}`}
          aria-label="Asistente de cotizaciones"
        >
          <button
            type="button"
            className="chat-toggle"
            aria-expanded={!asistenteContraido}
            aria-controls="chat-contenido"
            onClick={() => setAsistenteContraido((v) => !v)}
          >
            {asistenteContraido ? 'Abrir asistente →' : '← Contraer asistente'}
          </button>
          <div id="chat-contenido" className="chat-contenido">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">01 / CONVERSACIÓN</p>
                <h2>Cuéntame el pedido</h2>
              </div>
              {mostrarNueva && (
                <button
                  type="button"
                  className="button secondary small"
                  onClick={nuevaCotizacion}
                  disabled={ocupado || cargando}
                  aria-keyshortcuts="Alt+N"
                  title="Atajo: Alt+N · Ctrl/⌘+K abre el historial con el buscador"
                >
                  <span aria-hidden>+</span> Nueva cotización
                </button>
              )}
            </div>
            <div
              className="messages"
              ref={mensajes}
              data-testid="conversacion"
              aria-busy={enCurso === 'chat'}
            >
              {!conConversacion && (
                <div className="welcome">
                  <span className="speaker">NELTUME</span>
                  <p>Empecemos con una puerta.</p>
                  <div>
                    Indica el modelo, la madera, las medidas y la cantidad. También puedes incluir los datos
                    del cliente.
                  </div>
                  {!actual?.historial.length && !charla.length && (
                    <button
                      type="button"
                      className="example"
                      onClick={() => {
                        setMensaje(ejemplo);
                        setTextoConservado(false);
                        input.current?.focus();
                      }}
                      disabled={composerDeshabilitado}
                    >
                      <span>USAR ESTE EJEMPLO</span>“3 Huilo Huilo en oregón de 80 × 2,10 para Juan Pérez,
                      Temuco”
                      <b aria-hidden>→</b>
                    </button>
                  )}
                </div>
              )}
              {(actual ? actual.historial : charla).map((m, i, lista) => {
                const ultima = m.rol === 'asistente' && i === lista.length - 1;
                // Con preguntas estructuradas, la última respuesta no las repite en texto: se responden ahí mismo.
                const conPreguntas = ultima && preguntasChat.length > 0;
                const texto = conPreguntas ? sinPreguntas(m.texto, actual!) : m.texto;
                return (
                  <div key={actual ? i : `charla-${i}`} className={`message ${m.rol}`}>
                    <span className="speaker">{m.rol === 'usuario' ? 'TÚ' : 'NELTUME'}</span>
                    {texto && (
                      <TextoMensaje
                        texto={texto}
                        // Solo la última pregunta ofrece botones: las anteriores ya se respondieron.
                        elegir={
                          ultima && !conPreguntas && !composerDeshabilitado ? responderOpcion : undefined
                        }
                      />
                    )}
                    {conPreguntas && (
                      <div className="pendientes-chat" role="group" aria-label="Datos que faltan para cotizar">
                        <p className="pendientes-intro">
                          Faltan datos en {plural(actual!.incompletos.length, 'producto')}. Elige una opción o
                          escríbelo en tu próximo mensaje.
                        </p>
                        <PreguntasPendientes
                          preguntas={preguntasChat}
                          asistente={configurado}
                          editable={!ocupado && !bloqueada}
                          guardando={guardando}
                          responder={acciones.editar}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              {estadoChat && (
                <div className="message asistente local estado">
                  <span className="speaker">NELTUME</span>
                  <p>{estadoChat}</p>
                </div>
              )}
              {notaLocal && notaLocal.id === actualId && (
                <div className={`message asistente local ${notaLocal.tipo ?? ''}`}>
                  <span className="speaker">NELTUME</span>
                  <p>{notaLocal.texto}</p>
                </div>
              )}
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
                        const numero = numeroCotizacion(opcion.numero);
                        const fecha = fechaCorta(opcion.fecha);
                        const total = totalesOpciones[opcion.id];
                        const cliente = opcion.cliente || SIN_CLIENTE;
                        const detalle = [fecha, opcion.proyecto, opcion.comuna, opcion.detalle].filter(
                          Boolean,
                        );
                        return (
                          <button
                            type="button"
                            key={opcion.id}
                            disabled={ocupado}
                            onClick={() => elegirReferencia(opcion)}
                            aria-label={[
                              `Elegir cotización ${numero} de ${cliente}`,
                              etiquetaEstado[opcion.estado].toLowerCase(),
                              total !== undefined && `total ${pesos(total)}`,
                              ...detalle,
                            ]
                              .filter(Boolean)
                              .join(', ')}
                          >
                            <span className="reference-top">
                              <strong>
                                {numero} · {cliente}
                              </strong>
                              <span className={`status ${opcion.estado}`}>
                                {etiquetaEstado[opcion.estado]}
                              </span>
                              {total !== undefined && <span className="reference-total">{pesos(total)}</span>}
                            </span>
                            <small>{detalle.join(' · ')}</small>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className="reference-ninguna"
                        disabled={ocupado}
                        onClick={descartarSeleccion}
                      >
                        Ninguna de estas · es una cotización nueva
                      </button>
                    </div>
                  </div>
                </>
              )}
              {enCurso === 'chat' && (
                <div className="thinking">
                  Preparando los detalles
                  <span className="puntos" aria-hidden>
                    <span>·</span>
                    <span>·</span>
                    <span>·</span>
                  </span>
                </div>
              )}
            </div>
            {/* Región viva separada: anuncia solo la última respuesta del asistente. */}
            <p className="sr-only" aria-live="polite" aria-atomic="true">
              {enCurso === 'chat' ? 'Preparando los detalles…' : anuncio}
            </p>
            {!configurado && (
              <p className="notice" id="aviso-asistente">
                {SIN_ASISTENTE}
              </p>
            )}
            {actual && (
              <button
                type="button"
                className="jump-to-quote"
                onClick={() => {
                  setVistaMobile('cotizacion');
                  requestAnimationFrame(() => {
                    titulo.current?.scrollIntoView({ behavior: comportamientoScroll(), block: 'start' });
                    titulo.current?.focus({ preventScroll: true });
                  });
                }}
              >
                Ver cotización <span aria-hidden>↓</span>
              </button>
            )}
            <form onSubmit={enviar} className="composer">
              {textoConservado && (
                <div className="composer-retained" id="texto-conservado">
                  <span>Este texto venía de la cotización anterior. Revísalo antes de enviarlo.</span>
                  <button
                    type="button"
                    onClick={() => {
                      setMensaje('');
                      setTextoConservado(false);
                      input.current?.focus();
                    }}
                  >
                    Borrar texto
                  </button>
                </div>
              )}
              <label className="sr-only" htmlFor="mensaje">
                Escribe tu pedido
              </label>
              <textarea
                ref={input}
                id="mensaje"
                value={mensaje}
                onChange={(e) => {
                  setMensaje(e.target.value);
                  setTextoConservado(false);
                }}
                placeholder={
                  !configurado
                    ? 'El chat no está disponible por ahora.'
                    : bloqueada
                      ? `Cotización ${etiquetaEstado[actual!.estado].toLowerCase()}: no admite cambios. Duplícala o crea una nueva.`
                      : seleccion
                        ? 'Elige una de las cotizaciones de arriba.'
                        : estadoChat
                          ? `Escribe un cambio: se creará una revisión de la ${numeroCotizacion(actual!.numero)}.`
                          : 'Escribe el pedido o agrega un detalle…'
                }
                disabled={composerDeshabilitado}
                rows={3}
                maxLength={LIMITE}
                aria-describedby={
                  [ayudaCompositor, textoConservado && 'texto-conservado'].filter(Boolean).join(' ') ||
                  undefined
                }
                onKeyDown={enterEnvia}
              />
              <div className="composer-bottom">
                <span className="solo-escritorio">Enter para enviar · ⇧ Enter para nueva línea</span>
                <span className="solo-tactil">Usa «Enviar» para mandar el mensaje</span>
                {mensaje.length >= AVISO_LIMITE && (
                  <span id="contador" className={`contador ${mensaje.length >= LIMITE ? 'limite' : ''}`}>
                    {mensaje.length.toLocaleString('es-CL')} / {LIMITE.toLocaleString('es-CL')} caracteres
                  </span>
                )}
                <span className="composer-botones">
                  {enCurso === 'chat' && (
                    <button type="button" className="cancelar" onClick={() => abortar.current?.abort()}>
                      Cancelar
                    </button>
                  )}
                  <button
                    type="submit"
                    aria-label="Enviar mensaje"
                    disabled={!mensaje.trim() || composerDeshabilitado}
                  >
                    Enviar <span aria-hidden>→</span>
                  </button>
                </span>
              </div>
            </form>
          </div>
        </section>
        <CotizacionPanel
          asistente={configurado}
          actual={actual}
          enCurso={enCurso}
          guardando={guardando}
          descargando={descargando}
          acciones={acciones}
          tituloRef={titulo}
          agregarProducto={() => setAgregandoProducto(true)}
          mostrarCotizacion={() => setVistaMobile('cotizacion')}
          cargando={cargando}
          cambioVisual={cambioVisual?.id === actual?.id ? cambioVisual : null}
        />
      </main>
      <footer className="site-footer">
        <span>
          NELTUME <span className="muted">/ Hecho en madera.</span>
        </span>
        <span>Asistente de cotizaciones · Uso interno</span>
      </footer>
      <Avisos avisos={avisos} cerrar={cerrarAviso} />
      {agregandoProducto && (
        <AgregarProducto
          alCerrar={() => setAgregandoProducto(false)}
          agregar={agregarProducto}
          ocupado={ocupado}
        />
      )}
      {confirmacion}
      {dialogoAprobacion}
      {dialogoAnulacion}
      {dialogoAnulacionPago}
      {dialogoEmision}
    </div>
  );
}

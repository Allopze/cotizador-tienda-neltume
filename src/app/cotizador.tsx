'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  numeroNota,
  nombreFabrica,
  anticipoMinimo,
  esEditable,
  etiquetaEstado,
  puedeAnular,
  sumarCharla,
  type Cotizacion,
  type Despacho,
  type Mensaje,
} from '@/negocio/estado';
import type { SolicitudItem } from '@/catalogo/tipos';
import { pesos } from '@/negocio/precios';
import { ANTICIPO_TEXTO } from '@/negocio/limites';
import type { OpcionCotizacion } from '@/servidor/referencias';
import { CotizacionPanel, descripcionItem, type AccionesPanel, type Operacion } from './cotizacion-panel';
import { Encabezado } from './encabezado';
import { antesDeNavegar, useScrollRecordado } from './memoria-pantalla';
import { Avisos, useAvisos } from './avisos';
import { TextoMensaje } from './texto-mensaje';
import { falloCompartir } from './compartir';
import { PreguntasPendientes } from './preguntas-pendientes';
import { preguntasPendientes } from '@/negocio/pendientes';
import { AgregarProducto } from './agregar-producto';
import { CamposAbiertosContext, type RegistroCamposAbiertos } from './campo-editable';
import { useAvisoSalida } from './secciones-pantalla';
import { useConfirmacion } from './dialogo';
import { useAnulacion, useAnulacionPago, useAprobacion, useEmision } from './dialogos-cotizacion';
import type { AccionesDocumentos } from './panel-totales';
import type {
  CambiosEdicion,
  Despacho as CambiosDespacho,
  Detalle,
  ProductoElegido,
  ProductoPersonalizadoElegido,
  Resultado,
} from './contrato';
import {
  SIN_CLIENTE,
  comportamientoScroll,
  copiarTexto,
  enterEnvia,
  fechaCorta,
  fechaLarga,
  medidaPedida,
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
  urlSesionExpirada,
  documentoDisponible,
  esSilencioso,
  guardarArchivo,
  guardarBorrador,
  leerAbierta,
  leerBorrador,
  tomarAvisoAlAbrir,
  mensajeDe,
  pedirArchivo,
  pedirJSON,
  recordarAbierta,
} from './solicitud';
import { guardarDiagnosticoIA } from './diagnostico-ia';

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
/** Avisos de ediciones directas (no del chat) de la cotización abierta; duran hasta el próximo mensaje. */
interface AvisosLocales {
  id: string;
  textos: string[];
}
const MAX_AVISOS_LOCALES = 6;
/** Pantalla táctil: ahí una descarga sin gesto abre un diálogo del sistema (iOS) en vez de guardar. */
const esTactil = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
const urlDocumento = (archivo: string, ver = false) =>
  `/api/documento/${encodeURIComponent(archivo)}${ver ? '?ver=1' : ''}`;
interface HistorialEdicion {
  id: string | null;
  version: string | null;
  deshacer: SolicitudItem[][];
  rehacer: SolicitudItem[][];
}
interface EstadoHistorialEdicion {
  id: string | null;
  deshacer: number;
  rehacer: number;
}
const MAX_ACCIONES_HISTORIAL = 30;

/** Id propuesto para el borrador que cree el próximo mensaje (sin contexto seguro no hay UUID). */
const idNuevo = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : undefined;

export function Cotizador({
  email,
  nombre,
  admin,
  abrirId,
}: {
  email: string;
  nombre: string;
  /** Cuenta administradora: número manual al emitir y regenerar un PDF perdido. */
  admin: boolean;
  /** Cotización pedida por URL (`/?cotizacion=…`), p. ej. desde el historial. */
  abrirId: string | null;
}) {
  const router = useRouter();
  const [actual, setActual] = useState<Cotizacion | null>(null);
  const actualRef = useRef(actual);
  const historialEdicion = useRef<HistorialEdicion>({ id: null, version: null, deshacer: [], rehacer: [] });
  const [estadoHistorialEdicion, setEstadoHistorialEdicion] = useState<EstadoHistorialEdicion>({
    id: null,
    deshacer: 0,
    rehacer: 0,
  });
  function publicarHistorialEdicion(historial: HistorialEdicion) {
    historialEdicion.current = historial;
    setEstadoHistorialEdicion({
      id: historial.id,
      deshacer: historial.deshacer.length,
      rehacer: historial.rehacer.length,
    });
  }
  function vaciarHistorialEdicion(id: string | null = null) {
    publicarHistorialEdicion({ id, version: null, deshacer: [], rehacer: [] });
  }
  function registrarCambioItems(anterior: Cotizacion, siguiente: Cotizacion) {
    if (JSON.stringify(anterior.solicitudes) === JSON.stringify(siguiente.solicitudes)) return;
    const vigente = historialEdicion.current;
    const base = vigente.id === anterior.id
      ? vigente
      : { id: anterior.id, version: anterior.actualizada, deshacer: [], rehacer: [] };
    publicarHistorialEdicion({
      id: siguiente.id,
      version: siguiente.actualizada,
      deshacer: [...base.deshacer, structuredClone(anterior.solicitudes)].slice(-MAX_ACCIONES_HISTORIAL),
      rehacer: [],
    });
  }
  useEffect(() => {
    actualRef.current = actual;
  }, [actual]);
  const [asistentePreferencia, setAsistentePreferencia] = useState<{
    id: string | null;
    contraido: boolean;
  } | null>(null);
  const asistenteContraido =
    asistentePreferencia && asistentePreferencia.id === actual?.id
      ? asistentePreferencia.contraido
      : actual?.estado === 'aprobada';
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
  /** Id de la copia que creará el próximo «Duplicar»; sobrevive a un reintento para no crear dos (BUG-047). */
  const duplicadoPendiente = useRef<{ origen: string; nuevoId: string } | null>(null);
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null);
  /** Totales de las opciones en selección: se leen aparte, el asistente nunca recibe montos. */
  const [totalesOpciones, setTotalesOpciones] = useState<Record<string, number>>({});
  const [notaLocal, setNotaLocal] = useState<NotaLocal | null>(null);
  const [avisosLocales, setAvisosLocales] = useState<AvisosLocales | null>(null);
  const [anuncio, setAnuncio] = useState('');
  const [restaurando, setRestaurando] = useState(true),
    [configurado, setConfigurado] = useState(true);
  const [enfocar, setEnfocar] = useState(0);
  const { avisos, avisar, cerrar: cerrarAviso, limpiar, limpiarInformativos } = useAvisos();
  const [confirmar, confirmacion] = useConfirmacion();
  const [pedirAprobacion, dialogoAprobacion] = useAprobacion();
  const [pedirAnulacion, dialogoAnulacion] = useAnulacion();
  const [pedirAnulacionPago, dialogoAnulacionPago] = useAnulacionPago();
  const [pedirEmision, dialogoEmision] = useEmision();
  // Campos del detalle abiertos con cambios sin guardar: se avisa al emitir y al salir de la pantalla
  // (auditoría BUG-011).
  const camposSucios = useRef(new Set<string>());
  const [camposSinGuardar, setCamposSinGuardar] = useState(0);
  const registroCampos = useMemo<RegistroCamposAbiertos>(
    () => ({
      registrar: (id, sucio) => {
        const estaba = camposSucios.current.has(id);
        if (sucio === estaba) return;
        if (sucio) camposSucios.current.add(id);
        else camposSucios.current.delete(id);
        setCamposSinGuardar(camposSucios.current.size);
      },
      quitar: (id) => {
        if (camposSucios.current.delete(id)) setCamposSinGuardar(camposSucios.current.size);
      },
    }),
    [],
  );
  useAvisoSalida(camposSinGuardar > 0, 'Hay datos escritos sin guardar en la cotización. ¿Salir de todos modos?');
  const mensajes = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    workspace = useRef<HTMLElement>(null),
    titulo = useRef<HTMLHeadingElement>(null);
  const abortar = useRef<AbortController | null>(null);
  /** PDF ya bajado para compartir: si la descarga tardó, el navegador exige un toque nuevo para la hoja. */
  const paraCompartir = useRef<{ archivo: string; pdf: File } | null>(null);
  const ocupado = enCurso !== null;
  const ocupadoRef = useRef(false);
  const volverAlCompositor = useRef(false);
  useEffect(() => {
    ocupadoRef.current = ocupado;
  }, [ocupado]);
  // Al salir de la pantalla se corta la espera del chat: la respuesta ya no tendría dónde mostrarse.
  useEffect(() => () => abortar.current?.abort(), []);

  // La cotización pedida por URL. Limpiar la URL con el router vuelve a pedir la página, que llega sin
  // `cotizacion`: se sigue con la pedida en vez de reiniciar la carga, que abortaba la apertura en curso y hacía
  // un segundo viaje al servidor (con la sesión vencida, ese viaje llevaba al login).
  const [pedidaPorUrl, setPedidaPorUrl] = useState(abrirId);
  if (abrirId && abrirId !== pedidaPorUrl) setPedidaPorUrl(abrirId);

  const cargando = restaurando;
  // Al volver desde otra pantalla, el cotizador sigue a la misma altura. Si llega una cotización pedida
  // por URL (desde el historial), en cambio, la vista va a esa cotización.
  useScrollRecordado('cotizar', !cargando, !pedidaPorUrl);

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
      if (forzar || !ocupadoRef.current) {
        const previa = actualRef.current;
        if (previa?.id === id && previa.actualizada !== q.actualizada) {
          historialEdicion.current = { id, version: null, deshacer: [], rehacer: [] };
          setEstadoHistorialEdicion({ id, deshacer: 0, rehacer: 0 });
        }
        setActual((prev) => (prev?.id === id ? q : prev));
      }
      return q;
    },
    [leerDetalle],
  );

  // Carga inicial: parte en «Nueva cotización» (no abre la última de otra persona). Reabre, en este
  // orden, la pedida por URL, el borrador de esta pestaña o la que quedó abierta al ir a otra pantalla.
  useEffect(() => {
    const control = new AbortController();
    const b = leerBorrador();
    const id = pedidaPorUrl ?? b?.id ?? leerAbierta();
    const fin = () => {
      if (!control.signal.aborted) setRestaurando(false);
    };
    // El router (y no `history.replaceState`) deja la URL y la pantalla en el mismo estado: Atrás vuelve a donde
    // corresponde (auditoría BUG-055).
    if (pedidaPorUrl) router.replace('/', { scroll: false });
    Promise.resolve()
      .then(async () => {
        // Lo escrito se conserva aunque se abra otra cotización desde el historial, señalado como de la anterior.
        if (b?.texto.trim()) {
          setMensaje(b.texto);
          if (pedidaPorUrl && b.id !== pedidaPorUrl) setTextoConservado(true);
        }
        if (id) {
          const q = await leerDetalle(id, control.signal);
          setActual(q);
          if (q.estado === 'aprobada') setVistaMobile('cotizacion');
          const aviso = pedidaPorUrl && !control.signal.aborted ? tomarAvisoAlAbrir(q.id) : null;
          if (aviso) avisar('info', aviso);
        }
        if (pedidaPorUrl) setEnfocar((n) => n + 1);
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
  }, [leerDetalle, avisar, pedidaPorUrl, router]);

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
            fn: () => window.location.replace(urlSesionExpirada()),
          },
        });
      }),
    [avisar],
  );

  // Solo se desplaza el contenedor de mensajes (no la ventana) cuando llega algo nuevo.
  const largoHistorial = actual?.historial.length ?? 0;
  const largoAnterior = useRef({ id: actualId, largo: largoHistorial });
  useEffect(() => {
    const el = mensajes.current;
    if (!el) return;
    const anterior = largoAnterior.current;
    largoAnterior.current = { id: actualId, largo: largoHistorial };
    if (el.scrollHeight > el.clientHeight + 1) {
      el.scrollTo({ top: el.scrollHeight, behavior: comportamientoScroll() });
      return;
    }
    // En móvil la conversación no tiene scroll propio (el de la página basta): si llegó una respuesta a la
    // misma cotización, se acerca el último mensaje sin mover la página al abrir otra.
    if (anterior.id === actualId && largoHistorial > anterior.largo)
      el.lastElementChild?.scrollIntoView({ behavior: comportamientoScroll(), block: 'nearest' });
  }, [actualId, largoHistorial, seleccion, notaLocal, avisosLocales, charla]);

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
    vaciarHistorialEdicion(q.id);
    setActual(q);
    setSeleccion(null);
    setNotaLocal(null);
    setAvisosLocales(null);
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
    // Otra emisión de esta misma cotización (otra pestaña o un doble toque) o una operación que tiene el almacén:
    // no es una falla. Se informa y se ofrece actualizar cuando termine, sin recargar a media emisión.
    if (codigo === 'ocupado') {
      avisar('info', mensajeDe(e), {
        clave: 'operacion',
        ...(q
          ? { accion: { etiqueta: 'Actualizar', fn: () => void recargarActual(q.id, true).catch((x) => fallo(x, null)) } }
          : {}),
      });
      return;
    }
    if (codigo === 'version_obsoleta') {
      // Un solo mensaje: el del servidor ya pide revisar y reintentar, y aquí se dice además que se recargó.
      avisar('error', 'La cotización cambió mientras la tenías abierta. Se cargó la versión actual: revísala y vuelve a intentarlo.', {
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
  function recibir(
    d: Resultado,
    opciones: { anunciar?: boolean; previa?: Cotizacion | null; sinHistorial?: boolean } = {},
  ) {
    const q = d.cotizacion,
      previa = opciones.previa ?? actual;
    if (d.efimera) {
      // Sin pedido todavía: se muestra el intercambio, pero no se abre un borrador vacío.
      setActual(null);
      setCharla((c) => sumarCharla(c, q.historial));
      if (d.avisos?.length) avisar('info', d.avisos.join(' '));
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
      setAvisosLocales(null);
      vaciarHistorialEdicion(null);
    } else {
      if (!previa || previa.id !== q.id) vaciarHistorialEdicion(q.id);
      else if (opciones.sinHistorial) {
        const historial = historialEdicion.current;
        if (historial.id === q.id) publicarHistorialEdicion({ ...historial, version: q.actualizada });
      } else if (JSON.stringify(previa.solicitudes) !== JSON.stringify(q.solicitudes)) registrarCambioItems(previa, q);
      else {
        const historial = historialEdicion.current;
        if (historial.id === q.id) publicarHistorialEdicion({ ...historial, version: q.actualizada });
      }
      setActual(q);
      if (q.estado === 'aprobada') setVistaMobile('cotizacion');
    }
    if (d.avisos?.length) avisar('info', d.avisos.join(' '));
    // Los de una edición directa quedan además como nota en la conversación: el aviso dura 7 s. Se omiten los
    // que el servidor ya dejó en el historial (p. ej. una revisión desvinculada).
    const nuevos = opciones.anunciar || d.eliminada ? [] : (d.avisos ?? []).filter((a) => !q.historial.some((m) => m.texto === a));
    if (nuevos.length)
      setAvisosLocales((v) => ({
        id: q.id,
        textos: [...(v?.id === q.id ? v.textos.filter((t) => !nuevos.includes(t)) : []), ...nuevos].slice(-MAX_AVISOS_LOCALES),
      }));
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
    setNotaLocal(cambios ? { id: q.id, texto: `${cambios}.`, tipo: 'cambios' } : null);
    const ultimo = q.historial.at(-1);
    if (opciones.anunciar && ultimo?.rol === 'asistente')
      setAnuncio(cambios ? `${ultimo.texto} ${cambios}` : ultimo.texto);
    // Una descarga por acción: varias seguidas el navegador las bloquea o pide permiso. Las demás notas quedan
    // junto al total, y el aviso de la descarga lo dice (solo se ve un aviso informativo a la vez).
    if (d.archivo)
      entregarDocumento(
        d.archivo,
        d.archivos && d.archivos.length > 1
          ? `Se generaron ${d.archivos.length} notas de pedido, una por fábrica: las demás se descargan junto al total.`
          : undefined,
      );
  }

  /**
   * PDF recién generado (emisión, nota de pedido): en escritorio se descarga; en una pantalla táctil una
   * descarga sin gesto abre un diálogo del sistema, así que se ofrece abrirlo con un toque.
   */
  function entregarDocumento(archivo: string, detalle?: string) {
    if (!esTactil()) return void descargar(archivo, false, detalle);
    avisar('exito', `PDF listo: ${archivo}. ${detalle ?? 'También queda junto al total para verlo, descargarlo o compartirlo.'}`, {
      clave: 'descarga',
      accion: {
        etiqueta: 'Ver PDF',
        fn: () => {
          if (!ver(archivo)) void descargar(archivo);
        },
      },
    });
  }

  function nuevaCotizacion() {
    if (ocupado) return;
    // El borrador se crea recién con el primer mensaje: evita acumular cotizaciones vacías.
    // El texto escrito se conserva, pero se señala que venía de otra conversación.
    setTextoConservado(!!mensaje.trim() && (!!actual || charla.length > 0 || !!seleccion));
    vaciarHistorialEdicion(null);
    setActual(null);
    setAsistentePreferencia(null);
    setVistaMobile('pedido');
    setCambioVisual(null);
    setSeleccion(null);
    setNotaLocal(null);
    setAvisosLocales(null);
    setCharla([]);
    idPendiente.current = null;
    limpiar('operacion');
    // «Documento listo…» y similares eran de la cotización anterior y tapaban el compositor vacío.
    limpiarInformativos();
    input.current?.focus();
  }

  /** `reintento`: ya se regeneró una vez; un segundo 404 se informa sin volver a ofrecerlo. */
  async function descargar(archivo: string, reintento = false, detalle?: string) {
    setDescargando(archivo);
    try {
      const { blob, nombre } = await pedirArchivo(urlDocumento(archivo));
      guardarArchivo(blob, nombre ?? archivo);
      avisar('exito', `Documento listo: se descargó ${nombre ?? archivo}.${detalle ? ` ${detalle}` : ''}`, { clave: 'descarga' });
    } catch (e) {
      if (reintento || !(e instanceof ErrorSolicitud && e.status === 404)) return fallo(e);
      setDescargando(null);
      const recuperado = await recuperarPdf(archivo);
      if (recuperado) await descargar(recuperado, true);
    } finally {
      setDescargando(null);
    }
  }

  /**
   * El PDF emitido ya no está en el servidor (respaldo incompleto, disco cambiado): una cuenta administradora lo
   * regenera con lo guardado al emitir; las demás reciben a quién pedírselo. Devuelve el archivo o null.
   */
  async function recuperarPdf(archivo: string) {
    const q = actualRef.current;
    const nota = q?.notas.find((n) => n.pdf === archivo);
    const documento = !q ? null : nota ? 'nota' : q.pdf === archivo ? 'cotizacion' : null;
    if (!q || !documento || !admin) {
      avisar(
        'error',
        `No se encontró el PDF en el servidor.${admin ? '' : ' Pide a una cuenta administradora que lo regenere.'}`,
        { clave: 'descarga' },
      );
      return null;
    }
    const ok = await confirmar({
      titulo: 'No se encontró el PDF',
      mensaje: (
        <p>
          El archivo de {nota ? `la nota de pedido ${numeroNota(nota)}` : `la cotización ${numeroCotizacion(q.numero)}`}{' '}
          ya no está en el servidor. Se puede regenerar con los mismos datos con que se emitió.
        </p>
      ),
      aceptar: 'Regenerar PDF',
    });
    if (!ok || ocupadoRef.current) return null;
    setEnCurso('workflow');
    limpiar('operacion');
    try {
      const { archivo: regenerado, ...d } = await peticion({
        tipo: 'regenerar_pdf',
        id: q.id,
        ...versionDe(q),
        documento,
        ...(nota?.fabrica ? { fabrica: nota.fabrica } : {}),
      });
      recibir(d, { previa: q });
      avisar('exito', 'PDF regenerado.', { clave: 'descarga' });
      return regenerado ?? archivo;
    } catch (e) {
      fallo(e, q);
      return null;
    } finally {
      setEnCurso(null);
    }
  }

  /**
   * Abre un PDF en otra pestaña comprobando antes que exista: la pestaña se abre ya, dentro del toque (abrirla
   * después de la comprobación la bloquearía el navegador), y se cierra si falta el archivo. Falso si el
   * navegador no la abrió: quien llama sigue el enlace normal.
   */
  function ver(archivo: string) {
    const pestana = window.open('', '_blank');
    if (!pestana) return false;
    pestana.opener = null;
    documentoDisponible(urlDocumento(archivo, true))
      .then(async (existe) => {
        if (existe) return pestana.location.replace(urlDocumento(archivo, true));
        pestana.close();
        // Se reintenta como descarga: otra pestaña ya no sería parte del toque.
        const recuperado = await recuperarPdf(archivo);
        if (recuperado) await descargar(recuperado, true);
      })
      .catch((e) => {
        pestana.close();
        fallo(e);
      });
    return true;
  }

  async function compartir(archivo: string) {
    const listo = paraCompartir.current?.archivo === archivo ? paraCompartir.current.pdf : null;
    let pdf = listo;
    if (!pdf) {
      setDescargando(archivo);
      try {
        const { blob, nombre } = await pedirArchivo(urlDocumento(archivo));
        pdf = new File([blob], nombre ?? archivo, { type: 'application/pdf' });
        paraCompartir.current = { archivo, pdf };
      } catch (e) {
        if (e instanceof ErrorSolicitud && e.status === 404) {
          setDescargando(null);
          const recuperado = await recuperarPdf(archivo);
          if (recuperado) avisar('info', 'PDF regenerado: toca «Compartir» para enviarlo.', {
            clave: 'descarga',
            accion: { etiqueta: 'Compartir', fn: () => void compartir(recuperado) },
          });
        } else fallo(e);
        return;
      } finally {
        setDescargando(null);
      }
    }
    try {
      await navigator.share({ files: [pdf], title: pdf.name });
    } catch (e) {
      const respuesta = falloCompartir(e, !!listo);
      if (respuesta.tipo === 'otro_toque')
        avisar('info', respuesta.texto, {
          clave: 'descarga',
          accion: { etiqueta: 'Compartir', fn: () => void compartir(archivo) },
        });
      else if (respuesta.tipo === 'error') avisar('error', respuesta.texto, { clave: 'descarga' });
    }
  }
  const accionesDocumentos: AccionesDocumentos = {
    ver,
    compartir: (archivo) => void compartir(archivo),
    // Solo el PDF vigente: el de una reemplazada o anulada ya no es lo que se ofrece al cliente.
    compartible: actual && (actual.estado === 'emitida' || actual.estado === 'aprobada') ? actual.pdf : null,
  };

  /** Ejecuta una acción sobre la cotización abierta con su versión (`actualizada`). */
  async function ejecutar(
    op: Operacion,
    cuerpo: Record<string, unknown>,
    q = actual,
    opciones: { sinHistorial?: boolean } = {},
  ) {
    if (!q) return false;
    setEnCurso(op);
    limpiar('operacion');
    try {
      recibir(await peticion({ ...cuerpo, id: q.id }), { previa: q, ...opciones });
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

  async function aplicarHistorial(direccion: 'deshacer' | 'rehacer') {
    const q = actual;
    const historial = historialEdicion.current;
    if (!q || ocupado || historial.id !== q.id || historial.version !== q.actualizada) return false;
    const pila = direccion === 'deshacer' ? historial.deshacer : historial.rehacer;
    const objetivo = pila.at(-1);
    if (!objetivo) return false;
    const actualGuardado = structuredClone(q.solicitudes);
    const ok = await ejecutar(
      'editar',
      { tipo: 'restaurar_items', ...versionDe(q), items: structuredClone(objetivo) },
      q,
      { sinHistorial: true },
    );
    if (!ok) return false;
    const actualizada = historialEdicion.current;
    publicarHistorialEdicion({
      id: q.id,
      version: actualizada.version,
      deshacer:
        direccion === 'deshacer'
          ? actualizada.deshacer.slice(0, -1)
          : [...actualizada.deshacer, actualGuardado].slice(-MAX_ACCIONES_HISTORIAL),
      rehacer:
        direccion === 'deshacer'
          ? [...actualizada.rehacer, actualGuardado].slice(-MAX_ACCIONES_HISTORIAL)
          : actualizada.rehacer.slice(0, -1),
    });
    return true;
  }

  const acciones: AccionesPanel = {
    puedeDeshacer: estadoHistorialEdicion.id === actual?.id && estadoHistorialEdicion.deshacer > 0,
    puedeRehacer: estadoHistorialEdicion.id === actual?.id && estadoHistorialEdicion.rehacer > 0,
    deshacer: () => aplicarHistorial('deshacer'),
    rehacer: () => aplicarHistorial('rehacer'),
    async reordenar(desde, hasta) {
      const q = actual;
      if (!q || ocupado) return false;
      return ejecutar('reordenar', { tipo: 'reordenar', desde, hasta, ...versionDe(q) }, q);
    },
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
      const emision = await pedirEmision({
        total: q.montos.total,
        reemplaza: q.origen,
        numeroManual: admin,
        cliente: q.cliente.nombre,
        camposSueltos: camposSinGuardar,
        productos: q.montos.lineas.map((linea, i) => ({
          nombre: descripcionItem(q, linea.indice ?? i),
          medida: medidaPedida(linea),
        })),
      });
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
            ¿Eliminar este borrador{q.cliente.nombre ? ` de ${q.cliente.nombre}` : ''}? Sale del historial con
            su conversación y sus ítems, y pasa a la papelera: puedes deshacerlo desde el aviso o restaurarlo en
            Historial → Papelera.
          </p>
        ),
        aceptar: 'Eliminar borrador',
      });
      // La papelera guarda el borrador con la versión que tenía: con ella se restaura.
      if (ok && (await ejecutar('eliminar', { tipo: 'eliminar', ...versionDe(q) }, q)))
        avisar('exito', 'Borrador eliminado: quedó en la papelera.', {
          clave: 'papelera',
          accion: { etiqueta: 'Deshacer', fn: () => void restaurarBorrador(q.id, q.actualizada) },
        });
    },
    async anular() {
      const q = actual;
      if (!q || ocupado) return;
      // La misma regla que aplica el servidor: no se pide el motivo de algo que igual se rechazaría.
      const anulable = puedeAnular(q);
      if (!anulable.ok) {
        avisar('error', anulable.motivo, { clave: 'operacion' });
        return;
      }
      const datos = await pedirAnulacion(q.numero, q.estado === 'aprobada', anulable.pagado);
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
        q.notas.length > 0 &&
        ['pedido_generado', 'en_produccion'].includes(q.estadoOperativo ?? '') &&
        restante < minimo;
      const datos = await pedirAnulacionPago({
        monto: pesos(pago.monto),
        fecha: fechaLarga(pago.fecha),
        ...(frenaProduccion
          ? {
              aviso: `${q.notas.length > 1 ? 'Las notas de pedido ya están generadas' : 'La nota de pedido ya está generada'} y quedarían ${pesos(restante)} pagados, menos del ${ANTICIPO_TEXTO} (${pesos(minimo)}): la producción no podrá ${q.estadoOperativo === 'pedido_generado' ? 'iniciarse' : 'terminarse'} hasta volver a registrar el anticipo.`,
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
      // Una emitida solo se edita tras «Modificar», cuyo aviso ya explica que el cambio va a una revisión y el PDF
      // se conserva: no se vuelve a confirmar en cada campo.
      if (!q || ocupado) return false;
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

  const agregarProducto = (producto: ProductoElegido) => agregarItem({ tipo: 'agregar_producto', ...producto });
  /** Fuera de catálogo: queda solo en esta cotización, con sus referencias del cliente. */
  const agregarPersonalizado = (item: ProductoPersonalizadoElegido) =>
    agregarItem({ tipo: 'agregar_personalizado', item });

  async function agregarItem(accion: Record<string, unknown>) {
    if (ocupado) return false;
    const q = actual;
    setEnCurso('editar');
    limpiar('operacion');
    try {
      const d = await peticion({
        ...accion,
        ...(q ? { id: q.id, ...versionDe(q) } : {}),
      });
      recibir(d, { previa: q });
      setAgregandoProducto(false);
      setVistaMobile('cotizacion');
      // El ítem nuevo queda al final del detalle: se lleva a la vista (el aviso solo no decía dónde quedó).
      const ultimo = d.cotizacion.solicitudes.length - 1;
      requestAnimationFrame(() =>
        document
          .getElementById(`producto-${ultimo}`)
          ?.scrollIntoView({ behavior: comportamientoScroll(), block: 'center' }),
      );
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
    // El mismo id en un reintento: el servidor devuelve la copia que ya creó en vez de duplicarla.
    if (duplicadoPendiente.current?.origen !== id) {
      const nuevoId = idNuevo();
      duplicadoPendiente.current = nuevoId ? { origen: id, nuevoId } : null;
    }
    try {
      const d = await peticion({ tipo: 'duplicar', id, ...(duplicadoPendiente.current ? { nuevoId: duplicadoPendiente.current.nuevoId } : {}) });
      duplicadoPendiente.current = null;
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

  /**
   * «Deshacer» del aviso de borrador eliminado: lo saca de la papelera y lo abre. Se llama desde un aviso que
   * pudo quedar abierto un rato: solo lee estado por referencias.
   */
  async function restaurarBorrador(id: string, actualizada: string) {
    if (ocupadoRef.current) return;
    setEnCurso('eliminar');
    limpiar('operacion');
    try {
      recibir(await peticion({ tipo: 'restaurar_borrador', id, actualizada }));
      setSeleccion(null);
      setVistaMobile('cotizacion');
      setEnfocar((n) => n + 1);
      avisar('exito', 'Borrador restaurado.', { clave: 'papelera' });
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

  /** Cambio de número pedido por chat: se confirma aquí y se aplica con `cambiar_numero`, como desde el documento. */
  async function cambiarNumeroDesdeChat(c: NonNullable<Resultado['confirmarNumero']>, conversacion: Cotizacion) {
    const documento =
      c.documento === 'cotizacion'
        ? `la cotización N° ${c.actual}`
        : `la nota de pedido N° ${c.actual}${c.fabrica ? ` de ${nombreFabrica[c.fabrica]}` : ''}`;
    const ok = await confirmar({
      titulo: `¿Cambiar el número de ${documento}?`,
      mensaje: (
        <p>
          Pasa a ser la N° {c.numero.toLocaleString('es-CL')}. Su PDF se vuelve a generar con el número nuevo y el
          cambio queda en la actividad.
        </p>
      ),
      aceptar: `Cambiar a N° ${c.numero.toLocaleString('es-CL')}`,
    });
    // Se llama dentro del envío del chat (que sigue «en curso»), igual que la aprobación pedida por chat.
    if (!ok) {
      setNotaLocal({ id: conversacion.id, texto: 'Cambio de número cancelado.' });
      return;
    }
    setEnCurso('workflow');
    limpiar('operacion');
    try {
      // Trae el PDF con el número nuevo: se descarga como al emitir, y ese aviso confirma el cambio.
      recibir(
        await peticion({
          tipo: 'cambiar_numero',
          id: c.id,
          actualizada: c.actualizada,
          documento: c.documento,
          ...(c.fabrica ? { fabrica: c.fabrica } : {}),
          numero: c.numero,
        }),
      );
    } catch (e) {
      fallo(e);
    } finally {
      setEnCurso(null);
    }
  }

  async function responder(d: Resultado, previa: Cotizacion | null) {
    recibir(d, { anunciar: true, previa });
    if (d.confirmar) await aprobarDesdeChat(d.confirmar, d.cotizacion, !!d.efimera);
    if (d.confirmarNumero) await cambiarNumeroDesdeChat(d.confirmarNumero, d.cotizacion);
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const texto = mensaje;
    if (!texto.trim() || ocupado || bloqueada || !configurado || seleccion) return;
    const control = new AbortController();
    abortar.current = control;
    setEnCurso('chat');
    setNotaLocal(null);
    setAvisosLocales(null);
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
      guardarDiagnosticoIA(d);
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
      // Sin red, el texto sigue en el compositor: el aviso ofrece reenviarlo con un toque.
      if (codigoDe(e) === 'red')
        avisar('error', mensajeDe(e), {
          clave: 'operacion',
          accion: { etiqueta: 'Reintentar', fn: () => input.current?.form?.requestSubmit() },
        });
      else fallo(e, previa, nuevoId);
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
      guardarDiagnosticoIA(d);
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
    setAvisosLocales(null);
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
    // Igual que los enlaces del encabezado: no se sale con el chat esperando respuesta.
    if (abortar.current) return;
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

  // Reemplazadas y anuladas no admiten cambios (ni por chat). En una aprobada el chat solo reparte los ítems entre
  // fábricas y cambia números: lo demás lo responde el servidor.
  const bloqueada = !!actual && !esEditable(actual) && actual.estado !== 'aprobada';
  // Las preguntas con botones solo en un borrador: en una emitida, responder crearía una revisión.
  const preguntasChat = actual?.estado === 'borrador' ? preguntasPendientes(actual) : [];
  // Una pregunta en texto sigue abierta mientras no hay cotización o el borrador tiene datos faltantes.
  const preguntaAbierta = !actual || (actual.estado === 'borrador' && actual.incompletos.length > 0);
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
      ? `${numeroCotizacion(actual.numero)} emitida${actual.fechaEmision ? ` el ${fechaLarga(actual.fechaEmision)}` : ''}. Si escribes un cambio, se creará una revisión (una versión nueva en borrador que la reemplazará al emitirla) y este PDF se conserva.`
      : null;
  const mostrarNueva = !!actual || !!charla.length || !!seleccion;
  const aprobada = actual?.estado === 'aprobada';
  const pedidoOriginal = actual?.historial.find((m) => m.rol === 'usuario')?.texto;
  return (
    <div
      className={`app-shell pantalla-cotizador${actual ? ' con-pedido' : ''}${asistenteContraido ? ' asistente-contraido' : ''}${aprobada ? ' estado-aprobada' : ''}`}
    >
      <Encabezado
        email={email}
        nombre={nombre}
        pantalla="cotizar"
        alLogo={nuevaCotizacion}
        logoDeshabilitado={ocupado}
        navegacionBloqueada={enCurso === 'chat'}
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
          {aprobada ? 'Conversación' : 'Pedido'}
        </button>
        <button
          type="button"
          aria-pressed={vistaMobile === 'cotizacion'}
          aria-controls="panel-cotizacion"
          onClick={() => setVistaMobile('cotizacion')}
        >
          {aprobada ? 'Seguimiento' : 'Cotización'}{actual?.incompletos.length ? ` (${plural(actual.incompletos.length, 'pendiente')})` : ''}
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
            onClick={() => setAsistentePreferencia({ id: actual?.id ?? null, contraido: !asistenteContraido })}
          >
            {asistenteContraido
              ? aprobada ? 'Ver conversación →' : 'Abrir asistente →'
              : aprobada ? '← Contraer conversación' : '← Contraer asistente'}
          </button>
          {aprobada && asistenteContraido && (
            <button type="button" className="button secondary small chat-new-quote" onClick={nuevaCotizacion} disabled={ocupado || cargando}>
              + Nueva cotización
            </button>
          )}
          {aprobada && asistenteContraido && (
            <div className="chat-summary">
              <strong>Pedido original</strong>
              <p>{pedidoOriginal || 'La conversación del pedido está disponible para consultar.'}</p>
            </div>
          )}
          <div id="chat-contenido" className="chat-contenido">
            <div className="panel-heading">
              <div>
                <h2>{aprobada ? 'Conversación original' : 'Cuéntame el pedido'}</h2>
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
                  <div className="welcome-ayuda">
                    ¿Primera vez?{' '}
                    {/* Mientras el chat espera respuesta no se sale (igual que la cabecera): el borrador quedaría huérfano. */}
                    <Link
                      href="/ayuda"
                      scroll={false}
                      aria-disabled={enCurso === 'chat' || undefined}
                      onClick={enCurso === 'chat' ? (e) => e.preventDefault() : undefined}
                    >
                      Mira cómo funciona el cotizador
                    </Link>
                    : del pedido al PDF, la aprobación, el anticipo y el despacho.
                  </div>
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
                        // Solo la última pregunta, y solo si sigue abierta, ofrece botones: con la cotización emitida o
                        // sin datos faltantes, un toque al desplazarse reescribía un ítem ya resuelto.
                        elegir={
                          ultima && !conPreguntas && !composerDeshabilitado && preguntaAbierta
                            ? responderOpcion
                            : undefined
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
              {avisosLocales && avisosLocales.id === actualId && (
                <div className="message asistente local avisos-edicion" data-testid="avisos-locales">
                  <span className="speaker">NELTUME</span>
                  {avisosLocales.textos.map((t) => (
                    <p key={t}>{t}</p>
                  ))}
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
                Ver cotización <span aria-hidden>→</span>
              </button>
            )}
            {aprobada && (
              <p className="chat-readonly-note">
                Esta cotización está aprobada y no se modifica: duplícala si necesitas una nueva versión. Por chat
                puedes repartir sus ítems entre las fábricas o cambiar su número o el de sus notas de pedido.
              </p>
            )}
            {bloqueada && actual && (
              <div className="chat-readonly-note chat-bloqueada">
                <p>
                  Esta cotización está {etiquetaEstado[actual.estado].toLowerCase()} y no admite cambios.
                  {actual.estado === 'reemplazada' && actual.reemplazadaPor ? ` Modifica la N° ${actual.reemplazadaPor}.` : ''}
                </p>
                <button type="button" className="button secondary small" disabled={ocupado} onClick={() => acciones.duplicar()}>
                  Duplicar como cotización nueva
                </button>
              </div>
            )}
            <form onSubmit={enviar} className="composer" hidden={bloqueada}>
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
                      : actual?.estado === 'aprobada'
                        ? 'Cotización aprobada: puedes repartir sus ítems entre fábricas o cambiar un número.'
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
        <CamposAbiertosContext.Provider value={registroCampos}>
          <CotizacionPanel
            asistente={configurado}
            actual={actual}
            enCurso={enCurso}
            guardando={guardando}
            descargando={descargando}
            acciones={acciones}
            documentos={accionesDocumentos}
            tituloRef={titulo}
            agregarProducto={() => setAgregandoProducto(true)}
            mostrarCotizacion={() => setVistaMobile('cotizacion')}
            cargando={cargando}
            cambioVisual={cambioVisual?.id === actual?.id ? cambioVisual : null}
            admin={admin}
          />
        </CamposAbiertosContext.Provider>
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
          agregarPersonalizado={agregarPersonalizado}
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

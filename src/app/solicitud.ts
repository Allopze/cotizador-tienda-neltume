'use client';
// Único punto de acceso HTTP de la interfaz: interpreta estados, cuerpos no JSON y fallas de red
// para que ninguna pantalla muestre "Unexpected token '<'" ni "Failed to fetch".

export class ErrorSolicitud extends Error {
  constructor(
    message: string,
    public status: number,
    public codigo?: string,
    /** Datos extra del servidor, p. ej. `{ id }` en `revision_abierta` o `{ vence }` en `cotizacion_vencida`. */
    public detalle?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ErrorSolicitud';
  }
}
/** La sesión venció: el aviso global ya se mostró; quien llama no debe pintar otro error. */
export class ErrorSesion extends ErrorSolicitud {
  constructor() {
    super('Tu sesión expiró. Vuelve a ingresar.', 401, 'sesion');
    this.name = 'ErrorSesion';
  }
}
/** La espera se canceló a pedido de la persona (AbortController). */
export class ErrorCancelado extends ErrorSolicitud {
  constructor() {
    super('Se canceló la espera.', 0, 'cancelado');
    this.name = 'ErrorCancelado';
  }
}

export const MENSAJES = {
  red: 'Sin conexión con el cotizador. Revisa tu red e intenta nuevamente.',
  tiempo:
    'El asistente tardó demasiado en responder. Intenta de nuevo; si se repite, divide el pedido en partes.',
  conflicto:
    'Otra persona modificó esta cotización al mismo tiempo. Se cargó la versión actual; revísala e intenta nuevamente.',
  grande: 'El contenido es demasiado largo. Acórtalo e intenta nuevamente.',
  servidor: (status: number) =>
    `El cotizador tuvo un problema (error ${status}). Tus datos guardados se conservan; intenta nuevamente en un momento.`,
  general: 'No se pudo completar la operación.',
  noEncontrado: 'No se encontró el documento solicitado.',
};

type Oyente = () => void;
const oyentesSesion = new Set<Oyente>();
let redirigido = false;
/** Suscribe un aviso no destructivo para cuando el servidor responde 401. */
export function alExpirarSesion(fn: Oyente) {
  oyentesSesion.add(fn);
  return () => void oyentesSesion.delete(fn);
}
function expirarSesion(): never {
  // Se avisa en cada 401 (el aviso se reemplaza, no se apila); sin oyentes se va al login una vez.
  if (oyentesSesion.size) oyentesSesion.forEach((fn) => fn());
  else if (!redirigido && window.location.pathname !== '/login') {
    redirigido = true;
    window.location.replace('/login');
  }
  throw new ErrorSesion();
}

const esAborto = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

async function pedir(url: string, init?: RequestInit & { json?: unknown }) {
  const { json, ...resto } = init ?? {};
  const opciones: RequestInit =
    json === undefined
      ? resto
      : {
          method: 'POST',
          ...resto,
          headers: { 'Content-Type': 'application/json', ...resto.headers },
          body: JSON.stringify(json),
        };
  try {
    return await fetch(url, opciones);
  } catch (e) {
    if (esAborto(e)) throw new ErrorCancelado();
    // fetch solo rechaza con TypeError por red caída, DNS o CORS.
    throw new ErrorSolicitud(MENSAJES.red, 0, 'red');
  }
}

function mensajePorEstado(status: number, delServidor?: string) {
  if (status === 504 || status === 502) return status === 504 ? MENSAJES.tiempo : MENSAJES.servidor(status);
  if (delServidor) return delServidor;
  if (status === 409) return MENSAJES.conflicto;
  if (status === 413) return MENSAJES.grande;
  if (status === 404) return MENSAJES.noEncontrado;
  if (status >= 500) return MENSAJES.servidor(status);
  return MENSAJES.general;
}

/** fetch + JSON seguro. Lanza ErrorSolicitud (o ErrorSesion / ErrorCancelado). */
export async function pedirJSON<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const r = await pedir(url, init);
  if (r.status === 401 && window.location.pathname !== '/login') expirarSesion();
  let data: unknown = null;
  try {
    const texto = await r.text();
    data = texto ? JSON.parse(texto) : null;
  } catch (e) {
    if (esAborto(e)) throw new ErrorCancelado();
    data = null; // HTML de un proxy o de una página de error.
  }
  const cuerpo = (data && typeof data === 'object' ? data : {}) as {
    error?: unknown;
    codigo?: unknown;
    detalle?: unknown;
  };
  const error = typeof cuerpo.error === 'string' ? cuerpo.error : undefined;
  const codigo = typeof cuerpo.codigo === 'string' ? cuerpo.codigo : undefined;
  const detalle =
    cuerpo.detalle && typeof cuerpo.detalle === 'object'
      ? (cuerpo.detalle as Record<string, unknown>)
      : undefined;
  if (!r.ok) throw new ErrorSolicitud(mensajePorEstado(r.status, error), r.status, codigo, detalle);
  if (data === null) throw new ErrorSolicitud(MENSAJES.servidor(r.status), r.status, 'respuesta_invalida');
  return data as T;
}

/** Descarga binaria autenticada (PDF, CSV) con el nombre que propone el servidor. */
export async function pedirArchivo(
  url: string,
  init?: RequestInit,
): Promise<{ blob: Blob; nombre: string | null }> {
  const r = await pedir(url, init);
  if (r.status === 401) expirarSesion();
  if (!r.ok) throw new ErrorSolicitud(mensajePorEstado(r.status), r.status);
  const nombre = r.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? null;
  return { blob: await r.blob(), nombre };
}

/** Entrega un archivo al navegador como descarga. */
export function guardarArchivo(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Errores que no deben pintarse como aviso rojo (ya se informaron de otra forma). */
export const codigoDe = (e: unknown) => (e instanceof ErrorSolicitud ? e.codigo : undefined);
export const esSilencioso = (e: unknown) => e instanceof ErrorSesion || e instanceof ErrorCancelado;
export const mensajeDe = (e: unknown) =>
  e instanceof ErrorSolicitud ? e.message : e instanceof Error && e.message ? e.message : MENSAJES.general;

// Borrador del compositor: sobrevive a recargas y al vencimiento de la sesión.
const CLAVE_BORRADOR = 'neltume:borrador';
export interface Borrador {
  texto: string;
  id: string | null;
}
export function leerBorrador(): Borrador | null {
  try {
    const crudo = sessionStorage.getItem(CLAVE_BORRADOR);
    const b = crudo ? (JSON.parse(crudo) as Partial<Borrador>) : null;
    return b && typeof b.texto === 'string'
      ? { texto: b.texto, id: typeof b.id === 'string' ? b.id : null }
      : null;
  } catch {
    return null;
  }
}
/** `conCotizacion`: guarda también la cotización abierta aunque no haya texto (vencimiento de sesión). */
export function guardarBorrador(b: Borrador, conCotizacion = false) {
  try {
    if (b.texto.trim() || (conCotizacion && b.id)) sessionStorage.setItem(CLAVE_BORRADOR, JSON.stringify(b));
    else sessionStorage.removeItem(CLAVE_BORRADOR);
  } catch {
    // Almacenamiento bloqueado o lleno: el borrador solo vive en memoria.
  }
}

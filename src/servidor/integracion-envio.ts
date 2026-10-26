import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { carpetaReferencias } from './archivos-referencia';
import { registrarError } from './errores';
import {
  marcarEntregado,
  marcarIntentoFallido,
  reclamarEnvios,
  reemplazarSiHayNueva,
  soltarEnvio,
  type ContenidoEnvio,
  type FilaEnvio,
} from './integracion-bandeja';
import { configuracionFabrica, FABRICAS_INTEGRADAS, type ConfiguracionIntegracion } from './integracion-configuracion';
import {
  CODIGO_FABRICA,
  confirmacionSchema,
  errorFabricaSchema,
  mensajeSchema,
  ORIGEN_INTEGRACION,
  RUTA_PEDIDOS,
  rutaAdjunto,
  VERSION_CONTRATO,
  type MensajeFabrica,
} from './integracion-contrato';
import { CABECERA_IDEMPOTENCIA, firmar } from './integracion-firma';
import { generarPdf } from './pdf';

/**
 * Entrega de la bandeja de salida a la aplicación de la fábrica (docs/integracion-fabrica.md). Corre en segundo plano,
 * fuera del bloqueo de las cotizaciones: nunca demora ni hace fallar la nota de pedido. Un envío queda entregado
 * solo con la confirmación de la fábrica; un error pasajero se reintenta con espera exponencial y uno permanente
 * (la fábrica rechazó el contenido) no se repite.
 */

/** Tope del cuerpo de un pedido (JSON con los dos PDF en base64). Más grande no se envía: queda fallido. */
export const MAX_CUERPO_BYTES = 20 * 1024 * 1024;
/** Lo que se lee de una respuesta de la fábrica: la confirmación es un JSON chico. */
export const MAX_RESPUESTA_BYTES = 64 * 1024;
/** Intentos antes de dejar un envío fallido (con la espera exponencial, unos tres días). */
export const MAX_INTENTOS = 15;
const ESPERA_BASE_MS = 30_000;
const ESPERA_MAXIMA_MS = 6 * 60 * 60_000;
/** Cuánto queda tomado un envío: más que todos los plazos de un intento juntos. */
const EN_CURSO_MS = 10 * 60_000;
/** Pasada periódica que retoma lo pendiente (reintentos y lo que quedó de un reinicio). */
export const INTERVALO_MS = 60_000;
/** Respuestas que dicen que el contenido no sirve: repetir el mismo envío daría lo mismo. */
const PERMANENTES = new Set([400, 409, 410, 413, 415, 422]);

/** Espera antes del intento `intentos + 1`: 30 s, 1 min, 2 min… hasta 6 h, con ±20 % para no llegar todos juntos. */
export function esperaReintento(intentos: number, azar = Math.random) {
  const base = Math.min(ESPERA_MAXIMA_MS, ESPERA_BASE_MS * 2 ** Math.max(0, intentos - 1));
  return Math.round(base * (0.8 + 0.4 * azar()));
}

/** Retry-After en segundos o como fecha HTTP; null si no viene o no se entiende. */
function esperaPedida(cabecera: string | null, ahora: number) {
  if (!cabecera) return null;
  const segundos = Number(cabecera);
  const ms = Number.isFinite(segundos) ? segundos * 1000 : Date.parse(cabecera) - ahora;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ESPERA_MAXIMA_MS, ms) : null;
}

class ErrorEnvio extends Error {
  constructor(
    mensaje: string,
    public status: number | null = null,
    public permanente = false,
    public reintentarEnMs: number | null = null,
  ) {
    super(mensaje);
    this.name = 'ErrorEnvio';
  }
}

export interface OpcionesEnvio {
  directorio: string;
  db: Database.Database;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  ahora?: () => Date;
}

/** Lee la respuesta con tope: una fábrica mal configurada no llena la memoria. */
export async function leerRespuesta(respuesta: Response) {
  const lector = respuesta.body?.getReader();
  if (!lector) return '';
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > MAX_RESPUESTA_BYTES) {
      await lector.cancel().catch(() => {});
      break;
    }
    partes.push(value);
  }
  return Buffer.concat(partes).toString('utf8').slice(0, MAX_RESPUESTA_BYTES);
}

/** Código de error que informó la fábrica, para el diagnóstico (sin el cuerpo completo). */
function codigoError(texto: string) {
  try {
    const r = errorFabricaSchema.safeParse(JSON.parse(texto));
    return r.success ? `${r.data.error.code}${r.data.error.message ? `: ${r.data.error.message}` : ''}` : null;
  } catch {
    return null;
  }
}

/**
 * Una solicitud firmada. Sin seguir redirecciones (el cuerpo firmado no va a otro destino) y con plazo. Node valida
 * el certificado TLS (no se desactiva en ningún caso). Lanza `ErrorEnvio` clasificado; devuelve el status y el texto.
 */
async function solicitar(
  config: ConfiguracionIntegracion,
  { metodo, ruta, cuerpo, tipo, clave }: { metodo: 'POST' | 'PUT'; ruta: string; cuerpo: Uint8Array; tipo: string; clave: string },
  opciones: Required<Pick<OpcionesEnvio, 'fetch' | 'ahora'>>,
) {
  let respuesta: Response;
  try {
    respuesta = await opciones.fetch(`${config.url}${ruta}`, {
      method: metodo,
      headers: {
        'Content-Type': tipo,
        Accept: 'application/json',
        'User-Agent': 'neltume-cotizador',
        [CABECERA_IDEMPOTENCIA]: clave,
        ...firmar(config.secreto, cuerpo, opciones.ahora().getTime()),
      },
      body: cuerpo as Uint8Array<ArrayBuffer>,
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    const causa = error instanceof Error ? (error.name === 'TimeoutError' ? `sin respuesta en ${config.timeoutMs} ms` : error.message) : String(error);
    throw new ErrorEnvio(`No se pudo conectar con la fábrica: ${causa}`.slice(0, 300));
  }
  const texto = await leerRespuesta(respuesta).catch(() => '');
  if (respuesta.ok) return { status: respuesta.status, texto };
  const detalle = codigoError(texto);
  throw new ErrorEnvio(
    `La fábrica respondió ${respuesta.status}${detalle ? ` (${detalle})` : ''}.`,
    respuesta.status,
    PERMANENTES.has(respuesta.status),
    esperaPedida(respuesta.headers.get('retry-after'), opciones.ahora().getTime()),
  );
}

const existe = (ruta: string) =>
  access(ruta).then(
    () => true,
    () => false,
  );

/** Documento del mensaje: nombre, base64 y sha256 de los bytes del PDF. */
const documento = (filename: string, bytes: Buffer) => ({
  filename,
  mimeType: 'application/pdf' as const,
  contentBase64: bytes.toString('base64'),
  sha256: createHash('sha256').update(bytes).digest('hex'),
});

/** Arma el mensaje de `fila` con los bytes de sus PDF; imprime la orden de trabajo la primera vez. */
async function mensajeDe(fila: FilaEnvio, contenido: ContenidoEnvio, { directorio, db }: OpcionesEnvio): Promise<MensajeFabrica> {
  const base = {
    schemaVersion: VERSION_CONTRATO,
    eventType: fila.evento,
    eventId: fila.evento_id,
    source: ORIGEN_INTEGRACION,
    sourceOrderId: fila.cotizacion_id,
    sourceOrderRevision: fila.revision,
    destinationFactoryCode: CODIGO_FABRICA[fila.fabrica],
    issuedAt: contenido.issuedAt,
  } as const;
  if (fila.evento === 'order.cancelled') return mensajeSchema.parse({ ...base, cancellation: contenido.cancellation });
  const { commercial, production } = contenido.documents!;
  const rutaComercial = join(directorio, 'pdf', commercial.archivo);
  if (!(await existe(rutaComercial)))
    throw new ErrorEnvio(`Falta el PDF de la nota (${commercial.archivo}): regenéralo desde su documento («Regenerar PDF»).`);
  // La orden de trabajo se imprime una vez, desde el HTML guardado al encolar, y se reutiliza en cada reintento.
  const carpeta = join(directorio, 'integracion');
  const rutaProduccion = join(carpeta, 'pdf', production.archivo);
  if (!(await existe(rutaProduccion))) {
    if (!fila.html_produccion) throw new ErrorEnvio('El envío no tiene la orden de trabajo.', null, true);
    try {
      await generarPdf(carpeta, production.archivo, fila.html_produccion, undefined, { logoDe: db, referenciasDe: directorio });
    } catch (error) {
      // Otra pasada pudo imprimirla primero.
      if (!(await existe(rutaProduccion))) throw new ErrorEnvio(`No se pudo imprimir la orden de trabajo: ${(error as Error).message}`.slice(0, 300));
    }
  }
  return mensajeSchema.parse({
    ...base,
    order: contenido.order,
    documents: {
      commercial: documento(commercial.filename, await readFile(rutaComercial)),
      production: documento(production.filename, await readFile(rutaProduccion)),
    },
  });
}

/** Sube las referencias del cliente que nombra el pedido; la fábrica las guarda por su sha256 (repetir no duplica). */
async function subirAdjuntos(contenido: ContenidoEnvio, config: ConfiguracionIntegracion, opciones: OpcionesEnvio & Required<Pick<OpcionesEnvio, 'fetch' | 'ahora'>>) {
  for (const a of contenido.attachments ?? []) {
    let bytes: Buffer;
    try {
      bytes = await readFile(join(carpetaReferencias(opciones.directorio), a.archivo));
    } catch {
      throw new ErrorEnvio(`Falta el archivo de referencia ${a.archivo}.`, null, true);
    }
    if (createHash('sha256').update(bytes).digest('hex') !== a.attachmentId)
      throw new ErrorEnvio(`El archivo de referencia ${a.archivo} no coincide con su sha256.`, null, true);
    await solicitar(
      config,
      { metodo: 'PUT', ruta: rutaAdjunto(a.attachmentId), cuerpo: bytes, tipo: a.mimeType, clave: `${ORIGEN_INTEGRACION}:attachment:${a.attachmentId}` },
      opciones,
    );
  }
}

/** Un intento de entregar `fila`. Deja la fila entregada, pendiente para más tarde, fallida o reemplazada. */
async function entregar(fila: FilaEnvio, opciones: OpcionesEnvio & Required<Pick<OpcionesEnvio, 'fetch' | 'ahora'>>) {
  const { db } = opciones;
  const config = configuracionFabrica(fila.fabrica, opciones.env);
  // Se desconfiguró: queda pendiente, sin gastar un intento, hasta que vuelva la configuración.
  if (!config) return soltarEnvio(db, fila.id);
  if (reemplazarSiHayNueva(db, fila)) return;
  try {
    const contenido = JSON.parse(fila.contenido) as ContenidoEnvio;
    const mensaje = await mensajeDe(fila, contenido, opciones);
    const cuerpo = Buffer.from(JSON.stringify(mensaje), 'utf8');
    if (cuerpo.length > MAX_CUERPO_BYTES)
      throw new ErrorEnvio(`El pedido pesa ${Math.ceil(cuerpo.length / 1024 / 1024)} MB y el tope es ${MAX_CUERPO_BYTES / 1024 / 1024} MB.`, null, true);
    await subirAdjuntos(contenido, config, opciones);
    const { status, texto } = await solicitar(
      config,
      { metodo: 'POST', ruta: RUTA_PEDIDOS, cuerpo, tipo: 'application/json', clave: fila.clave_idempotencia },
      opciones,
    );
    let confirmacion: unknown;
    try {
      confirmacion = JSON.parse(texto);
    } catch {
      confirmacion = null;
    }
    const ack = confirmacionSchema.safeParse(confirmacion);
    if (!ack.success || ack.data.eventId !== fila.evento_id)
      throw new ErrorEnvio(`La fábrica respondió ${status} sin confirmar el evento ${fila.evento_id}.`, status);
    marcarEntregado(db, fila.id, status, texto, opciones.ahora());
    console.info(`[integracion] ${fila.evento} ${fila.clave_idempotencia} entregado (${ack.data.status}).`);
  } catch (error) {
    const e = error instanceof ErrorEnvio ? error : new ErrorEnvio(`Error inesperado: ${(error as Error)?.message ?? error}`.slice(0, 300));
    const intentos = fila.intentos + 1;
    const definitivo = e.permanente || intentos >= MAX_INTENTOS;
    const espera = Math.max(esperaReintento(intentos), e.reintentarEnMs ?? 0);
    const proximo = definitivo ? null : new Date(opciones.ahora().getTime() + espera);
    marcarIntentoFallido(db, fila.id, { status: e.status, error: e.message, proximo });
    // Solo identificadores y el motivo: ni el pedido ni el secreto van al registro.
    registrarError(
      'integracion',
      `${fila.evento} ${fila.clave_idempotencia} intento ${intentos}: ${e.message}${proximo ? ` Reintento: ${proximo.toISOString()}.` : ' No se reintenta.'}`,
    );
  }
}

/** Una pasada: entrega lo que toca ahora. Devuelve cuántos envíos tomó. */
export async function procesarPendientes(opciones: OpcionesEnvio) {
  const completas = { ...opciones, fetch: opciones.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a)), ahora: opciones.ahora ?? (() => new Date()) };
  // Solo las fábricas con configuración: lo de otra queda pendiente, sin gastar intentos, hasta que la tenga.
  const fabricas = FABRICAS_INTEGRADAS.filter((f) => configuracionFabrica(f, opciones.env));
  const vistos = new Set<number>();
  for (;;) {
    const ahora = completas.ahora();
    // Un envío vuelve a tocar en esta pasada solo si se soltó sin intentar: no se insiste en él hasta la siguiente.
    const filas = reclamarEnvios(completas.db, { ahora, vence: new Date(ahora.getTime() + EN_CURSO_MS), fabricas }).filter((f) => {
      if (!vistos.has(f.id)) return true;
      soltarEnvio(completas.db, f.id);
      return false;
    });
    if (!filas.length) return vistos.size;
    for (const fila of filas) {
      vistos.add(fila.id);
      await entregar(fila, completas);
    }
  }
}

// En el proceso del servidor: una sola pasada a la vez por carpeta de datos, y una más si llegó trabajo entretanto.
interface Ejecucion {
  corriendo: Promise<void> | null;
  otraVez: boolean;
}
const global = globalThis as typeof globalThis & {
  __neltumeIntegracion?: Map<string, Ejecucion>;
  __neltumeIntegracionIntervalo?: NodeJS.Timeout;
};
const ejecuciones = () => (global.__neltumeIntegracion ??= new Map());

/** Hay alguna fábrica integrada con configuración: si no, el envío ni se intenta. */
export const integracionConfigurada = (env: Record<string, string | undefined> = process.env) =>
  FABRICAS_INTEGRADAS.some((f) => configuracionFabrica(f, env));

/**
 * Pide una pasada en segundo plano para la base de `almacen` (al confirmar una nota de pedido, un cambio de número o
 * una anulación, y cada minuto). Nunca lanza ni se espera: lo que falle queda en la bandeja y en el registro.
 */
export function despertarIntegracion(almacen: { directorio: string; baseDatos(): Database.Database }) {
  if (!integracionConfigurada()) return;
  const mapa = ejecuciones();
  const actual = mapa.get(almacen.directorio) ?? { corriendo: null, otraVez: false };
  mapa.set(almacen.directorio, actual);
  if (actual.corriendo) {
    actual.otraVez = true;
    return;
  }
  actual.corriendo = (async () => {
    do {
      actual.otraVez = false;
      await new Promise((r) => setImmediate(r));
      try {
        await procesarPendientes({ directorio: almacen.directorio, db: almacen.baseDatos() });
      } catch (error) {
        registrarError('integracion', error);
      }
    } while (actual.otraVez);
  })().finally(() => {
    actual.corriendo = null;
  });
}

/** Espera la pasada en curso (pruebas y `npm run integracion`). */
export async function esperarIntegracion(directorio: string) {
  while (ejecuciones().get(directorio)?.corriendo) await ejecuciones().get(directorio)!.corriendo;
}

/** Pasada periódica del servidor (instrumentation.ts): retoma reintentos y lo que quedó pendiente de un reinicio. */
export function iniciarIntegracion(almacen: { directorio: string; baseDatos(): Database.Database }) {
  if (global.__neltumeIntegracionIntervalo) return;
  global.__neltumeIntegracionIntervalo = setInterval(() => despertarIntegracion(almacen), INTERVALO_MS);
  global.__neltumeIntegracionIntervalo.unref?.();
  despertarIntegracion(almacen);
}

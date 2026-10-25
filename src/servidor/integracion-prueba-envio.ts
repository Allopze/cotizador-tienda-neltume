import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { nombreFabrica, type Fabrica } from '../negocio/estado';
import { ErrorPdf, ErrorUsuario, registrarError } from './errores';
import { configuracionFabrica, detalleConfiguracion, fabricaIntegrada } from './integracion-configuracion';
import {
  claveIdempotenciaPrueba,
  CODIGO_FABRICA,
  confirmacionPruebaSchema,
  errorFabricaSchema,
  EVENTO_PRUEBA,
  MAX_PDF_PRUEBA_BYTES,
  mensajePruebaSchema,
  ORIGEN_FABRICA,
  ORIGEN_INTEGRACION,
  RUTA_PRUEBA_CONEXION,
  VERSION_CONTRATO,
} from './integracion-contrato';
import { leerRespuesta } from './integracion-envio';
import { CABECERA_IDEMPOTENCIA, firmar } from './integracion-firma';
import { guardarPrueba, type ResultadoPrueba } from './integracion-prueba';
import { generarPdf, plantillaPruebaConexion } from './pdf';

/**
 * Envío de la prueba de conexión a la fábrica (docs/integracion-fabrica.md, «Prueba de conexión»), desde el botón de
 * Ajustes. Una pulsación es un intento: sin bandeja ni reintentos, con plazo de 15 s, sin seguir redirecciones y con la
 * respuesta leída hasta 64 KB. El resultado se muestra en el momento y queda guardado con el PDF que se envió.
 */
export const PLAZO_PRUEBA_MS = 15_000;
/** Desfase de reloj entre las dos apps desde el cual se avisa (sin fallar: la firma admite hasta 300 s). */
const DESFASE_AVISO_S = 60;

export interface ResultadoEnvioPrueba {
  id: number;
  eventoId: string;
  resultado: Exclude<ResultadoPrueba, 'recibida'>;
  http: number | null;
  codigo: string | null;
  /** El diagnóstico, con las mismas palabras en las dos aplicaciones. */
  mensaje: string;
  latenciaMs: number;
  /** Algo que no hace fallar la prueba pero conviene saber (relojes distintos). */
  aviso: string | null;
}

export interface OpcionesEnvioPrueba {
  /** Carpeta de datos: ahí se imprime el PDF de prueba, que se guarda en la base y no queda en disco. */
  directorio: string;
  db: Database.Database;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  ahora?: () => Date;
}

const REDIRECCION = 'No se pudo conectar: redirección inesperada (¿Cloudflare Access?)';

/** Texto de una respuesta que no es un 2xx: el mismo diagnóstico en las dos pantallas (contrato, «Diagnóstico»). */
export function diagnosticarRespuesta({ http, codigo }: { http: number; codigo: string | null }) {
  if (http === 401) return 'La otra app rechazó la firma: el secreto no coincide o los relojes difieren en más de 5 minutos';
  if (http === 403) return 'La otra app rechazó el acceso (403): revisa el Host permitido o el acceso por Cloudflare';
  if (http === 404 || http === 405) return 'La otra app aún no tiene esta ruta (versión sin desplegar)';
  if (http === 503 && codigo === 'not_configured') return 'La otra app no tiene configurada la integración';
  if ([400, 409, 413, 415, 422].includes(http) && codigo) return codigo;
  return `La otra app respondió ${http}`;
}

/** Texto de una solicitud que no llegó a tener respuesta: red, DNS, TLS, plazo o una redirección que se rechaza. */
export function diagnosticarFalla(error: unknown) {
  const e = error instanceof Error ? error : new Error(String(error));
  if (e.name === 'TimeoutError' || e.name === 'AbortError')
    return `No se pudo conectar con la otra app: sin respuesta en ${PLAZO_PRUEBA_MS / 1000} s`;
  const causa = e.cause instanceof Error ? (e.cause as Error & { code?: string }) : null;
  if (/redirect/i.test(`${e.message} ${causa?.message ?? ''}`)) return REDIRECCION;
  return `No se pudo conectar con la otra app: ${(causa?.code ?? causa?.message ?? e.message).slice(0, 200)}`;
}

/** `error.code` del cuerpo de un error de la otra app, si lo trae. */
function codigoDeError(texto: string) {
  try {
    const r = errorFabricaSchema.safeParse(JSON.parse(texto));
    return r.success ? r.data.error.code : null;
  } catch {
    return null;
  }
}

/** Imprime el PDF de prueba con el Chromium de los documentos y devuelve sus bytes: en disco no queda nada. */
async function imprimir(directorio: string, db: Database.Database, eventId: string, fecha: Date, fabrica: Fabrica) {
  const carpeta = join(directorio, 'integracion', 'pruebas');
  const archivo = `prueba-conexion-${eventId}.pdf`;
  const html = await plantillaPruebaConexion(
    { eventId, fecha, emisor: 'Cotizador de la tienda Neltume', destino: `Fábrica ${nombreFabrica[fabrica]}` },
    db,
  );
  await generarPdf(carpeta, archivo, html, undefined, { logoDe: db });
  const ruta = join(carpeta, 'pdf', archivo);
  try {
    return await readFile(ruta);
  } finally {
    await rm(ruta, { force: true });
  }
}

// Una prueba a la vez: cada una imprime un PDF con Chromium y espera hasta 15 s a la otra app.
let enCurso = false;

/**
 * Envía la prueba a `fabrica` y la deja guardada. Una falta de configuración, otra prueba en curso o un PDF que no se
 * pudo imprimir lanzan `ErrorUsuario` (no se envió nada y no queda registro); todo lo que pasa después de enviar es un
 * resultado (aceptada, duplicada, rechazada o sin respuesta) con su diagnóstico.
 */
export async function enviarPrueba(fabrica: Fabrica, actor: string, opciones: OpcionesEnvioPrueba): Promise<ResultadoEnvioPrueba> {
  const { directorio, db, env = process.env, ahora = () => new Date() } = opciones;
  const pedir = opciones.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  if (!fabricaIntegrada(fabrica)) throw new ErrorUsuario('Esa fábrica no tiene integración.');
  const config = configuracionFabrica(fabrica, env);
  if (!config) throw new ErrorUsuario(detalleConfiguracion(fabrica, env).falta ?? 'Falta configurar la integración.', 'incompleta', 409);
  if (enCurso) throw new ErrorUsuario('Ya hay una prueba en curso: espera su resultado.', 'ocupado', 409);
  enCurso = true;
  try {
    const eventoId = randomUUID();
    const emitida = ahora();
    let pdf: Buffer;
    try {
      pdf = await imprimir(directorio, db, eventoId, emitida, fabrica);
    } catch (error) {
      registrarError('integracion-prueba', error);
      throw new ErrorUsuario(
        `No se pudo generar el PDF de prueba${error instanceof ErrorPdf ? `: ${error.tecnico}` : ''}. Revisa que Chromium funcione en este servidor (/api/salud).`,
        'pdf_no_disponible',
        503,
      );
    }
    if (pdf.length > MAX_PDF_PRUEBA_BYTES) throw new ErrorUsuario('El PDF de prueba pesa más de 1 MiB: no se envía.', 'pdf_no_disponible', 503);
    const filename = `prueba-conexion-${eventoId.slice(0, 8)}.pdf`;
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    // Como los pedidos: lo que no cumple el contrato no sale.
    const mensaje = mensajePruebaSchema(ORIGEN_INTEGRACION).parse({
      schemaVersion: VERSION_CONTRATO,
      eventType: EVENTO_PRUEBA,
      eventId: eventoId,
      source: ORIGEN_INTEGRACION,
      factoryCode: CODIGO_FABRICA[fabrica],
      issuedAt: emitida.toISOString(),
      document: { filename, mimeType: 'application/pdf', contentBase64: pdf.toString('base64'), sha256 },
    });
    const cuerpo = Buffer.from(JSON.stringify(mensaje), 'utf8');
    const clave = claveIdempotenciaPrueba(ORIGEN_INTEGRACION, eventoId);

    const antes = ahora().getTime();
    const desde = performance.now();
    let respuesta: Response | null = null;
    let texto = '';
    let falla: string | null = null;
    try {
      respuesta = await pedir(`${config.url}${RUTA_PRUEBA_CONEXION}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'neltume-cotizador',
          [CABECERA_IDEMPOTENCIA]: clave,
          ...firmar(config.secreto, cuerpo, ahora().getTime()),
        },
        body: cuerpo as Uint8Array<ArrayBuffer>,
        redirect: 'error',
        signal: AbortSignal.timeout(PLAZO_PRUEBA_MS),
      });
      // Un cuerpo ilegible no cambia el estado de la respuesta; uno que no termina de llegar es plazo agotado.
      texto = await leerRespuesta(respuesta).catch((error: unknown) => {
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw error;
        return '';
      });
    } catch (error) {
      falla = diagnosticarFalla(error);
    }
    const latenciaMs = Math.round(performance.now() - desde);

    let resultado: ResultadoEnvioPrueba['resultado'];
    let codigo: string | null = null;
    let mensajeResultado: string;
    let aviso: string | null = null;
    if (falla !== null) {
      resultado = 'sin_respuesta';
      mensajeResultado = falla;
    } else if (!respuesta!.ok) {
      resultado = 'rechazada';
      codigo = codigoDeError(texto);
      mensajeResultado = diagnosticarRespuesta({ http: respuesta!.status, codigo });
    } else {
      let cuerpoRespuesta: unknown = null;
      try {
        cuerpoRespuesta = JSON.parse(texto);
      } catch {
        // Un 2xx que no es JSON es de otra aplicación (o de un proxy).
      }
      const ack = confirmacionPruebaSchema.safeParse(cuerpoRespuesta);
      if (!ack.success || ack.data.eventId !== eventoId || ack.data.receiver !== ORIGEN_FABRICA) {
        resultado = 'rechazada';
        codigo = 'otra_aplicacion';
        mensajeResultado = 'Respondió otra aplicación';
      } else {
        resultado = ack.data.status === 'accepted' ? 'aceptada' : 'duplicada';
        mensajeResultado = resultado === 'aceptada' ? `Aceptada en ${latenciaMs} ms` : `Duplicada en ${latenciaMs} ms: la otra app ya la tenía`;
        // El reloj de la otra app contra el punto medio de la solicitud: la latencia no cuenta como desfase.
        const recibida = ack.data.receivedAt ? Date.parse(ack.data.receivedAt) : NaN;
        const desfaseS = Math.abs(recibida - (antes + latenciaMs / 2)) / 1000;
        if (desfaseS > DESFASE_AVISO_S)
          aviso = `Los relojes de las dos apps difieren unos ${Math.round(desfaseS)} s (la firma admite hasta 300 s).`;
      }
    }

    const id = guardarPrueba(db, {
      direccion: 'enviada',
      fabrica,
      eventoId,
      clave,
      fecha: emitida,
      resultado,
      http: respuesta?.status ?? null,
      codigo,
      detalle: mensajeResultado,
      latenciaMs,
      actor,
      archivo: filename,
      pdf,
      sha256,
    });
    // Solo identificadores y el resultado: ni el PDF ni el secreto van al registro.
    console.info(
      `[integracion] prueba de conexión enviada a ${CODIGO_FABRICA[fabrica]}: ${eventoId} ${resultado}${respuesta ? ` (${respuesta.status})` : ''} en ${latenciaMs} ms.`,
    );
    return { id, eventoId, resultado, http: respuesta?.status ?? null, codigo, mensaje: mensajeResultado, latenciaMs, aviso };
  } finally {
    enCurso = false;
  }
}

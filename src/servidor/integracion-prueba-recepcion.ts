import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { Fabrica } from '../negocio/estado';
import { hostPermitido } from './acceso';
import { abrirBaseDatos } from './base-datos';
import { ErrorLecturaVencida, leerBytes } from './cuerpo';
import { registrarError } from './errores';
import { FABRICAS_INTEGRADAS, secretoFabrica } from './integracion-configuracion';
import {
  claveIdempotenciaPrueba,
  CODIGO_FABRICA,
  MAX_CUERPO_PRUEBA_BYTES,
  MAX_PDF_PRUEBA_BYTES,
  mensajePruebaSchema,
  ORIGEN_FABRICA,
  ORIGEN_INTEGRACION,
  VERSION_CONTRATO,
} from './integracion-contrato';
import { CABECERA_FIRMA, CABECERA_IDEMPOTENCIA, CABECERA_TIMESTAMP, verificarFirma } from './integracion-firma';
import { buscarRecibida, guardarPrueba, motivoPdfInvalido } from './integracion-prueba';

/**
 * Recepción de la prueba de conexión que envía la fábrica (docs/integracion-fabrica.md, «Prueba de conexión»). Sin
 * sesión: la única credencial es la firma, que se verifica sobre los bytes crudos antes de interpretar el JSON. Lo
 * barato va primero y nada se guarda hasta el último paso; la respuesta 2xx sale solo después de guardar. Solo se
 * guarda una recepción aceptada: lo rechazado queda en el registro del servidor, sin cuerpo, para que quien no tiene
 * el secreto no llene la base. El cuerpo se lee con tope de tamaño, de tiempo y de lecturas a la vez: la ruta es
 * pública y cada lectura retiene memoria hasta que llega el cuerpo.
 */
interface VentanaRegistro {
  desde: number;
  cuenta: number;
}

/**
 * Líneas de registro por minuto, en dos grupos: lo que no probó la firma (cualquiera en internet) y lo que sí (la
 * fábrica, con algún error suyo). Separados, el ruido de unos no esconde el error de la otra.
 */
export interface TopeRegistro {
  sinFirma: VentanaRegistro;
  conFirma: VentanaRegistro;
}
export const nuevoTope = (): TopeRegistro => ({ sinFirma: { desde: 0, cuenta: 0 }, conFirma: { desde: 0, cuenta: 0 } });

export interface OpcionesRecepcion {
  env?: Record<string, string | undefined>;
  db?: Database.Database;
  ahora?: () => Date;
  /** Tope de líneas de registro; por omisión el del proceso (las pruebas pasan uno propio). */
  tope?: TopeRegistro;
  /** Plazo para que llegue el cuerpo entero (10 s por omisión). */
  plazoLecturaMs?: number;
}

/** Cuánto espera la fábrica antes de volver a intentar cuando la integración no está configurada. */
const REINTENTO_SIN_CONFIGURAR_S = 300;
const MAX_RECHAZOS_SIN_FIRMA = 20;
const MAX_RECHAZOS_CON_FIRMA = 60;
const PLAZO_LECTURA_MS = 10_000;
/** Cuerpos que se leen a la vez (hasta 2 MiB cada uno): una lectura lenta no puede retener toda la memoria. */
const MAX_LECTURAS_SIMULTANEAS = 8;
const REINTENTO_SOBRECARGA_S = 5;

const topeDelProceso = nuevoTope();
let lecturasEnCurso = 0;

function anotarRechazo(motivo: string, ahora: number, ventana: VentanaRegistro, max: number) {
  if (ahora - ventana.desde > 60_000) Object.assign(ventana, { desde: ahora, cuenta: 0 });
  if (++ventana.cuenta <= max) console.warn(`[integracion] prueba de conexión rechazada: ${motivo}`);
  else if (ventana.cuenta === max + 1)
    console.warn('[integracion] prueba de conexión: hay más rechazos por minuto de los que se anotan; se omiten los siguientes.');
}

const respuestaError = (status: number, code: string, message: string, cabeceras: Record<string, string> = {}) =>
  Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store', ...cabeceras } });

const respuestaExito = (status: 200 | 201, estado: 'accepted' | 'duplicate', eventId: string, recibida: string) =>
  Response.json(
    { status: estado, eventId, receiver: ORIGEN_INTEGRACION, receivedAt: recibida },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );

export async function recibirPrueba(
  req: Request,
  { env = process.env, db, ahora = () => new Date(), tope = topeDelProceso, plazoLecturaMs = PLAZO_LECTURA_MS }: OpcionesRecepcion = {},
) {
  const inicio = ahora();
  // Todo lo que no es un 2xx deja una línea en el registro (con tope por minuto, aparte según si la firma ya valió). El
  // motivo es texto nuestro: lo que escribió quien llama (el Content-Type) se acota antes de anotarlo.
  let firmada = false;
  const rechazar = (status: number, code: string, message: string, motivo = message, cabeceras?: Record<string, string>) => {
    const [ventana, max] = firmada ? [tope.conFirma, MAX_RECHAZOS_CON_FIRMA] : [tope.sinFirma, MAX_RECHAZOS_SIN_FIRMA];
    anotarRechazo(`${status} ${code} (${motivo})`, inicio.getTime(), ventana, max);
    return respuestaError(status, code, message, cabeceras);
  };

  if (!hostPermitido(req.headers.get('host'))) return rechazar(403, 'host_not_allowed', 'Host no permitido.', 'Host fuera de NELTUME_HOSTS');
  const secretos = FABRICAS_INTEGRADAS.flatMap((fabrica) => {
    const secreto = secretoFabrica(fabrica, env);
    return secreto ? [{ fabrica, secreto }] : [];
  });
  if (!secretos.length)
    return rechazar(503, 'not_configured', 'La integración no está configurada.', 'sin secreto', {
      'Retry-After': String(REINTENTO_SIN_CONFIGURAR_S),
    });
  const tipo = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (tipo !== 'application/json') return rechazar(415, 'unsupported_media_type', 'El Content-Type debe ser application/json.', tipo.slice(0, 40).replace(/[^\w/.+-]/g, '?') || 'sin Content-Type');
  if (Number(req.headers.get('content-length') ?? '0') > MAX_CUERPO_PRUEBA_BYTES)
    return rechazar(413, 'payload_too_large', 'El cuerpo supera los 2 MiB.', 'Content-Length');
  // Sin las cabeceras de firma no hay nada que verificar: ni se lee el cuerpo.
  const timestamp = req.headers.get(CABECERA_TIMESTAMP);
  const firma = req.headers.get(CABECERA_FIRMA);
  if (!timestamp || !firma) return rechazar(401, 'invalid_signature', 'Firma o timestamp inválidos.', 'sin cabeceras de firma');
  if (lecturasEnCurso >= MAX_LECTURAS_SIMULTANEAS)
    return rechazar(429, 'too_many_requests', 'Hay demasiadas solicitudes en curso: reintenta en unos segundos.', 'lecturas simultáneas', {
      'Retry-After': String(REINTENTO_SOBRECARGA_S),
    });
  let cuerpo: Buffer | null;
  lecturasEnCurso++;
  try {
    cuerpo = req.body ? await leerBytes(req.body, MAX_CUERPO_PRUEBA_BYTES, plazoLecturaMs) : Buffer.alloc(0);
  } catch (error) {
    // El cuerpo no terminó de llegar: demasiado lento, o quien lo mandaba cortó la conexión a medias.
    return error instanceof ErrorLecturaVencida
      ? rechazar(408, 'request_timeout', 'El cuerpo no llegó completo a tiempo.', 'lectura vencida')
      : rechazar(400, 'schema_invalid', 'El cuerpo llegó incompleto.', 'conexión cortada');
  } finally {
    lecturasEnCurso--;
  }
  if (!cuerpo) return rechazar(413, 'payload_too_large', 'El cuerpo supera los 2 MiB.', 'cuerpo leído');

  // La firma, con el secreto de cada fábrica integrada: vale el de la fábrica que el cuerpo nombra (más abajo).
  let fabrica: Fabrica | undefined;
  let motivoFirma = 'firma_invalida';
  for (const candidata of secretos) {
    const r = verificarFirma([candidata.secreto], { timestamp, firma }, cuerpo, inicio.getTime());
    if (r.ok) fabrica ??= candidata.fabrica;
    else if (!fabrica) motivoFirma = r.motivo;
  }
  if (!fabrica) return rechazar(401, 'invalid_signature', 'Firma o timestamp inválidos.', motivoFirma);
  firmada = true;

  let crudo: unknown;
  try {
    crudo = JSON.parse(cuerpo.toString('utf8'));
  } catch {
    return rechazar(400, 'schema_invalid', 'El cuerpo no es un JSON válido.');
  }
  // Una versión desconocida se rechaza antes que el resto del esquema.
  if (crudo && typeof crudo === 'object' && 'schemaVersion' in crudo && crudo.schemaVersion !== VERSION_CONTRATO)
    return rechazar(422, 'unsupported_schema_version', `Solo se entiende la versión ${VERSION_CONTRATO}.`);
  const valido = mensajePruebaSchema(ORIGEN_FABRICA).safeParse(crudo);
  if (!valido.success) {
    const { path, code } = valido.error.issues[0];
    return rechazar(400, 'schema_invalid', `El cuerpo no cumple el esquema (${path.join('.') || 'raíz'}: ${code}).`);
  }
  const mensaje = valido.data;
  const clave = claveIdempotenciaPrueba(ORIGEN_FABRICA, mensaje.eventId);
  if (req.headers.get(CABECERA_IDEMPOTENCIA) !== clave)
    return rechazar(400, 'schema_invalid', 'X-Idempotency-Key no corresponde al eventId.');
  if (mensaje.factoryCode !== CODIGO_FABRICA[fabrica])
    return rechazar(422, 'destination_mismatch', 'La fábrica del mensaje no es la del secreto que lo firmó.');

  const { contentBase64, sha256, filename } = mensaje.document;
  const pdf = Buffer.from(contentBase64, 'base64');
  if (pdf.length > MAX_PDF_PRUEBA_BYTES) return rechazar(413, 'payload_too_large', 'El PDF supera 1 MiB.');
  if (pdf.toString('base64') !== contentBase64)
    return rechazar(422, 'document_invalid', 'El contenido no es base64 estándar con relleno.');
  if (createHash('sha256').update(pdf).digest('hex') !== sha256)
    return rechazar(422, 'document_invalid', 'El sha256 no coincide con el PDF.');
  const invalido = motivoPdfInvalido(pdf);
  if (invalido) return rechazar(422, 'document_invalid', `El PDF no está íntegro: ${invalido}.`);

  try {
    const base = db ?? abrirBaseDatos();
    const hashCuerpo = createHash('sha256').update(cuerpo).digest('hex');
    const previa = buscarRecibida(base, clave);
    if (previa)
      return previa.cuerpoSha256 === hashCuerpo
        ? respuestaExito(200, 'duplicate', mensaje.eventId, previa.fecha)
        : rechazar(409, 'idempotency_conflict', 'Esa clave de idempotencia ya se usó con otro contenido.');
    const recibida = ahora();
    guardarPrueba(base, {
      direccion: 'recibida',
      fabrica,
      eventoId: mensaje.eventId,
      clave,
      fecha: recibida,
      resultado: 'recibida',
      archivo: filename,
      pdf,
      sha256,
      cuerpoSha256: hashCuerpo,
    });
    // Solo identificadores: ni el PDF ni el secreto van al registro.
    console.info(`[integracion] prueba de conexión recibida de ${CODIGO_FABRICA[fabrica]}: ${mensaje.eventId} (${pdf.length} B).`);
    return respuestaExito(201, 'accepted', mensaje.eventId, recibida.toISOString());
  } catch (error) {
    registrarError('integracion-prueba', error);
    return respuestaError(500, 'internal', 'Error interno.');
  }
}

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Firma de las solicitudes a la aplicación de la fábrica (docs/integracion-fabrica.md, «Firma»). Es la misma
 * especificación en ambos repositorios:
 *
 *   firma = HMAC-SHA256(secreto, `${timestamp}.` ‖ bytes originales del cuerpo)
 *   X-Neltume-Timestamp: segundos Unix, entero en decimal
 *   X-Neltume-Signature: v1=<firma en hexadecimal, minúsculas>
 *
 * El secreto es el texto de la variable de entorno en UTF-8. La fábrica verifica sobre los bytes que recibió, antes
 * de interpretar el JSON, y rechaza un timestamp a más de `TOLERANCIA_FIRMA_S` de su reloj.
 */
export const VERSION_FIRMA = 'v1';
/** Desfase de reloj aceptado entre ambos servidores, en segundos. */
export const TOLERANCIA_FIRMA_S = 300;

export const CABECERA_TIMESTAMP = 'X-Neltume-Timestamp';
export const CABECERA_FIRMA = 'X-Neltume-Signature';
export const CABECERA_IDEMPOTENCIA = 'X-Idempotency-Key';

function hmac(secreto: string, timestamp: string, cuerpo: Uint8Array) {
  return createHmac('sha256', Buffer.from(secreto, 'utf8'))
    .update(Buffer.from(`${timestamp}.`, 'utf8'))
    .update(cuerpo)
    .digest('hex');
}

/** Cabeceras de firma de `cuerpo` (los bytes exactos que se enviarán) en el instante `ahora`. */
export function firmar(secreto: string, cuerpo: Uint8Array, ahora = Date.now()) {
  const timestamp = String(Math.floor(ahora / 1000));
  return {
    [CABECERA_TIMESTAMP]: timestamp,
    [CABECERA_FIRMA]: `${VERSION_FIRMA}=${hmac(secreto, timestamp, cuerpo)}`,
  };
}

export type ResultadoVerificacion = { ok: true } | { ok: false; motivo: 'sin_firma' | 'timestamp_invalido' | 'fuera_de_plazo' | 'firma_invalida' };

/**
 * Verificación de referencia (la usa la fábrica y las pruebas de este repositorio). Acepta varias firmas separadas
 * por coma en la cabecera (`v1=…,v1=…`) para rotar el secreto sin cortar el envío.
 */
export function verificarFirma(
  secretos: string[],
  cabeceras: { timestamp: string | null; firma: string | null },
  cuerpo: Uint8Array,
  ahora = Date.now(),
): ResultadoVerificacion {
  const { timestamp, firma } = cabeceras;
  if (!timestamp || !firma) return { ok: false, motivo: 'sin_firma' };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, motivo: 'timestamp_invalido' };
  if (Math.abs(Math.floor(ahora / 1000) - Number(timestamp)) > TOLERANCIA_FIRMA_S) return { ok: false, motivo: 'fuera_de_plazo' };
  const recibidas = firma
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.startsWith(`${VERSION_FIRMA}=`))
    .map((f) => Buffer.from(f.slice(VERSION_FIRMA.length + 1), 'utf8'));
  for (const secreto of secretos) {
    const esperada = Buffer.from(hmac(secreto, timestamp, cuerpo), 'utf8');
    if (recibidas.some((r) => r.length === esperada.length && timingSafeEqual(r, esperada))) return { ok: true };
  }
  return { ok: false, motivo: 'firma_invalida' };
}

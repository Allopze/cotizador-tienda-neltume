import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { clavePedido, type LineaPedido, type TarifaStarkenAplicada } from '../negocio/starken';

// Firma de las tarifas de Starken. El navegador no es de fiar para decir cuánto cuesta un envío: cada tarifa que
// entrega /api/starken/cotizar lleva una firma HMAC ligada a la cotización, al pedido (su huella), al destino y a
// sus datos, y la acción `editar` la verifica antes de aceptar el valor y de dejar la tarifa en la actividad.

export const VIGENCIA_FIRMA_MS = 15 * 60 * 1000;

export type DatosFirmados = Omit<TarifaStarkenAplicada, 'vence' | 'firma'>;
export type EstadoFirma = 'valida' | 'invalida' | 'vencida';

const global = globalThis as typeof globalThis & { __neltumeStarkenFirma?: Buffer };

/**
 * Clave derivada de BETTER_AUTH_SECRET (sin usarla directamente). Sin secreto (desarrollo) se usa una clave
 * aleatoria del proceso: las firmas dejan de valer al reiniciar, y con 15 minutos de vigencia no importa.
 */
function clave(): Buffer {
  const secreto = process.env.BETTER_AUTH_SECRET?.trim();
  if (secreto && secreto.length >= 32)
    return Buffer.from(hkdfSync('sha256', secreto, 'neltume:starken', 'neltume:starken-tarifa:v1', 32));
  return (global.__neltumeStarkenFirma ??= randomBytes(32));
}

/** Datos que cubre la firma, en una forma sin ambigüedades (un arreglo JSON, no texto concatenado). */
const mensaje = (cotizacionId: string, t: DatosFirmados, vence: string) =>
  JSON.stringify([
    'starken-tarifa',
    2,
    cotizacionId,
    t.huellaBulto ?? null,
    t.codigoCiudadDestino,
    t.ciudadDestino,
    t.tipoEntrega,
    t.servicio ?? '',
    t.dias,
    t.costoTotal,
    vence,
  ]);
const hmac = (cotizacionId: string, t: DatosFirmados, vence: string) =>
  createHmac('sha256', clave())
    .update(mensaje(cotizacionId, t, vence))
    .digest();

/** Firma una tarifa para esa cotización; vale `VIGENCIA_FIRMA_MS` desde `ahora`. */
export function firmarTarifa(cotizacionId: string, t: DatosFirmados, ahora = Date.now()) {
  const vence = new Date(ahora + VIGENCIA_FIRMA_MS).toISOString();
  return { vence, firma: hmac(cotizacionId, t, vence).toString('base64url') };
}

/** Comprueba, sin consultar a nadie, que la tarifa la firmó este servidor para esa cotización y que no venció. */
export function verificarTarifa(
  cotizacionId: string,
  t: TarifaStarkenAplicada,
  ahora = Date.now(),
): EstadoFirma {
  if (typeof t.firma !== 'string' || typeof t.vence !== 'string') return 'invalida';
  const esperada = hmac(cotizacionId, t, t.vence);
  const recibida = Buffer.from(t.firma, 'base64url');
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return 'invalida';
  const vence = Date.parse(t.vence);
  return Number.isNaN(vence) || vence < ahora ? 'vencida' : 'valida';
}

/** Huella del pedido que se firma con cada tarifa: al aplicarla, la de las líneas que quedarán debe ser la misma. */
export const huellaBulto = (lineas: readonly LineaPedido[]) =>
  createHash('sha256').update(clavePedido(lineas)).digest('hex');

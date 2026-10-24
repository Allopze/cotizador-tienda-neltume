import type { Fabrica } from '../negocio/estado';

/**
 * Fábricas con integración automática. Solo Panguipulli: una nota de Santiago nunca se encola, aunque alguien
 * defina variables para ella. Se compara el identificador interno (`Fabrica`), nunca el nombre que se muestra.
 */
export const FABRICAS_INTEGRADAS: readonly Fabrica[] = ['panguipulli'];
export const fabricaIntegrada = (fabrica: Fabrica | null | undefined): fabrica is Fabrica =>
  !!fabrica && FABRICAS_INTEGRADAS.includes(fabrica);

/** Mínimo del secreto compartido: el mismo largo que se exige a BETTER_AUTH_SECRET. */
export const LARGO_MINIMO_SECRETO = 32;
const TIMEOUT_PREDETERMINADO_MS = 20_000;
const HOSTNAMES_LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface ConfiguracionIntegracion {
  /** Origen de la aplicación de la fábrica, sin barra final (https://fabrica.example.cl). */
  url: string;
  secreto: string;
  timeoutMs: number;
}

/** Prefijo de las variables de cada fábrica: NELTUME_FABRICA_PANGUIPULLI_URL y _SECRETO. */
const prefijo = (fabrica: Fabrica) => `NELTUME_FABRICA_${fabrica.toUpperCase()}`;

/** HTTPS; HTTP solo para una instancia local, como Starken. Sin usuario ni clave en la URL. */
function urlSegura(url: string) {
  if (!URL.canParse(url)) return false;
  const { protocol, hostname, username, password, search, hash } = new URL(url);
  if (username || password || search || hash) return false;
  return protocol === 'https:' || (protocol === 'http:' && HOSTNAMES_LOOPBACK.has(hostname));
}

export type EstadoConfiguracion = 'configurada' | 'sin_configurar' | 'incompleta';

/** Estado de las variables de `fabrica` (sin mostrar el secreto), para /api/salud y `npm run integracion`. */
export function estadoConfiguracion(fabrica: Fabrica, env: Record<string, string | undefined> = process.env): EstadoConfiguracion {
  if (!fabricaIntegrada(fabrica)) return 'sin_configurar';
  if (configuracionFabrica(fabrica, env)) return 'configurada';
  const algo = [`${prefijo(fabrica)}_URL`, `${prefijo(fabrica)}_SECRETO`].some((k) => env[k]?.trim());
  return algo ? 'incompleta' : 'sin_configurar';
}

/**
 * Configuración de la integración con `fabrica`, o null si no está activa: la fábrica no está integrada, falta la URL
 * o el secreto, la URL no es HTTPS o el secreto es corto. Sin configuración no se encola nada nuevo.
 */
export function configuracionFabrica(
  fabrica: Fabrica,
  env: Record<string, string | undefined> = process.env,
): ConfiguracionIntegracion | null {
  if (!fabricaIntegrada(fabrica)) return null;
  const url = env[`${prefijo(fabrica)}_URL`]?.trim().replace(/\/+$/, '');
  const secreto = env[`${prefijo(fabrica)}_SECRETO`]?.trim();
  if (!url || !secreto || !urlSegura(url) || secreto.length < LARGO_MINIMO_SECRETO) return null;
  const timeout = Number(env.NELTUME_FABRICA_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? Math.min(120_000, Math.max(1_000, Math.round(timeout))) : TIMEOUT_PREDETERMINADO_MS;
  return { url, secreto, timeoutMs };
}

import { accessSync, constants, readdirSync, statfsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { estadoClaveCommandCode } from '@/servidor/ajustes-ia';
import { validarConfiguracionAutenticacion } from '@/servidor/autenticacion-config';
import { abrirBaseDatos, directorioDatos, VERSION_ESQUEMA } from '@/servidor/base-datos';
import { chromiumPath } from '@/servidor/chromium';
import { sincronizacionActiva } from '@/servidor/feriados-sync';
import { prepararPdf } from '@/servidor/pdf';
import { leerEntornoStarken } from '@/servidor/starken';
import { leerConfiguracionStarken } from '@/servidor/starken-configuracion';

/**
 * Comprobaciones de /api/salud. `error` significa que el cotizador no puede cumplir su función principal (cotizar,
 * guardar, emitir PDF) y hace fallar el healthcheck; `aviso`, que algo pide atención sin detener el trabajo.
 * Nunca incluyen secretos: solo si la clave de IA existe y se puede leer, no la clave.
 */
export type EstadoComprobacion = 'ok' | 'aviso' | 'error';
export interface Comprobacion {
  estado: EstadoComprobacion;
  detalle: string;
  [dato: string]: unknown;
}

const MB = 1024 * 1024;
/** Bajo este espacio libre SQLite empieza a fallar al guardar: el healthcheck se pone en rojo. */
const ESPACIO_CRITICO = 256 * MB;
/** Bajo este, aviso: conviene limpiar o ampliar antes de llegar al crítico. */
const ESPACIO_AVISO = 2048 * MB;
const HORA = 60 * 60 * 1000;
/** El respaldo es diario: más de dos días sin uno indica que el cron dejó de correr. */
const RESPALDO_VENCIDO_MS = 48 * HORA;
/** Los feriados se sincronizan a diario; una semana sin lograrlo merece revisarse. */
const FERIADOS_VENCIDOS_MS = 7 * 24 * HORA;

const textoError = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

function comprobarBase(): Comprobacion {
  try {
    const db = abrirBaseDatos();
    db.prepare('SELECT 1').get();
    const version = db.pragma('user_version', { simple: true }) as number;
    return version === VERSION_ESQUEMA
      ? { estado: 'ok', detalle: 'La base de datos responde.', versionEsquema: version }
      : {
          estado: 'error',
          detalle: `La base tiene el esquema ${version} y este cotizador espera el ${VERSION_ESQUEMA}.`,
          versionEsquema: version,
          versionEsperada: VERSION_ESQUEMA,
        };
  } catch (error) {
    return { estado: 'error', detalle: `No se pudo abrir la base de datos: ${textoError(error)}` };
  }
}

function comprobarAutenticacion(): Comprobacion {
  try {
    validarConfiguracionAutenticacion();
    return { estado: 'ok', detalle: 'La configuración de inicio de sesión es válida.' };
  } catch (error) {
    return { estado: 'error', detalle: textoError(error) };
  }
}

function comprobarDisco(directorio = directorioDatos()): Comprobacion {
  try {
    const { bavail, bsize } = statfsSync(directorio);
    const libres = bavail * bsize;
    const libresMb = Math.floor(libres / MB);
    if (libres < ESPACIO_CRITICO)
      return {
        estado: 'error',
        detalle: `Quedan ${libresMb} MB libres en el disco de datos: guardar y emitir pueden fallar.`,
        libresMb,
      };
    if (libres < ESPACIO_AVISO)
      return { estado: 'aviso', detalle: `Quedan ${libresMb} MB libres en el disco de datos.`, libresMb };
    return { estado: 'ok', detalle: `${libresMb} MB libres en el disco de datos.`, libresMb };
  } catch (error) {
    return { estado: 'error', detalle: `No se pudo leer el espacio libre: ${textoError(error)}` };
  }
}

/** Plazo para que Chromium arranque y abra una página: menos que el timeout del healthcheck de Compose (10 s). */
const PLAZO_CHROMIUM_SALUD_MS = 8_000;
/**
 * Lanzar Chromium cuesta un par de segundos y memoria: el healthcheck corre cada 30 s, así que un arranque exitoso se
 * recuerda 10 minutos. Una falla se recuerda solo 1 minuto, para que se note pronto cuando se corrige.
 */
const CHROMIUM_OK_VIGENTE_MS = 10 * 60 * 1000;
const CHROMIUM_FALLA_VIGENTE_MS = 60 * 1000;

interface ArranqueChromium {
  ruta: string;
  hasta: number;
  comprobado: number;
  error: string | null;
}
let ultimoArranque: ArranqueChromium | null = null;
let arranqueEnCurso: Promise<ArranqueChromium> | null = null;

/** Arranca Chromium de verdad (el mismo navegador compartido de los PDF) y abre una página, con plazo corto. */
async function arrancarChromium(ruta: string, ahora: number): Promise<ArranqueChromium> {
  if (ultimoArranque?.ruta === ruta && ahora < ultimoArranque.hasta) return ultimoArranque;
  // Dos healthchecks simultáneos (o el healthcheck y una administradora) comparten el mismo intento.
  arranqueEnCurso ??= prepararPdf(PLAZO_CHROMIUM_SALUD_MS)
    .then(
      () => null,
      (error: unknown) => textoError(error).replace(/^No se pudo preparar Chromium[^:]*: /, ''),
    )
    .then((error) => {
      const comprobado = Date.now();
      ultimoArranque = {
        ruta,
        comprobado,
        error,
        hasta: comprobado + (error ? CHROMIUM_FALLA_VIGENTE_MS : CHROMIUM_OK_VIGENTE_MS),
      };
      return ultimoArranque;
    })
    .finally(() => {
      arranqueEnCurso = null;
    });
  return arranqueEnCurso;
}

/**
 * Chromium instalado y capaz de arrancar: sin él no se emiten PDF, así que una falla pone el healthcheck en rojo (y
 * una actualización que no lo arranca no pasa `docker compose up --wait`). El arranque se comprueba como mucho cada
 * 10 minutos (ver CHROMIUM_OK_VIGENTE_MS).
 */
async function comprobarChromium(ahora = Date.now()): Promise<Comprobacion> {
  const ruta = chromiumPath();
  if (!ruta) return { estado: 'error', detalle: 'No se encontró Chromium: no se pueden generar los PDF.' };
  try {
    accessSync(ruta, constants.X_OK);
  } catch {
    return { estado: 'error', detalle: `Chromium no existe o no se puede ejecutar en ${ruta}.`, ruta };
  }
  const arranque = await arrancarChromium(ruta, ahora);
  const comprobado = new Date(arranque.comprobado).toISOString();
  return arranque.error
    ? {
        estado: 'error',
        detalle: `Chromium está instalado pero no arranca: ${arranque.error}`,
        ruta,
        comprobado,
      }
    : { estado: 'ok', detalle: 'Chromium arranca y abre páginas.', ruta, comprobado };
}

/**
 * Despacho con Starken: es opcional, así que sin configurar no es un aviso. Solo dice si hay credenciales completas
 * y ciudad de origen; nunca las muestra ni llama a Starken.
 */
function comprobarStarken(): Comprobacion {
  const credenciales = leerEntornoStarken() !== null;
  const algunaVariable = Object.keys(process.env).some((k) => k.startsWith('STARKEN_') && process.env[k]?.trim());
  let origen = false;
  try {
    origen = leerConfiguracionStarken().origen !== null;
  } catch {
    // Sin base no hay origen guardado; la comprobación de la base ya informa el problema.
  }
  if (!credenciales)
    return algunaVariable
      ? {
          estado: 'aviso',
          detalle:
            'Starken está a medio configurar: faltan variables STARKEN_ o la URL no es HTTPS. El botón de despacho sigue desactivado.',
          configurado: false,
        }
      : { estado: 'ok', detalle: 'Starken no está configurado (es opcional).', configurado: false };
  if (!origen)
    return {
      estado: 'aviso',
      detalle: 'Starken tiene credenciales, pero falta elegir la ciudad de origen en Ajustes.',
      configurado: false,
    };
  return { estado: 'ok', detalle: 'Starken está configurado.', configurado: true };
}

function comprobarIA(): Comprobacion {
  try {
    const { configurada, fuente } = estadoClaveCommandCode();
    if (configurada) return { estado: 'ok', detalle: 'La clave de IA está configurada y se puede leer.', fuente };
    if (fuente === 'ilegible')
      return {
        estado: 'aviso',
        detalle:
          'La clave de IA guardada ya no se puede leer (cambió BETTER_AUTH_SECRET). Vuelve a ingresarla en Ajustes.',
        fuente,
      };
    return { estado: 'aviso', detalle: 'No hay clave de IA: el asistente no responde.', fuente };
  } catch (error) {
    return { estado: 'aviso', detalle: `No se pudo revisar la clave de IA: ${textoError(error)}` };
  }
}

function comprobarFeriados(ahora = new Date()): Comprobacion {
  if (!sincronizacionActiva())
    return { estado: 'ok', detalle: 'Sincronización de feriados desactivada (NELTUME_FERIADOS_SYNC=0).' };
  try {
    const fila = abrirBaseDatos()
      .prepare(
        `SELECT MAX(sincronizado) AS ultima,
                (SELECT error FROM feriados_sincronizacion WHERE error IS NOT NULL ORDER BY intentado DESC LIMIT 1) AS error
         FROM feriados_sincronizacion`,
      )
      .get() as { ultima: string | null; error: string | null };
    if (!fila.ultima)
      return {
        estado: 'aviso',
        detalle: 'Los feriados nunca se han sincronizado; se usan las reglas calculadas.',
        ultimoError: fila.error,
      };
    const vencida = ahora.getTime() - Date.parse(fila.ultima) > FERIADOS_VENCIDOS_MS;
    return {
      estado: vencida ? 'aviso' : 'ok',
      detalle: vencida
        ? 'Hace más de una semana que no se sincronizan los feriados.'
        : 'Feriados sincronizados.',
      ultimaSincronizacion: fila.ultima,
      ...(vencida && fila.error ? { ultimoError: fila.error } : {}),
    };
  } catch (error) {
    return { estado: 'aviso', detalle: `No se pudo revisar los feriados: ${textoError(error)}` };
  }
}

/** Fecha de una carpeta `cotizador-<ISO con : y . cambiados por ->` de `npm run respaldar`. */
function fechaRespaldo(directorio: string, nombre: string) {
  const iso = nombre
    .slice('cotizador-'.length)
    .replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, '$1:$2:$3.$4Z');
  const fecha = Date.parse(iso);
  return Number.isNaN(fecha) ? statSync(join(directorio, nombre)).mtimeMs : fecha;
}

function comprobarRespaldo(ahora = new Date()): Comprobacion {
  const directorio = resolve(/* turbopackIgnore: true */ process.env.NELTUME_RESPALDO_DIR ?? 'respaldos');
  try {
    const carpetas = readdirSync(directorio, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('cotizador-'))
      .map((e) => fechaRespaldo(directorio, e.name));
    if (!carpetas.length) return { estado: 'aviso', detalle: 'No hay respaldos en la carpeta de respaldos.' };
    const ultimo = Math.max(...carpetas);
    const vencido = ahora.getTime() - ultimo > RESPALDO_VENCIDO_MS;
    return {
      estado: vencido ? 'aviso' : 'ok',
      detalle: vencido ? 'El último respaldo tiene más de dos días.' : 'Hay un respaldo reciente.',
      ultimoRespaldo: new Date(ultimo).toISOString(),
      cantidad: carpetas.length,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { estado: 'aviso', detalle: 'Todavía no hay respaldos (la carpeta no existe).' };
    return { estado: 'aviso', detalle: `No se pudo revisar los respaldos: ${textoError(error)}` };
  }
}

/**
 * Lo que mira el healthcheck: cada 30 segundos y sin sesión. Todo es barato salvo el arranque de Chromium, que se
 * recuerda 10 minutos.
 */
export async function comprobacionesBasicas(): Promise<Record<string, Comprobacion>> {
  return {
    base: comprobarBase(),
    autenticacion: comprobarAutenticacion(),
    disco: comprobarDisco(),
    chromium: await comprobarChromium(),
  };
}

/** Detalle para una persona administradora. La IA se revisa sin llamarla: solo si la clave existe y se puede leer. */
export async function comprobacionesCompletas(ahora = new Date()): Promise<Record<string, Comprobacion>> {
  return {
    ...(await comprobacionesBasicas()),
    ia: comprobarIA(),
    starken: comprobarStarken(),
    feriados: comprobarFeriados(ahora),
    respaldo: comprobarRespaldo(ahora),
  };
}

export const todoBien = (comprobaciones: Record<string, Comprobacion>) =>
  Object.values(comprobaciones).every((c) => c.estado !== 'error');

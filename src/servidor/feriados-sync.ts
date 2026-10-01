import type Database from 'better-sqlite3';
import { z } from 'zod';
import { registrarFeriadosExternos } from '../negocio/feriados';
import { fechaLocal } from '../negocio/vigencia';
import { registrarError } from './errores';

// Sincroniza los feriados de Chile desde una fuente pública para cubrir los decretados por única vez
// (leyes puntuales, elecciones) que las reglas de src/negocio/feriados.ts no pueden anticipar.
// Lo sincronizado se suma a lo calculado; sin conexión se usan las reglas y lo último guardado.

/** Fuente pública (boostr.cl): incluye feriados legales, puntuales y electorales. */
export const URL_FERIADOS = (anio: number) => `https://api.boostr.cl/holidays/${anio}.json`;
/** Se refresca una vez al día; tras un fallo se reintenta a la hora. */
const VIGENCIA_MS = 24 * 60 * 60 * 1000,
  REINTENTO_MS = 60 * 60 * 1000;
/** Espera máxima al emitir cuando un año nunca se ha sincronizado; si no, se refresca en segundo plano. */
export const ESPERA_PRIMERA_MS = 3000;

const respuestaSchema = z.object({
  status: z.literal('success'),
  data: z.array(z.object({ date: z.iso.date(), title: z.string().max(300) })).max(80),
});

type Obtener = (url: string, init: RequestInit) => Promise<Response>;
type FilaSincronizacion = { anio: number; sincronizado: string | null; intentado: string };

/** Desactivable con NELTUME_FERIADOS_SYNC=0 (pruebas, instalaciones sin salida a internet). */
export const sincronizacionActiva = () => process.env.NELTUME_FERIADOS_SYNC !== '0';

/** Carga en memoria los feriados guardados para que los use el cálculo de días hábiles. */
export function cargarFeriadosGuardados(db: Database.Database) {
  const filas = db
    .prepare('SELECT fecha FROM feriados')
    .all() as { fecha: string }[];
  registrarFeriadosExternos(filas.map((f) => f.fecha));
}

export async function sincronizarAnio(db: Database.Database, anio: number, obtener: Obtener = fetch) {
  const intentado = new Date().toISOString();
  try {
    const r = await obtener(URL_FERIADOS(anio), {
      signal: AbortSignal.timeout(ESPERA_PRIMERA_MS * 2),
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const parsed = respuestaSchema.safeParse(await r.json());
    if (!parsed.success) throw new Error('respuesta con formato inesperado');
    const feriados = parsed.data.data.filter((f) => f.date.startsWith(`${anio}-`));
    // Una lista vacía o casi vacía es un error de la fuente: no borra lo que ya se tenía.
    if (feriados.length < 5) throw new Error(`solo ${feriados.length} feriados para ${anio}`);
    db.transaction(() => {
      db.prepare('DELETE FROM feriados WHERE anio = ?').run(anio);
      const insertar = db.prepare('INSERT OR REPLACE INTO feriados (fecha, anio, nombre) VALUES (?, ?, ?)');
      for (const f of feriados) insertar.run(f.date, anio, f.title);
      db.prepare(
        `INSERT INTO feriados_sincronizacion (anio, sincronizado, intentado, error) VALUES (?, ?, ?, NULL)
         ON CONFLICT(anio) DO UPDATE SET sincronizado = excluded.sincronizado, intentado = excluded.intentado, error = NULL`,
      ).run(anio, intentado, intentado);
    }).immediate();
    return { ok: true as const, cantidad: feriados.length };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    db.prepare(
      `INSERT INTO feriados_sincronizacion (anio, sincronizado, intentado, error) VALUES (?, NULL, ?, ?)
       ON CONFLICT(anio) DO UPDATE SET intentado = excluded.intentado, error = excluded.error`,
    ).run(anio, intentado, mensaje.slice(0, 300));
    registrarError('feriados', `No se sincronizaron los feriados de ${anio}: ${mensaje}`);
    return { ok: false as const, error: mensaje };
  }
}

let enCurso: Promise<unknown> | null = null;

/**
 * Deja listos los feriados del año en curso y del siguiente (una vigencia puede cruzar el año).
 * Carga lo guardado; si está desactualizado lo refresca en segundo plano, y solo espera (con tope)
 * cuando un año nunca se ha sincronizado. Nunca lanza: un fallo deja las reglas calculadas.
 */
export async function prepararFeriados(
  db: Database.Database,
  { ahora = new Date(), obtener = fetch as Obtener, forzar = false } = {},
) {
  try {
    cargarFeriadosGuardados(db);
    if (!forzar && !sincronizacionActiva()) return;
    const anio = Number(fechaLocal(ahora).slice(0, 4));
    const estado = new Map(
      (
        db
          .prepare('SELECT anio, sincronizado, intentado FROM feriados_sincronizacion')
          .all() as FilaSincronizacion[]
      ).map((f) => [f.anio, f]),
    );
    const pendientes = [anio, anio + 1].filter((a) => {
      if (forzar) return true;
      const e = estado.get(a);
      if (!e) return true;
      const ultimo = Date.parse(e.intentado);
      return e.sincronizado
        ? ahora.getTime() - Date.parse(e.sincronizado) > VIGENCIA_MS &&
            ahora.getTime() - ultimo > REINTENTO_MS
        : ahora.getTime() - ultimo > REINTENTO_MS;
    });
    if (!pendientes.length) return;
    const nuncaSincronizado = pendientes.some((a) => !estado.get(a)?.sincronizado);
    enCurso ??= Promise.all(pendientes.map((a) => sincronizarAnio(db, a, obtener)))
      .then(() => cargarFeriadosGuardados(db))
      .finally(() => {
        enCurso = null;
      });
    const tarea = enCurso;
    if (forzar) await tarea;
    else if (nuncaSincronizado)
      await Promise.race([tarea, new Promise((r) => setTimeout(r, ESPERA_PRIMERA_MS).unref?.())]);
  } catch (error) {
    registrarError('feriados', error);
  }
}

/** Estado para diagnóstico (script `npm run feriados`). */
export function estadoFeriados(db: Database.Database) {
  return {
    sincronizaciones: db
      .prepare('SELECT anio, sincronizado, intentado, error FROM feriados_sincronizacion ORDER BY anio')
      .all() as (FilaSincronizacion & { error: string | null })[],
    feriados: db
      .prepare('SELECT fecha, nombre FROM feriados ORDER BY fecha')
      .all() as {
      fecha: string;
      nombre: string;
    }[],
  };
}

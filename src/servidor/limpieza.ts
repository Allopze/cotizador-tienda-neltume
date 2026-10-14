import type Database from 'better-sqlite3';
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { compactarLogo } from './pdf';

// Datos que crecen sin que nadie los mire (npm run limpiar-borradores, a diario desde scripts/respaldo-diario.sh).
// Cada función lista lo que se borraría; el script borra solo con --confirmar. Nada de esto es un documento vigente:
// los snapshots de cotizaciones emitidas, aprobadas o reemplazadas y los PDF originales no se tocan nunca.

const DIA_MS = 86_400_000;
/** La auditoría de cuentas se conserva un año. */
export const DIAS_AUDITORIA = 365;
/** proper-lockfile renueva data/.estado.lock cada 15 s: uno sin tocar hace 10 minutos quedó de un proceso caído. */
export const LOCK_VENCIDO_MS = 10 * 60_000;
/** Un PDF temporal vive lo que dura una impresión (máx. 30 s): uno de más de una hora quedó de un proceso caído. */
export const TEMPORAL_VENCIDO_MS = 60 * 60_000;
/** `.<uuid>.pdf`: el archivo temporal de generarPdf antes de enlazarlo con su nombre definitivo. */
const TEMPORAL_PDF = /^\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;

const limite = (ahora: Date, dias: number) => new Date(ahora.getTime() - dias * DIA_MS).toISOString();

export interface SnapshotPurgable {
  archivo: string;
  cotizacionId: string;
  numero: number | null;
  /** `anulada`: la cotización se anuló hace más del plazo; `sin-cotizacion`: la cotización ya no existe. */
  motivo: 'anulada' | 'sin-cotizacion';
  fecha: string | null;
}

const CONDICION_SNAPSHOT = `(c.id IS NULL OR (c.estado = 'anulada' AND COALESCE(c.fecha_anulacion, c.actualizada) < @limite))`;

/**
 * Snapshots del HTML de documentos que ya no se van a regenerar tal cual: los de cotizaciones anuladas hace más de
 * `dias` días (su copia «ANULADA» se arma desde la cotización, no del snapshot) y los de cotizaciones que ya no
 * existen. Los de emitidas, aprobadas o reemplazadas se conservan siempre.
 */
export function snapshotsPurgables(db: Database.Database, dias: number, ahora = new Date()): SnapshotPurgable[] {
  const filas = db
    .prepare(
      `SELECT s.archivo, s.cotizacion_id AS cotizacionId, c.numero, c.id IS NULL AS sinCotizacion,
              COALESCE(c.fecha_anulacion, c.actualizada) AS fecha
       FROM documentos_snapshot s LEFT JOIN cotizaciones c ON c.id = s.cotizacion_id
       WHERE ${CONDICION_SNAPSHOT}
       ORDER BY fecha, s.archivo`,
    )
    .all({ limite: limite(ahora, dias) }) as (Omit<SnapshotPurgable, 'motivo'> & { sinCotizacion: number })[];
  return filas.map(({ sinCotizacion, ...f }) => ({ ...f, motivo: sinCotizacion ? 'sin-cotizacion' : 'anulada' }));
}

/** Borra los snapshots listados que siguen cumpliendo la condición (la cotización pudo cambiar entretanto). */
export function purgarSnapshots(
  db: Database.Database,
  snapshots: Pick<SnapshotPurgable, 'archivo' | 'cotizacionId'>[],
  dias: number,
  ahora = new Date(),
) {
  const borrar = db.prepare(
    `DELETE FROM documentos_snapshot WHERE archivo = @archivo AND cotizacion_id = @cotizacionId
       AND EXISTS (SELECT 1 FROM documentos_snapshot s LEFT JOIN cotizaciones c ON c.id = s.cotizacion_id
                   WHERE s.archivo = @archivo AND ${CONDICION_SNAPSHOT})`,
  );
  const lim = limite(ahora, dias);
  return db
    .transaction(() =>
      snapshots.reduce(
        (n, s) => n + borrar.run({ archivo: s.archivo, cotizacionId: s.cotizacionId, limite: lim }).changes,
        0,
      ),
    )
    .immediate();
}

/**
 * Snapshots guardados antes de que el logo fuera una referencia (pdf.ts, inyectarLogo): llevan el SVG en base64 en
 * cada documento. Compactarlos no cambia el documento regenerado mientras el logo vigente sea el mismo.
 */
export function snapshotsCompactables(db: Database.Database) {
  const filas = db
    .prepare(
      `SELECT archivo, cotizacion_id AS cotizacionId, html FROM documentos_snapshot
       WHERE html LIKE '%<img alt="Neltume" src="data:image/svg+xml;base64,%'`,
    )
    .all() as { archivo: string; cotizacionId: string; html: string }[];
  return filas.flatMap(({ archivo, cotizacionId, html }) => {
    const compacto = compactarLogo(html);
    return compacto === html ? [] : [{ archivo, cotizacionId, ahorro: html.length - compacto.length }];
  });
}

export function compactarSnapshots(db: Database.Database, archivos: { archivo: string; cotizacionId: string }[]) {
  const leer = db.prepare('SELECT html FROM documentos_snapshot WHERE archivo = ? AND cotizacion_id = ?');
  const escribir = db.prepare('UPDATE documentos_snapshot SET html = ? WHERE archivo = ? AND cotizacion_id = ?');
  return db
    .transaction(() => {
      let n = 0;
      for (const { archivo, cotizacionId } of archivos) {
        const fila = leer.get(archivo, cotizacionId) as { html: string } | undefined;
        if (!fila) continue;
        const compacto = compactarLogo(fila.html);
        if (compacto !== fila.html) n += escribir.run(compacto, archivo, cotizacionId).changes;
      }
      return n;
    })
    .immediate();
}

/** Registros de auditoría de cuentas con más de un año. */
export function auditoriaAntigua(db: Database.Database, ahora = new Date()) {
  const fila = db
    .prepare('SELECT COUNT(*) AS cantidad, MIN(fecha) AS desde FROM auditoria_cuentas WHERE fecha < ?')
    .get(limite(ahora, DIAS_AUDITORIA)) as { cantidad: number; desde: string | null };
  return fila;
}

export function purgarAuditoria(db: Database.Database, ahora = new Date()) {
  return db.prepare('DELETE FROM auditoria_cuentas WHERE fecha < ?').run(limite(ahora, DIAS_AUDITORIA)).changes;
}

export interface ArchivoPurgable {
  /** Ruta relativa a la carpeta de datos. */
  ruta: string;
  modificado: Date;
  tamano: number;
}

async function archivosDe(carpeta: string, prefijo: string, filtro: (nombre: string) => boolean) {
  const nombres = await readdir(carpeta).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [] as string[];
    throw error;
  });
  const archivos: ArchivoPurgable[] = [];
  for (const nombre of nombres.filter(filtro).sort()) {
    const info = await stat(join(carpeta, nombre)).catch(() => null);
    if (info?.isFile()) archivos.push({ ruta: join(prefijo, nombre), modificado: info.mtime, tamano: info.size });
  }
  return archivos;
}

/**
 * Copias «ANULADA» de más de `dias` días: documentoAnulado (documentos.ts) las vuelve a generar si alguien las pide.
 * El PDF original de una anulada no se toca.
 */
export async function pdfAnuladosAntiguos(directorio: string, dias: number, ahora = new Date()) {
  const corte = ahora.getTime() - dias * DIA_MS;
  return (await archivosDe(join(directorio, 'pdf'), 'pdf', (n) => !n.startsWith('.') && n.endsWith('-anulada.pdf')))
    .filter((a) => a.modificado.getTime() < corte);
}

/** PDF temporales (`.<uuid>.pdf`) que dejó una impresión interrumpida hace más de una hora. */
export async function temporalesHuerfanos(directorio: string, ahora = new Date()) {
  const corte = ahora.getTime() - TEMPORAL_VENCIDO_MS;
  return (await archivosDe(join(directorio, 'pdf'), 'pdf', (n) => TEMPORAL_PDF.test(n))).filter(
    (a) => a.modificado.getTime() < corte,
  );
}

/** data/.estado.lock de un proceso que terminó sin soltarlo; null si no hay o si está vigente. */
export async function lockVencido(directorio: string, ahora = new Date()) {
  const info = await stat(join(directorio, '.estado.lock')).catch(() => null);
  if (!info || ahora.getTime() - info.mtimeMs < LOCK_VENCIDO_MS) return null;
  return { ruta: '.estado.lock', modificado: info.mtime, tamano: 0 } satisfies ArchivoPurgable;
}

/** Borra los archivos listados (rutas relativas a `directorio`); devuelve cuántos borró. */
export async function eliminarArchivos(directorio: string, archivos: Pick<ArchivoPurgable, 'ruta'>[]) {
  let n = 0;
  for (const { ruta } of archivos) {
    const absoluta = join(directorio, ruta);
    if (!(await stat(absoluta).catch(() => null))) continue;
    // El lock de proper-lockfile es una carpeta; los PDF, archivos.
    await rm(absoluta, { recursive: ruta === '.estado.lock', force: true });
    n++;
  }
  return n;
}

/** Re-chequea el lock justo antes de borrarlo: si alguien lo renovó entretanto, se deja. */
export async function eliminarLockVencido(directorio: string, ahora = new Date()) {
  const lock = await lockVencido(directorio, ahora);
  return lock ? eliminarArchivos(directorio, [lock]) : 0;
}

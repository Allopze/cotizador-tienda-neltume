import type Database from 'better-sqlite3';
import { z } from 'zod';
import { cargarFeriadosGuardados } from './feriados-sync';

export const feriadoManualSchema = z.object({
  fecha: z.iso.date(),
  nombre: z.string().trim().min(1).max(200),
});

export type FeriadoManual = { fecha: string; nombre: string; creada: string };

export function listarFeriadosManuales(db: Database.Database): FeriadoManual[] {
  return db
    .prepare('SELECT fecha, nombre, creada FROM feriados_manuales ORDER BY fecha')
    .all() as FeriadoManual[];
}

export function guardarFeriadoManual(db: Database.Database, fecha: string, nombre: string) {
  db.prepare(
    `INSERT INTO feriados_manuales (fecha, nombre, creada) VALUES (?, ?, ?)
     ON CONFLICT(fecha) DO UPDATE SET nombre = excluded.nombre, creada = excluded.creada`,
  ).run(fecha, nombre.trim(), new Date().toISOString());
  cargarFeriadosGuardados(db);
  return listarFeriadosManuales(db);
}

export function eliminarFeriadoManual(db: Database.Database, fecha: string) {
  db.prepare('DELETE FROM feriados_manuales WHERE fecha = ?').run(fecha);
  cargarFeriadosGuardados(db);
  return listarFeriadosManuales(db);
}

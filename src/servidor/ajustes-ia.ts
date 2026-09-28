import type Database from 'better-sqlite3';
import {
  ajustesIAGuardadosSchema,
  ajustesIASchema,
  ajustesPredeterminados,
  type AjustesIA,
} from '../asistente/ajustes';
import { CommandCodeLLM, type LLM } from '../asistente/llm';
import { abrirBaseDatos } from './base-datos';

const CLAVE = 'ia';

export function leerAjustesIA(db: Database.Database = abrirBaseDatos()): AjustesIA {
  const predeterminados = ajustesPredeterminados(process.env.CMD_MODEL);
  const fila = db.prepare('SELECT valor_json FROM ajustes WHERE clave = ?').get(CLAVE) as
    { valor_json: string } | undefined;
  if (!fila) return predeterminados;
  try {
    const guardados = ajustesIAGuardadosSchema.safeParse(JSON.parse(fila.valor_json));
    return guardados.success ? guardados.data : predeterminados;
  } catch {
    return predeterminados;
  }
}

export function guardarAjustesIA(ajustes: AjustesIA, db: Database.Database = abrirBaseDatos()): AjustesIA {
  const validos = ajustesIASchema.parse(ajustes);
  db.prepare(
    `INSERT INTO ajustes (clave, valor_json, actualizada) VALUES (?, ?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor_json = excluded.valor_json, actualizada = excluded.actualizada`,
  ).run(CLAVE, JSON.stringify(validos), new Date().toISOString());
  return validos;
}

export function asistenteConfigurado(): boolean {
  return !!process.env.CMD_API_KEY;
}

export function crearLLM(ajustes: AjustesIA = leerAjustesIA()): LLM {
  return new CommandCodeLLM(ajustes.commandcode.modelo);
}

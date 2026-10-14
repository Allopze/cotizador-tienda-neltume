import type Database from 'better-sqlite3';
import { abrirBaseDatos } from './base-datos';
import { registrarError } from './errores';

/**
 * Registro de quién creó, editó, desactivó, activó o restableció la contraseña de qué cuenta (tabla
 * auditoria_cuentas, esquema 22). Se guarda el correo de cada parte tal como era en ese momento: si después cambia,
 * el registro sigue diciendo a quién se refería. Nunca se guardan contraseñas.
 */
export type AccionCuenta = 'crear' | 'crear-primera' | 'editar' | 'desactivar' | 'activar' | 'restablecer-clave';

export interface CambioCuenta {
  id: number;
  fecha: string;
  /** Correo de quien hizo el cambio; `terminal` o `primer arranque` si no fue desde Ajustes. */
  actor: string | null;
  objetivo: string | null;
  accion: string;
}

export const ACTOR_TERMINAL = 'terminal';
export const ACTOR_PRIMER_ARRANQUE = 'primer arranque';
export const LIMITE_CAMBIOS_CUENTAS = 50;

/** Registra un cambio ya hecho. Si el registro falla se anota en el servidor: el cambio de la cuenta no se revierte. */
export function registrarCambioCuenta(
  cambio: { actor: string | null; objetivo: string | null; accion: AccionCuenta },
  db: Database.Database = abrirBaseDatos(),
) {
  try {
    db.prepare('INSERT INTO auditoria_cuentas (fecha, actor, objetivo, accion) VALUES (?, ?, ?, ?)').run(
      new Date().toISOString(),
      cambio.actor?.slice(0, 300) ?? null,
      cambio.objetivo?.slice(0, 600) ?? null,
      cambio.accion,
    );
  } catch (error) {
    registrarError('auditoria-cuentas', error);
  }
}

/** Los últimos cambios, del más reciente al más antiguo. */
export function ultimosCambiosCuentas(
  limite = LIMITE_CAMBIOS_CUENTAS,
  db: Database.Database = abrirBaseDatos(),
): CambioCuenta[] {
  return db
    .prepare('SELECT id, fecha, actor, objetivo, accion FROM auditoria_cuentas ORDER BY id DESC LIMIT ?')
    .all(limite) as CambioCuenta[];
}

'use client';
import { guardarSesion, leerSesion } from './memoria-pantalla';

/**
 * Último mensaje del chat que respondió la IA en esta pestaña: qué modelo contestó, si fue el de respaldo y cuánto
 * tardó. La respuesta del chat lo trae en `diagnostico`; se guarda en sessionStorage para mostrarlo en
 * Ajustes → Asistente → Avanzado. Solo sirve para revisar el asistente: no lleva texto de la conversación.
 */
export interface DiagnosticoIA {
  modelo: string | null;
  respaldo: boolean;
  ms: number;
  /** Cuándo llegó la respuesta (ISO). */
  fecha: string;
}

const CLAVE = 'diagnostico-ia';

/** Lee el `diagnostico` de una respuesta del chat; null si no viene o no tiene la forma esperada. */
export function leerDiagnosticoRespuesta(respuesta: unknown, ahora = new Date()): DiagnosticoIA | null {
  const d = (respuesta as { diagnostico?: unknown } | null)?.diagnostico;
  if (!d || typeof d !== 'object') return null;
  const { modelo, respaldo, ms } = d as Record<string, unknown>;
  if (!(modelo === null || typeof modelo === 'string') || typeof respaldo !== 'boolean') return null;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  return { modelo, respaldo, ms: Math.round(ms), fecha: ahora.toISOString() };
}

/** Guarda el diagnóstico de una respuesta del chat; una respuesta sin él no borra el anterior. */
export function guardarDiagnosticoIA(respuesta: unknown) {
  const d = leerDiagnosticoRespuesta(respuesta);
  if (d) guardarSesion(CLAVE, d);
}

export function ultimoDiagnosticoIA(): DiagnosticoIA | null {
  const guardado = leerSesion<unknown>(CLAVE, null);
  const fecha = (guardado as { fecha?: unknown } | null)?.fecha;
  if (typeof fecha !== 'string' || Number.isNaN(Date.parse(fecha))) return null;
  return leerDiagnosticoRespuesta({ diagnostico: guardado }, new Date(fecha));
}

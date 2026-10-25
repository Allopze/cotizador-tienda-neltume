import type Database from 'better-sqlite3';
import type { Fabrica } from '../negocio/estado';

/**
 * Pruebas de conexión con la fábrica (tabla `integracion_pruebas`, esquema 27): el PDF de prueba que cada aplicación
 * envía a la otra desde Ajustes → «Conexión con la fábrica» (docs/integracion-fabrica.md, «Prueba de conexión»). Cada
 * fila es un envío o una recepción. El PDF solo se conserva en las últimas `PRUEBAS_CONSERVADAS` de cada dirección; la
 * fila sin el PDF queda como registro de auditoría hasta que la limpieza la borra (un año).
 */
export type DireccionPrueba = 'enviada' | 'recibida';
export type ResultadoPrueba = 'aceptada' | 'duplicada' | 'rechazada' | 'sin_respuesta' | 'recibida';

/** PDF de prueba que se conservan por dirección y fábrica. */
export const PRUEBAS_CONSERVADAS = 20;

export interface NuevaPrueba {
  direccion: DireccionPrueba;
  fabrica: Fabrica;
  eventoId: string;
  clave: string;
  fecha: Date;
  resultado: ResultadoPrueba;
  http?: number | null;
  codigo?: string | null;
  detalle?: string | null;
  latenciaMs?: number | null;
  /** Correo de quien apretó el botón (solo en lo enviado). */
  actor?: string | null;
  archivo: string;
  pdf: Buffer;
  sha256: string;
  /** Hash del cuerpo recibido: distingue un reenvío (mismo cuerpo) de un conflicto de idempotencia. */
  cuerpoSha256?: string | null;
}

/** Una fila de la lista de Ajustes: nunca lleva el PDF, solo si todavía se conserva. */
export interface PruebaListada {
  id: number;
  direccion: DireccionPrueba;
  /** El de la prueba: sus 8 primeros caracteres son el código corto que lleva el PDF, para cruzarlo con la otra app. */
  eventoId: string;
  fecha: string;
  resultado: ResultadoPrueba;
  http: number | null;
  codigo: string | null;
  detalle: string | null;
  latenciaMs: number | null;
  archivo: string;
  bytes: number;
  tienePdf: boolean;
}

/** Guarda la prueba y deja el PDF solo en las últimas de su dirección, en una misma transacción. Devuelve el id. */
export function guardarPrueba(db: Database.Database, p: NuevaPrueba): number {
  return db
    .transaction(() => {
      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO integracion_pruebas (direccion, fabrica, evento_id, clave_idempotencia, fecha, resultado, http, codigo,
             detalle, latencia_ms, actor, archivo, bytes, sha256, cuerpo_sha256, pdf)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          p.direccion,
          p.fabrica,
          p.eventoId,
          p.clave,
          p.fecha.toISOString(),
          p.resultado,
          p.http ?? null,
          p.codigo?.slice(0, 80) ?? null,
          p.detalle?.slice(0, 500) ?? null,
          p.latenciaMs ?? null,
          p.actor?.slice(0, 300) ?? null,
          p.archivo,
          p.pdf.length,
          p.sha256,
          p.cuerpoSha256 ?? null,
          p.pdf,
        );
      db.prepare(
        `UPDATE integracion_pruebas SET pdf = NULL
         WHERE direccion = ? AND fabrica = ? AND pdf IS NOT NULL
           AND id NOT IN (SELECT id FROM integracion_pruebas WHERE direccion = ? AND fabrica = ? ORDER BY id DESC LIMIT ?)`,
      ).run(p.direccion, p.fabrica, p.direccion, p.fabrica, PRUEBAS_CONSERVADAS);
      return Number(lastInsertRowid);
    })
    .immediate();
}

/** La prueba ya recibida con esa clave de idempotencia, si la hay. */
export function buscarRecibida(db: Database.Database, clave: string) {
  return db
    .prepare(
      `SELECT id, evento_id AS eventoId, fecha, cuerpo_sha256 AS cuerpoSha256 FROM integracion_pruebas
       WHERE direccion = 'recibida' AND clave_idempotencia = ?`,
    )
    .get(clave) as { id: number; eventoId: string; fecha: string; cuerpoSha256: string | null } | undefined;
}

/** Las últimas pruebas de `fabrica`, `limite` por dirección, de la más reciente a la más antigua. */
export function listarPruebas(db: Database.Database, fabrica: Fabrica, limite = PRUEBAS_CONSERVADAS): PruebaListada[] {
  const leer = db.prepare(
    `SELECT id, direccion, evento_id AS eventoId, fecha, resultado, http, codigo, detalle, latencia_ms AS latenciaMs,
       archivo, bytes, pdf IS NOT NULL AS tienePdf
     FROM integracion_pruebas WHERE direccion = ? AND fabrica = ? ORDER BY id DESC LIMIT ?`,
  );
  return (['enviada', 'recibida'] as const)
    .flatMap((direccion) =>
      (leer.all(direccion, fabrica, limite) as (Omit<PruebaListada, 'tienePdf'> & { tienePdf: number })[]).map((f) => ({
        ...f,
        tienePdf: !!f.tienePdf,
      })),
    )
    .sort((a, b) => b.id - a.id);
}

/** El PDF de una prueba que todavía lo conserva. */
export function leerPdfPrueba(db: Database.Database, id: number) {
  return db.prepare('SELECT archivo, pdf FROM integracion_pruebas WHERE id = ? AND pdf IS NOT NULL').get(id) as
    | { archivo: string; pdf: Buffer }
    | undefined;
}

/**
 * Integridad mínima de un PDF recibido: la cabecera, la cola y la tabla de referencias cruzadas a la que apunta. No lo
 * interpreta (la tienda no lleva un lector de PDF en producción): detecta lo que no es un PDF o llegó cortado.
 * Devuelve el motivo, o null si está íntegro.
 */
export function motivoPdfInvalido(bytes: Uint8Array): string | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < 32 || b.toString('latin1', 0, 5) !== '%PDF-') return 'no empieza con %PDF-';
  const cola = b.toString('latin1', Math.max(0, b.length - 1024));
  const fin = cola.lastIndexOf('%%EOF');
  if (fin < 0) return 'falta %%EOF al final';
  const inicio = cola.lastIndexOf('startxref', fin);
  if (inicio < 0) return 'falta startxref';
  const desplazamiento = /^\s*(\d{1,12})\s*$/.exec(cola.slice(inicio + 'startxref'.length, fin))?.[1];
  if (desplazamiento === undefined || Number(desplazamiento) >= b.length) return 'startxref apunta fuera del archivo';
  // La tabla de referencias es `xref` o, en un PDF con flujo de referencias, el objeto `/Type /XRef` que la contiene.
  const destino = b.toString('latin1', Number(desplazamiento), Number(desplazamiento) + 512);
  const valido = /^\s*xref/.test(destino) || (/^\s*\d+\s+\d+\s+obj/.test(destino) && /\/Type\s*\/XRef/.test(destino));
  return valido ? null : 'startxref no apunta a una tabla de referencias';
}

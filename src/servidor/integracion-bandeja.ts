import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Fabrica } from '../negocio/estado';
import { claveIdempotencia, type CancelacionFabrica, type EventoIntegracion, type PedidoFabrica } from './integracion-contrato';
import type { AdjuntoFabrica, EnvioPreparado } from './integracion-pedido';

/**
 * Bandeja de salida de la integración con fábrica (tabla `integracion_envios`, esquema 26). Cada fila es un evento
 * para la aplicación de una fábrica. Se escribe dentro de la misma transacción que la nota de pedido que lo origina
 * (`Unidad.encolarIntegracion`): si la nota no se guarda, no queda nada que enviar; si se guarda, el envío queda
 * registrado aunque el proceso se caiga justo después. El envío lo hace integracion-envio.ts, fuera del bloqueo.
 *
 * Por pedido (cotización y fábrica) las revisiones se numeran 1, 2, 3… y se entregan en orden. Cada revisión de
 * order.ready es el pedido completo: una nueva deja «reemplazada» a la anterior que aún no salió.
 */
export type EstadoEnvio = 'pendiente' | 'entregado' | 'fallido' | 'reemplazado';

export type Encolable =
  | {
      tipo: 'pedido';
      cotizacionId: string;
      envio: EnvioPreparado;
      /** Solo si el pedido ya se encoló antes (un cambio de número): uno anterior a la integración no se envía. */
      soloSiYaEncolado?: boolean;
    }
  | { tipo: 'cancelacion'; cotizacionId: string; fabrica: Fabrica; cancelacion: CancelacionFabrica };

/** Lo que guarda `contenido`: el mensaje sin el contenido de los PDF y dónde están los archivos. */
export interface ContenidoEnvio {
  issuedAt: string;
  order?: PedidoFabrica;
  cancellation?: CancelacionFabrica;
  documents?: {
    commercial: { archivo: string; filename: string };
    production: { archivo: string; filename: string };
  };
  attachments?: AdjuntoFabrica[];
}

export interface FilaEnvio {
  id: number;
  cotizacion_id: string;
  fabrica: Fabrica;
  revision: number;
  evento: EventoIntegracion;
  evento_id: string;
  clave_idempotencia: string;
  contenido: string;
  html_produccion: string | null;
  estado: EstadoEnvio;
  intentos: number;
  proximo_intento: string;
  en_curso_hasta: string | null;
  ultimo_status: number | null;
  ultimo_error: string | null;
  respuesta: string | null;
  creado: string;
  entregado: string | null;
}

/**
 * Inserta el evento dentro de la transacción en curso (la llama `Unidad.confirmar`). Devuelve el id, o null si no
 * correspondía encolarlo: una anulación o un cambio de número de un pedido que nunca se encoló.
 */
export function encolarEnTransaccion(db: Database.Database, item: Encolable, ahora = new Date()): number | null {
  const fabrica = item.tipo === 'pedido' ? item.envio.fabrica : item.fabrica;
  const yaEncolado = !!db
    .prepare('SELECT 1 FROM integracion_envios WHERE cotizacion_id = ? AND fabrica = ? LIMIT 1')
    .get(item.cotizacionId, fabrica);
  if ((item.tipo === 'cancelacion' || item.soloSiYaEncolado) && !yaEncolado) return null;
  const { revision } = db
    .prepare('SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM integracion_envios WHERE cotizacion_id = ? AND fabrica = ?')
    .get(item.cotizacionId, fabrica) as { revision: number };
  const iso = ahora.toISOString();
  // Lo anterior que todavía no salió ya no hace falta: la revisión nueva trae el pedido completo (o lo anula). Lo que
  // está en curso sigue: si falla, el envío ve que hay una revisión más nueva y la deja reemplazada (ver `reemplazarSiHayNueva`).
  db.prepare(
    `UPDATE integracion_envios SET estado = 'reemplazado', ultimo_error = ?
     WHERE cotizacion_id = ? AND fabrica = ? AND estado = 'pendiente' AND evento = 'order.ready'
       AND (en_curso_hasta IS NULL OR en_curso_hasta <= ?)`,
  ).run(`Reemplazado por la revisión ${revision} antes de salir.`, item.cotizacionId, fabrica, iso);
  let contenido: ContenidoEnvio;
  let html: string | null = null;
  if (item.tipo === 'pedido') {
    const { pedido, archivoComercial, htmlProduccion, adjuntos } = item.envio;
    const base = `nota-pedido-${fabrica}-${pedido.orderNumber}`;
    contenido = {
      issuedAt: iso,
      order: pedido,
      documents: {
        commercial: { archivo: archivoComercial, filename: `${base}-comercial.pdf` },
        // Cada revisión imprime su propia orden de trabajo: un PDF ya generado nunca se sobrescribe.
        production: { archivo: `orden-trabajo-${fabrica}-${pedido.orderNumber}-r${revision}.pdf`, filename: `${base}-produccion.pdf` },
      },
      attachments: adjuntos,
    };
    html = htmlProduccion;
  } else contenido = { issuedAt: iso, cancellation: item.cancelacion };
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO integracion_envios (cotizacion_id, fabrica, revision, evento, evento_id, clave_idempotencia, contenido,
         html_produccion, estado, proximo_intento, creado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?, ?)`,
    )
    .run(
      item.cotizacionId,
      fabrica,
      revision,
      item.tipo === 'pedido' ? 'order.ready' : 'order.cancelled',
      randomUUID(),
      claveIdempotencia(item.cotizacionId, fabrica, revision),
      JSON.stringify(contenido),
      html,
      iso,
      iso,
    );
  return Number(lastInsertRowid);
}

/**
 * Toma hasta `limite` envíos que tocan ahora, marcándolos «en curso» hasta `vence`: otro proceso (o una segunda
 * pasada) no los toma mientras tanto. Un envío espera a que salgan (o fallen) las revisiones anteriores de su pedido.
 */
export function reclamarEnvios(
  db: Database.Database,
  { ahora = new Date(), vence, fabricas, limite = 10 }: { ahora?: Date; vence: Date; fabricas: readonly Fabrica[]; limite?: number },
) {
  if (!fabricas.length) return [];
  const iso = ahora.toISOString();
  const candidatas = db
    .prepare(
      `SELECT e.id FROM integracion_envios e
       WHERE e.estado = 'pendiente' AND e.proximo_intento <= ? AND (e.en_curso_hasta IS NULL OR e.en_curso_hasta <= ?)
         AND e.fabrica IN (${fabricas.map(() => '?').join(', ')})
         AND NOT EXISTS (
           SELECT 1 FROM integracion_envios a
           WHERE a.cotizacion_id = e.cotizacion_id AND a.fabrica = e.fabrica AND a.revision < e.revision AND a.estado = 'pendiente'
         )
       ORDER BY e.id LIMIT ?`,
    )
    .all(iso, iso, ...fabricas, limite) as { id: number }[];
  const tomar = db.prepare(
    `UPDATE integracion_envios SET en_curso_hasta = ?
     WHERE id = ? AND estado = 'pendiente' AND (en_curso_hasta IS NULL OR en_curso_hasta <= ?)`,
  );
  const leer = db.prepare('SELECT * FROM integracion_envios WHERE id = ?');
  return candidatas.flatMap(({ id }) => (tomar.run(vence.toISOString(), id, iso).changes ? [leer.get(id) as FilaEnvio] : []));
}

/** Hay una revisión más nueva del mismo pedido: este envío ya no hace falta. */
export function reemplazarSiHayNueva(db: Database.Database, fila: FilaEnvio) {
  const nueva = db
    .prepare('SELECT revision FROM integracion_envios WHERE cotizacion_id = ? AND fabrica = ? AND revision > ? ORDER BY revision LIMIT 1')
    .get(fila.cotizacion_id, fila.fabrica, fila.revision) as { revision: number } | undefined;
  if (!nueva || fila.evento !== 'order.ready') return false;
  db.prepare(
    "UPDATE integracion_envios SET estado = 'reemplazado', en_curso_hasta = NULL, ultimo_error = ? WHERE id = ? AND estado = 'pendiente'",
  ).run(`Reemplazado por la revisión ${nueva.revision} antes de salir.`, fila.id);
  return true;
}

/** La fábrica confirmó el evento: recién aquí queda entregado. */
export function marcarEntregado(db: Database.Database, id: number, status: number, respuesta: string, ahora = new Date()) {
  db.prepare(
    `UPDATE integracion_envios SET estado = 'entregado', entregado = ?, en_curso_hasta = NULL, intentos = intentos + 1,
       ultimo_status = ?, ultimo_error = NULL, respuesta = ? WHERE id = ?`,
  ).run(ahora.toISOString(), status, respuesta.slice(0, 2000), id);
}

/** Un intento fallido: vuelve a «pendiente» para `proximo`, o queda «fallido» si no se debe reintentar. */
export function marcarIntentoFallido(
  db: Database.Database,
  id: number,
  { status, error, proximo }: { status: number | null; error: string; proximo: Date | null },
) {
  db.prepare(
    `UPDATE integracion_envios SET estado = ?, intentos = intentos + 1, en_curso_hasta = NULL, ultimo_status = ?,
       ultimo_error = ?, proximo_intento = COALESCE(?, proximo_intento) WHERE id = ?`,
  ).run(proximo ? 'pendiente' : 'fallido', status, error.slice(0, 1000), proximo?.toISOString() ?? null, id);
}

/** Suelta un envío tomado sin contar un intento (p. ej., la integración se desconfiguró entretanto). */
export function soltarEnvio(db: Database.Database, id: number) {
  db.prepare('UPDATE integracion_envios SET en_curso_hasta = NULL WHERE id = ?').run(id);
}

/** Vuelve a poner en cola un envío fallido (`npm run integracion -- --reintentar <id>`). */
export function reintentarEnvio(db: Database.Database, id: number, ahora = new Date()) {
  return (
    db
      .prepare(
        `UPDATE integracion_envios SET estado = 'pendiente', intentos = 0, proximo_intento = ?, en_curso_hasta = NULL
         WHERE id = ? AND estado = 'fallido'`,
      )
      .run(ahora.toISOString(), id).changes === 1
  );
}

export interface ResumenBandeja {
  pendientes: number;
  fallidos: number;
  entregados: number;
  /** Fecha del pendiente más antiguo (cuándo se encoló); null si no hay. */
  pendienteMasAntiguo: string | null;
  ultimoError: string | null;
}

export function resumenBandeja(db: Database.Database): ResumenBandeja {
  const fila = db
    .prepare(
      `SELECT
         SUM(estado = 'pendiente') AS pendientes, SUM(estado = 'fallido') AS fallidos, SUM(estado = 'entregado') AS entregados,
         MIN(CASE WHEN estado = 'pendiente' THEN creado END) AS antiguo,
         (SELECT ultimo_error FROM integracion_envios WHERE estado IN ('pendiente', 'fallido') AND ultimo_error IS NOT NULL
          ORDER BY id DESC LIMIT 1) AS error
       FROM integracion_envios`,
    )
    .get() as { pendientes: number | null; fallidos: number | null; entregados: number | null; antiguo: string | null; error: string | null };
  return {
    pendientes: fila.pendientes ?? 0,
    fallidos: fila.fallidos ?? 0,
    entregados: fila.entregados ?? 0,
    pendienteMasAntiguo: fila.antiguo,
    ultimoError: fila.error,
  };
}

/** Los últimos envíos, para `npm run integracion`; sin el contenido del pedido. */
export function ultimosEnvios(db: Database.Database, limite = 30) {
  return db
    .prepare(
      `SELECT e.id, c.numero AS cotizacion, e.fabrica, e.revision, e.evento, e.estado, e.intentos, e.proximo_intento,
         e.ultimo_status, e.ultimo_error, e.creado, e.entregado, e.clave_idempotencia
       FROM integracion_envios e LEFT JOIN cotizaciones c ON c.id = e.cotizacion_id
       ORDER BY e.id DESC LIMIT ?`,
    )
    .all(limite) as {
    id: number;
    cotizacion: number | null;
    fabrica: Fabrica;
    revision: number;
    evento: EventoIntegracion;
    estado: EstadoEnvio;
    intentos: number;
    proximo_intento: string;
    ultimo_status: number | null;
    ultimo_error: string | null;
    creado: string;
    entregado: string | null;
    clave_idempotencia: string;
  }[];
}

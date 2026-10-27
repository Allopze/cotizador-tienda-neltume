import type { Cotizacion, NotaPedido } from '../negocio/estado';
import { ErrorUsuario } from './errores';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Almacen } from './almacen';
import { generarPdf, plantilla, type DocumentoPdf } from './pdf';

/** Lo que imprime la cotización ya emitida `q` (con su número, fecha y vigencia guardados). */
export const documentoCotizacion = (q: Cotizacion): DocumentoPdf => ({
  tipo: 'cotizacion',
  numero: q.numero!,
  montos: q.montos,
  fecha: q.fechaEmision ?? q.creada,
  vence: q.vence,
  autor: q.emitidaPor,
  reglas: q.reglas,
  observaciones: q.observaciones,
});

/** Las otras notas de la cotización, con cuántos ítems lleva cada una: la nota las nombra. */
export const otrasNotas = (q: Pick<Cotizacion, 'notas' | 'montos' | 'solicitudes'>, nota: Pick<NotaPedido, 'pdf'>) =>
  q.notas
    .filter((n) => n.pdf !== nota.pdf && n.fabrica)
    .map((n) => ({
      fabrica: n.fabrica,
      numero: n.numero,
      items: q.montos.lineas.filter((l) => l.indice !== null && q.solicitudes[l.indice]?.fabrica === n.fabrica).length,
    }));

/** Lo que imprime la nota de pedido `nota` de `q`: sus líneas a precio de fábrica y el despacho con que se generó. */
export const documentoNota = (q: Cotizacion, nota: NotaPedido): DocumentoPdf => ({
  tipo: 'nota',
  numero: nota.numero,
  fabrica: nota.fabrica,
  montos: nota.montos,
  fecha: nota.fecha,
  autor: q.aprobadaPor,
  despacho: nota.despacho,
  reglas: q.reglas,
  observaciones: nota.observaciones,
  otrasNotas: otrasNotas(q, nota),
});

/**
 * Si el PDF pertenece a una cotización anulada (o a una de sus notas de pedido), devuelve una copia con la
 * marca «ANULADA», generada la primera vez que se pide. El PDF original nunca se modifica.
 */
export async function documentoAnulado(almacen: Almacen, archivo: string) {
  const q = almacen.porDocumento(archivo);
  if (!q || q.estado !== 'anulada' || q.numero === null) return null;
  const nombre = archivo.replace(/\.pdf$/, '-anulada.pdf');
  const ruta = join(almacen.directorio, 'pdf', nombre);
  if (await existe(ruta)) return { ruta, nombre };
  const anulada = { fecha: q.fechaAnulacion, motivo: q.motivoAnulacion, por: q.anuladaPor };
  const nota = q.notas.find((n) => n.pdf === archivo);
  // Se parte del documento emitido: una copia anulada no puede cambiar de flete ni de datos de empresa.
  const emitido = snapshotDe(almacen, q.id, archivo);
  const html = emitido
    ? marcarAnulada(emitido, anulada, !!nota)
    : await plantilla(q, { ...(nota ? documentoNota(q, nota) : documentoCotizacion(q)), anulada }, almacen.baseDatos());
  try {
    await generarPdf(almacen.directorio, nombre, html, undefined, { logoDe: almacen.baseDatos() });
  } catch (error) {
    // Otra descarga simultánea pudo generarla primero.
    if (!(await existe(ruta))) throw error;
  }
  return { ruta, nombre };
}

const existe = (ruta: string) =>
  access(ruta).then(
    () => true,
    () => false,
  );

/** El HTML con que se emitió `archivo`, tal como quedó guardado; null si es anterior a los snapshots. */
export function snapshotDe(almacen: Almacen, cotizacionId: string, archivo: string): string | null {
  const fila = almacen
    .baseDatos()
    .prepare('SELECT html FROM documentos_snapshot WHERE archivo = ? AND cotizacion_id = ?')
    .get(archivo, cotizacionId) as { html: string } | undefined;
  return fila?.html ?? null;
}

/**
 * Le pone la marca «ANULADA» al documento emitido, sin reimprimirlo: el contenido sigue siendo el que se entregó
 * aunque después cambien el despacho, la empresa o los ajustes (auditoría BUG-016).
 */
export function marcarAnulada(
  html: string,
  anulada: { fecha: string | null; motivo: string | null; por: string | null },
  nota: boolean,
) {
  const texto = `${nota ? 'NOTA DE PEDIDO ANULADA' : 'COTIZACIÓN ANULADA'}${anulada.fecha ? ` el ${anulada.fecha.slice(0, 10)}` : ''}${anulada.por ? ` por ${anulada.por}` : ''}${anulada.motivo ? `. Motivo: ${anulada.motivo}` : ''}. No es válida${nota ? ' para fábrica' : ''}.`;
  return html.replace(
    /(<body[^>]*>)/,
    `$1<div class="anulada-marca" aria-hidden="true">ANULADA</div><p class="anulada-aviso">${texto}</p>`,
  );
}

/**
 * Cambia en el HTML emitido solo los números de documento indicados. Así la copia renumerada conserva el resto del
 * contenido tal como se emitió (auditoría BUG-016).
 */
export function renumerarHtml(html: string, cambios: { de: number; a: number }[]) {
  return cambios.reduce(
    (texto, { de, a }) => texto.replace(new RegExp(`N\\.º\\s*${de}(?!\\d)`, 'g'), `N.º ${a}`),
    html,
  );
}

/** La nota de pedido de `fabrica` (sin indicarla, la única o la primera, como las anteriores a separar fábricas). */
export const notaDe = (q: Pick<Cotizacion, 'notas'>, fabrica?: string | null) =>
  fabrica ? q.notas.find((n) => n.fabrica === fabrica) : q.notas[0];

/**
 * Recupera documentos sin consultar catálogo ni reservar números. Se llama fuera del bloqueo del
 * estado: no hace falta comprobar Chromium antes, porque un fallo no gasta nada.
 */
export async function regenerarDocumento(
  almacen: Almacen,
  q: Cotizacion,
  tipo: 'cotizacion' | 'nota',
  fabrica?: string | null,
) {
  const nota = tipo === 'nota' ? notaDe(q, fabrica) : undefined;
  const archivo = tipo === 'nota' ? nota?.pdf : q.pdf;
  if (!archivo || q.numero === null)
    throw new ErrorUsuario('Todavía no hay un documento emitido que recuperar.');
  const ruta = join(almacen.directorio, 'pdf', archivo);
  if (await existe(ruta)) return { archivo, regenerado: false, avisos: [] };
  const snapshot = almacen
    .baseDatos()
    .prepare('SELECT html FROM documentos_snapshot WHERE archivo = ? AND cotizacion_id = ?')
    .get(archivo, q.id) as { html: string } | undefined;
  const html = snapshot
    ? snapshot.html
    : await plantilla(q, nota ? documentoNota(q, nota) : documentoCotizacion(q), almacen.baseDatos());
  try {
    // El snapshot guarda el logo como referencia: se imprime con el logo vigente de esta base (ver inyectarLogo).
    await generarPdf(almacen.directorio, archivo, html, undefined, { logoDe: almacen.baseDatos() });
  } catch (error) {
    // Otra recuperación simultánea pudo escribirlo primero.
    if (await existe(ruta)) return { archivo, regenerado: false, avisos: [] };
    throw error;
  }
  return {
    archivo,
    regenerado: true,
    avisos: snapshot
      ? []
      : ['Documento antiguo recuperado con sus importes originales y los datos de empresa actuales.'],
  };
}

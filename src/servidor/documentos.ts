import type { Cotizacion } from '../negocio/estado';
import { ErrorUsuario } from './errores';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Almacen } from './almacen';
import { generarPdf, plantilla } from './pdf';

/**
 * Si el PDF pertenece a una cotización anulada (o a su nota de pedido), devuelve una copia con la
 * marca «ANULADA», generada la primera vez que se pide. El PDF original nunca se modifica.
 */
export async function documentoAnulado(almacen: Almacen, archivo: string) {
  const q = almacen.porDocumento(archivo);
  if (!q || q.estado !== 'anulada' || q.numero === null) return null;
  const nombre = archivo.replace(/\.pdf$/, '-anulada.pdf');
  const ruta = join(almacen.directorio, 'pdf', nombre);
  if (await existe(ruta)) return { ruta, nombre };
  const anulada = { fecha: q.fechaAnulacion, motivo: q.motivoAnulacion, por: q.anuladaPor };
  const esNota = q.nota?.pdf === archivo;
  const html = esNota
    ? await plantilla(
        q,
        {
          tipo: 'nota',
          numero: q.nota!.numero,
          fabrica: q.nota!.fabrica,
          montos: q.nota!.montos,
          fecha: q.nota!.fecha,
          autor: q.aprobadaPor,
          despacho: q.nota!.despacho,
          anulada,
        },
        almacen.baseDatos(),
      )
    : await plantilla(
        q,
        {
          tipo: 'cotizacion',
          numero: q.numero,
          montos: q.montos,
          fecha: q.fechaEmision ?? q.creada,
          vence: q.vence,
          autor: q.emitidaPor,
          anulada,
        },
        almacen.baseDatos(),
      );
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

/**
 * Recupera documentos sin consultar catálogo ni reservar números. Se llama fuera del bloqueo del
 * estado: no hace falta comprobar Chromium antes, porque un fallo no gasta nada.
 */
export async function regenerarDocumento(almacen: Almacen, q: Cotizacion, tipo: 'cotizacion' | 'nota') {
  const archivo = tipo === 'nota' ? q.nota?.pdf : q.pdf;
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
    : await plantilla(
      q,
      tipo === 'nota'
        ? {
            tipo,
            numero: q.nota!.numero,
            fabrica: q.nota!.fabrica,
            montos: q.nota!.montos,
            fecha: q.nota!.fecha,
            despacho: q.nota!.despacho,
            observaciones: q.nota!.observaciones,
            autor: q.aprobadaPor,
          }
        : {
            tipo,
            numero: q.numero,
            montos: q.montos,
            fecha: q.fechaEmision ?? q.creada,
            vence: q.vence,
            autor: q.emitidaPor,
          },
      almacen.baseDatos(),
    );
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

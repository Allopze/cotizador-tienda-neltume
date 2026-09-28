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
    ? await plantilla(q, {
        tipo: 'nota',
        numero: q.nota!.numero,
        montos: q.nota!.montos,
        fecha: q.nota!.fecha,
        autor: q.aprobadaPor,
        despacho: q.nota!.despacho,
        anulada,
      })
    : await plantilla(q, {
        tipo: 'cotizacion',
        numero: q.numero,
        montos: q.montos,
        fecha: q.fechaEmision ?? q.creada,
        vence: q.vence,
        autor: q.emitidaPor,
        anulada,
      });
  try {
    await generarPdf(almacen.directorio, nombre, html);
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

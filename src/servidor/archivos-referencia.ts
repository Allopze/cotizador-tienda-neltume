import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReferenciaItem } from '../catalogo/tipos';
import {
  ARCHIVO_REFERENCIA,
  MAX_BYTES_REFERENCIA,
  MAX_REFERENCIAS_ITEM,
  TIPOS_REFERENCIA,
} from '../negocio/personalizados';
import { ErrorUsuario } from './errores';

/**
 * Referencias del cliente (fotos, croquis, planos) de los ítems de una cotización. Cada archivo se guarda una vez
 * por su contenido (sha256) y nunca se modifica: una revisión, un duplicado o un deshacer pueden apuntar al mismo
 * archivo sin copiarlo, y quitar la referencia de un ítem no afecta a otra cotización que la use.
 */
export const carpetaReferencias = (directorioDatos: string) => join(directorioDatos, 'referencias');

/** El tipo se deduce del contenido, no del nombre ni de lo que declara el navegador. */
export function tipoDelContenido(bytes: Uint8Array): ReferenciaItem['tipo'] | null {
  const empieza = (...firma: number[]) => firma.every((b, i) => bytes[i] === b);
  if (empieza(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (empieza(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (empieza(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-') return 'application/pdf';
  return null;
}

/** Nombre original sin rutas ni caracteres de control, para mostrarlo y ofrecerlo al descargar. */
export function nombreReferencia(nombre: string) {
  const limpio = nombre
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return limpio.slice(0, 200) || 'referencia';
}

export async function guardarReferencia(directorioDatos: string, bytes: Uint8Array, nombre: string): Promise<ReferenciaItem> {
  if (!bytes.length) throw new ErrorUsuario('El archivo está vacío.', 'archivo_invalido');
  if (bytes.length > MAX_BYTES_REFERENCIA)
    throw new ErrorUsuario('El archivo supera los 10 MB. Usa una imagen o un PDF más liviano.', 'archivo_invalido');
  const tipo = tipoDelContenido(bytes);
  if (!tipo)
    throw new ErrorUsuario('Formato no admitido. Usa una imagen JPG, PNG o WEBP, o un documento PDF.', 'archivo_invalido');
  const archivo = `${createHash('sha256').update(bytes).digest('hex')}.${TIPOS_REFERENCIA[tipo]}`;
  const carpeta = carpetaReferencias(directorioDatos);
  await mkdir(carpeta, { recursive: true });
  try {
    await writeFile(join(carpeta, archivo), bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    // El mismo contenido ya estaba guardado: se reutiliza. Se renueva su fecha para que la limpieza de
    // huérfanos no lo borre antes de que la edición lo asocie a un ítem.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const ahora = new Date();
    await utimes(join(carpeta, archivo), ahora, ahora);
  }
  return { archivo, nombre: nombreReferencia(nombre), tipo, tamano: bytes.length, fecha: new Date().toISOString() };
}

export async function leerReferencia(directorioDatos: string, archivo: string) {
  if (!ARCHIVO_REFERENCIA.test(archivo)) return null;
  try {
    return await readFile(/* turbopackIgnore: true */ join(carpetaReferencias(directorioDatos), archivo));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

const tipoDeArchivo = (archivo: string) =>
  (Object.keys(TIPOS_REFERENCIA) as ReferenciaItem['tipo'][]).find((t) => archivo.endsWith(`.${TIPOS_REFERENCIA[t]}`))!;

/**
 * Referencias que llegan con una edición: solo archivos ya subidos a este servidor. Tipo y tamaño salen del
 * archivo guardado; se descartan las repetidas.
 */
export function sanearReferencias(directorioDatos: string, referencias: ReferenciaItem[]): ReferenciaItem[] {
  const vistas = new Set<string>();
  const resultado: ReferenciaItem[] = [];
  for (const r of referencias) {
    if (!ARCHIVO_REFERENCIA.test(r.archivo))
      throw new ErrorUsuario('Una de las referencias no es válida. Vuelve a adjuntarla.', 'archivo_invalido');
    if (vistas.has(r.archivo)) continue;
    vistas.add(r.archivo);
    let tamano: number;
    try {
      tamano = statSync(join(carpetaReferencias(directorioDatos), r.archivo)).size;
    } catch {
      throw new ErrorUsuario(`No se encontró el archivo «${nombreReferencia(r.nombre)}». Vuelve a adjuntarlo.`, 'archivo_invalido');
    }
    const fecha = Number.isNaN(Date.parse(r.fecha)) ? new Date().toISOString() : new Date(r.fecha).toISOString();
    resultado.push({ archivo: r.archivo, nombre: nombreReferencia(r.nombre), tipo: tipoDeArchivo(r.archivo), tamano, fecha });
  }
  if (resultado.length > MAX_REFERENCIAS_ITEM)
    throw new ErrorUsuario(`Cada producto admite hasta ${MAX_REFERENCIAS_ITEM} referencias.`, 'archivo_invalido');
  return resultado;
}

/** Plazo en que un archivo recién subido puede seguir sin ítem: la persona aún no termina de adjuntarlo. */
export const GRACIA_HUERFANAS_MS = 24 * 3_600_000;

/**
 * Archivos de referencia que ninguna cotización usa (se quitaron de todos sus ítems o se eliminó el borrador)
 * y que llevan más del plazo de gracia sin tocarse. `enUso` son los archivos referenciados en la base.
 */
export async function referenciasHuerfanas(directorioDatos: string, enUso: Set<string>, ahora = Date.now()) {
  let nombres: string[];
  try {
    nombres = await readdir(carpetaReferencias(directorioDatos));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const huerfanas: { archivo: string; tamano: number; modificado: Date }[] = [];
  for (const archivo of nombres.sort()) {
    if (!ARCHIVO_REFERENCIA.test(archivo) || enUso.has(archivo)) continue;
    const datos = await stat(join(carpetaReferencias(directorioDatos), archivo));
    if (ahora - datos.mtimeMs < GRACIA_HUERFANAS_MS) continue;
    huerfanas.push({ archivo, tamano: datos.size, modificado: datos.mtime });
  }
  return huerfanas;
}

/** Borra los archivos indicados que siguen sin uso en este momento; devuelve cuántos borró. */
export async function eliminarReferencias(directorioDatos: string, archivos: string[], enUso: Set<string>) {
  let eliminados = 0;
  for (const archivo of archivos) {
    if (!ARCHIVO_REFERENCIA.test(archivo) || enUso.has(archivo)) continue;
    await rm(join(carpetaReferencias(directorioDatos), archivo), { force: true });
    eliminados++;
  }
  return eliminados;
}

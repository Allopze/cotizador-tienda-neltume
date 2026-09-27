import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Catalogo } from '../catalogo/tipos';
export class ErrorCatalogo extends Error {}
export const rutaCatalogo = () =>
  resolve(/* turbopackIgnore: true */ process.env.NELTUME_CATALOGO ?? 'data/catalogo.json');
// Caché por ruta y fecha de modificación: una reimportación se toma sin reiniciar el servidor.
let cache: { ruta: string; mtime: number; catalogo: Catalogo } | null = null;
export async function cargarCatalogo(): Promise<Catalogo> {
  const ruta = rutaCatalogo();
  try {
    const { mtimeMs } = await stat(ruta);
    if (cache?.ruta === ruta && cache.mtime === mtimeMs) return cache.catalogo;
    const catalogo = JSON.parse(await readFile(ruta, 'utf8')) as Catalogo;
    if (!Array.isArray(catalogo.productos) || !catalogo.productos.length) throw new Error('vacío');
    cache = { ruta, mtime: mtimeMs, catalogo };
    return catalogo;
  } catch (e) {
    throw new ErrorCatalogo(
      (e as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'Falta el catálogo. Ejecuta npm run importar -- datos-privados/COTIZADOR_2026.xlsx.'
        : 'El catálogo está dañado. Vuelve a ejecutar npm run importar.',
    );
  }
}

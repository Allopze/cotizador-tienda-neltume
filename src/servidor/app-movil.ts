import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { directorioDatos } from './base-datos';

// La app de Android se distribuye como APK firmado (sin Google Play). La versión publicada vive en la carpeta de datos
// del servidor (`<NELTUME_DATA_DIR>/app/`): `version.json` y `neltume-cotizador.apk`, que deja ahí
// android/scripts/publicar.sh. La app consulta la versión al abrirse y, si hay una nueva, la descarga e instala.

export const ARCHIVO_APK = 'neltume-cotizador.apk';

const versionSchema = z
  .object({
    versionCode: z.number().int().positive(),
    versionName: z.string().trim().min(1).max(40),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** Versión mínima que puede seguir usándose: una anterior debe actualizarse antes de continuar. */
    minimo: z.number().int().positive().optional(),
    notas: z.string().max(2000).optional(),
    publicada: z.string().max(40).optional(),
  })
  .strict();

export type VersionApp = z.infer<typeof versionSchema> & { tamano: number };

export const carpetaApp = () => join(directorioDatos(), 'app');

/** La versión publicada, o null si no hay una (o está incompleta: falta el APK o el JSON no es válido). */
export async function leerVersionApp(): Promise<VersionApp | null> {
  try {
    const datos = versionSchema.safeParse(JSON.parse(await readFile(join(carpetaApp(), 'version.json'), 'utf8')));
    if (!datos.success) return null;
    const apk = await stat(join(carpetaApp(), ARCHIVO_APK));
    if (!apk.isFile() || apk.size === 0) return null;
    return { ...datos.data, tamano: apk.size };
  } catch {
    return null;
  }
}

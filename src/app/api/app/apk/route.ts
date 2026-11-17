import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { ARCHIVO_APK, carpetaApp, leerVersionApp } from '@/servidor/app-movil';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El APK publicado, solo con sesión (es una herramienta interna). La app verifica su sha256 contra `version.json`
 * antes de instalarlo.
 */
export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  const version = await leerVersionApp();
  if (!version)
    return Response.json(
      { error: 'No hay una versión de la app publicada.', codigo: 'sin_app' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  const flujo = Readable.toWeb(createReadStream(join(carpetaApp(), ARCHIVO_APK))) as ReadableStream;
  const nombre = `Cotizador Neltume ${version.versionName}.apk`;
  return new Response(flujo, {
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': String(version.tamano),
      'Content-Disposition': `attachment; filename="cotizador-neltume.apk"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

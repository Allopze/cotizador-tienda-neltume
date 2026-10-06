import { rechazoSesion } from '@/servidor/acceso-autenticado';
import { directorioDatos } from '@/servidor/almacen';
import { leerReferencia, nombreReferencia } from '@/servidor/archivos-referencia';
import { registrarError } from '@/servidor/errores';
import { TIPOS_REFERENCIA } from '@/negocio/personalizados';

export const runtime = 'nodejs';

const noEncontrado = () =>
  Response.json(
    { error: 'Referencia no encontrada.' },
    { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );

/** Muestra una referencia del cliente; `?descargar=1` la descarga con su nombre original (`?nombre=`). */
export async function GET(req: Request, ctx: { params: Promise<{ archivo: string }> }) {
  const rechazo = await rechazoSesion(req);
  if (rechazo) return rechazo;
  const { archivo } = await ctx.params;
  let contenido: Buffer | null;
  try {
    contenido = await leerReferencia(directorioDatos(), archivo);
  } catch (error) {
    registrarError('api/referencias', error);
    return Response.json({ error: 'No se pudo abrir la referencia.' }, { status: 500 });
  }
  if (!contenido) return noEncontrado();
  const extension = archivo.split('.').pop()!;
  const tipo = Object.entries(TIPOS_REFERENCIA).find(([, ext]) => ext === extension)![0];
  const url = new URL(req.url);
  const nombre = nombreReferencia(url.searchParams.get('nombre') || archivo);
  const disposicion = url.searchParams.get('descargar') === '1' ? 'attachment' : 'inline';
  return new Response(new Uint8Array(contenido), {
    headers: {
      'Content-Type': tipo,
      // Nombre ASCII de respaldo y el original en UTF-8 (RFC 6266).
      'Content-Disposition': `${disposicion}; filename="${nombre.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      // El contenido nunca cambia (su nombre es su sha256), pero requiere sesión: solo caché privada.
      'Cache-Control': 'private, max-age=86400, immutable',
      'X-Content-Type-Options': 'nosniff',
      // Chrome no muestra un PDF en un documento con sandbox; las imágenes sí lo llevan.
      'Content-Security-Policy':
        tipo === 'application/pdf'
          ? "frame-ancestors 'none'"
          : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; sandbox",
    },
  });
}

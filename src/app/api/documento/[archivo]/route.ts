import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { directorioDatos } from '@/servidor/almacen';
import { rechazoSesion } from '@/servidor/acceso-autenticado';
export const runtime = 'nodejs';

const ARCHIVO_VALIDO = /^(cotizacion|nota-pedido)-\d+\.pdf$/;
const noEncontrado = () =>
  Response.json(
    { error: 'Documento no encontrado.' },
    { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );

export async function GET(req: Request, ctx: { params: Promise<{ archivo: string }> }) {
  const rechazo = await rechazoSesion(req);
  if (rechazo) return rechazo;
  const { archivo } = await ctx.params;
  if (!ARCHIVO_VALIDO.test(archivo)) return noEncontrado();
  // `?ver=1` abre el PDF en el navegador; por defecto se descarga.
  const disposicion = new URL(req.url).searchParams.get('ver') === '1' ? 'inline' : 'attachment';
  let pdf: Buffer;
  try {
    pdf = await readFile(join(directorioDatos(), 'pdf', archivo));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return noEncontrado();
    console.error(
      '[documento] no se pudo leer el PDF:',
      (error as NodeJS.ErrnoException).code ?? 'desconocido',
    );
    return Response.json({ error: 'No se pudo abrir el documento.' }, { status: 500 });
  }
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposicion}; filename="${archivo}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

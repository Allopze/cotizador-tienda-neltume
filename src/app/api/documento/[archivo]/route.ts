import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Almacen, directorioDatos } from '@/servidor/almacen';
import { rechazoSesion } from '@/servidor/acceso-autenticado';
import { documentoAnulado } from '@/servidor/documentos';
import { registrarError } from '@/servidor/errores';
export const runtime = 'nodejs';

// Las notas anteriores a separar las fábricas no llevan la fábrica en el nombre.
const ARCHIVO_VALIDO = /^(cotizacion|nota-pedido(-panguipulli|-santiago)?)-\d+\.pdf$/;
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
  const url = new URL(req.url);
  // `?ver=1` abre el PDF en el navegador; por defecto se descarga.
  const disposicion = url.searchParams.get('ver') === '1' ? 'inline' : 'attachment';
  let nombre = archivo;
  let pdf: Buffer;
  try {
    // Un documento anulado se entrega con la marca «ANULADA»; el original queda intacto en disco.
    let ruta = join(directorioDatos(), 'pdf', archivo);
    try {
      const anulado = await documentoAnulado(new Almacen(), archivo);
      if (anulado) ({ ruta, nombre } = anulado);
    } catch (error) {
      // Sin Chromium u otra falla: se entrega el original antes que no entregar nada.
      registrarError('documento', error);
    }
    pdf = await readFile(/* turbopackIgnore: true */ ruta);
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
      'Content-Disposition': `${disposicion}; filename="${nombre}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

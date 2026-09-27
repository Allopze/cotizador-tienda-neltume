import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { directorioDatos } from '@/servidor/almacen';
import { rechazoAcceso } from '@/servidor/acceso';
export const runtime = 'nodejs';
export async function GET(req: Request, ctx: { params: Promise<{ archivo: string }> }) {
  const rechazo = rechazoAcceso(req);
  if (rechazo) return rechazo;
  const { archivo } = await ctx.params;
  if (!/^(cotizacion|nota-pedido)-\d+\.pdf$/.test(archivo))
    return new Response('No encontrado', { status: 404 });
  try {
    const pdf = await readFile(join(directorioDatos(), 'pdf', archivo));
    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${archivo}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch {
    return new Response('Documento no encontrado', { status: 404 });
  }
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { dibujosModelos, normalizarModelo, RECURSOS } from '@/servidor/dibujos';

export const runtime = 'nodejs';

/** Dibujo de línea del modelo (PNG con fondo transparente). 404 si el modelo no tiene uno. */
export async function GET(req: Request, ctx: { params: Promise<{ modelo: string }> }) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  const { modelo } = await ctx.params;
  // Solo archivos del manifiesto: el nombre nunca llega a la ruta del disco.
  const dibujo = dibujosModelos().get(normalizarModelo(decodeURIComponent(modelo)));
  if (!dibujo) return Response.json({ error: 'Sin dibujo.' }, { status: 404 });
  try {
    const png = await readFile(/* turbopackIgnore: true */ join(RECURSOS, 'dibujos', dibujo.archivo));
    return new Response(new Uint8Array(png), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return Response.json({ error: 'Sin dibujo.' }, { status: 404 });
  }
}

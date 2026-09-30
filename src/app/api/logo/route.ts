import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { abrirBaseDatos } from '@/servidor/base-datos';
import { leerConfiguracionNegocio } from '@/servidor/configuracion-negocio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const configurado = leerConfiguracionNegocio(abrirBaseDatos()).empresa.logoSvg;
    const svg = configurado ?? (await readFile(join(process.cwd(), 'public/logo-neltume.svg'), 'utf8'));
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response('Logo no disponible.', { status: 404 });
  }
}

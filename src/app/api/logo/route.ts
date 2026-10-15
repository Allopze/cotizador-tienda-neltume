import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { abrirBaseDatos } from '@/servidor/base-datos';
import { leerConfiguracionNegocio } from '@/servidor/configuracion-negocio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El SVG lo sube una persona administradora y se valida con un parser y una lista de elementos permitidos
 * (svg-seguro.ts). Solo lo ven las sesiones iniciadas (el encabezado); la pantalla de inicio de sesión usa el archivo
 * estático /logo-neltume.svg. Como segunda barrera, si alguien lo abre directamente la CSP con `sandbox` impide que
 * ejecute código o cargue recursos, y nosniff evita que se interprete como otro tipo.
 */
const CSP_LOGO = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const cabeceras = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  try {
    const configurado = leerConfiguracionNegocio(abrirBaseDatos()).empresa.logoSvg;
    const svg = configurado ?? (await readFile(join(process.cwd(), 'public/logo-neltume.svg'), 'utf8'));
    return new Response(svg, {
      headers: {
        ...cabeceras,
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Content-Security-Policy': CSP_LOGO,
      },
    });
  } catch {
    return new Response('Logo no disponible.', {
      status: 404,
      headers: { ...cabeceras, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

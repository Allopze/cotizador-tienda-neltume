import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { rechazoAcceso } from '@/servidor/acceso';
import { abrirBaseDatos } from '@/servidor/base-datos';
import { leerConfiguracionNegocio } from '@/servidor/configuracion-negocio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * El SVG lo sube una persona administradora y la validación de configuracion-negocio es una lista negra que se puede
 * esquivar. Sigue siendo público (la pantalla de inicio de sesión lo muestra), pero si alguien lo abre directamente
 * la CSP con `sandbox` impide que ejecute código o cargue recursos, y nosniff evita que se interprete como otro tipo.
 */
const CSP_LOGO = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
const cabeceras = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(req: Request) {
  const rechazo = rechazoAcceso(req);
  if (rechazo) return rechazo;
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

import { recibirPrueba } from '@/servidor/integracion-prueba-recepcion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Prueba de conexión que envía la fábrica (docs/integracion-fabrica.md, «Prueba de conexión»). Sin sesión: la protege la
 * firma HMAC (el proxy de Next no pasa por /api/*, y el Host se valida en el handler). Solo POST.
 */
export async function POST(req: Request) {
  return recibirPrueba(req);
}

const noPermitido = () =>
  Response.json(
    { error: { code: 'method_not_allowed', message: 'Solo se acepta POST.' } },
    { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } },
  );
// Sin CORS: nadie llama a esta ruta desde un navegador, así que OPTIONS tampoco se acepta.
export const OPTIONS = noPermitido;
export const GET = noPermitido;
export const PUT = noPermitido;
export const PATCH = noPermitido;
export const DELETE = noPermitido;

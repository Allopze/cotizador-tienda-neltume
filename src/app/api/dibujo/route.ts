import { exigirSesion } from '@/servidor/acceso-autenticado';
import { dibujosModelos } from '@/servidor/dibujos';

export const runtime = 'nodejs';

/** Los modelos que tienen dibujo (nombre normalizado, el de `/api/dibujo/<modelo>`): la pantalla solo pide esos. */
export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  return Response.json(
    { modelos: [...dibujosModelos().keys()] },
    { headers: { 'Cache-Control': 'private, max-age=3600' } },
  );
}

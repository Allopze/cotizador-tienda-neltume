import { exigirSesion } from '@/servidor/acceso-autenticado';
import { Almacen } from '@/servidor/almacen';
import { registrarError } from '@/servidor/errores';
import { leerPdfPrueba } from '@/servidor/integracion-prueba';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noEncontrado = () =>
  Response.json(
    { error: 'La prueba no existe o ya no conserva su PDF.' },
    { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );

/**
 * PDF de una prueba de conexión (enviada o recibida), para verlo en el navegador desde «Conexión con la fábrica». Solo
 * quien administra y nunca se cachea. El PDF recibido ya pasó la firma, el sha256 y la revisión de su estructura; el
 * nombre del archivo se validó al recibirlo (letras, números, punto, guion), así que cabe tal cual en la cabecera.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sesion = await exigirSesion(req, { rol: 'admin' });
  if (!sesion.ok) return sesion.respuesta;
  const { id } = await ctx.params;
  if (!/^\d{1,12}$/.test(id)) return noEncontrado();
  try {
    const prueba = leerPdfPrueba(new Almacen().baseDatos(), Number(id));
    if (!prueba) return noEncontrado();
    return new Response(new Uint8Array(prueba.pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${prueba.archivo}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    registrarError('api/ajustes/conexion/pruebas', error);
    return Response.json({ error: 'No se pudo abrir el PDF de la prueba.' }, { status: 500 });
  }
}

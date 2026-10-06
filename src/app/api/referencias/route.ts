import { exigirSesion } from '@/servidor/acceso-autenticado';
import { directorioDatos } from '@/servidor/almacen';
import { guardarReferencia } from '@/servidor/archivos-referencia';
import { ErrorUsuario, registrarError } from '@/servidor/errores';
import { MAX_BYTES_REFERENCIA } from '@/negocio/personalizados';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };

/**
 * Sube una referencia del cliente (imagen o PDF) y devuelve sus datos. Todavía no queda asociada a ningún ítem:
 * eso lo hace la edición de la cotización, que la guarda en el ítem correspondiente.
 */
export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true });
  if (!sesion.ok) return sesion.respuesta;
  // El multipart agrega unos pocos KB al archivo; un cuerpo mucho mayor se rechaza sin leerlo.
  const largo = Number(req.headers.get('content-length') ?? 0);
  if (largo > MAX_BYTES_REFERENCIA + 64 * 1024)
    return Response.json(
      { error: 'El archivo supera los 10 MB. Usa una imagen o un PDF más liviano.', codigo: 'archivo_invalido' },
      { status: 413, headers: sinCache },
    );
  try {
    const form = await req.formData();
    const archivo = form.get('archivo');
    if (!(archivo instanceof File))
      return Response.json(
        { error: 'Selecciona una imagen o un PDF.', codigo: 'archivo_invalido' },
        { status: 400, headers: sinCache },
      );
    if (archivo.size > MAX_BYTES_REFERENCIA)
      throw new ErrorUsuario('El archivo supera los 10 MB. Usa una imagen o un PDF más liviano.', 'archivo_invalido');
    const referencia = await guardarReferencia(
      directorioDatos(),
      new Uint8Array(await archivo.arrayBuffer()),
      archivo.name,
    );
    return Response.json({ referencia }, { headers: sinCache });
  } catch (error) {
    if (error instanceof ErrorUsuario)
      return Response.json({ error: error.message, codigo: error.codigo }, { status: error.status, headers: sinCache });
    registrarError('api/referencias', error);
    return Response.json(
      { error: 'No se pudo guardar el archivo. Vuelve a intentarlo.', codigo: 'error_interno' },
      { status: 500, headers: sinCache },
    );
  }
}

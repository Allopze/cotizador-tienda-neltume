import { exigirSesion } from '@/servidor/acceso-autenticado';
import { directorioDatos } from '@/servidor/almacen';
import { guardarReferencia } from '@/servidor/archivos-referencia';
import { ErrorUsuario, registrarError } from '@/servidor/errores';
import { MAX_BYTES_REFERENCIA } from '@/negocio/personalizados';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };
// El multipart agrega unos pocos KB al archivo.
const MAX_CUERPO = MAX_BYTES_REFERENCIA + 64 * 1024;
const MUY_GRANDE = 'El archivo supera los 10 MB. Usa una imagen o un PDF más liviano.';

const rechazo = (error: string, status: number) =>
  Response.json({ error, codigo: 'archivo_invalido' }, { status, headers: sinCache });

/**
 * Lee el cuerpo con tope antes de interpretarlo: `formData()` lo cargaría entero en memoria, y Content-Length lo
 * declara el cliente (puede mentir). Devuelve null si el cuerpo supera el tope.
 */
async function leerConTope(req: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!req.body) return new Uint8Array();
  const lector = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await lector.cancel();
      return null;
    }
    partes.push(value);
  }
  const cuerpo = new Uint8Array(total);
  let posicion = 0;
  for (const parte of partes) {
    cuerpo.set(parte, posicion);
    posicion += parte.byteLength;
  }
  return cuerpo;
}

/**
 * Sube una referencia del cliente (imagen o PDF) y devuelve sus datos. Todavía no queda asociada a ningún ítem:
 * eso lo hace la edición de la cotización, que la guarda en el ítem correspondiente.
 */
export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true });
  if (!sesion.ok) return sesion.respuesta;
  // El navegador siempre declara el tamaño de un formulario; sin él (envío por partes) no se sabe cuánto llegará.
  const declarado = req.headers.get('content-length');
  if (declarado === null || !/^\d+$/.test(declarado.trim()))
    return rechazo('No se pudo recibir el archivo: la solicitud no indica su tamaño.', 411);
  if (Number(declarado) > MAX_CUERPO) return rechazo(MUY_GRANDE, 413);
  try {
    const cuerpo = await leerConTope(req, MAX_CUERPO);
    if (!cuerpo) return rechazo(MUY_GRANDE, 413);
    const tipo = req.headers.get('content-type') ?? '';
    let form: FormData;
    try {
      form = await new Response(cuerpo, { headers: { 'content-type': tipo } }).formData();
    } catch {
      return rechazo('Selecciona una imagen o un PDF.', 400);
    }
    const archivo = form.get('archivo');
    if (!(archivo instanceof File)) return rechazo('Selecciona una imagen o un PDF.', 400);
    if (archivo.size > MAX_BYTES_REFERENCIA) throw new ErrorUsuario(MUY_GRANDE, 'archivo_invalido');
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

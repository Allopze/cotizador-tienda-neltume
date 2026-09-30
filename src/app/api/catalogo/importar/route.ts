import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ErrorImportacion } from '@/catalogo/importar';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { abrirBaseDatos } from '@/servidor/base-datos';
import { cargarCatalogo } from '@/servidor/catalogo';
import { analizarPlanilla } from '@/servidor/importacion-catalogo';
import { guardarCatalogo } from '@/servidor/repositorio-catalogo';
import { registrarError } from '@/servidor/errores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ARCHIVO = 20 * 1024 * 1024;
const sinCache = { 'Cache-Control': 'no-store' };
const texto = (v: FormDataEntryValue | null) => typeof v === 'string' ? v : '';

export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true });
  if (!sesion.ok) return sesion.respuesta;
  if (sesion.usuario.rol !== 'admin')
    return Response.json({ error: 'Solo quien administra puede importar el catálogo.', codigo: 'sin_permiso' }, { status: 403, headers: sinCache });

  let carpeta: string | undefined;
  try {
    const form = await req.formData();
    const archivo = form.get('archivo');
    if (!(archivo instanceof File) || !archivo.name.toLowerCase().endsWith('.xlsx') || archivo.size <= 0 || archivo.size > MAX_ARCHIVO)
      return Response.json({ error: 'Selecciona un Excel .xlsx de hasta 20 MB.', codigo: 'archivo_invalido' }, { status: 400, headers: sinCache });
    const accion = texto(form.get('accion'));
    if (accion !== 'previsualizar' && accion !== 'confirmar')
      return Response.json({ error: 'Indica si quieres previsualizar o confirmar la importación.', codigo: 'solicitud_invalida' }, { status: 400, headers: sinCache });

    carpeta = await mkdtemp(join(tmpdir(), 'neltume-catalogo-'));
    const ruta = join(carpeta, 'catalogo.xlsx');
    await writeFile(ruta, Buffer.from(await archivo.arrayBuffer()), { flag: 'wx', mode: 0o600 });
    const db = abrirBaseDatos();
    const actual = await cargarCatalogo();
    const { importado, vista } = await analizarPlanilla(ruta, basename(archivo.name).slice(0, 200), actual);

    if (accion === 'previsualizar') return Response.json(vista, { headers: sinCache });

    if (texto(form.get('sha256')) !== vista.sha256 || texto(form.get('baseSha256')) !== (vista.baseSha256 ?? ''))
      return Response.json({ error: 'El archivo o el catálogo cambiaron después de la vista previa. Vuelve a analizar el Excel.', codigo: 'vista_previa_obsoleta' }, { status: 409, headers: sinCache });
    const forzar = texto(form.get('forzar')) === 'true';
    // Reemplaza solo los productos de esta planilla; los de la otra y los agregados a mano quedan como estaban.
    guardarCatalogo(db, importado.catalogo, importado.configuracion, { forzar });
    return Response.json({ importado: true, fuente: vista.fuente, origen: vista.origen, etiquetaOrigen: vista.etiquetaOrigen, conteos: vista.conteos }, { headers: sinCache });
  } catch (error) {
    if (error instanceof ErrorImportacion)
      return Response.json({ error: error.message, codigo: 'excel_invalido' }, { status: 400, headers: sinCache });
    if (error instanceof Error && /Si la reducción es intencional|repite un código o producto agregado|de otra planilla ya importada/i.test(error.message))
      return Response.json({ error: error.message, codigo: 'confirmacion_requerida' }, { status: 409, headers: sinCache });
    registrarError('api/catalogo/importar', error);
    return Response.json({ error: 'No se pudo analizar o guardar el catálogo. La versión actual se conserva.', codigo: 'error_importacion' }, { status: 500, headers: sinCache });
  } finally {
    if (carpeta) await rm(carpeta, { recursive: true, force: true }).catch(() => {});
  }
}

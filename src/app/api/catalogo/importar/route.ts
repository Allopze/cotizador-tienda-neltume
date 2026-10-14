import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ErrorImportacion } from '@/catalogo/importar';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { abrirBaseDatos } from '@/servidor/base-datos';
import { analizarPlanilla } from '@/servidor/importacion-catalogo';
import { guardarCatalogo, RepositorioCatalogoSqlite } from '@/servidor/repositorio-catalogo';
import { registrarError } from '@/servidor/errores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ARCHIVO = 20 * 1024 * 1024;
/** El multipart agrega a la planilla los demás campos y los separadores: unos pocos KB. */
const MAX_CUERPO = MAX_ARCHIVO + 64 * 1024;
const ARCHIVO_INVALIDO = 'Selecciona un Excel .xlsx de hasta 20 MB.';
const sinCache = { 'Cache-Control': 'no-store' };
const texto = (v: FormDataEntryValue | null) => typeof v === 'string' ? v : '';
const rechazo = (error: string, codigo: string, status: number) =>
  ({ ok: false as const, respuesta: Response.json({ error, codigo }, { status, headers: sinCache }) });

/**
 * Lee el formulario con tope, sin cargar en memoria más que lo permitido: se rechaza por el largo declarado
 * antes de leer nada y se corta la lectura si el cuerpo lo supera. Sin `Content-Length` (un cuerpo enviado por
 * partes) no se sabe cuánto viene, así que tampoco se acepta: el navegador siempre lo envía con un archivo.
 */
async function leerFormulario(req: Request) {
  const largo = req.headers.get('content-length')?.trim() ?? '';
  if (!/^\d+$/.test(largo)) return rechazo('Envía la planilla desde Catálogo → Importar.', 'solicitud_invalida', 411);
  if (Number(largo) > MAX_CUERPO) return rechazo(ARCHIVO_INVALIDO, 'archivo_invalido', 413);
  if (!req.body) return rechazo(ARCHIVO_INVALIDO, 'archivo_invalido', 400);
  const lector = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CUERPO) {
      await lector.cancel().catch(() => {});
      return rechazo(ARCHIVO_INVALIDO, 'archivo_invalido', 413);
    }
    partes.push(value);
  }
  try {
    const cuerpo = new Response(Buffer.concat(partes), { headers: { 'content-type': req.headers.get('content-type') ?? '' } });
    return { ok: true as const, form: await cuerpo.formData() };
  } catch {
    return rechazo(ARCHIVO_INVALIDO, 'archivo_invalido', 400);
  }
}

export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true });
  if (!sesion.ok) return sesion.respuesta;
  if (sesion.usuario.rol !== 'admin')
    return Response.json({ error: 'Solo quien administra puede importar el catálogo.', codigo: 'sin_permiso' }, { status: 403, headers: sinCache });

  let carpeta: string | undefined;
  try {
    const lectura = await leerFormulario(req);
    if (!lectura.ok) return lectura.respuesta;
    const { form } = lectura;
    const archivo = form.get('archivo');
    if (!(archivo instanceof File) || !archivo.name.toLowerCase().endsWith('.xlsx') || archivo.size <= 0 || archivo.size > MAX_ARCHIVO)
      return Response.json({ error: ARCHIVO_INVALIDO, codigo: 'archivo_invalido' }, { status: 400, headers: sinCache });
    const accion = texto(form.get('accion'));
    if (accion !== 'previsualizar' && accion !== 'confirmar')
      return Response.json({ error: 'Indica si quieres previsualizar o confirmar la importación.', codigo: 'solicitud_invalida' }, { status: 400, headers: sinCache });

    carpeta = await mkdtemp(join(tmpdir(), 'neltume-catalogo-'));
    const ruta = join(carpeta, 'catalogo.xlsx');
    await writeFile(ruta, Buffer.from(await archivo.arrayBuffer()), { flag: 'wx', mode: 0o600 });
    const db = abrirBaseDatos();
    // Sin exigir un catálogo vigente: en una instalación nueva la primera planilla se importa desde aquí.
    const actual = new RepositorioCatalogoSqlite(db);
    const { importado, vista } = await analizarPlanilla(ruta, basename(archivo.name).slice(0, 200), actual);

    if (accion === 'previsualizar') return Response.json(vista, { headers: sinCache });

    // La versión es la de todo el catálogo: otra importación, un alta o una edición obligan a analizar de nuevo.
    if (texto(form.get('versionCatalogo')) !== (vista.versionCatalogo ?? '') || texto(form.get('sha256')) !== vista.sha256 || texto(form.get('baseSha256')) !== (vista.baseSha256 ?? ''))
      return Response.json({ error: 'El archivo o el catálogo cambiaron después de la vista previa. Vuelve a analizar el Excel.', codigo: 'vista_previa_obsoleta' }, { status: 409, headers: sinCache });
    const forzar = texto(form.get('forzar')) === 'true';
    // Reemplaza solo los productos de esta planilla; los de la otra y los agregados a mano quedan como estaban.
    guardarCatalogo(db, importado.catalogo, importado.configuracion, { forzar });
    // Para ofrecer «Volver a la planilla anterior»: qué volvería y la versión que debe seguir vigente para hacerlo.
    const despues = new RepositorioCatalogoSqlite(db);
    return Response.json(
      {
        importado: true,
        fuente: vista.fuente,
        origen: vista.origen,
        etiquetaOrigen: vista.etiquetaOrigen,
        conteos: vista.conteos,
        anterior: despues.planillaAnterior(vista.origen),
        versionCatalogo: despues.version,
      },
      { headers: sinCache },
    );
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

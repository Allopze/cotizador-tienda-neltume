import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { importar, ErrorImportacion } from '@/catalogo/importar';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { abrirBaseDatos } from '@/servidor/base-datos';
import { cargarCatalogo } from '@/servidor/catalogo';
import { guardarCatalogo } from '@/servidor/repositorio-catalogo';
import { registrarError } from '@/servidor/errores';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ARCHIVO = 20 * 1024 * 1024;
const sinCache = { 'Cache-Control': 'no-store' };
const texto = (v: FormDataEntryValue | null) => typeof v === 'string' ? v : '';

function claveProducto(p: { codigo: string; modelo: string; madera: string; medida: string; anchoMin: number | null; anchoMax: number | null; altoMin?: number | null; altoMax?: number | null; largo: number; precioNeto: number; descripcion: string; tipo: string | null; familia: string }) {
  return JSON.stringify([
    p.modelo, p.familia, p.tipo, p.madera, p.medida, p.anchoMin, p.anchoMax,
    p.altoMin ?? null, p.altoMax ?? null, p.largo, p.precioNeto, p.descripcion,
  ]);
}

function comparar(actual: ReturnType<Awaited<ReturnType<typeof cargarCatalogo>>['importados']>, nueva: Awaited<ReturnType<typeof importar>>['catalogo']['productos']) {
  const anteriorPorCodigo = new Map(actual.map((p) => [p.codigo, p]));
  const nuevaPorCodigo = new Map(nueva.map((p) => [p.codigo, p]));
  const nuevos = nueva.filter((p) => !anteriorPorCodigo.has(p.codigo));
  const modificados = nueva.flatMap((p) => {
    const previo = anteriorPorCodigo.get(p.codigo);
    return previo && claveProducto(previo) !== claveProducto(p) ? [{ codigo: p.codigo, anterior: previo, nuevo: p }] : [];
  });
  const sinCambios = nueva.filter((p) => {
    const previo = anteriorPorCodigo.get(p.codigo);
    return previo && claveProducto(previo) === claveProducto(p);
  });
  const eliminados = actual.filter((p) => !nuevaPorCodigo.has(p.codigo));
  return {
    conteos: { nuevos: nuevos.length, modificados: modificados.length, sinCambios: sinCambios.length, eliminados: eliminados.length },
    productos: {
      nuevos: nuevos.slice(0, 100).map((p) => ({ codigo: p.codigo, descripcion: p.descripcion, precioNeto: p.precioNeto })),
      modificados: modificados.slice(0, 100),
      sinCambios: sinCambios.slice(0, 100).map((p) => ({ codigo: p.codigo, descripcion: p.descripcion })),
      eliminados: eliminados.slice(0, 100).map((p) => ({ codigo: p.codigo, descripcion: p.descripcion, precioNeto: p.precioNeto })),
    },
  };
}

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
    const importado = await importar(ruta, actual.configuracion);
    importado.catalogo.fuente = basename(archivo.name).slice(0, 200);
    const baseSha256 = actual.metadata?.sha256 ?? null;
    const cambios = comparar(actual.importados(), importado.catalogo.productos);

    if (accion === 'previsualizar')
      return Response.json({
        sha256: importado.catalogo.sha256,
        baseSha256,
        fuente: importado.catalogo.fuente,
        totalProductos: importado.catalogo.productos.length,
        conteos: cambios.conteos,
        productos: cambios.productos,
        incidencias: importado.incidencias,
        erroresPlantilla: importado.erroresPlantilla,
      }, { headers: sinCache });

    if (texto(form.get('sha256')) !== importado.catalogo.sha256 || texto(form.get('baseSha256')) !== (baseSha256 ?? ''))
      return Response.json({ error: 'El archivo o el catálogo cambiaron después de la vista previa. Vuelve a analizar el Excel.', codigo: 'vista_previa_obsoleta' }, { status: 409, headers: sinCache });
    const forzar = texto(form.get('forzar')) === 'true';
    guardarCatalogo(db, importado.catalogo, actual.configuracion, { forzar });
    return Response.json({ importado: true, fuente: importado.catalogo.fuente, conteos: cambios.conteos }, { headers: sinCache });
  } catch (error) {
    if (error instanceof ErrorImportacion)
      return Response.json({ error: error.message, codigo: 'excel_invalido' }, { status: 400, headers: sinCache });
    if (error instanceof Error && /Si la reducción es intencional|repite un código o producto agregado/i.test(error.message))
      return Response.json({ error: error.message, codigo: 'confirmacion_requerida' }, { status: 409, headers: sinCache });
    registrarError('api/catalogo/importar', error);
    return Response.json({ error: 'No se pudo analizar o guardar el catálogo. La versión actual se conserva.', codigo: 'error_importacion' }, { status: 500, headers: sinCache });
  } finally {
    if (carpeta) await rm(carpeta, { recursive: true, force: true }).catch(() => {});
  }
}

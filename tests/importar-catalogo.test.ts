import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { planillaEnchapadas, xlsxBytes } from './fixture-xlsx';

// La ruta de Catálogo → Importar sobre una base propia, con la sesión de administración simulada.
vi.mock('../src/servidor/acceso-autenticado', () => ({
  exigirSesion: vi.fn(async () => ({
    ok: true,
    usuario: { id: 'admin', email: 'admin@neltume.test', nombre: 'Administración', rol: 'admin' },
  })),
}));

let directorio: string | undefined;
afterEach(async () => {
  if (directorio) (await import('../src/servidor/base-datos')).cerrarBaseDatos();
  vi.unstubAllEnvs();
  vi.resetModules();
  if (directorio) await rm(directorio, { recursive: true, force: true });
  directorio = undefined;
});

const URL_IMPORTAR = 'http://127.0.0.1:3000/api/catalogo/importar';

/** Formulario multipart como lo envía el navegador: con su largo en Content-Length. */
async function multipart(form: FormData) {
  const r = new Response(form);
  const bytes = new Uint8Array(await r.arrayBuffer());
  return new Request(URL_IMPORTAR, {
    method: 'POST',
    body: bytes,
    headers: { 'content-type': r.headers.get('content-type')!, 'content-length': String(bytes.length) },
  });
}

/** Base vacía, como en una instalación nueva: sin catálogo ni metadatos. */
async function montar() {
  directorio = await mkdtemp(join(tmpdir(), 'neltume-importar-'));
  vi.stubEnv('NELTUME_DATA_DIR', directorio);
  vi.stubEnv('NELTUME_DB_PATH', join(directorio, 'cotizador.sqlite'));
  const { POST } = await import('../src/app/api/catalogo/importar/route');
  const rutaCatalogo = await import('../src/app/api/catalogo/route');
  const { abrirBaseDatos } = await import('../src/servidor/base-datos');
  const { RepositorioCatalogoSqlite } = await import('../src/servidor/repositorio-catalogo');
  const { cargarCatalogo } = await import('../src/servidor/catalogo');
  const archivo = new File([xlsxBytes(planillaEnchapadas())], 'enchapadas.xlsx');
  const enviar = async (campos: Record<string, string>, otro: Blob = archivo) => {
    const form = new FormData();
    form.set('archivo', otro, 'enchapadas.xlsx');
    for (const [clave, valor] of Object.entries(campos)) form.set(clave, valor);
    const r = await POST(await multipart(form));
    return { status: r.status, cuerpo: await r.json() };
  };
  /** Acción JSON de Catálogo (p. ej. volver a la planilla anterior). */
  const catalogo = async (cuerpo: unknown) => {
    const r = await rutaCatalogo.POST(
      new Request('http://127.0.0.1:3000/api/catalogo', {
        method: 'POST',
        body: JSON.stringify(cuerpo),
        headers: { 'content-type': 'application/json' },
      }),
    );
    return { status: r.status, cuerpo: await r.json() };
  };
  /** Lo que envía la pantalla al confirmar una vista previa. */
  const confirmar = (vista: { versionCatalogo: string | null; sha256: string; baseSha256: string | null }) =>
    enviar({
      accion: 'confirmar',
      versionCatalogo: vista.versionCatalogo ?? '',
      sha256: vista.sha256,
      baseSha256: vista.baseSha256 ?? '',
      forzar: 'false',
    });
  return { POST, enviar, confirmar, catalogo, repo: () => new RepositorioCatalogoSqlite(abrirBaseDatos()), cargarCatalogo };
}

/** Copia del zip con el tamaño descomprimido que declara una de sus partes cambiado en el índice central. */
function declararTamano(zip: Uint8Array, nombre: string, bytes: number) {
  const copia = zip.slice();
  const v = new DataView(copia.buffer);
  for (let o = 0; o + 46 <= copia.length; o++) {
    if (v.getUint32(o, true) !== 0x02014b50) continue;
    const largo = v.getUint16(o + 28, true);
    if (new TextDecoder().decode(copia.subarray(o + 46, o + 46 + largo)) !== nombre) continue;
    v.setUint32(o + 24, bytes, true);
    return copia;
  }
  throw new Error(`El zip no trae ${nombre}`);
}

/** Libro de la planilla de enchapadas con el XML de su primera hoja reemplazado. */
function conHoja(xml: string) {
  const partes = unzipSync(xlsxBytes(planillaEnchapadas()));
  partes['xl/worksheets/sheet1.xml'] = strToU8(xml);
  return new Blob([zipSync(partes)]);
}

describe('importar el catálogo desde la aplicación', () => {
  it('una instalación nueva, sin catálogo, importa su primera planilla', async () => {
    const m = await montar();
    await expect(m.cargarCatalogo()).rejects.toThrow(/Falta el catálogo/);
    const vista = await m.enviar({ accion: 'previsualizar' });
    expect(vista.status).toBe(200);
    expect(vista.cuerpo).toMatchObject({
      origen: 'enchapadas',
      versionCatalogo: null,
      baseSha256: null,
      edicionesManuales: [],
      conteos: { nuevos: 27, modificados: 0, sinCambios: 0, eliminados: 0 },
    });
    const r = await m.confirmar(vista.cuerpo);
    expect(r).toMatchObject({ status: 200, cuerpo: { importado: true, conteos: { nuevos: 27 } } });
    const catalogo = await m.cargarCatalogo();
    expect(catalogo.buscarPorCodigo('HUIL-EM-085-240')?.precioNeto).toBe(102019);
  });

  it('avisa los productos editados a mano y pide analizar de nuevo si el catálogo cambió', async () => {
    const m = await montar();
    await m.confirmar((await m.enviar({ accion: 'previsualizar' })).cuerpo);
    const antes = (await m.enviar({ accion: 'previsualizar' })).cuerpo;
    expect(antes.versionCatalogo).toEqual(expect.any(String));

    m.repo().editarProducto('HUIL-EM-085-240', { precioNeto: 110_000 });
    // La vista previa anterior ya no corresponde al catálogo: no se aplica.
    expect(await m.confirmar(antes)).toMatchObject({ status: 409, cuerpo: { codigo: 'vista_previa_obsoleta' } });
    expect(m.repo().buscarPorCodigo('HUIL-EM-085-240')?.precioNeto).toBe(110_000);

    const vista = (await m.enviar({ accion: 'previsualizar' })).cuerpo;
    expect(vista.edicionesManuales).toEqual([
      { codigo: 'HUIL-EM-085-240', descripcion: 'HUILO HUILO MARA ENCHAPADA 0,85 MT X 2,21 A 2,4 MT', precioNeto: 110_000 },
    ]);
    expect(vista.conteos).toMatchObject({ modificados: 1 });
    expect((await m.confirmar(vista)).status).toBe(200);
    // La planilla manda: el precio vuelve al suyo y ya no queda nada editado a mano.
    expect(m.repo().buscarPorCodigo('HUIL-EM-085-240')?.precioNeto).toBe(102019);
    expect((await m.enviar({ accion: 'previsualizar' })).cuerpo.edicionesManuales).toEqual([]);
  });
});

describe('volver a la planilla anterior desde Catálogo → Importar', () => {
  it('confirmar dice qué volvería y «volver» trae la planilla con lo editado a mano y su aviso', async () => {
    const m = await montar();
    const primera = await m.confirmar((await m.enviar({ accion: 'previsualizar' })).cuerpo);
    // La primera importación no tiene a qué volver.
    expect(primera.cuerpo).toMatchObject({ importado: true, anterior: null });

    m.repo().editarProducto('HUIL-EM-085-240', { precioNeto: 110_000 });
    const r = await m.confirmar((await m.enviar({ accion: 'previsualizar' })).cuerpo);
    expect(r.status).toBe(200);
    expect(r.cuerpo.anterior).toMatchObject({
      origen: 'enchapadas',
      fuente: 'enchapadas.xlsx',
      productos: 27,
      edicionesManuales: 1,
    });
    expect(r.cuerpo.versionCatalogo).toBe(m.repo().version);
    expect(m.repo().buscarPorCodigo('HUIL-EM-085-240')?.precioNeto).toBe(102019);

    // Con una versión que ya no es la vigente no se toca nada.
    expect(await m.catalogo({ tipo: 'volver_planilla', origen: 'enchapadas', versionCatalogo: 'otra' })).toMatchObject({
      status: 409,
      cuerpo: { codigo: 'version_obsoleta' },
    });
    const vuelta = await m.catalogo({
      tipo: 'volver_planilla',
      origen: 'enchapadas',
      versionCatalogo: r.cuerpo.versionCatalogo,
    });
    expect(vuelta).toMatchObject({ status: 200, cuerpo: { restaurada: { productos: 27, edicionesManuales: 1 } } });
    expect(m.repo().buscarPorCodigo('HUIL-EM-085-240')?.precioNeto).toBe(110_000);
    // La vista previa siguiente vuelve a avisar que ese precio se editó a mano.
    expect((await m.enviar({ accion: 'previsualizar' })).cuerpo.edicionesManuales).toEqual([
      expect.objectContaining({ codigo: 'HUIL-EM-085-240', precioNeto: 110_000 }),
    ]);
  });
});

describe('subida de la planilla con tope', () => {
  it('sin Content-Length no se lee el cuerpo y responde 411', async () => {
    const m = await montar();
    const form = new FormData();
    form.set('archivo', new File([xlsxBytes(planillaEnchapadas())], 'enchapadas.xlsx'));
    form.set('accion', 'previsualizar');
    // Un Request con FormData no declara su largo (como un cuerpo enviado por partes).
    const sinLargo = new Request(URL_IMPORTAR, { method: 'POST', body: form });
    expect(sinLargo.headers.get('content-length')).toBeNull();
    const r = await m.POST(sinLargo);
    expect(r.status).toBe(411);
    expect(await r.json()).toMatchObject({ codigo: 'solicitud_invalida' });
  });

  it('un largo declarado mayor que el tope se rechaza sin leer el cuerpo; un cuerpo que lo excede se corta', async () => {
    const m = await montar();
    let leidos = 0;
    const cuerpo = () =>
      new ReadableStream<Uint8Array>({
        pull(control) {
          leidos += 1024 * 1024;
          control.enqueue(new Uint8Array(1024 * 1024));
        },
      });
    const pedir = (largo: number) =>
      m.POST(
        new Request(URL_IMPORTAR, {
          method: 'POST',
          body: cuerpo(),
          headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(largo) },
          duplex: 'half',
        } as RequestInit),
      );
    const grande = await pedir(21 * 1024 * 1024);
    expect(grande.status).toBe(413);
    expect(await grande.json()).toMatchObject({ codigo: 'archivo_invalido' });
    expect(leidos).toBeLessThanOrEqual(1024 * 1024);
    // Declara poco pero manda sin fin: la lectura se corta al pasar el tope.
    leidos = 0;
    const mentiroso = await pedir(1000);
    expect(mentiroso.status).toBe(413);
    expect(leidos).toBeLessThan(25 * 1024 * 1024);
  });

  it('un libro que declara partes descomprimidas enormes se rechaza como Excel inválido antes de inflarlas', async () => {
    const m = await montar();
    const zip = xlsxBytes(planillaEnchapadas());
    const parte = declararTamano(zip, 'xl/worksheets/sheet1.xml', 150 * 1024 * 1024);
    const r = await m.enviar({ accion: 'previsualizar' }, new Blob([parte]));
    expect(r.status).toBe(400);
    expect(r.cuerpo.codigo).toBe('excel_invalido');
    expect(r.cuerpo.error).toMatch(/supera 100 MB/);
    // Ninguna parte pasa de 100 MB, pero juntas pasan de 200 MB.
    let total = zip;
    for (const nombre of ['xl/worksheets/sheet1.xml', 'xl/workbook.xml', 'xl/sharedStrings.xml'])
      total = declararTamano(total, nombre, 90 * 1024 * 1024);
    const suma = await m.enviar({ accion: 'previsualizar' }, new Blob([total]));
    expect(suma).toMatchObject({ status: 400, cuerpo: { codigo: 'excel_invalido' } });
    expect(suma.cuerpo.error).toMatch(/supera 200 MB/);
    expect(m.repo().version).toBeNull();
  });

  it('una hoja con XML roto o una referencia de celda inválida es un Excel inválido (400), no un error interno', async () => {
    const m = await montar();
    const roto = await m.enviar(
      { accion: 'previsualizar' },
      conHoja('<worksheet><sheetData><row r="1"><c r="B1"><v>1</v></row></sheetData></worksheet>'),
    );
    expect(roto).toMatchObject({ status: 400, cuerpo: { codigo: 'excel_invalido' } });
    expect(roto.cuerpo.error).toMatch(/^No se pudo leer el archivo como un Excel \.xlsx válido \(la hoja .+ no se puede leer/);
    const referencia = await m.enviar(
      { accion: 'previsualizar' },
      conHoja('<worksheet><sheetData><row r="1"><c r="1B"><v>1</v></c></row></sheetData></worksheet>'),
    );
    expect(referencia).toMatchObject({ status: 400, cuerpo: { codigo: 'excel_invalido' } });
    expect(referencia.cuerpo.error).toMatch(/referencia de celda inválida/);
  });
});

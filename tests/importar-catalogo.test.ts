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
  const { GET, POST } = await import('../src/app/api/catalogo/importar/route');
  const rutaCatalogo = await import('../src/app/api/catalogo/route');
  const { abrirBaseDatos } = await import('../src/servidor/base-datos');
  const { RepositorioCatalogoSqlite } = await import('../src/servidor/repositorio-catalogo');
  const { cargarCatalogo } = await import('../src/servidor/catalogo');
  const archivo = new File([xlsxBytes(planillaEnchapadas())], 'enchapadas.xlsx');
  const enviar = async (campos: Record<string, string>, otro: Blob = archivo, nombre = 'enchapadas.xlsx') => {
    const form = new FormData();
    form.set('archivo', otro, nombre);
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
  const confirmar = (
    vista: { versionCatalogo: string | null; sha256: string; baseSha256: string | null },
    { forzar = false, otro }: { forzar?: boolean; otro?: Blob } = {},
  ) =>
    enviar(
      {
        accion: 'confirmar',
        versionCatalogo: vista.versionCatalogo ?? '',
        sha256: vista.sha256,
        baseSha256: vista.baseSha256 ?? '',
        forzar: String(forzar),
      },
      otro,
    );
  /** Lo que consulta la pantalla al abrirse: a qué planilla anterior se puede volver todavía. */
  const estado = async () => {
    const r = await GET(new Request(URL_IMPORTAR));
    return { status: r.status, cuerpo: await r.json() };
  };
  /** Filas de las tablas que guardan la copia para volver atrás y las marcas de lo editado a mano. */
  const copias = () => ({
    anterior: abrirBaseDatos().prepare('SELECT * FROM catalogo_anterior ORDER BY origen').all(),
    ediciones: abrirBaseDatos().prepare('SELECT * FROM catalogo_ediciones ORDER BY codigo').all(),
  });
  return {
    POST,
    enviar,
    confirmar,
    catalogo,
    estado,
    copias,
    repo: () => new RepositorioCatalogoSqlite(abrirBaseDatos()),
    cargarCatalogo,
  };
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

/** Planilla de enchapadas con solo la hoja de Los Ríos: 3 productos, menos del 90 % de los 27. */
const reducida = () => new Blob([xlsxBytes({ 'LOS RIOS ENCHP': planillaEnchapadas()['LOS RIOS ENCHP'] })]);

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

  it('dos confirmaciones simultáneas de la misma vista previa: una guarda y la otra pide analizar de nuevo', async () => {
    const m = await montar();
    await m.confirmar((await m.enviar({ accion: 'previsualizar' })).cuerpo);
    const vista = (await m.enviar({ accion: 'previsualizar' })).cuerpo;
    const fecha = m.repo().metadata!.fecha;
    const respuestas = await Promise.all([m.confirmar(vista), m.confirmar(vista)]);
    expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(respuestas.find((r) => r.status === 409)!.cuerpo).toMatchObject({ codigo: 'vista_previa_obsoleta' });
    // Se importó una sola vez: la planilla anterior a la que se vuelve es la primera, no esta misma.
    expect(m.repo().metadata!.fecha > fecha).toBe(true);
    expect(m.repo().planillaAnterior('enchapadas')).toMatchObject({ fecha });
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

  it('«volver» espera el bloqueo del almacén: no cambia el catálogo en medio de otra escritura', async () => {
    const m = await montar();
    await m.confirmar((await m.enviar({ accion: 'previsualizar' })).cuerpo);
    m.repo().editarProducto('HUIL-EM-085-240', { precioNeto: 110_000 });
    const r = await m.confirmar((await m.enviar({ accion: 'previsualizar' })).cuerpo);
    expect(m.repo().buscarPorCodigo('HUIL-EM-085-240')?.precioNeto).toBe(102019);
    const { Almacen } = await import('../src/servidor/almacen');
    let vuelta: ReturnType<typeof m.catalogo> | undefined;
    // Mientras otra operación (p. ej. una emisión) tiene el bloqueo, «volver» espera sin tocar el catálogo.
    await new Almacen().transaccion(async () => {
      vuelta = m.catalogo({ tipo: 'volver_planilla', origen: 'enchapadas', versionCatalogo: r.cuerpo.versionCatalogo });
      await new Promise((listo) => setTimeout(listo, 400));
      expect(m.repo().buscarPorCodigo('HUIL-EM-085-240')?.precioNeto).toBe(102019);
    });
    expect(await vuelta).toMatchObject({ status: 200, cuerpo: { restaurada: { productos: 27 } } });
    expect(m.repo().buscarPorCodigo('HUIL-EM-085-240')?.precioNeto).toBe(110_000);
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

describe('casos de borde de la importación', () => {
  it('una reducción bajo el 90 % pide la casilla de forzar; con ella se importa', async () => {
    const m = await montar();
    await m.confirmar((await m.enviar({ accion: 'previsualizar' })).cuerpo);
    const vista = await m.enviar({ accion: 'previsualizar' }, reducida());
    expect(vista.cuerpo).toMatchObject({ totalProductos: 3, conteos: { sinCambios: 3, eliminados: 24 } });
    const sinForzar = await m.confirmar(vista.cuerpo, { otro: reducida() });
    expect(sinForzar).toMatchObject({ status: 409, cuerpo: { codigo: 'confirmacion_requerida' } });
    expect(sinForzar.cuerpo.error).toMatch(/La planilla trae 3 productos y el catálogo actual tiene 27/);
    expect(m.repo().conteoPorOrigen()).toEqual({ enchapadas: 27 });
    const forzada = await m.confirmar(vista.cuerpo, { otro: reducida(), forzar: true });
    expect(forzada).toMatchObject({ status: 200, cuerpo: { importado: true, conteos: { eliminados: 24 } } });
    expect(m.repo().conteoPorOrigen()).toEqual({ enchapadas: 3 });
  });

  it('un archivo que no es .xlsx se rechaza: por su nombre, o por su contenido si se llama .xlsx', async () => {
    const m = await montar();
    const csv = await m.enviar({ accion: 'previsualizar' }, new Blob(['codigo;precio\nA;1']), 'precios.csv');
    expect(csv).toMatchObject({ status: 400, cuerpo: { codigo: 'archivo_invalido', error: 'Selecciona un Excel .xlsx de hasta 20 MB.' } });
    const texto = await m.enviar({ accion: 'previsualizar' }, new Blob(['codigo;precio\nA;1']));
    expect(texto).toMatchObject({ status: 400, cuerpo: { codigo: 'excel_invalido' } });
    expect(texto.cuerpo.error).toMatch(/^No se pudo leer el archivo como un Excel \.xlsx válido \(no es un archivo comprimido/);
    expect(m.repo().version).toBeNull();
  });

  it('un Excel con contraseña de apertura dice que está protegido; un .xls antiguo, que hay que guardarlo como .xlsx', async () => {
    const m = await montar();
    // Documento compuesto de Office (CFB): firma D0 CF 11 E0 A1 B1 1A E1 y, si está cifrado, el flujo EncryptionInfo.
    const cfb = (...nombres: string[]) => {
      const firma = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
      return new Blob([Buffer.concat([firma, Buffer.alloc(504), ...nombres.map((n) => Buffer.from(n, 'utf16le'))])]);
    };
    const protegido = await m.enviar({ accion: 'previsualizar' }, cfb('EncryptionInfo', 'EncryptedPackage'));
    expect(protegido).toMatchObject({ status: 400, cuerpo: { codigo: 'excel_invalido' } });
    expect(protegido.cuerpo.error).toMatch(
      /^El archivo está protegido con contraseña: guárdalo sin contraseña y vuelve a intentarlo\./,
    );
    const antiguo = await m.enviar({ accion: 'previsualizar' }, cfb('Workbook'));
    expect(antiguo).toMatchObject({ status: 400, cuerpo: { codigo: 'excel_invalido' } });
    expect(antiguo.cuerpo.error).toMatch(/^El archivo es un Excel antiguo \(\.xls\)/);
  });

  it('una hoja que figura en el libro pero falta en el zip es un Excel inválido (400)', async () => {
    const m = await montar();
    const partes = unzipSync(xlsxBytes(planillaEnchapadas()));
    delete partes['xl/worksheets/sheet2.xml'];
    const r = await m.enviar({ accion: 'previsualizar' }, new Blob([zipSync(partes)]));
    expect(r).toMatchObject({ status: 400, cuerpo: { codigo: 'excel_invalido' } });
    expect(r.cuerpo.error).toMatch(/falta xl\/worksheets\/sheet2\.xml en la planilla/);
  });

  it('importar dos veces la misma planilla: la vista previa no ve cambios y la anterior pasa a ser la misma', async () => {
    const m = await montar();
    await m.confirmar((await m.enviar({ accion: 'previsualizar' })).cuerpo);
    const vista = (await m.enviar({ accion: 'previsualizar' })).cuerpo;
    expect(vista.conteos).toEqual({ nuevos: 0, modificados: 0, soloDescripcion: 0, sinCambios: 27, eliminados: 0 });
    const r = await m.confirmar(vista);
    expect(r.cuerpo.anterior).toMatchObject({ fuente: 'enchapadas.xlsx', productos: 27, edicionesManuales: 0 });
    const antes = m.repo().importados('enchapadas');
    const vuelta = await m.catalogo({ tipo: 'volver_planilla', origen: 'enchapadas', versionCatalogo: r.cuerpo.versionCatalogo });
    expect(vuelta.status).toBe(200);
    expect(m.repo().importados('enchapadas')).toEqual(antes);
  });

  it('una importación rechazada deja intactas la copia para volver atrás y las marcas de lo editado a mano', async () => {
    const m = await montar();
    await m.confirmar((await m.enviar({ accion: 'previsualizar' })).cuerpo);
    await m.confirmar((await m.enviar({ accion: 'previsualizar' })).cuerpo);
    m.repo().editarProducto('HUIL-EM-085-240', { precioNeto: 110_000 });
    const antes = m.copias();
    expect(antes.anterior).toHaveLength(1);
    expect(antes.ediciones).toEqual([expect.objectContaining({ codigo: 'HUIL-EM-085-240' })]);
    const vista = (await m.enviar({ accion: 'previsualizar' }, reducida())).cuerpo;
    expect((await m.confirmar(vista, { otro: reducida() })).status).toBe(409);
    expect(m.copias()).toEqual(antes);
    expect(m.repo().buscarPorCodigo('HUIL-EM-085-240')?.precioNeto).toBe(110_000);
  });
});

describe('volver a la planilla anterior después de recargar', () => {
  it('la pantalla consulta a qué planilla se puede volver: aparece tras importar, se va si el catálogo cambia y vuelve a ofrecerse tras deshacer', async () => {
    const m = await montar();
    expect(await m.estado()).toEqual({ status: 200, cuerpo: { deshacer: [] } });
    await m.confirmar((await m.enviar({ accion: 'previsualizar' })).cuerpo);
    // La primera importación no tiene a qué volver.
    expect((await m.estado()).cuerpo.deshacer).toEqual([]);
    const segunda = await m.confirmar((await m.enviar({ accion: 'previsualizar' })).cuerpo);
    const { deshacer } = (await m.estado()).cuerpo;
    expect(deshacer).toEqual([
      expect.objectContaining({
        origen: 'enchapadas',
        fuente: 'enchapadas.xlsx',
        importada: 'enchapadas.xlsx',
        productos: 27,
        versionCatalogo: segunda.cuerpo.versionCatalogo,
      }),
    ]);
    // Con lo que entrega la consulta se puede volver, igual que justo después de importar.
    const vuelta = await m.catalogo({ tipo: 'volver_planilla', origen: 'enchapadas', versionCatalogo: deshacer[0].versionCatalogo });
    expect(vuelta.status).toBe(200);
    // La importación deshecha queda como anterior: se ofrece volver a ella.
    expect((await m.estado()).cuerpo.deshacer).toEqual([expect.objectContaining({ origen: 'enchapadas', productos: 27 })]);
    // Un cambio posterior en el catálogo (una edición a mano) deja de ofrecerlo.
    m.repo().editarProducto('HUIL-EM-085-240', { precioNeto: 110_000 });
    expect((await m.estado()).cuerpo.deshacer).toEqual([]);
  });
});

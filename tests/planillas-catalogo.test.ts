import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { referenciaCatalogo } from '../src/app/formato';
import { contextoSeguro, SYSTEM } from '../src/asistente/llm';
import { pregunta } from '../src/asistente/preguntas';
import { ErrorImportacion } from '../src/catalogo/importar';
import { importarPlanilla } from '../src/catalogo/planilla';
import {
  CONFIGURACION_CATALOGO_BASE,
  resolverMaderaConfigurada,
  validarConfiguracionCatalogo,
} from '../src/catalogo/configuracion';
import { clienteVacio, type Catalogo, type Producto } from '../src/catalogo/tipos';
import { MARGENES_INICIALES } from '../src/negocio/precios';
import { Almacen } from '../src/servidor/almacen';
import { abrirBaseDatos, cerrarBaseDatos, VERSION_ESQUEMA } from '../src/servidor/base-datos';
import { analizarPlanilla } from '../src/servidor/importacion-catalogo';
import { guardarCatalogo, RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { Servicio } from '../src/servidor/servicio';
import { escribirXlsx, filasPuerta, planillaEnchapadas, type Hojas } from './fixture-xlsx';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const producto = (codigo: string, p: Partial<Producto> = {}): Producto => ({
  codigo,
  modelo: 'Huilo Huilo',
  familia: 'PUERTA',
  tipo: 'PUERTA SÓLIDA',
  madera: 'MARA',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2.4,
  precioNeto: 100_000,
  descripcion: `${codigo} PRINCIPAL`,
  filaOrigen: 4,
  ...p,
});
/** Planilla principal mínima: una puerta sólida de Huilo Huilo en Mara, otras maderas y un marco de pino. */
const principal = (): Catalogo => ({
  fuente: 'COTIZADOR.xlsx',
  sha256: 'principal-1',
  fecha: '2026-01-01T00:00:00.000Z',
  origen: 'principal',
  productos: [
    producto('HUIL-M-3-A'),
    producto('HUIL-M-4-A', { medida: '0,90 A 0,95', anchoMin: 0.9, anchoMax: 0.95, precioNeto: 110_000 }),
    producto('HUIL-O-3-A', { madera: 'PINO OREGON', precioNeto: 90_000 }),
    producto('MAR-O-2X4-A', {
      modelo: 'MARCO',
      familia: 'MARCO',
      tipo: null,
      madera: 'PINO OREGON',
      medida: '2X4',
      anchoMin: null,
      anchoMax: null,
      largo: 2.2,
      precioNeto: 25_000,
    }),
  ],
});

const dirs: string[] = [];
const rutas: string[] = [];
const limpiezas: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const ruta of rutas.splice(0)) cerrarBaseDatos(ruta);
  for (const limpiar of limpiezas.splice(0)) await limpiar();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function base() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-planillas-'));
  dirs.push(dir);
  const ruta = join(dir, 'cotizador.sqlite');
  rutas.push(ruta);
  const db = abrirBaseDatos(ruta);
  return { dir, ruta, db, repo: () => new RepositorioCatalogoSqlite(db) };
}
/** Lo que hace la ruta de importación: analiza, compara con su origen y guarda. */
async function aplicar(db: ReturnType<typeof abrirBaseDatos>, hojas: Hojas, { forzar = false } = {}) {
  const { ruta, limpiar } = await escribirXlsx(hojas);
  limpiezas.push(limpiar);
  const { importado, vista } = await analizarPlanilla(
    ruta,
    'VALORES.xlsx',
    new RepositorioCatalogoSqlite(db),
  );
  guardarCatalogo(db, importado.catalogo, importado.configuracion, { forzar });
  return { importado, vista };
}
const ordenes = (db: ReturnType<typeof abrirBaseDatos>) =>
  db
    .prepare(
      'SELECT origen, MIN(orden) AS desde, MAX(orden) AS hasta, COUNT(*) AS n FROM productos_catalogo GROUP BY origen ORDER BY origen',
    )
    .all();

describe('catálogo por planilla de origen', () => {
  it('importar las enchapadas conserva la principal y las agregadas a mano, y viceversa', async () => {
    const { db, repo } = await base();
    guardarCatalogo(db, principal());
    const manual = producto('MAN-1', { modelo: 'Manual', madera: 'LENGA', descripcion: 'MANUAL' });
    repo().agregarProductoManual(manual, repo().version!);
    const { importado } = await aplicar(db, planillaEnchapadas());
    const r = repo();
    expect(importado.origen).toBe('enchapadas');
    expect(r.importados('principal')).toEqual(principal().productos);
    expect(r.importados('enchapadas')).toHaveLength(27);
    expect(r.conteoPorOrigen()).toEqual({ principal: 4, enchapadas: 27 });
    expect(r.todos()).toHaveLength(4 + 27 + 1);
    expect(r.listarManuales().map((p) => p.codigo)).toEqual(['MAN-1']);
    // Cada origen numera sus productos desde 0 y el orden global pone la principal primero.
    expect(ordenes(db)).toEqual([
      { origen: 'enchapadas', desde: 0, hasta: 26, n: 27 },
      { origen: 'principal', desde: 0, hasta: 3, n: 4 },
    ]);
    expect(
      r
        .todos()
        .slice(0, 4)
        .map((p) => p.codigo),
    ).toEqual(principal().productos.map((p) => p.codigo));
    expect(r.todos().at(-1)?.codigo).toBe('MAN-1');
    expect(r.modelos()).toEqual(['Huilo Huilo', 'MARCO', 'LOS RIOS', 'Manual']);

    // Una nueva principal (un precio distinto) no toca las enchapadas.
    const enchapadasAntes = r.importados('enchapadas');
    const nueva = principal();
    nueva.sha256 = 'principal-2';
    nueva.productos[0].precioNeto = 123_456;
    guardarCatalogo(db, nueva);
    expect(repo().importados('enchapadas')).toEqual(enchapadasAntes);
    expect(repo().importados('principal')[0].precioNeto).toBe(123_456);
    expect(repo().listarManuales()).toHaveLength(1);

    // Y una nueva enchapadas (un costo distinto) tampoco toca la principal.
    const hojas = planillaEnchapadas();
    hojas['LOS RIOS ENCHP'] = {
      ...hojas['LOS RIOS ENCHP'],
      ...filasPuerta(12, [['2,00 A 2,20 MTS', '0,70 MT', 75_000]]),
    };
    await aplicar(db, hojas);
    expect(repo().importados('principal')).toEqual(nueva.productos);
    expect(repo().buscarPorCodigo('LOSR-EM-070-220')?.precioNeto).toBe(75_000);
  });

  it('la versión del catálogo cambia en cada importación, de cualquier origen', async () => {
    const { db, repo } = await base();
    guardarCatalogo(db, principal());
    const v1 = repo().version!;
    // Con una sola planilla, la huella es la suya: nada cambia para quien no importa enchapadas.
    expect(repo().metadata?.sha256).toBe('principal-1');
    expect(repo().metadata?.fuente).toBe('COTIZADOR.xlsx');
    const { importado } = await aplicar(db, planillaEnchapadas());
    const v2 = repo().version!;
    expect(v2).not.toBe(v1);
    expect(repo().metadata?.sha256).not.toBe('principal-1');
    expect(repo().metadata?.fuente).toBe('COTIZADOR.xlsx + VALORES.xlsx');
    expect(repo().metadata?.cantidadProductos).toBe(31);
    expect(repo().metadataOrigen('enchapadas')).toMatchObject({
      sha256: importado.catalogo.sha256,
      fuente: 'VALORES.xlsx',
      cantidadProductos: 27,
    });
    expect(repo().metadataOrigen('principal')).toMatchObject({ sha256: 'principal-1', cantidadProductos: 4 });
    // Una propuesta hecha con la versión anterior deja de valer: cambió alguna planilla.
    expect(repo().mismaImportacion(v1)).toBe(false);
    expect(repo().mismaImportacion(v2)).toBe(true);
    // Reimportar el mismo archivo cambia la versión (fecha) pero no invalida las propuestas en curso.
    await aplicar(db, planillaEnchapadas());
    expect(repo().version).not.toBe(v2);
    expect(repo().mismaImportacion(v2)).toBe(true);
    // Un producto nuevo de la principal, en cambio, sí las invalida.
    const nueva = principal();
    nueva.sha256 = 'principal-2';
    guardarCatalogo(db, nueva);
    expect(repo().mismaImportacion(v2)).toBe(false);
    expect(repo().metadata?.cantidadProductos).toBe(31);
  });

  it('el mínimo de productos conservados se controla por origen', async () => {
    const { db, repo } = await base();
    const grande: Catalogo = {
      ...principal(),
      productos: Array.from({ length: 100 }, (_, i) =>
        producto(`HUIL-M-${i}`, { largo: 2 + i / 100, anchoMin: 0.8 + i, anchoMax: 0.85 + i }),
      ),
    };
    guardarCatalogo(db, grande);
    // Las 27 enchapadas son muy pocas frente a los 100 de la principal, pero son otra planilla: sin control.
    await aplicar(db, planillaEnchapadas());
    expect(repo().todos()).toHaveLength(127);
    // Reducir las enchapadas de 27 a 16 sí exige forzar, y el catálogo no cambia si no se fuerza.
    const soloHuilo = { 'HUILO HUILO ENCHP': planillaEnchapadas()['HUILO HUILO ENCHP'] };
    await expect(aplicar(db, soloHuilo)).rejects.toThrow(
      /trae 16 productos y el catálogo actual tiene 27 de la planilla de enchapadas.*--forzar/,
    );
    expect(repo().conteoPorOrigen()).toEqual({ principal: 100, enchapadas: 27 });
    await aplicar(db, soloHuilo, { forzar: true });
    expect(repo().conteoPorOrigen()).toEqual({ principal: 100, enchapadas: 16 });
    // Y la principal conserva su propio control.
    expect(() =>
      guardarCatalogo(db, { ...grande, sha256: 'menos', productos: grande.productos.slice(0, 80) }),
    ).toThrow(/trae 80 productos y el catálogo actual tiene 100\..*--forzar/);
    expect(repo().conteoPorOrigen()).toEqual({ principal: 100, enchapadas: 16 });
  });

  it('un código o producto repetido en otra planilla o agregado a mano se rechaza sin modificar nada', async () => {
    const { db, repo } = await base();
    guardarCatalogo(db, principal());
    await aplicar(db, planillaEnchapadas());
    const version = repo().version;
    const antes = repo().todos();
    // Otra planilla ya tiene ese código.
    const { importado } = await importarYGuardable(planillaEnchapadas());
    const choque: Catalogo = {
      ...importado.catalogo,
      productos: importado.catalogo.productos.map((p, i) => (i === 0 ? { ...p, codigo: 'HUIL-M-3-A' } : p)),
    };
    expect(() => guardarCatalogo(db, choque)).toThrow(
      /repite 1 código\(s\) o producto\(s\) de otra planilla ya importada: HUIL-M-3-A/,
    );
    // Mismos atributos que un producto de la otra planilla, con otro código.
    const mismoProducto: Catalogo = {
      ...importado.catalogo,
      origen: 'enchapadas',
      productos: [
        ...importado.catalogo.productos.slice(1),
        { ...importado.catalogo.productos[0], codigo: 'OTRO-1' },
      ],
    };
    guardarCatalogo(db, mismoProducto);
    expect(repo().buscarPorCodigo('OTRO-1')).toBeDefined();
    const enPrincipal: Catalogo = {
      ...principal(),
      sha256: 'p2',
      productos: [...principal().productos, { ...importado.catalogo.productos[1], codigo: 'OTRO-2' }],
    };
    expect(() => guardarCatalogo(db, enPrincipal)).toThrow(/de otra planilla ya importada/);
    expect(
      repo()
        .importados('enchapadas')
        .map((p) => p.codigo),
    ).toContain('OTRO-1');
    expect(repo().todos()).toHaveLength(antes.length);
    expect(repo().version).not.toBe(version);
    async function importarYGuardable(hojas: Hojas) {
      const { ruta, limpiar } = await escribirXlsx(hojas);
      limpiezas.push(limpiar);
      return { importado: await importarPlanilla(ruta) };
    }
  });
});

describe('productos agregados a mano frente a una planilla nueva', () => {
  it('una planilla que trae el código de un producto manual se rechaza completa, sin tocar el catálogo', async () => {
    const { db, repo } = await base();
    guardarCatalogo(db, principal());
    repo().agregarProductoManual(
      producto('MARC-PF-30X70-240', { modelo: 'Manual', descripcion: 'M' }),
      repo().version!,
    );
    const version = repo().version;
    await expect(aplicar(db, planillaEnchapadas())).rejects.toThrow(
      /repite un código o producto agregado manualmente/,
    );
    expect(repo().conteoPorOrigen()).toEqual({ principal: 4 });
    expect(repo().version).toBe(version);
    expect(repo().metadataOrigen('enchapadas')).toBeNull();
  });
});

describe('vista previa de la importación por origen', () => {
  it('compara solo con los productos de su propio origen y dice qué otra planilla no se toca', async () => {
    const { db } = await base();
    guardarCatalogo(db, principal());
    const { ruta, limpiar } = await escribirXlsx(planillaEnchapadas(), 'cualquier-nombre.xlsx');
    limpiezas.push(limpiar);
    const repo = new RepositorioCatalogoSqlite(db);
    const primera = (await analizarPlanilla(ruta, 'valores.xlsx', repo)).vista;
    expect(primera).toMatchObject({
      origen: 'enchapadas',
      etiquetaOrigen: 'Planilla de enchapadas, prepintadas y marcos finger',
      fuente: 'valores.xlsx',
      totalProductos: 27,
      baseSha256: null,
      conteos: { nuevos: 27, modificados: 0, sinCambios: 0, eliminados: 0 },
      sinModificar: [{ origen: 'principal', etiqueta: 'Planilla de puertas sólidas', productos: 4 }],
    });
    // Las incidencias dicen de qué hoja es cada fila (el bloque de ENDOLADO no se importa).
    expect(primera.incidencias.map((i) => [i.hoja, i.fila])).toEqual([['MARCOS ', 28]]);

    await aplicar(db, planillaEnchapadas());
    const hojas = planillaEnchapadas();
    hojas['LOS RIOS ENCHP'] = {
      ...hojas['LOS RIOS ENCHP'],
      ...filasPuerta(12, [['2,00 A 2,20 MTS', '0,70 MT', 75_000]]),
    };
    const { ruta: ruta2, limpiar: limpiar2 } = await escribirXlsx(hojas);
    limpiezas.push(limpiar2);
    const segunda = (await analizarPlanilla(ruta2, 'valores.xlsx', new RepositorioCatalogoSqlite(db))).vista;
    expect(segunda.conteos).toEqual({ nuevos: 0, modificados: 1, sinCambios: 26, eliminados: 0 });
    expect(segunda.productos.modificados[0]).toMatchObject({
      codigo: 'LOSR-EM-070-220',
      anterior: { precioNeto: 73_660 },
      nuevo: { precioNeto: 75_000 },
    });
    expect(segunda.baseSha256).toBe(new RepositorioCatalogoSqlite(db).metadataOrigen('enchapadas')?.sha256);
  });

  it('un libro que no es ninguna de las dos planillas falla con un error claro y el catálogo queda igual', async () => {
    const { db, repo } = await base();
    guardarCatalogo(db, principal());
    const version = repo().version;
    const { ruta, limpiar } = await escribirXlsx({ Hoja1: { A1: 'nada', B2: 5 } });
    limpiezas.push(limpiar);
    await expect(analizarPlanilla(ruta, 'x.xlsx', repo())).rejects.toThrow(ErrorImportacion);
    await expect(analizarPlanilla(ruta, 'x.xlsx', repo())).rejects.toThrow(/No reconozco esta planilla/);
    expect(repo().version).toBe(version);
    expect(repo().todos()).toHaveLength(4);
  });
});

describe('maderas de la planilla y configuración guardada', () => {
  it('«pino finger» nunca es PINO OREGON; «pino» sigue siéndolo; «en Mara» y «enchapada en Mara» son maderas distintas', () => {
    const c = CONFIGURACION_CATALOGO_BASE;
    for (const v of [
      'pino finger',
      'Pino Finger',
      'PINO-FINGER',
      'finger',
      'finger joint',
      'pino finger desnudo',
    ])
      expect(resolverMaderaConfigurada(v, c), v).toBe('PINO FINGER');
    for (const v of ['pino', 'Pino Oregón', 'oregon'])
      expect(resolverMaderaConfigurada(v, c), v).toBe('PINO OREGON');
    for (const v of [
      'finger enchapado',
      'pino finger enchapado',
      'Pino Finger enchapado en mara',
      'finger enchapada',
    ])
      expect(resolverMaderaConfigurada(v, c), v).toBe('PINO FINGER ENCHAPADO MARA');
    for (const v of ['enchapada en mara', 'Enchape Mara', 'mara enchapada', 'enchapado en Mara', 'enchapada'])
      expect(resolverMaderaConfigurada(v, c), v).toBe('MARA ENCHAPADA');
    expect(resolverMaderaConfigurada('mara', c)).toBe('MARA');
    for (const v of ['prepintada', 'Prepintado', 'PREPINTADAS'])
      expect(resolverMaderaConfigurada(v, c), v).toBe('PREPINTADA');
    expect(validarConfiguracionCatalogo({}).maderas.map((m) => m.codigo)).toEqual([
      'O',
      'L',
      'M',
      'R',
      'PP',
      'EM',
      'PF',
      'FE',
    ]);
  });

  it('una configuración guardada antes recibe las maderas nuevas al importar las enchapadas', async () => {
    const { db, repo } = await base();
    const vieja = { maderas: CONFIGURACION_CATALOGO_BASE.maderas.slice(0, 4) };
    guardarCatalogo(db, principal(), validarConfiguracionCatalogo(vieja));
    expect(repo().configuracion.maderas.map((m) => m.nombre)).toEqual([
      'PINO OREGON',
      'LENGA',
      'MARA',
      'RAULI',
    ]);
    expect(repo().resolverMadera('pino finger')).toBeNull();
    await aplicar(db, planillaEnchapadas());
    const r = repo();
    expect(r.configuracion.maderas.map((m) => m.nombre)).toContain('PINO FINGER ENCHAPADO MARA');
    expect(r.resolverMadera('pino finger')).toBe('PINO FINGER');
    expect(r.resolverMadera('pino')).toBe('PINO OREGON');
    // La IA ve las maderas nuevas con sus alias, y «pino» solo en PINO OREGON.
    const alias = r.aliasMaderas();
    expect(alias['PINO FINGER']).toContain('FINGER');
    expect(
      Object.entries(alias)
        .filter(([, a]) => a.includes('PINO'))
        .map(([n]) => n),
    ).toEqual(['PINO OREGON']);
    expect(r.maderas()).toEqual([
      'MARA',
      'PINO OREGON',
      'PREPINTADA',
      'MARA ENCHAPADA',
      'PINO FINGER',
      'PINO FINGER ENCHAPADO MARA',
    ]);
    const contexto = contextoSeguro(
      'x',
      [],
      clienteVacio(),
      r.modelos(),
      r.maderas(),
      [],
      'cotizacion_nueva',
      null,
      { modelos: r.aliasModelos(), maderas: alias },
    );
    expect(contexto.maderas).toContain('PINO FINGER');
    expect(contexto.aliasMaderas['MARA ENCHAPADA']).toContain('ENCHAPADA EN MARA');
    expect(SYSTEM).toMatch(/«Pino finger» es PINO FINGER, nunca PINO OREGON/);
    expect(SYSTEM).toMatch(
      /«enchapada en Mara».*MARA ENCHAPADA.*«prepintada» es PREPINTADA.*«Huilo Huilo en Mara» sin enchape es MARA sólida/,
    );
  });
});

describe('migración a v14: productos por origen', () => {
  it('las bases anteriores quedan como «principal», con su orden y metadatos', async () => {
    const { ruta, db } = await base();
    guardarCatalogo(db, principal());
    const meta = db.prepare('SELECT fuente, sha256, fecha FROM catalogo_meta WHERE id = 1').get() as {
      fuente: string;
      sha256: string;
      fecha: string;
    };
    // Forma de una base en v13: sin la columna origen, con orden único global y sin catalogo_origenes.
    db.exec(`
      DROP TABLE productos_catalogo;
      DROP TABLE catalogo_origenes;
      CREATE TABLE productos_catalogo (
        codigo TEXT PRIMARY KEY, orden INTEGER NOT NULL UNIQUE CHECK (orden >= 0), modelo TEXT NOT NULL,
        modelo_normalizado TEXT NOT NULL, familia TEXT NOT NULL CHECK (familia IN ('PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA')),
        tipo TEXT, madera TEXT NOT NULL, medida TEXT NOT NULL, ancho_min REAL, ancho_max REAL, largo REAL NOT NULL,
        precio_neto REAL NOT NULL CHECK (precio_neto > 0), descripcion TEXT NOT NULL, fila_origen INTEGER NOT NULL,
        alto_min REAL, alto_max REAL, UNIQUE (modelo, madera, medida, largo)
      );
      INSERT INTO productos_catalogo (codigo, orden, modelo, modelo_normalizado, familia, madera, medida, ancho_min, ancho_max, largo, precio_neto, descripcion, fila_origen)
        VALUES ('A-1', 0, 'Huilo Huilo', 'HUILOHUILO', 'PUERTA', 'MARA', '0,80 A 0,85', 0.8, 0.85, 2.4, 100000, 'A', 4),
               ('A-2', 1, 'Huilo Huilo', 'HUILOHUILO', 'PUERTA', 'LENGA', '0,80 A 0,85', 0.8, 0.85, 2.4, 100000, 'B', 5);
      PRAGMA user_version = 13;
    `);
    cerrarBaseDatos(ruta);
    const migrada = abrirBaseDatos(ruta);
    expect(migrada.pragma('user_version', { simple: true })).toBe(VERSION_ESQUEMA);
    expect(VERSION_ESQUEMA).toBeGreaterThanOrEqual(14);
    const r = new RepositorioCatalogoSqlite(migrada);
    expect(r.importados('principal').map((p) => p.codigo)).toEqual(['A-1', 'A-2']);
    expect(r.conteoPorOrigen()).toEqual({ principal: 2 });
    expect(r.metadataOrigen('principal')).toEqual({ ...meta, cantidadProductos: 2 });
    expect(r.version).toBe(`${meta.sha256}:${meta.fecha}`);
    // El orden ya no es único en toda la tabla: otra planilla puede numerar también desde 0.
    await aplicar(migrada, planillaEnchapadas());
    expect(ordenes(migrada)).toEqual([
      { origen: 'enchapadas', desde: 0, hasta: 26, n: 27 },
      { origen: 'principal', desde: 0, hasta: 1, n: 2 },
    ]);
  });
});

describe('rango de alto superpuesto', () => {
  it('usa los escalones del catálogo: un rango, una medida exacta con su holgura y un rango incompleto', async () => {
    const { db, repo } = await base();
    guardarCatalogo(db, principal());
    await aplicar(db, planillaEnchapadas());
    const r = repo();
    const candidata = (p: Partial<Producto>) =>
      producto('NUEVO', {
        modelo: 'Huilo Huilo',
        madera: 'MARA ENCHAPADA',
        medida: '0,85',
        anchoMin: 0.85,
        anchoMax: 0.85,
        tipo: 'PUERTA ENCHAPADA',
        ...p,
      });
    // 0,85 existe con altos 2,00–2,20 y 2,21–2,40.
    expect(r.rangoSuperpuesto(candidata({ altoMin: 2.3, altoMax: 2.35, largo: 2.35 }))?.codigo).toBe(
      'HUIL-EM-085-240',
    );
    expect(r.rangoSuperpuesto(candidata({ largo: 2.3 }))?.codigo).toBe('HUIL-EM-085-240');
    expect(r.rangoSuperpuesto(candidata({ altoMin: 2.15, altoMax: 2.3, largo: 2.3 }))?.codigo).toBe(
      'HUIL-EM-085-220',
    );
    expect(r.rangoSuperpuesto(candidata({ altoMin: 2.41, altoMax: 2.6, largo: 2.6 }))).toBeNull();
    expect(r.rangoSuperpuesto(candidata({ largo: 2.402 }))?.codigo).toBe('HUIL-EM-085-240');
    expect(r.rangoSuperpuesto(candidata({ largo: 2.41 }))).toBeNull();
    // Un rango incompleto o invertido no crea un escalón: el alto vale como largo exacto.
    expect(r.rangoSuperpuesto(candidata({ altoMin: 2.5, altoMax: null, largo: 2.6 }))).toBeNull();
    expect(r.rangoSuperpuesto(candidata({ altoMin: 2.4, altoMax: 2.3, largo: 2.6 }))).toBeNull();
    // Otro ancho o la madera sólida no chocan.
    expect(
      r.rangoSuperpuesto(candidata({ medida: '0,88', anchoMin: 0.88, anchoMax: 0.88, largo: 2.3 })),
    ).toBeNull();
    expect(r.rangoSuperpuesto(candidata({ madera: 'LENGA', largo: 2.3 }))).toBeNull();
  });
});

describe('resolución y márgenes con las dos planillas', () => {
  async function servicio() {
    const { dir, db, repo } = await base();
    guardarCatalogo(db, principal());
    await aplicar(db, planillaEnchapadas());
    const llm = { interpretar: vi.fn() };
    return { repo: repo(), llm, servicio: new Servicio(repo(), llm, new Almacen(dir)) };
  }
  const pedido = (modelo: string, madera: string | null, extra: Record<string, unknown> = {}) => ({
    modelo,
    madera,
    ancho: null,
    alto: null,
    medida: null,
    cantidad: 2,
    ...extra,
  });
  const lista = (...items: object[]) => ({
    name: 'actualizar_cotizacion',
    input: { items, cliente: clienteVacio() },
  });
  async function cotizar(s: Awaited<ReturnType<typeof servicio>>, item: object) {
    s.llm.interpretar.mockResolvedValueOnce(lista(item));
    return (await s.servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza' })).cotizacion;
  }
  const linea = (q: Awaited<ReturnType<typeof cotizar>>) => q.montos.lineas[0];

  it('«Huilo Huilo enchapada en Mara 83,5 x 236» usa el siguiente ancho y el rango de alto 2,21–2,40, con margen de enchapada', async () => {
    const s = await servicio();
    const q = await cotizar(s, pedido('Huilo Huilo', 'enchapada en Mara', { ancho: 83.5, alto: 236 }));
    expect(q.incompletos).toEqual([]);
    const l = linea(q);
    expect(l.producto.codigo).toBe('HUIL-EM-085-240');
    expect(l).toMatchObject({
      cantidad: 2,
      precioFabrica: 102_019,
      margen: MARGENES_INICIALES.puertas_enchapadas_mara,
      anchoSolicitado: 0.835,
      altoSolicitado: 2.36,
    });
    expect(l.precioUnitario).toBe(Math.round(102_019 * 1.75));
    expect(referenciaCatalogo(l)).toBe(
      'Referencia HUIL-EM-085-240 · 0,85 × 2,21–2,40 m · siguiente medida del catálogo en ancho',
    );
  });

  it('el mismo modelo se distingue por la terminación: sólida en Mara, prepintada y enchapada', async () => {
    const s = await servicio();
    const solida = linea(await cotizar(s, pedido('Huilo Huilo', 'Mara', { ancho: 83.5, alto: 240 })));
    expect(solida.producto.codigo).toBe('HUIL-M-3-A');
    expect(solida.margen).toBe(MARGENES_INICIALES.puertas_solidas_mara_lenga);
    // Prepintada: solo hay 0,70, 0,80 y 0,90; 0,835 cotiza 0,90.
    const pre = linea(await cotizar(s, pedido('Huilo Huilo', 'prepintada', { ancho: 83.5, alto: 236 })));
    expect(pre.producto.codigo).toBe('HUIL-PP-090-240');
    expect(pre).toMatchObject({
      precioFabrica: 53_840,
      margen: 1.4,
      precioUnitario: Math.round(53_840 * 2.4),
    });
    const sin = linea(await cotizar(s, pedido('Huilo Huilo', 'Mara enchapada', { ancho: 70, alto: 210 })));
    expect(sin.producto.codigo).toBe('HUIL-EM-070-220');
    expect(sin.margen).toBe(0.75);
    const losRios = linea(await cotizar(s, pedido('Los Ríos', 'prepintada', { ancho: 75, alto: 2.1 })));
    expect(losRios.producto.codigo).toBe('LOSR-PP-075-220');
  });

  it('los marcos finger se cotizan por escuadría en mm; desnudo 100 %, enchapado 75 %; «pino» sigue siendo Oregón', async () => {
    const s = await servicio();
    const desnudo = linea(
      await cotizar(s, pedido('Marco', 'pino finger', { medida: '30x70', alto: 2.4, cantidad: 3 })),
    );
    expect(desnudo.producto.codigo).toBe('MARC-PF-30X70-240');
    expect(desnudo).toMatchObject({ precioFabrica: 12_295, margen: 1, precioUnitario: 24_590, cantidad: 3 });
    expect(desnudo.producto.madera).toBe('PINO FINGER');
    // Entre 2,50 y 3,00 m el set siguiente es el de 3,00 m (también es un set, no una pieza lineal).
    const enchapado = linea(
      await cotizar(s, pedido('Marco', 'finger enchapado', { medida: '30x70', alto: 2.6 })),
    );
    expect(enchapado.producto.codigo).toBe('MARC-FE-30X70-300');
    expect(enchapado).toMatchObject({
      precioFabrica: 46_250,
      margen: 0.75,
      precioUnitario: Math.round(46_250 * 1.75),
    });
    expect(referenciaCatalogo(enchapado)).toBe(
      'Referencia MARC-FE-30X70-300 · 3,00 m · siguiente medida del catálogo en largo',
    );
    const oregon = linea(await cotizar(s, pedido('Marco', 'pino', { medida: '4', alto: 2.2 })));
    expect(oregon.producto.codigo).toBe('MAR-O-2X4-A');
    expect(oregon.producto.madera).toBe('PINO OREGON');
  });

  it('la puerta enchapada y su marco del pedido de Paula Lastra quedan completos con el anclaje de nombres y cifras activo', async () => {
    const s = await servicio();
    Object.assign(s.llm, { verificarCifras: true });
    s.llm.interpretar.mockResolvedValueOnce(lista(
      pedido('HUILO HUILO', 'MARA ENCHAPADA', { ancho: 0.82, alto: 2.27, tipoMedida: 'vano' }),
      pedido('MARCO', 'MARA ENCHAPADA', { medida: '30x90', alto: 2.27 }),
    ));
    const q = (await s.servicio.ejecutar({
      tipo: 'chat',
      mensaje: 'Cotizar a Paula Lastra\nDespacho a Chillan\n2 unidades Huilo Huilo enchapada de\n0.82x2.27 mts (vano) con su marco de\n30x90 enchapado\n1 unidad ranco lenga solida 0.87x2.44 mts\n(vano) con su marco de 2x5 pulgadas en\nlenga',
    })).cotizacion;
    expect(q.incompletos).toEqual([]);
    expect(q.montos.lineas.map((l) => l.producto.codigo)).toEqual(['HUIL-EM-085-240', 'MARC-FE-30X90-250']);
    expect(q.solicitudes[1].madera).toBe('PINO FINGER ENCHAPADO MARA');
  });

  it('fuera del catálogo se pregunta describiendo el tramo que se cotiza, también con rangos de alto', async () => {
    const s = await servicio();
    const pregunta1 = async (item: object) => (await cotizar(s, item)).incompletos[0]?.pregunta;
    expect(await pregunta1(pedido('Huilo Huilo', 'enchapada en Mara', { ancho: 80, alto: 245 }))).toBe(
      'Huilo Huilo no viene en 2,45 m de alto o largo. Se cotizan altos o largos entre 2,00 y 2,40 m.',
    );
    expect(await pregunta1(pedido('Huilo Huilo', 'enchapada en Mara', { ancho: 95, alto: 230 }))).toBe(
      'Huilo Huilo no viene en 0,95 m de ancho. Se cotizan anchos entre 0,70 y 0,90 m.',
    );
    // Un marco más corto que el set menor se cotiza con ese set: no se pregunta.
    const corto = await cotizar(s, pedido('Marco', 'pino finger', { medida: '30x70', alto: 2 }));
    expect(corto.incompletos).toEqual([]);
    expect(linea(corto).producto.codigo).toBe('MARC-PF-30X70-220');
    // El marco de una puerta enchapada (Paula Lastra: 30x90 para 2,27 m) es el set Pino Finger enchapado de 2,5 m.
    const enchapado = await cotizar(s, pedido('Marco', 'enchapado en mara', { medida: '30x90', alto: 2.27 }));
    expect(enchapado.incompletos).toEqual([]);
    expect(linea(enchapado).producto.codigo).toBe('MARC-FE-30X90-250');
    // Sin la madera se pregunta por ella, con las terminaciones entre las opciones.
    const faltante = await pregunta1(pedido('Huilo Huilo', null, { ancho: 80, alto: 230 }));
    expect(faltante).toMatch(/Prepintada/);
    expect(faltante).toMatch(/Mara Enchapada/);
    // Una sola altura: «hasta» no aplica y el tramo se dice con un único valor.
    expect(
      pregunta(
        {
          tipo: 'medida_no_disponible',
          campo: 'alto',
          valor: 2.1,
          disponibles: [],
          rango: { min: 2.4, max: 2.4 },
        },
        'Marco',
      ),
    ).toBe('Marco no viene en 2,10 m de alto o largo. Solo se cotiza 2,40 m de alto o largo.');
  });

  it('la IA recibe las maderas nuevas con sus alias y no se le da «pino» para el finger', async () => {
    const s = await servicio();
    await cotizar(s, pedido('Huilo Huilo', 'Mara', { ancho: 80, alto: 240 }));
    const enviado = s.llm.interpretar.mock.calls[0][0];
    expect(enviado.maderas).toEqual(
      expect.arrayContaining(['PREPINTADA', 'MARA ENCHAPADA', 'PINO FINGER', 'PINO FINGER ENCHAPADO MARA']),
    );
    expect(enviado.aliasMaderas['PINO FINGER']).toEqual(expect.arrayContaining(['FINGER']));
    expect(enviado.aliasMaderas['PINO FINGER']).not.toContain('PINO');
    expect(enviado.aliasMaderas['PINO OREGON']).toEqual(['PINO', 'OREGON']);
    expect(enviado.aliasMaderas['MARA ENCHAPADA']).toEqual(
      expect.arrayContaining(['ENCHAPADA EN MARA', 'ENCHAPE MARA']),
    );
  });
});

// Con la planilla real y la de enchapadas del directorio privado (nunca versionadas); sin ellas, no corre.
const PRINCIPAL_REAL = process.env.NELTUME_PLANILLA ?? 'datos-privados/COTIZADOR_2026.xlsx';
const ENCHAPADAS_REAL =
  process.env.NELTUME_PLANILLA_ENCHAPADAS ?? 'datos-privados/VALORES PUERTAS ENCHAPADAS_NELTUME.CO.xlsx';
describe.skipIf(!existsSync(PRINCIPAL_REAL) || !existsSync(ENCHAPADAS_REAL))(
  'con las planillas reales (solo local)',
  () => {
    it('importa las dos en una misma base, sin chocar, y cotiza con los márgenes de cada categoría', async () => {
      const { dir, db, repo } = await base();
      const p = await importarPlanilla(PRINCIPAL_REAL);
      expect(p.origen).toBe('principal');
      guardarCatalogo(db, p.catalogo, p.configuracion);
      const v1 = repo().version;
      const e = await importarPlanilla(ENCHAPADAS_REAL, repo().configuracion);
      expect(e.origen).toBe('enchapadas');
      expect(e.catalogo.productos).toHaveLength(94);
      expect(e.conteos).toEqual({ PUERTA: 82, MARCO: 12, PIEZAS_T: 0, MOLDURA: 0 });
      expect(e.incidencias.map((i) => i.detalle)).toEqual([
        expect.stringMatching(/SET ENDOLADO MDF ENCHAPADO EN MARA.*no reconocido/),
        expect.stringMatching(/SET ENDOLADO MDF RECTO DESNUDO.*no reconocido/),
      ]);
      guardarCatalogo(db, e.catalogo, e.configuracion);
      const r = repo();
      expect(r.version).not.toBe(v1);
      expect(r.conteoPorOrigen()).toEqual({ principal: 8772, enchapadas: 94 });
      expect(r.todos()).toHaveLength(8772 + 94);
      expect(new Set(r.todos().map((x) => x.codigo)).size).toBe(8772 + 94);
      const llm = { interpretar: vi.fn() };
      const servicio = new Servicio(r, llm, new Almacen(dir));
      const cotizar = async (item: object) => {
        llm.interpretar.mockResolvedValueOnce({
          name: 'actualizar_cotizacion',
          input: { items: [item], cliente: clienteVacio() },
        });
        return (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza' })).cotizacion.montos.lineas[0];
      };
      const enchapada = await cotizar({
        modelo: 'Huilo Huilo',
        madera: 'enchapada en Mara',
        ancho: 83.5,
        alto: 236,
        medida: null,
        cantidad: 1,
      });
      expect(enchapada).toMatchObject({ precioFabrica: 102_019, margen: 0.75 });
      expect(enchapada.producto.codigo).toBe('HUIL-EM-085-240');
      const solida = await cotizar({
        modelo: 'Huilo Huilo',
        madera: 'Mara',
        ancho: 83.5,
        alto: 236,
        medida: null,
        cantidad: 1,
      });
      expect(solida.producto.madera).toBe('MARA');
      const coz = await cotizar({
        modelo: 'Coz Coz',
        madera: 'prepintada',
        ancho: 65,
        alto: 2.3,
        medida: null,
        cantidad: 1,
      });
      expect(coz).toMatchObject({ precioFabrica: 48_750, margen: 1.4 });
      const finger = await cotizar({
        modelo: 'Marco',
        madera: 'pino finger',
        ancho: null,
        alto: 2.2,
        medida: '30x90',
        cantidad: 1,
      });
      expect(finger).toMatchObject({ precioFabrica: 14_980, margen: 1 });
      const fingerMara = await cotizar({
        modelo: 'Marco',
        madera: 'finger enchapado',
        ancho: null,
        alto: 3,
        medida: '30x90',
        cantidad: 1,
      });
      expect(fingerMara).toMatchObject({ precioFabrica: 56_000, margen: 0.75 });
      // Las maderas sólidas del marco de la planilla principal no cambian.
      const oregon = await cotizar({
        modelo: 'Marco',
        madera: 'pino',
        ancho: null,
        alto: 2.1,
        medida: '4',
        cantidad: 1,
      });
      expect(oregon.producto.madera).toBe('PINO OREGON');
      // La vista previa de la principal se compara solo con los productos de la principal.
      const vista = (await analizarPlanilla(PRINCIPAL_REAL, 'COTIZADOR.xlsx', repo())).vista;
      expect(vista).toMatchObject({
        origen: 'principal',
        etiquetaOrigen: 'Planilla de puertas sólidas',
        conteos: { nuevos: 0, modificados: 0, sinCambios: 8772, eliminados: 0 },
        sinModificar: [{ origen: 'enchapadas', productos: 94 }],
      });
      // Volver a importar la principal no toca las enchapadas.
      const otra = await importarPlanilla(PRINCIPAL_REAL, r.configuracion);
      guardarCatalogo(db, otra.catalogo, otra.configuracion);
      expect(repo().conteoPorOrigen()).toEqual({ principal: 8772, enchapadas: 94 });
    });
  },
);

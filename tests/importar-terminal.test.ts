import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { Almacen } from '../src/servidor/almacen';
import { abrirBaseDatos, cerrarBaseDatos } from '../src/servidor/base-datos';
import { configuracionGuardada, RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { planillaEnchapadas, planillaPrincipal, xlsxBytes, type Hojas } from './fixture-xlsx';

// `npm run importar` corre en el servidor junto a la aplicación: debe esperar el bloqueo del almacén igual que
// la importación desde Catálogo → Importar, para no cambiar el catálogo en medio de una emisión.

const raiz = process.cwd();
let directorio: string | undefined;
afterEach(async () => {
  cerrarBaseDatos();
  if (directorio) await rm(directorio, { recursive: true, force: true });
  directorio = undefined;
});

const productos = (ruta: string) => {
  const db = new Database(ruta, { readonly: true });
  try {
    return (db.prepare('SELECT COUNT(*) AS n FROM productos_catalogo').get() as { n: number }).n;
  } finally {
    db.close();
  }
};

/** Corre `npm run importar` sobre la base de `directorio` y devuelve el código de salida y lo que escribió. */
function importarDesdeTerminal(
  directorio: string,
  planilla: string,
  extra: string[] = [],
  config = join(raiz, 'config/catalogo.json'),
) {
  const datos = join(directorio, 'data');
  const proceso = spawn(
    join(raiz, 'node_modules/.bin/tsx'),
    ['--tsconfig', join(raiz, 'tsconfig.json'), join(raiz, 'scripts/importar.ts'), planilla, ...extra],
    {
      cwd: directorio,
      env: {
        ...process.env,
        NELTUME_DATA_DIR: datos,
        NELTUME_DB_PATH: join(datos, 'cotizador.sqlite'),
        NELTUME_CATALOGO_CONFIG: config,
      },
    },
  );
  let salida = '';
  proceso.stdout.on('data', (d) => (salida += d));
  proceso.stderr.on('data', (d) => (salida += d));
  return new Promise<{ codigo: number | null; salida: string }>((listo) =>
    proceso.on('close', (codigo) => listo({ codigo, salida })),
  );
}
function escribirPlanilla(nombre: string, hojas: Hojas, extra: Record<string, string> = {}) {
  const ruta = join(directorio!, nombre);
  const partes = unzipSync(xlsxBytes(hojas));
  for (const [parte, contenido] of Object.entries(extra)) partes[parte] = strToU8(contenido);
  writeFileSync(ruta, zipSync(partes));
  return ruta;
}

describe('scripts/importar.ts', () => {
  it('espera el bloqueo del almacén antes de guardar el catálogo', async () => {
    directorio = await mkdtemp(join(tmpdir(), 'neltume-importar-terminal-'));
    const datos = join(directorio, 'data');
    const base = join(datos, 'cotizador.sqlite');
    const planilla = join(directorio, 'enchapadas.xlsx');
    writeFileSync(planilla, xlsxBytes(planillaEnchapadas()));
    const almacen = new Almacen(datos, base);
    let salida = '';
    let termino: Promise<number | null> | undefined;
    await almacen.transaccion(async () => {
      const proceso = spawn(
        join(raiz, 'node_modules/.bin/tsx'),
        ['--tsconfig', join(raiz, 'tsconfig.json'), join(raiz, 'scripts/importar.ts'), planilla],
        {
          cwd: directorio,
          env: {
            ...process.env,
            NELTUME_DATA_DIR: datos,
            NELTUME_DB_PATH: base,
            NELTUME_CATALOGO_CONFIG: join(raiz, 'config/catalogo.json'),
          },
        },
      );
      proceso.stdout.on('data', (d) => (salida += d));
      proceso.stderr.on('data', (d) => (salida += d));
      termino = new Promise((listo) => proceso.on('close', listo));
      // Tiempo de sobra para que el script arranque y llegue a guardar; con el bloqueo tomado, no guarda.
      await new Promise((listo) => setTimeout(listo, 4000));
      expect(productos(base), salida).toBe(0);
    });
    expect(await termino, salida).toBe(0);
    expect(salida).toMatch(/27 productos/);
    expect(productos(base)).toBe(27);
    expect(existsSync(join(directorio, 'data/reporte-importacion-enchapadas.md'))).toBe(true);
  }, 30_000);

  it('conserva los alias editados en «Nombres y alias»: config/catalogo.json no los pisa', async () => {
    directorio = await mkdtemp(join(tmpdir(), 'neltume-importar-terminal-'));
    const datos = join(directorio, 'data');
    mkdirSync(datos, { recursive: true });
    const db = abrirBaseDatos(join(datos, 'cotizador.sqlite'));
    const repo = new RepositorioCatalogoSqlite(db);
    // «JUILO» se agregó en la aplicación y no está en config/catalogo.json.
    const editada = structuredClone(repo.configuracion);
    editada.aliasModelos['HUILO HUILO'] = [...editada.aliasModelos['HUILO HUILO'], 'JUILO'];
    repo.guardarConfiguracion(editada);
    cerrarBaseDatos();
    // El archivo trae un alias para un modelo que la base ya tiene y otro para uno que no tiene.
    const archivo = JSON.parse(readFileSync(join(raiz, 'config/catalogo.json'), 'utf8'));
    archivo.aliasModelos['HUILO HUILO'].push('UILO');
    archivo.aliasModelos['LOS RIOS'] = ['LOSRIOS'];
    const config = join(directorio, 'catalogo.json');
    writeFileSync(config, JSON.stringify(archivo));

    const r = await importarDesdeTerminal(directorio, escribirPlanilla('enchapadas.xlsx', planillaEnchapadas()), [], config);
    expect(r.codigo, r.salida).toBe(0);
    const guardada = configuracionGuardada(abrirBaseDatos(join(datos, 'cotizador.sqlite')))!;
    // Manda la base: conserva «JUILO» y no toma el alias que el archivo agrega a ese mismo modelo.
    expect(guardada.aliasModelos['HUILO HUILO']).toContain('JUILO');
    expect(guardada.aliasModelos['HUILO HUILO']).not.toContain('UILO');
    // Lo que la base no tenía llega desde el archivo.
    expect(guardada.aliasModelos['LOS RIOS']).toEqual(['LOSRIOS']);
  }, 30_000);

  it('una reducción bajo el 90 % no guarda, pero deja el reporte de la planilla', async () => {
    directorio = await mkdtemp(join(tmpdir(), 'neltume-importar-terminal-'));
    const base = join(directorio, 'data/cotizador.sqlite');
    expect((await importarDesdeTerminal(directorio, escribirPlanilla('enchapadas.xlsx', planillaEnchapadas()))).codigo).toBe(0);
    const reporte = join(directorio, 'data/reporte-importacion-enchapadas.md');
    writeFileSync(reporte, 'reporte viejo');
    const { 'LOS RIOS ENCHP': losRios } = planillaEnchapadas();
    const r = await importarDesdeTerminal(directorio, escribirPlanilla('enchapadas.xlsx', { 'LOS RIOS ENCHP': losRios }));
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/No se pudo actualizar el catálogo/);
    expect(r.salida).toMatch(/Si la reducción es intencional, repite la importación con --forzar/);
    expect(productos(base)).toBe(27);
    expect(readFileSync(reporte, 'utf8')).toMatch(/^# Reporte de importación[\s\S]*3 productos/);
  }, 30_000);

  it('si falla después de guardar, dice que el catálogo sí quedó guardado', async () => {
    directorio = await mkdtemp(join(tmpdir(), 'neltume-importar-terminal-'));
    // El logo no se puede escribir: en su lugar hay una carpeta.
    mkdirSync(join(directorio, 'public/logo-neltume.svg'), { recursive: true });
    const planilla = escribirPlanilla('principal.xlsx', planillaPrincipal(), {
      'xl/media/image2.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });
    const r = await importarDesdeTerminal(directorio, planilla);
    expect(r.codigo).toBe(1);
    expect(r.salida).toMatch(/quedó guardado/);
    expect(r.salida).not.toMatch(/No se pudo actualizar el catálogo/);
    expect(productos(join(directorio, 'data/cotizador.sqlite'))).toBe(3);
  }, 30_000);
});

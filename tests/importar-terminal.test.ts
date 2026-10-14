import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { Almacen } from '../src/servidor/almacen';
import { cerrarBaseDatos } from '../src/servidor/base-datos';
import { planillaEnchapadas, xlsxBytes } from './fixture-xlsx';

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
});

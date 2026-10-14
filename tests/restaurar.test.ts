import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { abrirBaseDatos, cerrarBaseDatos } from '../src/servidor/base-datos';
import { ErrorRestauracion, restaurarRespaldo } from '../scripts/lib/restauracion';

// O2 / 5.1: respaldar → cambiar → restaurar con una base temporal. La restauración exige el servidor detenido,
// verifica la copia antes de tocar nada y aparta lo que había para poder deshacer.

const raiz = process.cwd();
const tsx = join(raiz, 'node_modules', '.bin', 'tsx');
const REFERENCIA = `${'a'.repeat(64)}.png`;
let directorio: string | undefined;

afterEach(async () => {
  cerrarBaseDatos();
  vi.unstubAllEnvs();
  if (directorio) await rm(directorio, { recursive: true, force: true });
  directorio = undefined;
});

async function preparar() {
  directorio = await mkdtemp(join(tmpdir(), 'cotizador-restaurar-'));
  const datos = join(directorio, 'data');
  const entorno = {
    NELTUME_DATA_DIR: datos,
    NELTUME_DB_PATH: join(datos, 'cotizador.sqlite'),
    NELTUME_CATALOGO_CONFIG: join(directorio, 'config', 'catalogo.json'),
    NELTUME_RESPALDO_DIR: join(directorio, 'respaldos'),
  };
  for (const [clave, valor] of Object.entries(entorno)) vi.stubEnv(clave, valor);
  mkdirSync(join(directorio, 'config'));
  return { datos, entorno };
}

const marca = (valor: string) =>
  abrirBaseDatos()
    .prepare(
      `INSERT INTO ajustes (clave, valor_json, actualizada) VALUES ('prueba', ?, '2026-10-14')
       ON CONFLICT(clave) DO UPDATE SET valor_json = excluded.valor_json`,
    )
    .run(JSON.stringify(valor));

const leerMarca = (ruta: string) => {
  const db = new Database(ruta, { readonly: true });
  try {
    return JSON.parse((db.prepare("SELECT valor_json FROM ajustes WHERE clave = 'prueba'").get() as { valor_json: string }).valor_json);
  } finally {
    db.close();
  }
};

/** Estado «del respaldo»: marca, un PDF, una referencia y la configuración; luego respalda con el script real. */
function respaldar(datos: string, entorno: Record<string, string>) {
  marca('respaldo');
  mkdirSync(join(datos, 'pdf'), { recursive: true });
  writeFileSync(join(datos, 'pdf', 'cotizacion-1.pdf'), 'pdf del respaldo');
  mkdirSync(join(datos, 'referencias'), { recursive: true });
  writeFileSync(join(datos, 'referencias', REFERENCIA), 'png');
  writeFileSync(entorno.NELTUME_CATALOGO_CONFIG, '{"origen":"respaldo"}');
  cerrarBaseDatos();
  const r = spawnSync(tsx, ['scripts/respaldar.ts'], { cwd: raiz, env: { ...process.env, ...entorno }, encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(0);
  const carpeta = r.stdout.match(/^Respaldo en ([^:]+):/m)![1];
  // Después del respaldo el trabajo sigue: estos cambios se pierden al restaurar, pero quedan apartados.
  marca('despues');
  writeFileSync(join(datos, 'pdf', 'cotizacion-2.pdf'), 'pdf posterior');
  writeFileSync(entorno.NELTUME_CATALOGO_CONFIG, '{"origen":"despues"}');
  return carpeta;
}

describe('npm run restaurar', () => {
  it('restaura base, PDF, referencias y configuración del mismo respaldo y aparta lo anterior', async () => {
    const { datos, entorno } = await preparar();
    const carpeta = respaldar(datos, entorno);
    cerrarBaseDatos();

    const resultado = await restaurarRespaldo(carpeta);
    expect(resultado).toMatchObject({ cotizaciones: 0, pdf: 1, referencias: 1, config: true });
    expect(leerMarca(entorno.NELTUME_DB_PATH)).toBe('respaldo');
    expect(readdirSync(join(datos, 'pdf'))).toEqual(['cotizacion-1.pdf']);
    expect(readdirSync(join(datos, 'referencias'))).toEqual([REFERENCIA]);
    expect(readFileSync(entorno.NELTUME_CATALOGO_CONFIG, 'utf8')).toContain('respaldo');
    for (const sufijo of ['-wal', '-shm']) expect(existsSync(`${entorno.NELTUME_DB_PATH}${sufijo}`)).toBe(false);

    // Lo de antes queda aparte, completo, para deshacer.
    expect(leerMarca(join(resultado.aparte, 'cotizador.sqlite'))).toBe('despues');
    expect(readdirSync(join(resultado.aparte, 'pdf')).sort()).toEqual(['cotizacion-1.pdf', 'cotizacion-2.pdf']);
    expect(readFileSync(join(resultado.aparte, 'catalogo.json'), 'utf8')).toContain('despues');

    // La base restaurada abre normalmente.
    expect(JSON.parse((abrirBaseDatos().prepare("SELECT valor_json FROM ajustes WHERE clave = 'prueba'").get() as { valor_json: string }).valor_json)).toBe('respaldo');
  });

  it('el respaldo conserva la fecha de los PDF y referencias (la copia diaria enlaza los que no cambiaron)', async () => {
    const { datos, entorno } = await preparar();
    const pdf = join(datos, 'pdf', 'cotizacion-1.pdf');
    const referencia = join(datos, 'referencias', REFERENCIA);
    const fecha = new Date('2026-01-02T03:04:05Z');
    mkdirSync(join(datos, 'pdf'), { recursive: true });
    mkdirSync(join(datos, 'referencias'), { recursive: true });
    writeFileSync(pdf, 'pdf');
    writeFileSync(referencia, 'png');
    utimesSync(pdf, fecha, fecha);
    utimesSync(referencia, fecha, fecha);
    marca('respaldo');
    cerrarBaseDatos();
    const r = spawnSync(tsx, ['scripts/respaldar.ts'], { cwd: raiz, env: { ...process.env, ...entorno }, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    const carpeta = r.stdout.match(/^Respaldo en ([^:]+):/m)![1];
    expect(statSync(join(carpeta, 'pdf', 'cotizacion-1.pdf')).mtime.toISOString()).toBe(fecha.toISOString());
    expect(statSync(join(carpeta, 'referencias', REFERENCIA)).mtime.toISOString()).toBe(fecha.toISOString());
  });

  it('no toca nada si el servidor tiene la base abierta', async () => {
    const { datos, entorno } = await preparar();
    const carpeta = respaldar(datos, entorno);
    abrirBaseDatos(); // el «servidor» sigue con la base abierta

    await expect(restaurarRespaldo(carpeta)).rejects.toThrow(/en uso/);
    cerrarBaseDatos();
    expect(leerMarca(entorno.NELTUME_DB_PATH)).toBe('despues');
    expect(readdirSync(join(datos, 'pdf')).sort()).toEqual(['cotizacion-1.pdf', 'cotizacion-2.pdf']);
    expect(readdirSync(datos).some((n) => n.startsWith('antes-de-restaurar'))).toBe(false);
  });

  it('no toca nada si hay un bloqueo de escritura reciente', async () => {
    const { datos, entorno } = await preparar();
    const carpeta = respaldar(datos, entorno);
    cerrarBaseDatos();
    mkdirSync(join(datos, '.estado.lock'));
    await expect(restaurarRespaldo(carpeta)).rejects.toThrow(/guardando cambios/);
    expect(leerMarca(entorno.NELTUME_DB_PATH)).toBe('despues');
  });

  it('rechaza una copia dañada o que no es del cotizador antes de tocar los datos', async () => {
    const { datos, entorno } = await preparar();
    const carpeta = respaldar(datos, entorno);
    cerrarBaseDatos();
    const danada = join(directorio!, 'danada');
    mkdirSync(danada);
    writeFileSync(join(danada, 'cotizador.sqlite'), Buffer.alloc(8192, 7));
    await expect(restaurarRespaldo(danada)).rejects.toBeInstanceOf(ErrorRestauracion);

    const ajena = join(directorio!, 'ajena');
    mkdirSync(ajena);
    const otra = new Database(join(ajena, 'cotizador.sqlite'));
    otra.exec('CREATE TABLE x (y)');
    otra.close();
    await expect(restaurarRespaldo(ajena)).rejects.toThrow(/no es una base del cotizador/);

    await expect(restaurarRespaldo(join(directorio!, 'no-existe'))).rejects.toThrow(/No existe/);
    expect(leerMarca(entorno.NELTUME_DB_PATH)).toBe('despues');
    expect(existsSync(carpeta)).toBe(true);
  });

  it('el comando explica el uso y deja un mensaje claro al terminar', async () => {
    const { datos, entorno } = await preparar();
    const carpeta = respaldar(datos, entorno);
    cerrarBaseDatos();
    const env = { ...process.env, ...entorno };
    const sinCarpeta = spawnSync(tsx, ['scripts/restaurar.ts'], { cwd: raiz, env, encoding: 'utf8' });
    expect(sinCarpeta.status).toBe(2);
    expect(sinCarpeta.stdout).toMatch(/Uso: npm run restaurar/);

    const r = spawnSync(tsx, ['scripts/restaurar.ts', carpeta], { cwd: raiz, env, encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Restauración lista/);
    expect(r.stdout).toMatch(/antes-de-restaurar-/);
    expect(leerMarca(entorno.NELTUME_DB_PATH)).toBe('respaldo');
  });
});

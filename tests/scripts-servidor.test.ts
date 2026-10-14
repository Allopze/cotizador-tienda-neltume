import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

// Scripts del servidor (5.3, 5.5, 5.2): se prueban con un `docker` falso en el PATH que anota cada llamada.
// Con dash si está disponible: el servidor (Debian) ejecuta `sh` con dash, más estricto que bash.

const raiz = process.cwd();
const SHELL = existsSync('/bin/dash') ? '/bin/dash' : '/bin/sh';
const RESPALDO = '/app/respaldos/cotizador-2026-10-14T21-00-00-000Z';
let directorio: string | undefined;

afterEach(async () => {
  if (directorio) await rm(directorio, { recursive: true, force: true });
  directorio = undefined;
});

function escribir(ruta: string, contenido: string, ejecutable = false) {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, contenido);
  if (ejecutable) chmodSync(ruta, 0o755);
}

const DOCKER_FALSO = `#!/bin/sh
echo "$*" >> "$FALSO_LOG"
case "$*" in
  "compose version") exit 0 ;;
  "compose ps --status running -q cotizador") [ "\${FALSO_CORRIENDO:-1}" = 1 ] && echo abc123 ; exit 0 ;;
  *"npm run --silent respaldar")
    [ "\${FALSO_RESPALDO:-0}" = 0 ] || exit 1
    echo "Respaldo en ${RESPALDO}: 3 cotizaciones, 1 PDF, 0 referencias del cliente." ;;
  "compose build") exit "\${FALSO_BUILD:-0}" ;;
  "compose up"*) exit "\${FALSO_UP:-0}" ;;
  "compose cp "*) mkdir -p "$4/$(basename "\${3#cotizador:}")" ;;
esac
exit 0
`;

async function preparar() {
  directorio = await mkdtemp(join(tmpdir(), 'cotizador-scripts-'));
  const bin = join(directorio, 'bin');
  const log = join(directorio, 'docker.log');
  escribir(join(bin, 'docker'), DOCKER_FALSO, true);
  writeFileSync(log, '');
  const correr = (args: string[], env: Record<string, string> = {}, cwd = directorio!) =>
    spawnSync(SHELL, args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FALSO_LOG: log, ...env },
    });
  const llamadas = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  return { directorio, bin, log, correr, llamadas };
}

describe('docker/iniciar.sh', () => {
  const servidor = ['node', 'node_modules/next/dist/bin/next', 'start'];
  const valido = {
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    BETTER_AUTH_URL: 'https://cotizador.neltume.cl',
    NELTUME_IP_HEADER: '',
  };

  async function iniciar(env: Record<string, string | undefined>, comando = servidor) {
    const { bin, log, correr } = await preparar();
    // npm y node falsos: anotan la llamada en vez de migrar o levantar Next.
    for (const nombre of ['npm', 'node']) escribir(join(bin, nombre), `#!/bin/sh\necho "${nombre} $*" >> "$FALSO_LOG"\n`, true);
    const base = { BETTER_AUTH_SECRET: '', BETTER_AUTH_URL: '', NELTUME_IP_HEADER: '' };
    const r = correr([join(raiz, 'docker/iniciar.sh'), ...comando], { ...base, ...env } as Record<string, string>);
    return { ...r, llamadas: readFileSync(log, 'utf8') };
  }

  it('aborta con un mensaje claro si falta el secreto, es corto o el origen no es HTTPS', async () => {
    const casos: [Record<string, string>, RegExp][] = [
      [{ ...valido, BETTER_AUTH_SECRET: '' }, /falta BETTER_AUTH_SECRET/],
      [{ ...valido, BETTER_AUTH_SECRET: 'b'.repeat(31) }, /31 caracteres y necesita al menos 32/],
      [{ ...valido, BETTER_AUTH_URL: 'http://cotizador.neltume.cl' }, /BETTER_AUTH_URL debe ser el origen HTTPS/],
      [{ ...valido, BETTER_AUTH_URL: '' }, /BETTER_AUTH_URL debe ser el origen HTTPS/],
      [{ ...valido, NELTUME_IP_HEADER: 'true-client-ip' }, /NELTUME_IP_HEADER debe ser/],
    ];
    for (const [env, mensaje] of casos) {
      const r = await iniciar(env);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(mensaje);
      expect(r.stderr).toMatch(/No se inicia el cotizador/);
      // No llegó a migrar ni a iniciar Next.
      expect(r.llamadas).toBe('');
      await rm(directorio!, { recursive: true, force: true });
    }
  });

  it('con la configuración válida migra, prepara el primer arranque e inicia', async () => {
    const r = await iniciar({ ...valido, NELTUME_IP_HEADER: 'x-real-ip' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.llamadas.trim().split('\n')).toEqual([
      'npm run auth:migrar',
      'npm run --silent primer-arranque',
      'node node_modules/next/dist/bin/next start',
    ]);
  });

  it('otros comandos (restaurar, usuarios) se ejecutan sin validar ni migrar', async () => {
    const r = await iniciar({}, ['npm', 'run', 'restaurar', '--', RESPALDO]);
    expect(r.status).toBe(0);
    expect(r.llamadas.trim()).toBe(`npm run restaurar -- ${RESPALDO}`);
  });
});

/** Las mismas exclusiones en las dos formas de actualizar: lo propio del servidor nunca se borra. */
describe('exclusiones al sincronizar', () => {
  const exclusiones = (texto: string) =>
    [...texto.matchAll(/--exclude=(\/[^\s'"]+)/g)].map((m) => m[1]).sort();

  it('deploy.mjs y actualizar.sh conservan .env, respaldos*, compose.override.yaml, cron/ y .version-anterior/', () => {
    const esperado = ['/.env', '/.version-anterior/', '/compose.override.yaml', '/cron/', '/respaldos*'].sort();
    const deploy = readFileSync(join(raiz, 'scripts/deploy.mjs'), 'utf8');
    const lineaRsync = deploy.split('\n').find((l) => l.startsWith('rsync -a --delete'))!;
    expect(exclusiones(lineaRsync)).toEqual(esperado);
    const actualizar = readFileSync(join(raiz, 'scripts/actualizar.sh'), 'utf8');
    expect(exclusiones(actualizar.slice(actualizar.indexOf('sincronizar() {')))).toEqual(esperado);
  });
});

describe('scripts/actualizar.sh', () => {
  async function instalacion() {
    const contexto = await preparar();
    const inst = join(contexto.directorio, 'instalacion');
    const archivos: Record<string, string> = {
      'compose.yaml': 'version: vieja\n',
      Dockerfile: 'FROM viejo\n',
      'package.json': '{"version":"vieja"}\n',
      'docker/iniciar.sh': '#!/bin/sh\n',
      'src/viejo.ts': 'export {};\n',
      '.env': 'BETTER_AUTH_SECRET=secreto-del-servidor\n',
      'compose.override.yaml': 'services: {}\n',
      'cron/tarea.sh': '#!/bin/sh\n',
      'respaldos-servidor/cotizador-2026-01-01/marca': 'respaldo en el host\n',
    };
    for (const [ruta, contenido] of Object.entries(archivos)) escribir(join(inst, ruta), contenido);
    escribir(join(inst, 'scripts/actualizar.sh'), readFileSync(join(raiz, 'scripts/actualizar.sh'), 'utf8'));
    const zip = join(contexto.directorio, 'entrega.zip');
    writeFileSync(
      zip,
      zipSync({
        'compose.yaml': strToU8('version: nueva\n'),
        Dockerfile: strToU8('FROM nuevo\n'),
        'package.json': strToU8('{"version":"nueva"}\n'),
        'docker/iniciar.sh': strToU8('#!/bin/sh\n'),
        'src/nuevo.ts': strToU8('export {};\n'),
        '.env': strToU8('BETTER_AUTH_SECRET=secreto-nuevo-del-zip\n'),
        'scripts/actualizar.sh': strToU8(readFileSync(join(raiz, 'scripts/actualizar.sh'), 'utf8')),
      }),
    );
    const actualizar = (args: string[], env: Record<string, string> = {}) =>
      contexto.correr([join(inst, 'scripts/actualizar.sh'), ...args], env);
    const leer = (ruta: string) => readFileSync(join(inst, ruta), 'utf8');
    return { ...contexto, inst, zip, actualizar, leer };
  }

  const conservados = (leer: (ruta: string) => string) => {
    expect(leer('.env')).toBe('BETTER_AUTH_SECRET=secreto-del-servidor\n');
    expect(leer('compose.override.yaml')).toBe('services: {}\n');
    expect(leer('cron/tarea.sh')).toBe('#!/bin/sh\n');
    expect(leer('respaldos-servidor/cotizador-2026-01-01/marca')).toBe('respaldo en el host\n');
  };

  it('respalda antes, conserva lo del servidor, guarda la versión anterior e inicia esperando la salud', async () => {
    const { actualizar, zip, inst, leer, llamadas } = await instalacion();
    const r = actualizar([zip]);
    expect(r.status, r.stderr).toBe(0);
    expect(leer('compose.yaml')).toBe('version: nueva\n');
    expect(existsSync(join(inst, 'src/nuevo.ts'))).toBe(true);
    expect(existsSync(join(inst, 'src/viejo.ts'))).toBe(false);
    conservados(leer);
    expect(leer('.version-anterior/codigo/compose.yaml')).toBe('version: vieja\n');
    expect(leer('.version-anterior/respaldo').trim()).toBe(RESPALDO);
    expect(existsSync(join(inst, '.version-anterior/codigo/.env'))).toBe(false);

    const orden = llamadas();
    const indice = (texto: string) => orden.findIndex((l) => l.startsWith(texto));
    expect(indice('compose exec -T cotizador npm run --silent respaldar')).toBeGreaterThanOrEqual(0);
    expect(indice('compose exec -T cotizador npm run --silent respaldar')).toBeLessThan(indice('compose build'));
    expect(indice('compose build')).toBeLessThan(indice('compose up -d --remove-orphans --wait --wait-timeout 300'));
    expect(r.stdout).toMatch(/Actualización lista/);
  });

  it('si el respaldo falla no cambia nada', async () => {
    const { actualizar, zip, inst, leer, llamadas } = await instalacion();
    const r = actualizar([zip], { FALSO_RESPALDO: '1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no se pudo respaldar/);
    expect(leer('compose.yaml')).toBe('version: vieja\n');
    expect(existsSync(join(inst, '.version-anterior'))).toBe(false);
    expect(llamadas().some((l) => l.startsWith('compose build') || l.startsWith('compose up'))).toBe(false);
  });

  it('con el contenedor detenido respalda con docker compose run', async () => {
    const { actualizar, zip, llamadas } = await instalacion();
    const r = actualizar([zip], { FALSO_CORRIENDO: '0' });
    expect(r.status, r.stderr).toBe(0);
    expect(llamadas()).toContain('compose run --rm -T cotizador npm run --silent respaldar');
  });

  it('si la imagen no se construye deja los archivos como estaban', async () => {
    const { actualizar, zip, inst, leer, llamadas } = await instalacion();
    const r = actualizar([zip], { FALSO_BUILD: '1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/sigue con la versión anterior/);
    expect(leer('compose.yaml')).toBe('version: vieja\n');
    expect(existsSync(join(inst, 'src/viejo.ts'))).toBe(true);
    expect(existsSync(join(inst, 'src/nuevo.ts'))).toBe(false);
    conservados(leer);
    expect(llamadas().some((l) => l.startsWith('compose up'))).toBe(false);
  });

  it('si no pasa el chequeo de salud explica cómo volver, y --volver restaura datos y código', async () => {
    const { actualizar, zip, inst, leer, llamadas, log } = await instalacion();
    const fallida = actualizar([zip], { FALSO_UP: '1' });
    expect(fallida.status).toBe(1);
    expect(fallida.stderr).toMatch(/no pasó el chequeo de salud/);
    expect(fallida.stderr).toContain(`sh ${inst}/scripts/actualizar.sh --volver`);
    expect(fallida.stderr).toContain(RESPALDO);

    // Sin terminal y sin --si no hace nada.
    writeFileSync(log, '');
    const sinConfirmar = actualizar(['--volver']);
    expect(sinConfirmar.status).toBe(1);
    expect(sinConfirmar.stderr).toMatch(/--si/);
    expect(llamadas().some((l) => l.startsWith('compose stop'))).toBe(false);

    const vuelta = actualizar(['--volver', '--si']);
    expect(vuelta.status, vuelta.stderr).toBe(0);
    const orden = llamadas();
    const restaurar = orden.indexOf(`compose run --rm -T cotizador npm run --silent restaurar -- ${RESPALDO}`);
    expect(orden.indexOf('compose stop')).toBeGreaterThanOrEqual(0);
    expect(orden.indexOf('compose stop')).toBeLessThan(restaurar);
    expect(restaurar).toBeLessThan(orden.findIndex((l) => l.startsWith('compose up -d --build')));
    expect(leer('compose.yaml')).toBe('version: vieja\n');
    expect(existsSync(join(inst, 'src/nuevo.ts'))).toBe(false);
    conservados(leer);
  });

  it('se niega a trabajar fuera de una instalación', async () => {
    const { correr, zip, directorio: dir } = await instalacion();
    const r = correr([join(raiz, 'scripts/actualizar.sh'), zip, '--dir', join(dir, 'bin')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no encuentro una instalación/);
  });
});

describe('scripts/respaldo-diario.sh', () => {
  async function instalacion() {
    const contexto = await preparar();
    const inst = join(contexto.directorio, 'instalacion');
    escribir(join(inst, 'compose.yaml'), 'services: {}\n');
    escribir(join(inst, 'scripts/respaldo-diario.sh'), readFileSync(join(raiz, 'scripts/respaldo-diario.sh'), 'utf8'));
    const diario = (args: string[]) => contexto.correr([join(inst, 'scripts/respaldo-diario.sh'), ...args]);
    return { ...contexto, inst, diario };
  }

  it('respalda, limpia, copia fuera de la instalación y conserva las N copias más recientes', async () => {
    const { diario, llamadas, directorio: dir } = await instalacion();
    const destino = join(dir, 'otro-disco');
    for (const fecha of ['2026-10-11', '2026-10-12', '2026-10-13'])
      mkdirSync(join(destino, `cotizador-${fecha}T21-00-00-000Z`), { recursive: true });
    const r = diario([destino, '2']);
    expect(r.status, r.stderr).toBe(0);
    expect(llamadas()).toEqual([
      'compose exec -T cotizador npm run --silent respaldar',
      'compose exec -T cotizador npm run --silent limpiar-borradores -- --confirmar',
      `compose cp cotizador:${RESPALDO} ${destino}/`,
    ]);
    expect(readdirSync(destino).sort()).toEqual([
      'cotizador-2026-10-13T21-00-00-000Z',
      'cotizador-2026-10-14T21-00-00-000Z',
    ]);
  });

  it('se niega a copiar dentro de la carpeta de instalación', async () => {
    const { diario, inst, llamadas } = await instalacion();
    const r = diario([join(inst, 'respaldos-servidor')]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/dentro de la instalación/);
    expect(llamadas()).toEqual([]);
  });
});

it('el ZIP de entrega incluye los scripts del servidor', () => {
  const deploy = readFileSync(join(raiz, 'scripts/deploy.mjs'), 'utf8');
  for (const ruta of ['scripts/actualizar.sh', 'scripts/respaldo-diario.sh', 'scripts/restaurar.ts'])
    expect(deploy).toContain(`'${ruta}'`);
  expect(deploy).toContain("'docs/manual-operativo.md'");
});

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

// Scripts del servidor (5.3, 5.5, 5.2): se prueban con un `docker` falso en el PATH que anota cada llamada.
// Con dash si está disponible: el servidor (Debian) ejecuta `sh` con dash, más estricto que bash.

const raiz = process.cwd();
// Script que `npm run deploy` corre en el servidor por SSH (se prueba igual, con el docker falso).
// @ts-expect-error: módulo JavaScript sin tipos; importarlo no despliega (solo corre al ejecutarlo).
const { scriptRemoto } = (await import('../scripts/deploy.mjs')) as { scriptRemoto: string };
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
  *"npm run --silent respaldar"*)
    [ "\${FALSO_RESPALDO:-0}" = 0 ] || exit 1
    # Un contenedor anterior a --json (FALSO_RESPALDO_TEXTO=1) lo ignora y escribe el texto para personas.
    case "$*" in
      *" --json") [ "\${FALSO_RESPALDO_TEXTO:-0}" = 0 ] &&
        echo '{"carpeta":"${RESPALDO}","cotizaciones":3,"pdf":1,"referencias":0}' && exit 0 ;;
    esac
    echo "Respaldo en ${RESPALDO}: 3 cotizaciones, 1 PDF, 0 referencias del cliente." ;;
  "compose build"*) exit "\${FALSO_BUILD:-0}" ;;
  "compose up"*) exit "\${FALSO_UP:-0}" ;;
  "compose cp "*)
    [ "\${FALSO_CP:-0}" = 0 ] || exit 1
    # Como docker cp: la carpeta del respaldo con un PDF (fecha original conservada) y una base que cambia cada vez.
    d="$4/$(basename "\${3#cotizador:}")"
    mkdir -p "$d/pdf"
    printf 'pdf emitido' > "$d/pdf/cotizacion-1.pdf"
    touch -t 202601010000 "$d/pdf/cotizacion-1.pdf"
    date > "$d/cotizador.sqlite" ;;
esac
exit 0
`;

/** curl falso: «descarga» FALSO_CURL_ARCHIVO en la ruta de -o; con FALSO_CURL=1 falla como un 404. */
const CURL_FALSO = `#!/bin/sh
echo "curl $*" >> "$FALSO_LOG"
salida=''
while [ $# -gt 0 ]; do
  [ "$1" = -o ] && salida="$2"
  shift
done
[ "\${FALSO_CURL:-0}" = 0 ] || exit 22
cp "$FALSO_CURL_ARCHIVO" "$salida"
`;

async function preparar() {
  directorio = await mkdtemp(join(tmpdir(), 'cotizador-scripts-'));
  const bin = join(directorio, 'bin');
  const log = join(directorio, 'docker.log');
  escribir(join(bin, 'docker'), DOCKER_FALSO, true);
  escribir(join(bin, 'curl'), CURL_FALSO, true);
  // macOS no trae flock; en el servidor (Debian) sí.
  if (!existsSync('/usr/bin/flock')) escribir(join(bin, 'flock'), '#!/bin/sh\nexit 0\n', true);
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

  it('NELTUME_IP_HEADER no distingue mayúsculas ni espacios alrededor, igual que la app', async () => {
    for (const cabecera of ['X-Real-IP', ' CF-Connecting-IP ', 'NINGUNA', 'X-Forwarded-For']) {
      const r = await iniciar({ ...valido, NELTUME_IP_HEADER: cabecera });
      expect(r.status, `${cabecera}: ${r.stderr}`).toBe(0);
      expect(r.llamadas).toContain('node node_modules/next/dist/bin/next start');
      await rm(directorio!, { recursive: true, force: true });
    }
    const r = await iniciar({ ...valido, NELTUME_IP_HEADER: 'X-Client-IP' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NELTUME_IP_HEADER debe ser .*\(ahora: 'X-Client-IP'\)/);
  });

  it('deja datos y respaldos en 0700 aunque el volumen venga de una imagen anterior (0755)', async () => {
    const base = await mkdtemp(join(tmpdir(), 'cotizador-volumenes-'));
    try {
      const datos = join(base, 'data');
      const respaldos = join(base, 'respaldos');
      for (const d of [datos, respaldos]) mkdirSync(d, { mode: 0o755 });
      const r = await iniciar({ ...valido, NELTUME_DATA_DIR: datos, NELTUME_RESPALDO_DIR: respaldos });
      expect(r.status, r.stderr).toBe(0);
      for (const d of [datos, respaldos]) expect(statSync(d).mode & 0o777).toBe(0o700);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
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
    // Copia del respaldo fuera del volumen, para --volver aunque el respaldo rote.
    expect(llamadas()).toContain(`compose cp cotizador:${RESPALDO} ${inst}/.version-anterior/datos/`);
    expect(existsSync(join(inst, '.version-anterior/datos', RESPALDO.split('/').at(-1)!, 'pdf/cotizacion-1.pdf'))).toBe(true);

    const orden = llamadas();
    const indice = (texto: string) => orden.findIndex((l) => l.startsWith(texto));
    expect(indice('compose exec -T cotizador npm run --silent respaldar')).toBeGreaterThanOrEqual(0);
    expect(indice('compose exec -T cotizador npm run --silent respaldar')).toBeLessThan(indice('compose build'));
    expect(indice('compose build')).toBeLessThan(indice('compose up -d --remove-orphans --wait --wait-timeout 300'));
    // La imagen base se actualiza en cada entrega (parches de Chromium y Node).
    expect(orden).toContain('compose build --pull');
    expect(r.stdout).toMatch(/Actualización lista/);
  });

  it('si no se puede copiar el respaldo a .version-anterior avisa y sigue (el respaldo del volumen sirve)', async () => {
    const { actualizar, zip, inst, leer } = await instalacion();
    const r = actualizar([zip], { FALSO_CP: '1' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/no se pudo copiar el respaldo/);
    expect(existsSync(join(inst, '.version-anterior/datos'))).toBe(false);
    expect(leer('.version-anterior/respaldo').trim()).toBe(RESPALDO);
  });

  it('acepta una URL https: descarga la entrega con curl, la revisa y actualiza', async () => {
    const { actualizar, zip, leer, llamadas } = await instalacion();
    const url = 'https://entregas.neltume.cl/neltume-cotizador-2026-10-14.zip';
    const r = actualizar([url], { FALSO_CURL_ARCHIVO: zip });
    expect(r.status, r.stderr).toBe(0);
    expect(leer('compose.yaml')).toBe('version: nueva\n');
    conservados(leer);
    const curl = llamadas().find((l) => l.startsWith('curl '))!;
    expect(curl).toContain("--proto =https");
    expect(curl.endsWith(url)).toBe(true);
  });

  it('rechaza una URL sin https, una descarga fallida o algo que no es un ZIP, sin cambiar nada', async () => {
    const { actualizar, directorio: dir, leer, llamadas, inst } = await instalacion();
    const http = actualizar(['http://entregas.neltume.cl/entrega.zip']);
    expect(http.status).toBe(1);
    expect(http.stderr).toMatch(/debe empezar con https:\/\//);

    const caida = actualizar(['https://entregas.neltume.cl/no-existe.zip'], { FALSO_CURL: '1' });
    expect(caida.status).toBe(1);
    expect(caida.stderr).toMatch(/no se pudo descargar/);

    const pagina = join(dir, 'error.html');
    writeFileSync(pagina, '<html>Not Found</html>');
    const html = actualizar(['https://entregas.neltume.cl/entrega.zip'], { FALSO_CURL_ARCHIVO: pagina });
    expect(html.status).toBe(1);
    // El mensaje nombra la URL indicada, no la copia temporal de la descarga.
    expect(html.stderr).toContain('https://entregas.neltume.cl/entrega.zip no es un ZIP válido');

    // Un archivo local que no es ZIP tampoco pasa.
    expect(actualizar([pagina]).stderr).toMatch(/no es un ZIP válido/);

    expect(leer('compose.yaml')).toBe('version: vieja\n');
    expect(existsSync(join(inst, '.version-anterior'))).toBe(false);
    expect(llamadas().some((l) => l.includes('respaldar') || l.startsWith('compose build'))).toBe(false);
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
    expect(llamadas()).toContain('compose run --rm -T cotizador npm run --silent respaldar -- --json');
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
    // Antes de restaurar se repone el respaldo desde la copia de .version-anterior/datos (si ya rotó del volumen).
    const reponer = orden.findIndex((l) =>
      l.startsWith(`compose run --rm -T --user root -v ${inst}/.version-anterior/datos:/version-anterior:ro cotizador sh -c `),
    );
    expect(reponer).toBeGreaterThan(orden.indexOf('compose stop'));
    expect(reponer).toBeLessThan(restaurar);
    expect(orden[reponer].endsWith(`reponer ${RESPALDO}`)).toBe(true);
    expect(restaurar).toBeLessThan(orden.findIndex((l) => l.startsWith('compose up -d --build')));
    expect(leer('compose.yaml')).toBe('version: vieja\n');
    expect(existsSync(join(inst, 'src/nuevo.ts'))).toBe(false);
    conservados(leer);
  });

  it('--volver sin copia del respaldo usa el del volumen, sin intentar reponerlo', async () => {
    const { actualizar, zip, inst, llamadas, log } = await instalacion();
    expect(actualizar([zip], { FALSO_UP: '1', FALSO_CP: '1' }).status).toBe(1);
    writeFileSync(log, '');
    const vuelta = actualizar(['--volver', '--si']);
    expect(vuelta.status, vuelta.stderr).toBe(0);
    expect(llamadas().some((l) => l.includes('--user root'))).toBe(false);
    expect(llamadas()).toContain(`compose run --rm -T cotizador npm run --silent restaurar -- ${RESPALDO}`);
    expect(readFileSync(join(inst, 'compose.yaml'), 'utf8')).toBe('version: vieja\n');
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
    const nombre = RESPALDO.split('/').at(-1)!;
    expect(llamadas()).toEqual([
      'compose exec -T cotizador npm run --silent respaldar -- --json',
      'compose exec -T cotizador npm run --silent limpiar-borradores -- --confirmar',
      `compose cp cotizador:${RESPALDO} ${destino}/.entrante-${nombre}/`,
    ]);
    // La carpeta temporal de la bajada no queda.
    expect(readdirSync(destino).sort()).toEqual([
      'cotizador-2026-10-13T21-00-00-000Z',
      'cotizador-2026-10-14T21-00-00-000Z',
    ]);
    expect(readFileSync(join(destino, nombre, 'pdf/cotizacion-1.pdf'), 'utf8')).toBe('pdf emitido');
  });

  it('lee la carpeta de la línea JSON y, de un contenedor anterior a --json, del texto «Respaldo en …»', async () => {
    const { correr, inst, directorio: dir } = await instalacion();
    const nombre = RESPALDO.split('/').at(-1)!;
    for (const [env, destino] of [
      [{}, join(dir, 'disco-json')],
      [{ FALSO_RESPALDO_TEXTO: '1' }, join(dir, 'disco-texto')],
    ] as const) {
      const r = correr([join(inst, 'scripts/respaldo-diario.sh'), destino], env);
      expect(r.status, r.stderr).toBe(0);
      expect(readFileSync(join(destino, nombre, 'pdf/cotizacion-1.pdf'), 'utf8')).toBe('pdf emitido');
    }
  });

  it('enlaza con la copia anterior lo que no cambió (rsync --link-dest): los PDF no se duplican', async () => {
    const { diario, directorio: dir } = await instalacion();
    const destino = join(dir, 'otro-disco');
    const ayer = join(destino, 'cotizador-2026-10-13T21-00-00-000Z');
    escribir(join(ayer, 'pdf/cotizacion-1.pdf'), 'pdf emitido');
    const fecha = new Date(2026, 0, 1, 0, 0);
    utimesSync(join(ayer, 'pdf/cotizacion-1.pdf'), fecha, fecha);
    escribir(join(ayer, 'cotizador.sqlite'), 'base de ayer');
    const r = diario([destino]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/enlazado con cotizador-2026-10-13T21-00-00-000Z/);
    const hoy = join(destino, RESPALDO.split('/').at(-1)!);
    expect(statSync(join(hoy, 'pdf/cotizacion-1.pdf')).ino).toBe(statSync(join(ayer, 'pdf/cotizacion-1.pdf')).ino);
    expect(statSync(join(hoy, 'pdf/cotizacion-1.pdf')).nlink).toBe(2);
    // Lo que cambió se copia aparte: la base de hoy no pisa la de ayer.
    expect(statSync(join(hoy, 'cotizador.sqlite')).ino).not.toBe(statSync(join(ayer, 'cotizador.sqlite')).ino);
    expect(readFileSync(join(ayer, 'cotizador.sqlite'), 'utf8')).toBe('base de ayer');
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

describe('compose.yaml y .dockerignore', () => {
  // Sin comentarios: solo cuenta lo que Compose interpreta.
  const compose = readFileSync(join(raiz, 'compose.yaml'), 'utf8').replace(/^\s*#.*\n/gm, '');
  const servicio = compose.slice(compose.indexOf('  cotizador:'), compose.indexOf('\n  tunel:'));
  const entorno = servicio.slice(servicio.indexOf('    environment:'), servicio.indexOf('    ports:'));
  const variables = [...entorno.matchAll(/^ {6}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);

  /** Variables de entorno que lee la app (src/ y scripts/), salvo las solo de pruebas o desarrollo. */
  function variablesDeLaApp() {
    const encontradas = new Set<string>();
    const recorrer = (carpeta: string) => {
      for (const entrada of readdirSync(join(raiz, carpeta), { withFileTypes: true })) {
        const ruta = join(carpeta, entrada.name);
        if (entrada.isDirectory()) recorrer(ruta);
        else if (/\.(ts|tsx|mjs)$/.test(entrada.name)) {
          const texto = readFileSync(join(raiz, ruta), 'utf8');
          for (const m of texto.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) encontradas.add(m[1]);
          for (const m of texto.matchAll(/(?:leerEntorno|leer)\('([A-Z][A-Z0-9_]*)'\)/g)) encontradas.add(m[1]);
        }
      }
    };
    recorrer('src');
    recorrer('scripts');
    // Solo pruebas, desarrollo o comandos que no corren en el contenedor del servidor. NEXT_RUNTIME la pone Next.
    for (const fuera of ['NELTUME_TEST_MODE', 'NELTUME_LLM', 'NELTUME_STARKEN', 'TEST', 'NELTUME_PLANILLA', 'NELTUME_CATALOGO', 'NEXT_RUNTIME'])
      encontradas.delete(fuera);
    return [...encontradas].sort();
  }

  it('el cotizador recibe solo las variables que usa la app: sin env_file y sin el token del túnel', () => {
    expect(servicio).not.toMatch(/env_file/);
    expect(variables).not.toContain('CLOUDFLARE_TUNNEL_TOKEN');
    expect(servicio).not.toContain('CLOUDFLARE_TUNNEL_TOKEN');
    for (const variable of variablesDeLaApp()) expect(variables, `falta ${variable} en compose.yaml`).toContain(variable);
    // Los mismos valores por omisión que la app: una variable vacía no debe cambiar el comportamiento.
    expect(entorno).toContain('CMD_TIMEOUT_MS: ${CMD_TIMEOUT_MS:-60000}');
    expect(entorno).toContain('CMD_REINTENTO_MS: ${CMD_REINTENTO_MS:-2000}');
    expect(entorno).toContain('NELTUME_CATALOGO_CONFIG: ${NELTUME_CATALOGO_CONFIG:-config/catalogo.json}');
    expect(entorno).toContain('NELTUME_IP_HEADER: ${NELTUME_IP_HEADER:-cf-connecting-ip}');
  });

  it('el túnel usa una versión fija de cloudflared y es el único que recibe el token', () => {
    const tunel = compose.slice(compose.indexOf('\n  tunel:'));
    expect(tunel).toMatch(/image: cloudflare\/cloudflared:\d{4}\.\d{1,2}\.\d+\n/);
    expect(tunel).not.toMatch(/cloudflared:latest/);
    expect(tunel).toContain('TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN:-}');
  });

  it('la imagen crea datos y respaldos en 0700 a nombre de node: un volumen nuevo copia esos permisos', () => {
    expect(readFileSync(join(raiz, 'Dockerfile'), 'utf8')).toMatch(
      /^RUN install -d -m 700 -o node -g node \/app\/data \/app\/respaldos$/m,
    );
  });

  it('.dockerignore excluye el build de las pruebas E2E', () => {
    const lineas = readFileSync(join(raiz, '.dockerignore'), 'utf8').split('\n');
    expect(lineas).toContain('.next-e2e');
  });
});

describe('npm run deploy: script remoto', () => {
  /** Instalación ya desplegada y la entrega nueva que llega por stdin. */
  async function servidor() {
    const contexto = await preparar();
    const destino = join(contexto.directorio, 'srv', 'cotizador-neltume');
    const archivos: Record<string, string> = {
      'compose.yaml': 'version: vieja\n',
      'src/viejo.ts': 'export {};\n',
      '.env': 'BETTER_AUTH_URL=https://cotizador.neltume.cl\nNELTUME_HOSTS=cotizador.neltume.cl\n',
      'cron/tarea.sh': '#!/bin/sh\n',
      '.version-anterior/codigo/compose.yaml': 'version: de hace dos despliegues\n',
      '.version-anterior/respaldo': '/app/respaldos/cotizador-2026-09-01T21-00-00-000Z\n',
    };
    for (const [ruta, contenido] of Object.entries(archivos)) escribir(join(destino, ruta), contenido);
    // Mismo tamaño y misma hora que el compose.yaml de la entrega: solo comparando el contenido se ve que cambió.
    const hora = new Date(2026, 0, 1, 10, 0, 0);
    utimesSync(join(destino, 'compose.yaml'), hora, hora);
    const zip = zipSync({
      'compose.yaml': [strToU8('version: nueva\n'), { mtime: hora }],
      'src/nuevo.ts': strToU8('export {};\n'),
      '.env': strToU8('BETTER_AUTH_SECRET=nuevo\n'),
    });
    const desplegar = (env: Record<string, string> = {}) =>
      spawnSync(SHELL, ['-c', scriptRemoto, 'desplegar', destino, '1'], {
        cwd: contexto.directorio,
        input: zip,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${contexto.bin}:${process.env.PATH}`, FALSO_LOG: contexto.log, ...env },
      });
    const leer = (ruta: string) => readFileSync(join(destino, ruta), 'utf8');
    return { ...contexto, destino, desplegar, leer };
  }

  it('renueva .version-anterior/ como actualizar.sh, con copia del respaldo, y construye con --pull', async () => {
    const { desplegar, leer, destino, llamadas } = await servidor();
    const r = desplegar();
    expect(r.status, r.stderr).toBe(0);
    expect(leer('compose.yaml')).toBe('version: nueva\n');
    expect(existsSync(join(destino, 'src/viejo.ts'))).toBe(false);
    expect(leer('cron/tarea.sh')).toBe('#!/bin/sh\n');
    expect(leer('.env')).toMatch(/^BETTER_AUTH_URL=https:/);
    // La versión anterior es la de ESTE despliegue, no la de una actualización con ZIP previa.
    expect(leer('.version-anterior/codigo/compose.yaml')).toBe('version: vieja\n');
    expect(existsSync(join(destino, '.version-anterior/codigo/src/viejo.ts'))).toBe(true);
    expect(existsSync(join(destino, '.version-anterior/codigo/.env'))).toBe(false);
    expect(leer('.version-anterior/respaldo').trim()).toBe(RESPALDO);
    expect(existsSync(join(destino, '.version-anterior/datos', RESPALDO.split('/').at(-1)!))).toBe(true);

    const orden = llamadas();
    const indice = (texto: string) => orden.findIndex((l) => l.startsWith(texto));
    expect(indice('compose exec -T cotizador npm run --silent respaldar')).toBeLessThan(indice(`compose cp cotizador:${RESPALDO}`));
    expect(orden).toContain('compose build --pull');
    expect(indice('compose build --pull')).toBeLessThan(indice('compose up -d --remove-orphans --wait --wait-timeout 300'));
  });

  it('con el cotizador detenido no hay respaldo: borra la versión anterior vieja en vez de dejarla apuntando atrás', async () => {
    const { desplegar, destino, leer } = await servidor();
    const r = desplegar({ FALSO_CORRIENDO: '0' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/no hubo respaldo ni queda versión anterior/);
    expect(existsSync(join(destino, '.version-anterior'))).toBe(false);
    expect(leer('compose.yaml')).toBe('version: nueva\n');
  });

  it('si la imagen no se construye deja los archivos como estaban', async () => {
    const { desplegar, destino, leer, llamadas } = await servidor();
    const r = desplegar({ FALSO_BUILD: '1' });
    expect(r.status).toBe(8);
    expect(r.stderr).toMatch(/sigue la versión anterior/);
    expect(leer('compose.yaml')).toBe('version: vieja\n');
    expect(existsSync(join(destino, 'src/viejo.ts'))).toBe(true);
    expect(existsSync(join(destino, 'src/nuevo.ts'))).toBe(false);
    expect(llamadas().some((l) => l.startsWith('compose up'))).toBe(false);
  });

  it('si no pasa el chequeo de salud explica cómo volver', async () => {
    const { desplegar, destino } = await servidor();
    const r = desplegar({ FALSO_UP: '1' });
    expect(r.status).toBe(9);
    expect(r.stderr).toContain(`sh ${destino}/scripts/actualizar.sh --volver`);
  });
});

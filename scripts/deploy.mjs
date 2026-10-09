import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function principal() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      ssh: { type: 'string' },
      dir: { type: 'string' },
      port: { type: 'string', default: '3000' },
      forzar: { type: 'boolean' },
      'sin-ia': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      'Uso: npm run deploy -- [--url https://cotizador.example.cl]\n' +
        '     npm run deploy:zip -- [--url https://cotizador.example.cl] [--port 3000]\n' +
        'Con --ssh <host> --dir <ruta> sube la entrega por SSH y la levanta con Docker Compose;\n' +
        'sin --ssh genera un ZIP en deploy/. --forzar omite el chequeo de recursos del servidor.\n' +
        'Antes de empaquetar corre tipos, lint, pruebas y la evaluación de la IA; si algo falla, no se despliega.\n' +
        '--sin-ia omite solo la evaluación de la IA (por ejemplo, si el proveedor no responde).',
    );
    return;
  }
  if (Boolean(values.ssh) !== Boolean(values.dir)) throw new Error('--ssh y --dir van juntos.');
  if (values.dir && !values.dir.startsWith('/')) throw new Error('--dir debe ser una ruta absoluta.');
  if (!/^\d{1,5}$/.test(values.port)) throw new Error('--port debe ser un número de puerto.');
  await verificar({ sinIa: values['sin-ia'] });

  let origen = '';
  let host = '';
  if (values.url) {
    const url = new URL(values.url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('--url debe ser un origen HTTPS, sin credenciales, ruta, query ni fragmento.');
    origen = url.origin;
    host = url.host;
  }

  // Lista explícita: no recoge .env.local, datos, planillas, PDF ni artefactos locales.
  const archivos = {};
  const agregar = async (ruta) => {
    const absoluta = join(raiz, ruta);
    archivos[ruta.replaceAll('\\', '/')] = new Uint8Array(await readFile(absoluta));
  };
  const carpeta = async (ruta) => {
    for (const entrada of await readdir(join(raiz, ruta), { withFileTypes: true })) {
      if (entrada.name.startsWith('.')) continue;
      // Este lanzador importa tests/, que no forma parte de la entrega de producción.
      if (ruta === 'scripts' && entrada.name === 'preparar-e2e.ts') continue;
      const hija = join(ruta, entrada.name);
      if (entrada.isDirectory()) await carpeta(hija);
      else if (entrada.isFile()) await agregar(hija);
      else throw new Error(`No se empaquetan enlaces simbólicos: ${hija}`);
    }
  };
  for (const ruta of [
    'package.json',
    'package-lock.json',
    'next.config.ts',
    'next-env.d.ts',
    'tsconfig.json',
    'postcss.config.mjs',
    'Dockerfile',
    'compose.yaml',
    '.dockerignore',
    '.env.example',
    'docker/LEEME.md',
  ])
    await agregar(ruta);
  for (const ruta of ['src', 'public', 'config', 'scripts']) await carpeta(ruta);
  await agregar('docker/iniciar.sh');

  let entorno = await readFile(join(raiz, '.env.example'), 'utf8');
  entorno = entorno
    .replace(/^BETTER_AUTH_SECRET=.*$/m, `BETTER_AUTH_SECRET=${randomBytes(32).toString('base64')}`)
    .replace(/^BETTER_AUTH_URL=.*$/m, `BETTER_AUTH_URL=${origen}`)
    .replace(/^# NELTUME_HOSTS=.*$/m, `NELTUME_HOSTS=${host}`);
  entorno =
    '# Configuración del servidor. Conserva este archivo al actualizar.\n' +
    entorno +
    '\n# Puerto publicado en el servidor; el proxy HTTPS debe apuntar aquí.\n' +
    `NELTUME_BIND_IP=127.0.0.1\nNELTUME_PORT=${values.port}\n`;
  archivos['.env'] = strToU8(entorno);
  const zip = zipSync(archivos, { level: 6 });

  if (values.ssh) {
    console.log(`Subiendo ${Object.keys(archivos).length} archivos a ${values.ssh}:${values.dir}…`);
    await desplegarRemoto(values.ssh, values.dir, zip, values.forzar);
    return;
  }

  const destino = join(raiz, 'deploy');
  await mkdir(destino, { recursive: true, mode: 0o700 });
  const fecha = new Date().toISOString().replace(/[:.]/g, '-');
  const salida = join(destino, `neltume-cotizador-${fecha}.zip`);
  await writeFile(salida, zip, { mode: 0o600, flag: 'wx' });
  console.log(`ZIP generado: ${relative(raiz, salida)}`);
  console.log(`${Object.keys(archivos).length} archivos. Instalación nueva con base vacía.`);
  if (!origen) console.log('En el servidor, completa BETTER_AUTH_URL y NELTUME_HOSTS en .env.');
  console.log('Descomprime el ZIP y ejecuta: docker compose up -d');
  console.log('Instrucciones de dominio, primera cuenta y actualizaciones: docker/LEEME.md');
}

/**
 * Nada llega al servidor sin pasar las pruebas: unos tests rotos estuvieron días sin que nadie lo notara, y no
 * hay CI. La evaluación de la IA corre cada caso varias veces (cuesta unos centavos de dólar).
 */
async function verificar({ sinIa }) {
  const pasos = [
    ['Tipos', 'npx', ['tsc', '--noEmit']],
    ['Lint', 'npm', ['run', 'lint']],
    ['Pruebas unitarias y de interfaz', 'npm', ['test']],
    ...(sinIa ? [] : [['Evaluación de la IA', 'npm', ['run', 'evaluar:regresion']]]),
  ];
  for (const [nombre, comando, argumentos] of pasos) {
    console.log(`\n▶ ${nombre}…`);
    const codigo = await new Promise((resolver, rechazar) => {
      const proceso = spawn(comando, argumentos, {
        cwd: raiz,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
      proceso.on('error', rechazar);
      proceso.on('close', resolver);
    });
    if (codigo !== 0)
      throw new Error(
        `${nombre}: falló. No se despliega; corrige el problema y vuelve a intentarlo.` +
          (nombre === 'Evaluación de la IA'
            ? ' Si el proveedor de IA no respondía, repite más tarde o usa --sin-ia.'
            : ''),
      );
  }
  if (sinIa) console.warn('\nSe omitió la evaluación de la IA (--sin-ia).');
  console.log('\nVerificación completa.');
}

// Corre en el servidor: recibe el ZIP por stdin, sincroniza el código conservando el .env
// existente (su secreto debe ser estable) y reconstruye el contenedor.
const scriptRemoto = `
set -eu
destino="$1"
forzar="$2"

# Guard de recursos: un solo despliegue a la vez y no construir si el servidor está justo.
exec 9>/tmp/neltume-cotizador-deploy.lock
flock -n 9 || { echo "Ya hay otro despliegue del cotizador en curso." >&2; exit 4; }
if [ "$forzar" != "1" ]; then
  raiz_docker="$(docker info --format '{{.DockerRootDir}}')"
  disco_mb=$(df -Pm "$raiz_docker" | awk 'NR==2 {print $4}')
  memoria_mb=$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo)
  carga=$(cut -d' ' -f1 /proc/loadavg)
  nucleos=$(nproc)
  echo "Servidor: \${disco_mb} MB libres en disco, \${memoria_mb} MB de RAM disponible, carga $carga en $nucleos núcleos."
  falla=""
  [ "$disco_mb" -ge 5120 ] || falla="$falla menos de 5 GB libres en $raiz_docker;"
  [ "$memoria_mb" -ge 2048 ] || falla="$falla menos de 2 GB de RAM disponible;"
  awk -v c="$carga" -v n="$nucleos" 'BEGIN { exit !(c <= n * 0.8) }' || falla="$falla carga sobre el 80 % de los núcleos;"
  if [ -n "$falla" ]; then
    echo "Despliegue cancelado:$falla" >&2
    echo "Libera recursos o repite con: npm run deploy -- --forzar" >&2
    exit 5
  fi
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/entrega.zip"
unzip -q "$tmp/entrega.zip" -d "$tmp/codigo"
if ! mkdir -p "$destino" 2>/dev/null || [ ! -w "$destino" ]; then
  echo "No puedo escribir en $destino. Créalo una vez en el servidor con:" >&2
  echo "  sudo install -d -o $(id -un) -g $(id -gn) $destino" >&2
  exit 6
fi
if [ -f "$destino/.env" ]; then
  echo "Se conserva el .env del servidor."
else
  install -m 600 "$tmp/codigo/.env" "$destino/.env"
  echo "Creado $destino/.env con un secreto nuevo."
fi
rm "$tmp/codigo/.env"
rsync -a --delete --exclude=/.env "$tmp/codigo/" "$destino/"
cd "$destino"
if ! grep -q '^BETTER_AUTH_URL=https://.' .env || ! grep -q '^NELTUME_HOSTS=.' .env; then
  echo "Falta BETTER_AUTH_URL o NELTUME_HOSTS en $destino/.env." >&2
  echo "Complétalos allí (o borra ese .env y repite con --url https://...) y vuelve a desplegar." >&2
  exit 3
fi
docker compose up -d --build --remove-orphans --wait --wait-timeout 300
docker compose ps
# Cada build deja sin etiqueta la imagen anterior; se borran solo las de este proyecto.
docker image prune -f --filter label=cl.neltume.cotizador
`;

const comillas = (texto) => `'${texto.replaceAll("'", "'\\''")}'`;

function desplegarRemoto(host, dir, zip, forzar) {
  return new Promise((resolver, rechazar) => {
    const comando = `sh -c ${comillas(scriptRemoto)} desplegar ${comillas(dir)} ${forzar ? 1 : 0}`;
    const ssh = spawn('ssh', ['-o', 'BatchMode=yes', host, comando], {
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    ssh.on('error', rechazar);
    ssh.on('close', (codigo) => {
      if (codigo === 0) {
        console.log(`Despliegue listo en ${host}:${dir}`);
        resolver();
      } else rechazar(new Error(`el servidor terminó con código ${codigo}.`));
    });
    ssh.stdin.on('error', () => {});
    ssh.stdin.end(zip);
  });
}

principal().catch((error) => {
  console.error(`No se pudo generar el despliegue: ${error.message}`);
  process.exitCode = 1;
});

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
      'solo-verificar': { type: 'boolean' },
      'sin-verificar': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      'Uso: npm run deploy -- [--url https://cotizador.example.cl]\n' +
        '     npm run deploy:zip -- [--url https://cotizador.example.cl] [--port 3000]\n' +
        '     npm run verificar\n' +
        'Con --ssh <host> --dir <ruta> sube la entrega por SSH y la levanta con Docker Compose;\n' +
        'sin --ssh genera un ZIP en deploy/. --forzar omite el chequeo de recursos del servidor.\n' +
        'Antes de empaquetar corre tipos, lint, pruebas y la evaluación de la IA; si algo falla, no se despliega.\n' +
        '--sin-ia omite solo la evaluación de la IA (por ejemplo, si el proveedor no responde).\n' +
        '--solo-verificar corre la verificación y no empaqueta ni despliega (npm run verificar).\n' +
        '--sin-verificar empaqueta o despliega sin verificar: solo para una entrega ya verificada en otro equipo.\n' +
        'En el servidor, el ZIP se instala con: sh scripts/actualizar.sh <zip> (ver docker/LEEME.md).',
    );
    return;
  }
  if (Boolean(values.ssh) !== Boolean(values.dir)) throw new Error('--ssh y --dir van juntos.');
  if (values.dir && !values.dir.startsWith('/')) throw new Error('--dir debe ser una ruta absoluta.');
  if (!/^\d{1,5}$/.test(values.port)) throw new Error('--port debe ser un número de puerto.');
  if (values['solo-verificar'] && values['sin-verificar'])
    throw new Error('--solo-verificar y --sin-verificar no van juntos.');
  // Verificar (en el equipo de desarrollo o en CI) y desplegar son pasos separados: --sin-verificar permite generar
  // o subir una entrega urgente sin la planilla privada ni la clave de IA de este equipo.
  if (values['sin-verificar'])
    console.warn(
      'Se omite la verificación (--sin-verificar): la entrega no pasó por tipos, lint, pruebas ni evaluación de la IA.',
    );
  else {
    // Se advierte al empezar y al terminar: entre medio, la salida de las pruebas la deja fuera de la vista.
    if (values['sin-ia']) console.warn(advertenciaSinIa());
    await verificar({ sinIa: values['sin-ia'] });
  }
  if (values['solo-verificar']) return;

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
      // Herramientas de desarrollo: importan tests/ o solo sirven para medir, no viajan a producción.
      if (ruta === 'scripts' && ['preparar-e2e.ts', 'carga.ts'].includes(entrada.name)) continue;
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
    'docs/manual-operativo.md',
  ])
    await agregar(ruta);
  for (const ruta of ['src', 'public', 'config', 'scripts']) await carpeta(ruta);
  await agregar('docker/iniciar.sh');
  // El servidor se actualiza con este script sin el equipo de desarrollo: una entrega sin él no sirve.
  for (const ruta of ['scripts/actualizar.sh', 'scripts/respaldo-diario.sh', 'scripts/restaurar.ts'])
    if (!archivos[ruta]) throw new Error(`Falta ${ruta} en la entrega.`);

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
  console.log('Instalación nueva: descomprime el ZIP y ejecuta docker compose up -d.');
  console.log('Actualización: sh <instalación>/scripts/actualizar.sh <zip> (conserva .env y respaldos).');
  console.log('Instrucciones de dominio, primera cuenta, respaldos y actualizaciones: docker/LEEME.md');
}

/**
 * Advertencia destacada de --sin-ia: la entrega no pasó la evaluación de la IA (precisión, errores silenciosos y
 * falsas alarmas), así que un cambio en el asistente puede llegar a las vendedoras sin medir.
 */
export function advertenciaSinIa() {
  const lineas = [
    'ATENCIÓN: SE OMITIÓ LA EVALUACIÓN DE LA IA (--sin-ia)',
    '',
    'Esta entrega no midió la precisión del asistente, sus errores',
    'silenciosos ni sus falsas alarmas. Si cambió el asistente, el',
    'anclaje o los casos, corre «npm run evaluar:regresion» antes',
    'de usarlo con las vendedoras.',
  ];
  const ancho = Math.max(...lineas.map((l) => l.length));
  const borde = `+${'-'.repeat(ancho + 2)}+`;
  const cuerpo = lineas.map((l) => `| ${l.padEnd(ancho)} |`);
  const texto = ['', borde, ...cuerpo, borde, ''].join('\n');
  // Amarillo y negrita en una terminal; texto plano si la salida va a un archivo.
  return process.stderr.isTTY ? `\x1b[1;33m${texto}\x1b[0m` : texto;
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
  if (sinIa) console.warn(advertenciaSinIa());
  console.log('\nVerificación completa.');
}

// Corre en el servidor: recibe el ZIP por stdin, sincroniza el código conservando el .env existente (su secreto
// debe ser estable), guarda la versión anterior como scripts/actualizar.sh (para `actualizar.sh --volver`) y
// reconstruye el contenedor con la imagen base al día (--pull).
export const scriptRemoto = `
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

# Igual que scripts/actualizar.sh: no se tocan la configuración ni los datos propios del servidor, y se compara por
# contenido (--checksum): un archivo distinto con el mismo tamaño y la misma hora (la del ZIP) no se saltaría.
sincronizar() {
rsync -a --delete --checksum --exclude=/.env '--exclude=/respaldos*' --exclude=/compose.override.yaml --exclude=/cron/ --exclude=/.version-anterior/ "$1/" "$2/"
}

# Carpeta del respaldo según la salida de «npm run respaldar -- --json» (una línea JSON con "carpeta").
carpetaRespaldo() {
  c="$(printf '%s\\n' "$1" | sed -n 's/^{.*"carpeta":"\\([^"]*\\)".*}$/\\1/p' | tail -n 1)"
  # Un contenedor con la versión anterior a --json lo ignora y escribe el texto «Respaldo en <carpeta>: …».
  [ -n "$c" ] || c="$(printf '%s\\n' "$1" | sed -n 's/^Respaldo en \\([^:]*\\):.*/\\1/p' | tail -n 1)"
  printf '%s' "$c"
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cat > "$tmp/entrega.zip"
# Respaldo antes de tocar nada, si ya hay una versión corriendo; si falla, no se actualiza.
respaldo=""
if [ -f "$destino/compose.yaml" ] && [ -n "$(cd "$destino" && docker compose ps --status running -q cotizador 2>/dev/null)" ]; then
  echo "Respaldando los datos antes de actualizar…"
  salida="$(cd "$destino" && docker compose exec -T cotizador npm run --silent respaldar -- --json)" || {
    echo "No se pudo respaldar; no se actualizó nada." >&2
    exit 7
  }
  printf '%s\\n' "$salida"
  respaldo="$(carpetaRespaldo "$salida")"
fi
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

# Versión anterior, como scripts/actualizar.sh: el código actual y una copia del respaldo recién tomado, para que
# \`sh scripts/actualizar.sh --volver\` vuelva a lo que había antes de ESTE despliegue.
anterior="$destino/.version-anterior"
if [ -f "$destino/compose.yaml" ]; then
  rm -rf "$anterior"
  if [ -n "$respaldo" ]; then
    echo "Guardando el código actual en $anterior…"
    mkdir -p "$anterior/codigo" "$anterior/datos"
    sincronizar "$destino" "$anterior/codigo"
    printf '%s\\n' "$respaldo" > "$anterior/respaldo"
    (cd "$destino" && docker compose cp "cotizador:$respaldo" "$anterior/datos/") || {
      rm -rf "$anterior/datos"
      echo "Aviso: no se pudo copiar el respaldo a $anterior; --volver lo usará mientras siga en el volumen." >&2
    }
  else
    echo "Aviso: el cotizador no estaba corriendo, así que no hubo respaldo ni queda versión anterior a la que volver." >&2
  fi
fi

sincronizar "$tmp/codigo" "$destino"
cd "$destino"
if ! grep -q '^BETTER_AUTH_URL=https://.' .env || ! grep -q '^NELTUME_HOSTS=.' .env; then
  echo "Falta BETTER_AUTH_URL o NELTUME_HOSTS en $destino/.env." >&2
  echo "Complétalos allí (o borra ese .env y repite con --url https://...) y vuelve a desplegar." >&2
  exit 3
fi
# --pull: la imagen base (Node, Chromium de Debian) trae sus parches; sin él la capa queda congelada en la caché.
if ! docker compose build --pull; then
  if [ -d "$anterior/codigo" ]; then
    sincronizar "$anterior/codigo" "$destino"
    echo "No se pudo construir la versión nueva. Se dejaron los archivos como estaban; sigue la versión anterior." >&2
  fi
  exit 8
fi
if ! docker compose up -d --remove-orphans --wait --wait-timeout 300; then
  docker compose ps || true
  echo "La versión nueva no pasó el chequeo de salud." >&2
  [ -d "$anterior/codigo" ] && echo "Para volver a la anterior, en el servidor: sh $destino/scripts/actualizar.sh --volver" >&2
  exit 9
fi
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

// Solo al ejecutarlo: las pruebas importan el módulo para revisar la advertencia sin desplegar nada.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  principal().catch((error) => {
    console.error(`No se pudo generar el despliegue: ${error.message}`);
    process.exitCode = 1;
  });

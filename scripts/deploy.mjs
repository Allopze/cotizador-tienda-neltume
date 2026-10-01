import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function principal() {
  const { values } = parseArgs({
    options: { url: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) {
    console.log('Uso: npm run deploy -- [--url https://cotizador.example.cl]');
    return;
  }

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
    'NELTUME_BIND_IP=127.0.0.1\nNELTUME_PORT=3000\n';
  archivos['.env'] = strToU8(entorno);

  const destino = join(raiz, 'deploy');
  await mkdir(destino, { recursive: true, mode: 0o700 });
  const fecha = new Date().toISOString().replace(/[:.]/g, '-');
  const salida = join(destino, `neltume-cotizador-${fecha}.zip`);
  await writeFile(salida, zipSync(archivos, { level: 6 }), { mode: 0o600, flag: 'wx' });
  console.log(`ZIP generado: ${relative(raiz, salida)}`);
  console.log(`${Object.keys(archivos).length} archivos. Instalación nueva con base vacía.`);
  if (!origen) console.log('En el servidor, completa BETTER_AUTH_URL y NELTUME_HOSTS en .env.');
  console.log('Descomprime el ZIP y ejecuta: docker compose up -d');
  console.log('Instrucciones de dominio, primera cuenta y actualizaciones: docker/LEEME.md');
}

principal().catch((error) => {
  console.error(`No se pudo generar el despliegue: ${error.message}`);
  process.exitCode = 1;
});

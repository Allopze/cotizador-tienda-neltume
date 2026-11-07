import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFIESTO = join(raiz, '.verificacion', 'entrega.json');
const CARPETAS_VERIFICADAS = ['src', 'public', 'config', 'scripts', 'tests', 'evals', 'docker', 'docs'];
const ARCHIVOS_VERIFICADOS = [
  'package.json',
  'package-lock.json',
  'next.config.ts',
  'next-env.d.ts',
  'tsconfig.json',
  'postcss.config.mjs',
  'eslint.config.mjs',
  'playwright.config.ts',
  'playwright.smoke.config.ts',
  'playwright.aceptacion.config.ts',
  'vitest.config.ts',
  'Dockerfile',
  'compose.yaml',
  '.dockerignore',
  '.env.example',
];
const PRIVADOS_VERIFICADOS = [
  'datos-privados/COTIZADOR_2026.xlsx',
  'datos-privados/VALORES PUERTAS ENCHAPADAS_NELTUME.CO.xlsx',
];
const IGNORAR = new Set([
  '.git',
  'node_modules',
  'data',
  'deploy',
  'test-results',
  'playwright-report',
  '.next',
  '.next-e2e',
  '.verificacion',
  'capturas',
  'screenshots',
  'ui-audit',
  'modelos-3d',
  'respaldos',
]);

/** Lista recursiva de archivos de una carpeta, en rutas relativas a la raíz. */
async function listarArchivos(carpeta) {
  const salida = [];
  const pendientes = [carpeta];
  while (pendientes.length) {
    const actual = pendientes.pop();
    for (const entrada of await readdir(actual, { withFileTypes: true })) {
      if (IGNORAR.has(entrada.name) || entrada.name === '.DS_Store') continue;
      if (entrada.isFile() && entrada.name.startsWith('.env') && entrada.name !== '.env.example') continue;
      const ruta = join(actual, entrada.name);
      if (entrada.isDirectory()) pendientes.push(ruta);
      else if (entrada.isFile()) salida.push(relative(raiz, ruta).replaceAll('\\', '/'));
    }
  }
  return salida;
}

/**
 * Huella del árbol que se verifica y se despliega: código, configuración, tests, evals y las dos planillas
 * privadas que usan las pruebas. Un cambio en cualquiera invalida la verificación anterior. No incluye
 * .env, datos, respaldos ni artefactos.
 */
export async function huellaEntrega() {
  const archivos = [];
  for (const ruta of [...ARCHIVOS_VERIFICADOS, ...PRIVADOS_VERIFICADOS])
    if (existsSync(join(raiz, ruta))) archivos.push(ruta);
  for (const carpeta of CARPETAS_VERIFICADAS)
    if (existsSync(join(raiz, carpeta))) archivos.push(...(await listarArchivos(join(raiz, carpeta))));
  const ordenados = [...new Set(archivos)].sort();
  const hash = createHash('sha256');
  for (const ruta of ordenados) {
    hash.update(ruta);
    hash.update('\0');
    hash.update(await readFile(join(raiz, ruta)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function leerManifiesto() {
  try {
    const datos = JSON.parse(await readFile(MANIFIESTO, 'utf8'));
    return datos && typeof datos === 'object' ? datos : null;
  } catch {
    return null;
  }
}

/** Una verificación sirve para desplegar si es del mismo árbol y, salvo --sin-ia explícito, incluyó la IA. */
export function puedeReusar(manifiesto, { huella, sinIa }) {
  return (
    !!manifiesto &&
    manifiesto.version === 1 &&
    manifiesto.ok === true &&
    manifiesto.huella === huella &&
    (sinIa || manifiesto.ia === true)
  );
}

async function escribirManifiesto({ huella, ia, etapas }) {
  await mkdir(dirname(MANIFIESTO), { recursive: true });
  await writeFile(
    MANIFIESTO,
    JSON.stringify({ version: 1, huella, ok: true, ia, fecha: new Date().toISOString(), etapas }, null, 2),
  );
}

async function borrarManifiesto() {
  await rm(MANIFIESTO, { force: true });
}

/**
 * Advertencia destacada de --sin-ia: la entrega no pasó la evaluación de la IA (precisión, errores
 * silenciosos y falsas alarmas), así que un cambio en el asistente puede llegar a las vendedoras sin medir.
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

function ejecutar(paso) {
  return new Promise((resolver, rechazar) => {
    const inicio = Date.now();
    const proceso = spawn(paso.comando, paso.argumentos, {
      cwd: raiz,
      shell: process.platform === 'win32',
    });
    const prefijo = `[${paso.nombre}] `;
    // Con varios procesos a la vez, la salida sin prefijo es ilegible. Se prefija por línea y se deja
    // el último fragmento para cuando cierre el flujo (una línea sin salto final).
    const bombear = (flujo, salida) => {
      let pendiente = '';
      flujo.setEncoding('utf8');
      flujo.on('data', (trozo) => {
        pendiente += trozo;
        const lineas = pendiente.split('\n');
        pendiente = lineas.pop() ?? '';
        for (const linea of lineas) salida.write(`${prefijo}${linea}\n`);
      });
      flujo.on('end', () => {
        if (pendiente) salida.write(`${prefijo}${pendiente}\n`);
      });
    };
    bombear(proceso.stdout, process.stdout);
    bombear(proceso.stderr, process.stderr);
    proceso.on('error', rechazar);
    proceso.on('close', (codigo) => resolver({ codigo, ms: Date.now() - inicio }));
  });
}

/**
 * Grupos de pasos independientes. El grupo 1 es rápido y no compite por Chromium; el grupo 2 junta E2E
 * con la evaluación de IA, que es de red. Así se solapa lo que no pelea por CPU y se conserva toda la
 * cobertura. `--serial` ejecuta cada paso por separado para diagnosticar.
 */
function pasos({ sinIa }) {
  return [
    { nombre: 'Tipos', comando: 'npx', argumentos: ['tsc', '--noEmit'], grupo: 1 },
    { nombre: 'Lint', comando: 'npm', argumentos: ['run', 'lint'], grupo: 1 },
    { nombre: 'Unitarios', comando: 'npm', argumentos: ['run', 'test:unit'], grupo: 1 },
    // El runner paralelo aísla base, puerto y distDir por grupo; su salida viene prefijada.
    { nombre: 'E2E', comando: 'npm', argumentos: ['run', 'test:e2e:paralelo'], grupo: 2 },
    ...(sinIa ? [] : [{ nombre: 'IA', comando: 'npm', argumentos: ['run', 'evaluar:regresion'], grupo: 2 }]),
  ];
}

async function correrGrupo(pasosDelGrupo) {
  const asentados = await Promise.allSettled(pasosDelGrupo.map((paso) => ejecutar(paso)));
  return asentados.map((resultado, i) => {
    if (resultado.status === 'fulfilled') return resultado.value;
    console.error(`[${pasosDelGrupo[i].nombre}] ${resultado.reason?.message ?? resultado.reason}`);
    return { codigo: 1, ms: 0 };
  });
}

/**
 * Verifica la entrega antes de empaquetarla. La IA sigue siendo obligatoria; `--sin-ia` solo existe para
 * una caída del proveedor y `--serial` sirve para diagnosticar un fallo que solo aparece al ejecutar todo
 * junto. Sin `--serial`, los grupos corren en paralelo y el total es el del grupo más lento, no la suma.
 */
export async function verificar({ sinIa = false, serial = false } = {}) {
  const lista = pasos({ sinIa });
  console.log(
    `\n▶ Verificación ${serial ? 'en serie' : 'por grupos en paralelo'}: ${lista.map((p) => p.nombre).join(', ')}…`,
  );
  const resultados = new Map();
  if (serial) {
    for (const paso of lista) {
      const resultado = await ejecutar(paso);
      resultados.set(paso, resultado);
      if (resultado.codigo !== 0) break;
    }
  } else {
    const grupos = [...new Set(lista.map((paso) => paso.grupo))].sort((a, b) => a - b);
    for (const grupo of grupos) {
      const delGrupo = lista.filter((paso) => paso.grupo === grupo);
      console.log(`\n▶ Grupo ${grupo}: ${delGrupo.map((paso) => paso.nombre).join(', ')}…`);
      const salida = await correrGrupo(delGrupo);
      salida.forEach((resultado, i) => resultados.set(delGrupo[i], resultado));
      if (salida.some((resultado) => resultado.codigo !== 0)) break;
    }
  }
  const fallas = [];
  const etapas = [];
  for (const paso of lista) {
    const resultado = resultados.get(paso);
    if (!resultado) {
      console.log(`— ${paso.nombre}: no ejecutado`);
      etapas.push({ nombre: paso.nombre, ok: false, noEjecutado: true });
      continue;
    }
    const bien = resultado.codigo === 0;
    console.log(`${bien ? '✔' : '✘'} ${paso.nombre} (${(resultado.ms / 1000).toFixed(1)} s)`);
    etapas.push({ nombre: paso.nombre, ok: bien, ms: resultado.ms });
    if (!bien) fallas.push(paso.nombre);
  }
  if (fallas.length) {
    // Una verificación fallida no puede dejar vigente la atestación de una corrida anterior.
    await borrarManifiesto();
    if (sinIa) console.warn(advertenciaSinIa());
    throw new Error(
      `${fallas.join(', ')}: falló. No se despliega; corrige el problema y vuelve a intentarlo.` +
        (fallas.includes('IA') ? ' Si el proveedor de IA no respondía, repite más tarde.' : ''),
    );
  }
  const huella = await huellaEntrega();
  await escribirManifiesto({ huella, ia: !sinIa, etapas });
  console.log(`Manifiesto: ${relative(raiz, MANIFIESTO)}`);
  if (sinIa) console.warn(advertenciaSinIa());
  console.log('\nVerificación completa.');
}

// Solo al ejecutarlo: deploy.mjs lo importa para reutilizar la misma verificación.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({
    options: {
      'sin-ia': { type: 'boolean' },
      serial: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      'Uso: npm run verificar -- [--sin-ia] [--serial]\n' +
        'Por omisión los grupos de verificación corren en paralelo.\n' +
        '--serial ejecuta cada paso por separado para diagnosticar.\n' +
        '--sin-ia omite la evaluación de la IA solo si el proveedor no responde.\n' +
        'Al terminar deja .verificacion/entrega.json; npm run deploy lo reutiliza si el árbol no cambió.',
    );
    process.exit(0);
  }
  verificar({ sinIa: values['sin-ia'], serial: values.serial }).catch((error) => {
    console.error(`No se pudo verificar: ${error.message}`);
    process.exitCode = 1;
  });
}

import { spawn } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Aísla E2E por grupos de procesos: cada grupo tiene su base, su puerto y su distDir. No se sube
// `workers` dentro de un mismo grupo porque los tests de ese grupo comparten correlativos y datos.
// Los dependientes de `flujo` van juntos; los independientes se reparten en bloques contiguos.
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsconfig = join(raiz, 'tsconfig.json');
const tsconfigOriginal = await readFile(tsconfig, 'utf8');
const nextEnv = join(raiz, 'next-env.d.ts');
const nextEnvOriginal = await readFile(nextEnv, 'utf8');
const workers = Math.max(1, Math.min(4, Number(process.env.NELTUME_E2E_WORKERS) || 2));
const archivos = (await readdir(join(raiz, 'tests')))
  .filter((nombre) => nombre.endsWith('.e2e.ts') && nombre !== 'aceptacion.e2e.ts' && nombre !== 'primer-uso.e2e.ts')
  .sort();
// Archivos que dependen del orden de `flujo.e2e.ts` (323, nota 1, 577) o de datos que deja.
// La lista sale de los comentarios de cada test; si agregas una dependencia, actualízala.
const DEPENDIENTES_DE_FLUJO = new Set([
  'flujo.e2e.ts',
  'gestion-descuento-cantidad.e2e.ts',
  'gestion.e2e.ts',
  'historial.e2e.ts',
  'movil.e2e.ts',
  'navegacion.e2e.ts',
  'pedido-corregido.e2e.ts',
  'reparto-fabricas.e2e.ts',
  'toque-doble.e2e.ts',
]);
const bloques = [];
if (workers === 1) bloques.push(archivos);
else {
  const dependientes = archivos.filter((nombre) => DEPENDIENTES_DE_FLUJO.has(nombre));
  const independientes = archivos.filter((nombre) => !DEPENDIENTES_DE_FLUJO.has(nombre));
  if (dependientes.length) bloques.push(dependientes);
  const repartos = Math.max(1, workers - bloques.length);
  const tamanoIndependientes = Math.ceil(independientes.length / repartos);
  for (let i = 0; i < repartos; i++) {
    const bloque = independientes.slice(i * tamanoIndependientes, (i + 1) * tamanoIndependientes);
    if (bloque.length) bloques.push(bloque);
  }
}
const grupos = [];
for (let i = 0; i < bloques.length; i++) {
  grupos.push({
    nombre: `flujos-${i + 1}`,
    datos: `data/test-e2e-p${i + 1}`,
    puerto: String(3201 + i),
    dist: `.next-e2e/p${i + 1}`,
    salida: `test-results/flujos-${i + 1}`,
    argumentos: ['playwright', 'test', '--project=flujos', ...bloques[i].map((archivo) => `tests/${archivo}`)],
  });
}
grupos.push({
  nombre: 'aceptacion',
  datos: 'data/test-e2e-aceptacion',
  puerto: String(3201 + grupos.length),
  dist: '.next-e2e/aceptacion',
  salida: 'test-results/aceptacion',
  argumentos: ['playwright', 'test', '--config=playwright.aceptacion.config.ts'],
});

function entorno(grupo) {
  return {
    ...process.env,
    NELTUME_E2E_DIR: grupo.datos,
    NELTUME_E2E_PORT: grupo.puerto,
    NELTUME_DIST_DIR: grupo.dist,
    NELTUME_E2E_OUTPUT_DIR: grupo.salida,
  };
}

function correr(nombre, comando, argumentos, env) {
  return new Promise((resolver, rechazar) => {
    const inicio = Date.now();
    const proceso = spawn(comando, argumentos, {
      cwd: raiz,
      env,
      shell: process.platform === 'win32',
    });
    const prefijo = `[${nombre}] `;
    for (const [flujo, salida] of [
      [proceso.stdout, process.stdout],
      [proceso.stderr, process.stderr],
    ]) {
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
    }
    proceso.on('error', rechazar);
    proceso.on('close', (codigo) => resolver({ codigo: codigo ?? 1, ms: Date.now() - inicio }));
  });
}

try {
  console.log(`▶ E2E aislado: ${workers} grupo(s) de flujos + aceptación.`);
  // El grupo que contiene `flujo` conserva el orden de los tests dependientes; los independientes se reparten.
  for (const grupo of grupos) {
    console.log(`\n▶ Preparando ${grupo.nombre} (${grupo.datos}, puerto ${grupo.puerto})…`);
    const preparado = await correr(`prep ${grupo.nombre}`, 'npx', ['tsx', 'scripts/preparar-e2e.ts'], entorno(grupo));
    if (preparado.codigo !== 0) throw new Error(`No se pudo preparar ${grupo.nombre}.`);
  }
  const resultados = await Promise.all(
    grupos.map(async (grupo) => ({ grupo, ...(await correr(grupo.nombre, 'npx', grupo.argumentos, entorno(grupo))) })),
  );
  let fallas = 0;
  for (const resultado of resultados) {
    const bien = resultado.codigo === 0;
    if (!bien) fallas++;
    console.log(`${bien ? '✔' : '✘'} ${resultado.grupo.nombre} (${(resultado.ms / 1000).toFixed(1)} s)`);
  }
  if (fallas) {
    console.error(`\n${fallas} grupo(s) fallaron.`);
    process.exitCode = 1;
  } else console.log('\nE2E aislado: todos los grupos pasaron.');
} finally {
  // `next dev` agrega rutas de tipos a tsconfig.json y reescribe next-env.d.ts; se restauran para no dejar
  // cambios generados por el distDir de cada grupo.
  await writeFile(tsconfig, tsconfigOriginal);
  await writeFile(nextEnv, nextEnvOriginal);
}

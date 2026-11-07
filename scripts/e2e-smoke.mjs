import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Smoke aislado: base, puerto, distDir y outputDir propios. Guarda/restaura los archivos que `next dev`
// genera (tsconfig.json y next-env.d.ts) para no dejar cambios en el árbol.
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsconfig = join(raiz, 'tsconfig.json');
const nextEnv = join(raiz, 'next-env.d.ts');
const tsconfigOriginal = await readFile(tsconfig, 'utf8');
const nextEnvOriginal = await readFile(nextEnv, 'utf8');
const entorno = {
  ...process.env,
  NELTUME_E2E_DIR: 'data/test-e2e-smoke',
  NELTUME_E2E_PORT: '3102',
  NELTUME_DIST_DIR: '.next-e2e/smoke',
  NELTUME_E2E_OUTPUT_DIR: 'test-results/smoke',
};

function correr(comando, argumentos) {
  return new Promise((resolver, rechazar) => {
    const proceso = spawn(comando, argumentos, {
      cwd: raiz,
      env: entorno,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    proceso.on('error', rechazar);
    proceso.on('close', (codigo) => resolver(codigo ?? 1));
  });
}

try {
  const preparado = await correr('npx', ['tsx', 'scripts/preparar-e2e.ts']);
  if (preparado !== 0) process.exitCode = preparado;
  else process.exitCode = await correr('npx', ['playwright', 'test', '--config=playwright.smoke.config.ts']);
} finally {
  await writeFile(tsconfig, tsconfigOriginal);
  await writeFile(nextEnv, nextEnvOriginal);
}

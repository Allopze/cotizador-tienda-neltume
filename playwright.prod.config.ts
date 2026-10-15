import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { chromiumPath } from './src/servidor/chromium';

// E2E contra el build de producción: `next build` + `next start` (NODE_ENV=production) detrás de un proxy HTTPS local
// (scripts/proxy-tls-e2e.mjs, certificado autofirmado), porque en producción BETTER_AUTH_URL debe ser https.
//   npx playwright test -c playwright.prod.config.ts
// Datos aislados en data/test-e2e-prod y compilación en .next-e2e/prod: no toca la E2E
// de desarrollo ni .next; los datos se preparan en el primer webServer (tests/preparar-e2e-prod.ts). Un segundo
// `next start` del mismo build, con CHROMIUM_PATH inválido, sirve a
// tests/sin-chromium.prod.ts: emitir sin Chromium se explica en pantalla y no gasta el número.
process.env.NELTUME_E2E_DIR ??= 'data/test-e2e-prod';
const dataE2E = resolve(process.env.NELTUME_E2E_DIR);
const dbE2E = resolve(dataE2E, 'cotizador.sqlite');
const SECRETO = 'playwright-secret-neltume-0123456789abcdef';
const ORIGEN = 'https://127.0.0.1:3443';
const ORIGEN_SIN_CHROMIUM = 'https://127.0.0.1:3444';
process.env.BETTER_AUTH_SECRET = SECRETO;
process.env.BETTER_AUTH_URL = ORIGEN;
process.env.NELTUME_DATA_DIR = dataE2E;
process.env.NELTUME_DB_PATH = dbE2E;

const entorno = (origen: string) => ({
  NODE_ENV: 'production',
  NELTUME_TEST_MODE: '1',
  NELTUME_DIST_DIR: '.next-e2e/prod',
  NELTUME_LLM: 'fijo',
  NELTUME_STARKEN: 'fijo',
  NELTUME_FERIADOS_SYNC: '0',
  NELTUME_DATA_DIR: dataE2E,
  NELTUME_DB_PATH: dbE2E,
  BETTER_AUTH_SECRET: SECRETO,
  BETTER_AUTH_URL: origen,
});

export default defineConfig({
  testDir: 'tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  projects: [
    { name: 'prod', testMatch: '**/*.e2e.ts', testIgnore: ['**/aceptacion.e2e.ts', '**/primer-uso.e2e.ts'] },
    { name: 'prod-aceptacion', testMatch: '**/aceptacion.e2e.ts', dependencies: ['prod'] },
    {
      name: 'sin-chromium',
      testMatch: '**/sin-chromium.prod.ts',
      dependencies: ['prod-aceptacion'],
      use: { baseURL: ORIGEN_SIN_CHROMIUM },
    },
  ],
  use: {
    baseURL: ORIGEN,
    ignoreHTTPSErrors: true,
    headless: true,
    launchOptions: { executablePath: chromiumPath() },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      // Datos nuevos, build limpio y los dos `next start` del mismo build: el normal (3200) y uno con CHROMIUM_PATH
      // inválido (3201, en segundo plano; Playwright cierra el grupo de procesos al terminar).
      command: [
        'npx tsx tests/preparar-e2e-prod.ts',
        'rm -rf .next-e2e/prod',
        'npx next build',
        `(CHROMIUM_PATH=/ruta/que/no/existe/chromium BETTER_AUTH_URL=${ORIGEN_SIN_CHROMIUM} npx next start --hostname 127.0.0.1 --port 3201 &)`,
        'npx next start --hostname 127.0.0.1 --port 3200',
      ].join(' && '),
      url: 'http://127.0.0.1:3200/login',
      reuseExistingServer: false,
      timeout: 600000,
      env: entorno(ORIGEN),
    },
    {
      command: `node scripts/proxy-tls-e2e.mjs 3443 3200 ${dataE2E}-tls`,
      url: `${ORIGEN}/login`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 600000,
    },
    {
      command: `node scripts/proxy-tls-e2e.mjs 3444 3201 ${dataE2E}-tls`,
      url: `${ORIGEN_SIN_CHROMIUM}/login`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 600000,
    },
  ],
});

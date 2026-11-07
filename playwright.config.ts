import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import { chromiumPath } from './src/servidor/chromium';
const dataE2E = resolve(process.env.NELTUME_E2E_DIR ?? 'data/test-e2e');
const dbE2E = resolve(dataE2E, 'cotizador.sqlite');
// 3101 por omisión: VS Code y otras herramientas suelen ocupar 3100. Se puede cambiar con NELTUME_E2E_PORT.
const puertoE2E = process.env.NELTUME_E2E_PORT ?? '3101';
const baseURL = `http://127.0.0.1:${puertoE2E}`;
const distE2E = process.env.NELTUME_DIST_DIR ?? '.next-e2e';
process.env.BETTER_AUTH_SECRET = 'playwright-secret-neltume-0123456789abcdef';
process.env.BETTER_AUTH_URL = baseURL;
process.env.NELTUME_DATA_DIR = dataE2E;
process.env.NELTUME_DB_PATH = dbE2E;
const conFirefox = process.env.NELTUME_E2E_FIREFOX === '1';
export default defineConfig({
  testDir: 'tests',
  outputDir: process.env.NELTUME_E2E_OUTPUT_DIR ?? 'test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  // La aceptación emite cotizaciones y notas: corre al final para no mover los correlativos que otras
  // pruebas esperan (la primera cotización es la 323 y la primera nota de Panguipulli, la 577).
  // «webkit-iphone» repite las pruebas del teléfono en WebKit (Safari) con el iPhone 13; requiere
  // `npx playwright install webkit`. «webkit» y «firefox» repiten en escritorio los campos que siguen numéricos, con
  // el navegador en inglés (así una burbuja de validación nativa se notaría); requieren
  // `npx playwright install webkit firefox`. Firefox es opcional (NELTUME_E2E_FIREFOX=1): el Firefox 155 de
  // Playwright 1.63 no arranca en macOS 27 («Could not find profile folder»). «primer-uso» aparta por un momento las
  // cuentas: corre al final de todo.
  projects: [
    { name: 'flujos', testMatch: '**/*.e2e.ts', testIgnore: ['**/aceptacion.e2e.ts', '**/primer-uso.e2e.ts'] },
    { name: 'aceptacion', testMatch: '**/aceptacion.e2e.ts', dependencies: ['flujos'] },
    {
      name: 'webkit-iphone',
      testMatch: '**/movil.e2e.ts',
      dependencies: ['aceptacion'],
      use: { ...devices['iPhone 13'], launchOptions: {} },
    },
    {
      name: 'webkit',
      testMatch: '**/campos-numericos.e2e.ts',
      dependencies: ['aceptacion'],
      use: { ...devices['Desktop Safari'], locale: 'en-US', launchOptions: {} },
    },
    ...(conFirefox
      ? [
          {
            name: 'firefox',
            testMatch: '**/campos-numericos.e2e.ts',
            dependencies: ['aceptacion'],
            use: { ...devices['Desktop Firefox'], locale: 'en-US', launchOptions: {} },
          },
        ]
      : []),
    {
      name: 'primer-uso',
      testMatch: '**/primer-uso.e2e.ts',
      dependencies: ['aceptacion', 'webkit-iphone', 'webkit', ...(conFirefox ? ['firefox'] : [])],
    },
  ],
  use: {
    baseURL,
    headless: true,
    launchOptions: { executablePath: chromiumPath() },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run dev -- --port ${puertoE2E}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NELTUME_TEST_MODE: '1',
      NELTUME_LLM: 'fijo',
      // Starken simulado (src/servidor/starken-fijo.ts): sin red ni credenciales reales.
      NELTUME_STARKEN: 'fijo',
      NELTUME_FERIADOS_SYNC: '0',
      // La integración con la fábrica queda apagada: `next dev` carga `.env.local` y, sin esto, cada corrida
      // enviaría pedidos de prueba a la URL configurada (auditoría BUG-022).
      NELTUME_FABRICA_PANGUIPULLI_URL: '',
      NELTUME_FABRICA_PANGUIPULLI_SECRETO: '',
      NELTUME_DATA_DIR: dataE2E,
      NELTUME_DB_PATH: dbE2E,
      NELTUME_DIST_DIR: distE2E,
      BETTER_AUTH_SECRET: 'playwright-secret-neltume-0123456789abcdef',
      BETTER_AUTH_URL: baseURL,
    },
  },
});

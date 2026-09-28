import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { chromiumPath } from './src/servidor/chromium';
const dataE2E = resolve('data/test-e2e');
const dbE2E = resolve(dataE2E, 'cotizador.sqlite');
process.env.BETTER_AUTH_SECRET = 'playwright-secret-neltume-0123456789abcdef';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3100';
process.env.NELTUME_DATA_DIR = dataE2E;
process.env.NELTUME_DB_PATH = dbE2E;
export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    headless: true,
    launchOptions: { executablePath: chromiumPath() },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NELTUME_TEST_MODE: '1',
      NELTUME_LLM: 'fijo',
      NELTUME_DATA_DIR: dataE2E,
      NELTUME_DB_PATH: dbE2E,
      BETTER_AUTH_SECRET: 'playwright-secret-neltume-0123456789abcdef',
      BETTER_AUTH_URL: 'http://127.0.0.1:3100',
    },
  },
});

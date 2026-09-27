import { defineConfig } from '@playwright/test';
import { chromiumPath } from './src/servidor/chromium';
export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  globalSetup: './tests/preparar-e2e.ts',
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
      NELTUME_DATA_DIR: 'data/test-e2e',
      NELTUME_DB_PATH: 'data/test-e2e/cotizador.sqlite',
    },
  },
});

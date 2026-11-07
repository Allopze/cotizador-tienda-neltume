import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// Cadena dependiente de la aceptación: corre en su propia base y puerto, en paralelo con los grupos de
// flujos. Aceptación crea la cotización/nota que usan WebKit y primer uso; por eso la cadena conserva
// esas dependencias, pero ya no arrastra todo el proyecto `flujos`.
const conFirefox = process.env.NELTUME_E2E_FIREFOX === '1';

export default defineConfig({
  ...base,
  projects: [
    { name: 'aceptacion', testMatch: '**/aceptacion.e2e.ts' },
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
});

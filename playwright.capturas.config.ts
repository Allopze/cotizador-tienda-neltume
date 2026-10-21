import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// `npm run ss`: capturas de todas las pantallas (tests/pantallas.ss.ts) en escritorio y en teléfono, con el mismo
// servidor y la misma base aislada que la E2E. Quedan en capturas/<proyecto>/; `SS_COMPLETA=1` captura la página
// entera en vez de solo lo que cabe en la pantalla.
export default defineConfig({
  ...base,
  testMatch: '**/pantallas.ss.ts',
  outputDir: 'test-results/capturas',
  reporter: 'list',
  retries: 0,
  projects: [
    { name: 'escritorio', use: { viewport: { width: 1920, height: 1080 } } },
    {
      name: 'telefono',
      use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
  ],
});

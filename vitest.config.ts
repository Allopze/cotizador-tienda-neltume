import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    // Sin red en las pruebas: la sincronización de feriados se prueba con una fuente simulada.
    env: { NELTUME_FERIADOS_SYNC: '0' },
  },
});

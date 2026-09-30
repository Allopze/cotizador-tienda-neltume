import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  // Mismo alias que tsconfig: permite probar los formatos de la interfaz (src/app).
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    // Sin red en las pruebas: la sincronización de feriados se prueba con una fuente simulada.
    env: { NELTUME_FERIADOS_SYNC: '0' },
  },
});

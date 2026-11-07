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
    // Los reintentos de la IA no esperan en las pruebas.
    // Vitest define TEST=true; la app solo lo acepta vacío, 0 o false. Los tests de auth que simulan
    // producción necesitan TEST=0 para llegar a validar el secreto y los orígenes.
    env: { NELTUME_FERIADOS_SYNC: '0', CMD_REINTENTO_MS: '0', TEST: '0' },
  },
});

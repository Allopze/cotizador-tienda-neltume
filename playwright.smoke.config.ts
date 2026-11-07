import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Smoke: recorrido corto para desarrollo y para un CI rápido. No reemplaza la suite completa:
// `npm run test:e2e` y `npm run verificar` siguen ejecutando todos los proyectos, incluidos WebKit,
// aceptación y primer uso. Este perfil usa su propia base y su propio puerto (data/test-e2e-smoke, 3102).
const archivos = [
  '**/login.e2e.ts',
  '**/cotizador-ui.e2e.ts',
  '**/alta-desde-pendiente.e2e.ts',
  '**/pedido-especial.e2e.ts',
  '**/catalogo-secciones.e2e.ts',
  '**/edicion-detalle.e2e.ts',
];

export default defineConfig({
  ...base,
  projects: [{ name: 'smoke', testMatch: archivos }],
});

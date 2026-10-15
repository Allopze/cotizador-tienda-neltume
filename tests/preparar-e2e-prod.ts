// Prepara los datos aislados de la E2E contra producción (playwright.prod.config.ts) antes de compilar y arrancar.
// Se ejecuta con tsx desde el webServer: así los datos existen antes de que `next start` abra la base.
process.env.NELTUME_E2E_DIR ??= 'data/test-e2e-prod';
const { default: preparar } = await import('./preparar-e2e');
await preparar();
export {};

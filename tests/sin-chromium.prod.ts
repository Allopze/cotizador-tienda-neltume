import { test, expect } from './fixtures-e2e';
import { crearBorrador, leer } from './api-e2e';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { DIR_E2E, iniciarSesion } from './login-e2e';

// Solo en playwright.prod.config.ts (proyecto «sin-chromium»): el servidor corre con CHROMIUM_PATH inválido. Emitir
// explica en pantalla que el PDF no se pudo generar (503, antes un 500 genérico), la cotización queda en borrador y
// el número no se gasta: el siguiente correlativo sigue disponible.

test('sin Chromium, emitir avisa en pantalla, conserva el borrador y no gasta el número', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await iniciarSesion(page);
  const borrador = await crearBorrador(page.request, { cliente: 'Cliente Sin Chromium' });
  const db = abrirBaseDatos(`${DIR_E2E}/cotizador.sqlite`, { permitirJsonLegado: true, cachear: false });
  const numeracion = async () =>
    (db.prepare('SELECT siguiente_cotizacion AS n FROM correlativos WHERE id = 1').get() as { n: number }).n;
  const antes = await numeracion();
  await page.goto(`/?cotizacion=${encodeURIComponent(borrador.id)}`);
  const panel = page.getByLabel('Cotización en curso');
  await panel.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
  const respuesta = page.waitForResponse((r) => r.url().endsWith('/api/accion') && r.request().method() === 'POST');
  await page.getByRole('alertdialog', { name: 'Emitir la cotización' }).getByRole('button', { name: 'Emitir y generar PDF' }).click();
  expect((await respuesta).status()).toBe(503);
  await expect(
    page.getByRole('alert').filter({ hasText: 'No se pudo generar el PDF. Reintenta en un momento; la cotización se conserva.' }),
  ).toBeVisible();
  await expect(page.getByText(/tuvo un problema \(error 5\d\d\)/)).toHaveCount(0);
  const despues = await leer(page.request, borrador.id);
  expect(despues.estado).toBe('borrador');
  expect(despues.numero).toBeNull();
  expect(await numeracion()).toBe(antes);
  db.close();
});

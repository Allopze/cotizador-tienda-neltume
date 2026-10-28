import { test, expect, type Locator, type Page } from './fixtures-e2e';
import { crearBorrador, crearEmitida, leer } from './api-e2e';
import { iniciarSesion } from './login-e2e';

// Doble toque en el teléfono (modo táctil, 390 px) sobre «Emitir y generar PDF» y «Registrar pago»: el segundo toque
// llega mientras la primera llamada sigue en curso (se demora a propósito) y no debe emitir otra vez ni registrar un
// segundo pago. Corre después de flujo.e2e.ts (orden alfabético): emite, y la 323 y la nota 1 son de esa prueba.

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

/** Cuenta los POST a /api/accion de un tipo y los demora para que el segundo toque llegue con el primero en curso. */
async function contarYDemorar(page: Page, tipo: string) {
  const enviados: unknown[] = [];
  await page.route('**/api/accion', async (route) => {
    const req = route.request();
    if (req.method() === 'POST' && req.postDataJSON()?.tipo === tipo) {
      enviados.push(req.postDataJSON());
      await new Promise((r) => setTimeout(r, 800));
    }
    await route.continue();
  });
  return enviados;
}

/** Dos toques seguidos en el centro del botón, como un dedo que golpea dos veces (sin esperar entre ambos). */
async function dobleToque(page: Page, boton: Locator) {
  await boton.scrollIntoViewIfNeeded();
  const caja = (await boton.boundingBox())!;
  const x = caja.x + caja.width / 2,
    y = caja.y + caja.height / 2;
  await page.touchscreen.tap(x, y);
  await page.touchscreen.tap(x, y);
}

async function abrirVista(page: Page, id: string) {
  await page.goto(`/?cotizacion=${encodeURIComponent(id)}`);
  await expect(page).toHaveURL(/\/$/); // el router limpió la URL: ya no hay viaje en curso
  const pestana = page
    .getByRole('navigation', { name: 'Vista del cotizador' })
    .getByRole('button', { name: /^(Cotización|Seguimiento)$/ });
  await pestana.click();
  await expect(pestana).toHaveAttribute('aria-pressed', 'true');
}

test('doble toque en «Emitir»: una sola emisión y un solo número', async ({ page }) => {
  await iniciarSesion(page);
  const borrador = await crearBorrador(page.request, { cliente: 'Cliente Doble Toque Emitir' });
  await abrirVista(page, borrador.id);
  const panel = page.getByLabel('Cotización en curso');
  const enviados = await contarYDemorar(page, 'emitir');

  // El doble toque en el botón de la barra no emite: abre el diálogo una sola vez (el segundo toque puede caer fuera
  // del diálogo y cerrarlo, como «Cancelar»; entonces se vuelve a tocar).
  const emitir = panel.getByRole('button', { name: 'Emitir y generar PDF', exact: true });
  await dobleToque(page, emitir);
  const dialogo = page.getByRole('alertdialog', { name: 'Emitir la cotización' });
  await page.waitForTimeout(500);
  expect(await dialogo.count()).toBeLessThanOrEqual(1);
  expect(enviados).toHaveLength(0);
  if (!(await dialogo.count())) await emitir.tap();
  await expect(dialogo).toHaveCount(1);
  // Y el doble toque en la confirmación emite una sola vez.
  await dobleToque(page, dialogo.getByRole('button', { name: 'Emitir y generar PDF' }));
  await expect.poll(async () => (await leer(page.request, borrador.id)).estado, { timeout: 30000 }).toBe('emitida');
  await page.waitForTimeout(1500);
  expect(enviados).toHaveLength(1);
  // Sin avisos de error (el anunciador de rutas de Next es un «alert» vacío).
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
  await page.unroute('**/api/accion');
});

test('doble toque en «Registrar pago»: un solo pago en el registro', async ({ page }) => {
  await iniciarSesion(page);
  const aprobada = await crearEmitida(page.request, { cliente: 'Cliente Doble Toque Pago', aprobar: true });
  await abrirVista(page, aprobada.id);
  const flujo = page.getByLabel('Cotización en curso').locator('.quote-workflow');
  const monto = flujo.getByLabel(/^Monto recibido/);
  await monto.scrollIntoViewIfNeeded();
  await monto.tap();
  await monto.fill('10.000');
  const enviados = await contarYDemorar(page, 'pago');
  await dobleToque(page, flujo.getByRole('button', { name: 'Registrar pago' }));
  await expect(flujo.locator('.workflow-ledger')).toContainText('$10.000');
  await page.waitForTimeout(1500);
  expect(enviados).toHaveLength(1);
  const final = await leer(page.request, aprobada.id);
  expect((final.pagos as unknown[] | undefined)?.length).toBe(1);
  await expect(page.getByText(/cambió mientras la tenías abierta/)).toHaveCount(0);
  await page.unroute('**/api/accion');
});

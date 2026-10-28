import { test, expect } from './fixtures-e2e';
import { iniciarSesion } from './login-e2e';

// No emite nada (no mueve correlativos) y al final elimina el borrador que creó.
test('lo escrito se conserva al abrir otra cotización y no se cambia de pantalla con el chat esperando', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso');
  const compositor = page.getByLabel('Escribe tu pedido');
  const historial = page.getByRole('link', { name: 'Historial' });

  // Un borrador propio, para abrirlo después con el mismo enlace que usa el historial.
  const respuesta = page.waitForResponse(
    (r) => r.url().endsWith('/api/accion') && r.request().method() === 'POST',
  );
  await compositor.fill('3 Huilo Huilo oregón 80×210 para Juan Pérez, Temuco');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  const { cotizacion } = (await (await respuesta).json()) as { cotizacion: { id: string } };
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();

  // Texto a medio escribir en una cotización nueva; se pasa por el historial y se abre el borrador.
  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await compositor.fill('Agrega marcos en oregón');
  await historial.click();
  await expect(page.getByRole('heading', { name: 'Historial de cotizaciones' })).toBeVisible();
  await page.goto(`/?cotizacion=${cotizacion.id}`);
  await expect(page).toHaveURL(/\/$/); // el router limpió la URL: ya no hay viaje en curso
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Sin número');
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await expect(compositor).toHaveValue('Agrega marcos en oregón');
  await expect(page.locator('#texto-conservado')).toContainText('Este texto venía de la cotización anterior');

  // Mientras el chat espera, los enlaces del encabezado y Ctrl+K no sacan de la pantalla.
  await page.route('**/api/accion', async (route) => {
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.tipo === 'chat')
      await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(historial).toHaveAttribute('aria-disabled', 'true');
  await historial.click({ force: true });
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  await expect(page).not.toHaveURL(/historial/);
  await expect(historial).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#texto-conservado')).toHaveCount(0);
  await expect(compositor).toHaveValue('');
  await page.unroute('**/api/accion');

  await panel.getByRole('button', { name: 'Más acciones' }).click();
  await panel.getByRole('button', { name: 'Eliminar borrador' }).click();
  await page
    .getByRole('alertdialog', { name: 'Eliminar borrador' })
    .getByRole('button', { name: 'Eliminar borrador' })
    .click();
  await expect(
    page.getByLabel('Vista previa de la cotización').getByRole('heading', { level: 2 }),
  ).toHaveText('Vista previa');
});

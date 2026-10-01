import { test, expect, type Page } from '@playwright/test';
import { iniciarSesion } from './login-e2e';

async function agregarPuerta(page: Page) {
  await page.getByRole('button', { name: 'Agregar producto del catálogo' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Agregar producto' });
  await dialogo.getByLabel('Busca por modelo, madera o código').fill('HUIL-O-3-B');
  await dialogo.locator('.producto-resultados button').first().click();
  await dialogo.getByLabel('Cantidad', { exact: true }).fill('3');
  await dialogo.getByLabel('Ancho (m)', { exact: true }).fill('0.8');
  await dialogo.getByLabel('La medida corresponde a').selectOption('hoja');
  await dialogo.getByRole('button', { name: 'Agregar al pedido' }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(page.getByLabel('Cotización en curso').getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
}

test('desktop: catálogo, edición compacta, scroll de página y resumen persistente', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await iniciarSesion(page);
  await agregarPuerta(page);
  const panel = page.getByLabel('Cotización en curso');
  const barra = page.getByLabel('Resumen y acciones de la cotización');
  await expect(panel.locator('.item-details')).not.toHaveAttribute('open');
  await expect(panel.locator('.quote-details[open]')).toHaveCount(0);
  await expect(barra).toBeInViewport();
  await expect(barra).toContainText('IVA incluido · CLP');
  await expect(panel.getByRole('button', { name: 'Editar precio unitario', exact: true })).toContainText('$');
  await page.screenshot({ path: 'test-results/cotizador-desktop.png' });
  await panel.getByRole('button', { name: /^Editar cantidad de/ }).click();
  await panel.getByLabel(/^Cantidad de/).fill('4');
  await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(panel.locator('.quote-change-note')).toContainText('Cantidad: 3 → 4');
  await expect(panel.locator('#producto-0')).toHaveClass(/item-actualizado/);

  await panel.locator('.item-details > summary').click();
  await panel.getByRole('button', { name: /^Editar ancho \(m\)/ }).click();
  await expect(panel.getByLabel('Ancho (m)', { exact: true })).toHaveValue('0.8');
  await panel.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await panel.locator('.quote-client-section > summary').click();
  await panel.locator('.quote-details > summary').filter({ hasText: 'Despacho' }).click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight > innerHeight))
    .toBe(true);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(barra).toBeInViewport();
  await expect(barra.getByRole('button', { name: 'Emitir y generar PDF', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'test-results/cotizador-desktop-scroll.png', fullPage: true });

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'Contraer asistente', exact: false }).click();
  await expect(page.getByLabel('Escribe tu pedido')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Abrir asistente', exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Abrir asistente', exact: false }).click();
  await expect(page.getByLabel('Escribe tu pedido')).toBeVisible();
  for (const [width, height] of [
    [1280, 720],
    [1024, 768],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(barra).toBeInViewport();
  }
});

test('los pendientes abren su editor y el total se identifica como parcial', async ({ page }) => {
  await iniciarSesion(page);
  await page.getByLabel('Escribe tu pedido').fill('3 Pillo oregón 80×210 para Juan Pérez, Temuco');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  const panel = page.getByLabel('Cotización en curso');
  await expect(panel.locator('.item-details')).toHaveAttribute('open');
  await expect(panel.locator('.quote-toolbar')).toContainText('Total parcial');
  await expect(panel.getByRole('button', { name: 'Emitir y generar PDF', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: /^Confirmar Huilo Huilo/ }).click();
  await expect(panel.locator('.quote-toolbar')).toContainText('Total del pedido');
  await expect(panel.getByRole('button', { name: 'Emitir y generar PDF', exact: true })).toBeEnabled();
});

test('móvil: cambia entre pedido y cotización conservando texto y resumen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await iniciarSesion(page);
  await page.getByRole('button', { name: 'Cotización', exact: true }).click();
  await agregarPuerta(page);
  const barra = page.getByLabel('Resumen y acciones de la cotización');
  await expect(barra).toBeInViewport();
  await page.getByRole('button', { name: 'Pedido', exact: true }).click();
  await page.getByLabel('Escribe tu pedido').fill('Agregar observación de entrega');
  await page.getByRole('button', { name: 'Cotización', exact: true }).click();
  await expect(page.getByLabel('Escribe tu pedido')).toBeHidden();
  await expect(barra).toBeInViewport();
  await page.getByRole('button', { name: 'Pedido', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pedido', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Escribe tu pedido')).toBeVisible();
  await expect(page.getByLabel('Escribe tu pedido')).toHaveValue('Agregar observación de entrega');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Cotización', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cotización', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('Escribe tu pedido')).toBeHidden();
  await page.screenshot({ path: 'test-results/cotizador-mobile.png' });
});

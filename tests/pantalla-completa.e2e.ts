import { test, expect, type Page } from '@playwright/test';
import { iniciarSesion } from './login-e2e';

/** El documento no es más alto que la ventana: el cotizador se ve completo sin desplazar la página. */
async function sinScrollDePagina(page: Page) {
  const { alto, ventana } = await page.evaluate(() => ({
    alto: document.documentElement.scrollHeight,
    ventana: window.innerHeight,
  }));
  expect(alto).toBeLessThanOrEqual(ventana);
}

test('el cotizador cabe en la ventana en todos sus estados', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso');
  const enviar = async (texto: string) => {
    await page.getByLabel('Escribe tu pedido').fill(texto);
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.getByRole('button', { name: 'Enviar mensaje' })).toBeDisabled();
  };

  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await sinScrollDePagina(page);

  await enviar('3 Huilo Huilo oregón 80×210 para Juan Pérez, Temuco');
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await enviar('agrega marcos de oregón');
  await enviar('3 de 2x4 de 2,1');
  await expect(panel.getByText('MAR-O-2X4-B', { exact: true })).toBeVisible();
  // Acciones y totales siguen a la vista con varios ítems.
  await sinScrollDePagina(page);
  await expect(panel.getByRole('button', { name: 'Emitir y generar PDF', exact: true })).toBeInViewport();
  await expect(page.getByTestId('total')).toBeInViewport();
  await page.screenshot({ path: 'test-results/pantalla-completa-borrador.png' });

  await panel.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Emitir la cotización' })
    .getByRole('button', { name: 'Emitir y generar PDF' })
    .click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(/^N° \d+$/);
  await sinScrollDePagina(page);

  await page.getByRole('button', { name: 'Aprobar y generar nota de pedido' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Aprobar y generar nota' }).click();
  await expect(panel.locator('.status.aprobada').first()).toBeVisible();
  await sinScrollDePagina(page);
  await expect(panel.getByRole('button', { name: 'Descargar nota de pedido' })).toBeInViewport();
  await page.screenshot({ path: 'test-results/pantalla-completa-aprobada.png' });

  for (const [width, height] of [
    [1280, 720],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await sinScrollDePagina(page);
    await expect(page.getByTestId('total')).toBeInViewport();
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: 'test-results/pantalla-completa-720.png' });
});

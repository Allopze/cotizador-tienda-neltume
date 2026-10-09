import { test, expect } from '@playwright/test';
import { iniciarSesion } from './login-e2e';

test('un pedido fuera de catálogo queda pendiente y se cotiza como especial con el precio indicado', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso');
  await page.getByLabel('Escribe tu pedido').fill('1 Huilo Huilo oregón 1,90 x 2,20, pedido especial');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  // 1,90 m no existe en el catálogo: queda pendiente y la respuesta explica cómo cotizarlo.
  await expect(
    page.getByTestId('conversacion').getByText(/Si es un pedido especial, escribe su precio/),
  ).toBeVisible();
  await expect(panel.getByText('Incompleto · no suma al total')).toBeVisible();
  await page.screenshot({ path: 'test-results/pedido-especial-pendiente.png', fullPage: true });

  await panel.getByRole('button', { name: /cotizar como especial/i }).click();
  const precio = panel.getByLabel(/precio neto para cotizar como especial/i);
  await precio.fill('0');
  await precio.press('Enter');
  await expect(panel.getByRole('alert')).toContainText('precio unitario neto');
  await precio.fill('450.000');
  await precio.press('Enter');

  await expect(panel.getByText(/Personalizado · fuera de catálogo/)).toBeVisible();
  await expect(panel.getByText('Incompleto · no suma al total')).toHaveCount(0);
  await expect(panel.locator('tr[id^="producto-"]').first().locator('.celda-total')).toContainText(
    '$450.000',
  );
  // El costo de fábrica (opcional) es lo que usará la nota de pedido; sin él, la línea va «Por definir».
  await panel.locator('.item-details > summary').first().click();
  const costo = panel.getByRole('button', { name: /editar costo de fábrica/i });
  await expect(costo).toContainText('Por definir');
  await costo.click();
  await panel.getByLabel('Costo de fábrica (nota de pedido)').fill('300.000');
  await panel.getByLabel('Costo de fábrica (nota de pedido)').press('Enter');
  await expect(panel.getByRole('button', { name: /editar costo de fábrica/i })).toContainText('$300.000');
  // El precio al cliente no cambia.
  await expect(panel.locator('tr[id^="producto-"]').first().locator('.celda-total')).toContainText(
    '$450.000',
  );
  await page.screenshot({ path: 'test-results/pedido-especial.png', fullPage: true });
});

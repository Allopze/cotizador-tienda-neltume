import { test, expect } from '@playwright/test';
import { iniciarSesion } from './login-e2e';

const pesosEnTexto = (texto: string | null) => Number((texto ?? '').replace(/\D/g, ''));

test('descuento especial por ítem: se aplica a un solo producto, se ve el precio original y se quita', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso');
  const enviar = async (texto: string) => {
    await page.getByLabel('Escribe tu pedido').fill(texto);
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.getByRole('button', { name: 'Enviar mensaje' })).toBeDisabled();
  };
  await enviar('3 Huilo Huilo oregón 80×210 para Juan Pérez, Temuco');
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await enviar('agrega marcos de oregón');
  await enviar('3 de 2x4 de 2,1');
  await expect(panel.getByText('MAR-O-2X4-B', { exact: true })).toBeVisible();

  const filas = panel.locator('tr[id^="producto-"]');
  const totalLinea = (i: number) => filas.nth(i).locator('.celda-total');
  const totalPuerta = pesosEnTexto(await totalLinea(0).textContent());
  const totalMarco = pesosEnTexto(await totalLinea(1).textContent());
  const totalCotizacion = pesosEnTexto(await page.getByTestId('total').textContent());
  await expect(page.getByTestId('ahorro-items')).toHaveCount(0);

  // 15 % solo a la puerta.
  await panel.locator('.item-details > summary').first().click();
  const descuento = panel.getByTestId('descuento-item-0');
  await descuento.getByLabel('Descuento especial', { exact: true }).fill('15');
  await descuento.getByLabel('Descuento especial', { exact: true }).press('Enter');
  // El descuento es por unidad (3 puertas), redondeado al peso.
  const ahorro = 3 * Math.round((totalPuerta / 3) * 0.15);
  await expect(page.getByTestId('ahorro-items')).toHaveText(`−$${ahorro.toLocaleString('es-CL')}`);
  await expect(totalLinea(0)).toContainText(`$${(totalPuerta - ahorro).toLocaleString('es-CL')}`);
  // El precio original queda visible (tachado) en el unitario y en el total de la línea.
  await expect(filas.nth(0).locator('s.precio-original')).toHaveCount(2);
  await expect(filas.nth(0).locator('.precio-descuento')).toBeVisible();
  await expect(descuento).toContainText('Precio original');
  await expect(descuento).toContainText('Ahorro');
  // El marco no cambia.
  await expect(totalLinea(1)).toHaveText(`$${totalMarco.toLocaleString('es-CL')}`);
  await expect(filas.nth(1).locator('s.precio-original')).toHaveCount(0);
  await expect(page.getByTestId('subtotal-original')).toBeVisible();
  expect(pesosEnTexto(await page.getByTestId('total').textContent())).toBeLessThan(totalCotizacion);
  await page.screenshot({ path: 'test-results/descuento-item-escritorio.png', fullPage: true });

  // Validación sin enviar: más de 100 %.
  await descuento.getByLabel('Descuento especial', { exact: true }).fill('120');
  await descuento.getByLabel('Descuento especial', { exact: true }).press('Enter');
  await expect(descuento.getByRole('alert')).toContainText('100 %');

  // Persiste: recargar vuelve al inicio y el borrador, abierto desde el historial, conserva el descuento.
  await page.reload();
  await page.getByRole('link', { name: 'Historial' }).click();
  await page.locator('.history-fila').first().click();
  await expect(page.getByTestId('ahorro-items')).toHaveText(`−$${ahorro.toLocaleString('es-CL')}`);
  await expect(filas.nth(0).locator('s.precio-original')).toHaveCount(2);

  // En teléfono, la tarjeta del ítem conserva precio original y rebajado sin desbordar.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/descuento-item-movil.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });

  // Quitar el descuento devuelve el precio normal.
  await panel.locator('.item-details > summary').first().click();
  await panel.getByTestId('descuento-item-0').getByRole('button', { name: 'Quitar descuento' }).click();
  await expect(page.getByTestId('ahorro-items')).toHaveCount(0);
  await expect(totalLinea(0)).toHaveText(`$${totalPuerta.toLocaleString('es-CL')}`);
  await expect(page.getByTestId('total')).toHaveText(`$${totalCotizacion.toLocaleString('es-CL')}`);
});

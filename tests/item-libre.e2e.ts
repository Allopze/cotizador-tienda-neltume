import { test, expect } from './fixtures-e2e';
import { iniciarSesion } from './login-e2e';

// Ítem libre: cualquier cosa que no es carpintería (una bebida, la instalación) se cotiza con su nombre y precio,
// sin madera, medidas ni fábrica. Se pide por chat o se agrega a mano; no se crea en el catálogo.

test('por chat, «una cocacola bien fría de 593ml por $1.490» queda cotizada como ítem libre', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso');
  await page.getByLabel('Escribe tu pedido').fill('añade a la cotización una cocacola bien fría de 593ml por $1.490');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(page.getByTestId('conversacion').getByText(/como ítem libre a \$1\.490 sin IVA c\/u/)).toBeVisible();
  await expect(page.getByTestId('conversacion').getByText(/faltan ceros/)).toHaveCount(0);
  await expect(panel.getByText('Ítem libre · no va a fábrica')).toBeVisible();
  await expect(panel.getByText('Incompleto · no suma al total')).toHaveCount(0);
  await expect(panel.locator('tr[id^="producto-"]').first().locator('.celda-total')).toContainText('$1.490');
  // Sin madera ni medidas que editar.
  await panel.locator('.item-details > summary').first().click();
  await expect(panel.getByText('Agregar madera')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /editar costo de fábrica/i })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/item-libre-chat.png', fullPage: true });
});

test('a mano, «Otro (ítem libre)» pide solo nombre, cantidad y precio', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso');
  await page.getByRole('button', { name: /Agregar producto/ }).first().click();
  await page.getByRole('dialog', { name: 'Agregar producto' }).getByRole('button', { name: 'Crear producto personalizado' }).click();
  const form = page.getByRole('dialog', { name: 'Producto personalizado' });
  await form.getByLabel('Nombre del producto').fill('Instalación');
  await form.getByRole('combobox', { name: 'Tipo de producto' }).click();
  await form.getByRole('option', { name: /Otro \(ítem libre/ }).click();
  await expect(form.getByLabel('Madera')).toHaveCount(0);
  await expect(form.getByLabel('Ancho (m) · opcional')).toHaveCount(0);
  await form.getByLabel('Cantidad').fill('1');
  await form.getByLabel('Precio unitario sin IVA ($)').fill('45.000');
  await form.getByRole('button', { name: 'Agregar al pedido' }).click();
  await expect(form).toHaveCount(0);
  await expect(panel.getByText('Ítem libre · no va a fábrica')).toBeVisible();
  await expect(panel.getByText('Incompleto · no suma al total')).toHaveCount(0);
  await expect(panel.locator('tr[id^="producto-"]').first().locator('.celda-total')).toContainText('$45.000');
});

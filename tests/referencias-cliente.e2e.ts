import { test, expect } from './fixtures-e2e';
import { iniciarSesion } from './login-e2e';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNk+M/AwMDAxMDAwMDAAAAhAQIBxPvAiQAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

test('producto personalizado con referencias del cliente por ítem', async ({ page }) => {
  const errores: string[] = [];
  page.on('pageerror', (error) => errores.push(error.message));
  await iniciarSesion(page);
  const nueva = page.getByRole('button', { name: 'Nueva cotización' });
  if (await nueva.count()) await nueva.click();

  // Ítem 1: producto normal del catálogo, sin referencias.
  await page.getByRole('button', { name: /Agregar producto/ }).first().click();
  const dialogo = page.getByRole('dialog', { name: 'Agregar producto' });
  await dialogo.getByLabel('Busca por modelo, madera o código').fill('HUIL-O-3-B');
  await dialogo.locator('.producto-resultados button').first().click();
  await dialogo.getByLabel('La medida corresponde a').selectOption('hoja');
  await dialogo.getByRole('button', { name: 'Agregar al pedido' }).click();
  await expect(dialogo).toHaveCount(0);

  // Ítem 2: producto personalizado con la foto que mandó el cliente.
  await page.getByRole('button', { name: /Agregar producto/ }).first().click();
  await page.getByRole('dialog', { name: 'Agregar producto' }).getByRole('button', { name: 'Crear producto personalizado' }).click();
  const form = page.getByRole('dialog', { name: 'Producto personalizado' });
  await form.getByLabel('Nombre del producto').fill('Puerta según diseño cliente');
  await form.getByLabel('Madera').fill('Roble');
  await form.getByLabel('Cantidad').fill('2');
  await form.getByLabel('Ancho (m) · opcional').fill('80');
  await form.getByLabel('Alto (m) · opcional').fill('2,10');
  await form.getByLabel('Precio unitario sin IVA ($)').fill('345.000');
  await form.getByLabel('Descripción para el documento · opcional').fill('Puerta sólida de roble según fotografía adjunta.');
  // Una subida lenta no deja agregar el producto a medias: quedaría sin su referencia y sin aviso.
  await page.route('**/api/referencias', async (ruta) => {
    await new Promise((listo) => setTimeout(listo, 800));
    await ruta.continue();
  });
  await form.locator('input[type=file]').setInputFiles({ name: 'foto-whatsapp.png', mimeType: 'image/png', buffer: PNG });
  await expect(form.getByRole('button', { name: 'Subiendo referencia…' })).toBeDisabled();
  // «Subiendo foto-whatsapp.png…» también contiene el nombre: se espera la tarjeta ya subida.
  await expect(form.locator('.referencia-tarjeta')).toHaveCount(1);
  await expect(form.getByRole('button', { name: 'Agregar al pedido' })).toBeEnabled();
  await page.unroute('**/api/referencias');
  await page.screenshot({ path: 'test-results/referencias-formulario.png' });
  await form.getByRole('button', { name: 'Agregar al pedido' }).click();
  await expect(form).toHaveCount(0);

  const panel = page.getByLabel('Cotización en curso');
  const item1 = panel.locator('#producto-0');
  const item2 = panel.locator('#producto-1');
  await expect(item2.getByText('Puerta según diseño cliente', { exact: true })).toBeVisible();
  await expect(item2.getByText('Personalizado · fuera de catálogo · Roble')).toBeVisible();
  await expect(item2.locator('.referencia-tarjeta')).toHaveCount(1);
  await expect(item2.locator('.referencia-miniatura img')).toBeVisible();
  // El ítem del catálogo solo ofrece la acción compacta.
  await expect(item1.locator('.referencia-tarjeta')).toHaveCount(0);
  await expect(item1.getByRole('button', { name: /Agregar imagen o dibujo de referencia/ })).toHaveText('+ Agregar referencia');
  await expect(panel.locator('#producto-1 .celda-total')).toHaveText('$690.000');

  // Un PDF técnico en el mismo ítem; luego se cambia la cantidad sin perder las referencias.
  await item2.locator('input[type=file]').setInputFiles({ name: 'croquis-medidas.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(item2.locator('.referencia-tarjeta')).toHaveCount(2);
  await expect(item2.getByText('Documento PDF', { exact: false })).toBeVisible();
  await item2.locator('.celda-cantidad button').first().click();
  await item2.locator('.celda-cantidad input').fill('3');
  await item2.locator('.celda-cantidad input').press('Enter');
  await expect(panel.locator('#producto-1 .celda-total')).toHaveText('$1.035.000');
  await expect(item2.locator('.referencia-tarjeta')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/referencias-panel.png', fullPage: true });

  // Se conservan al volver a abrir la cotización.
  await page.goto('/historial');
  await page.getByRole('link', { name: /Puerta según diseño cliente/ }).first().click();
  await expect(panel.locator('#producto-1').getByText('Puerta según diseño cliente', { exact: true })).toBeVisible();
  await expect(panel.locator('#producto-1 .referencia-tarjeta')).toHaveCount(2);
  await expect(panel.locator('#producto-0 .referencia-tarjeta')).toHaveCount(0);

  // Ver la imagen en grande.
  await panel.locator('#producto-1').getByRole('button', { name: 'Ver foto-whatsapp.png' }).last().click();
  const visor = page.getByRole('dialog', { name: 'foto-whatsapp.png' });
  await expect(visor.locator('img.referencia-vista')).toBeVisible();
  await visor.press('Escape');
  await expect(visor).toHaveCount(0);

  // Reemplazar el PDF por otra imagen.
  const selector = page.waitForEvent('filechooser');
  await panel.locator('#producto-1').getByRole('button', { name: /Reemplazar croquis-medidas\.pdf/ }).click();
  await (await selector).setFiles({ name: 'referencia-frontal.png', mimeType: 'image/png', buffer: PNG_2 });
  await expect(panel.locator('#producto-1').getByText('referencia-frontal.png')).toBeVisible();
  await expect(panel.locator('#producto-1').getByText('croquis-medidas.pdf')).toHaveCount(0);

  // Eliminar pide confirmación.
  await panel.locator('#producto-1').getByRole('button', { name: /Eliminar referencia-frontal\.png/ }).click();
  const confirmar = page.getByRole('alertdialog', { name: 'Eliminar referencia' });
  await confirmar.getByRole('button', { name: 'Eliminar referencia' }).click();
  await expect(panel.locator('#producto-1 .referencia-tarjeta')).toHaveCount(1);
  await expect(panel.locator('#producto-1').getByText('foto-whatsapp.png')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Cotización', exact: true }).click();
  await panel.locator('#producto-1').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/referencias-movil.png' });
  expect(errores).toEqual([]);
});

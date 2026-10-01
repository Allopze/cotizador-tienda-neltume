import { test, expect } from '@playwright/test';
import { iniciarSesion } from './login-e2e';

test('agregar un producto a mano en la misma pantalla que el alta asistida', async ({ page }) => {
  await iniciarSesion(page);
  await page.getByRole('link', { name: 'Catálogo', exact: true }).click();
  await page.getByRole('link', { name: 'Agregar producto' }).click();

  // Las dos vías conviven: la descripción asistida y el formulario.
  await expect(page.getByLabel('Describe el producto')).toBeVisible();
  const datos = page.getByRole('form', { name: 'DATOS DEL PRODUCTO' });
  await datos.getByRole('combobox', { name: 'Familia' }).click();
  await datos.getByRole('option', { name: 'Puerta' }).click();
  await datos.getByLabel('Modelo').fill('Roble');
  await datos.getByLabel('Madera').fill('Raulí');
  await datos.getByLabel('Ancho mínimo').fill('80');
  await datos.getByLabel('Ancho máximo').fill('85');
  await datos.getByLabel('Alto').fill('2,10');
  await datos.getByLabel('Precio base neto').fill('145.000');
  await datos.getByRole('button', { name: 'Revisar propuesta' }).click();

  const revision = page.locator('.catalog-preview');
  await expect(revision).toContainText('Roble Raulí 0,8 a 0,85 m × 2,1 m');
  await expect(revision).toContainText('$145.000');
  await page.screenshot({ path: 'test-results/alta-manual.png', fullPage: true });

  // Cambiar un dato invalida la revisión: hay que volver a revisar.
  await datos.getByLabel('Precio base neto').fill('150.000');
  await expect(revision).toHaveCount(0);
  await datos.getByRole('button', { name: 'Revisar propuesta' }).click();
  await expect(revision).toContainText('$150.000');

  await revision.getByRole('button', { name: 'Confirmar y guardar' }).click();
  await page
    .getByRole('alertdialog', { name: 'Agregar al catálogo' })
    .getByRole('button', { name: 'Agregar al catálogo' })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'Producto agregado' })).toBeVisible();

  // Queda disponible en la consulta del catálogo.
  await page.getByRole('link', { name: 'Consultar' }).click();
  await page.getByLabel('Buscar en el catálogo').fill('roble rauli');
  await expect(page.getByRole('main')).toContainText('Roble Raulí');
});

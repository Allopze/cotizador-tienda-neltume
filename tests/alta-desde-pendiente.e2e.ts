import { test, expect } from '@playwright/test';
import { iniciarSesion } from './login-e2e';

test('agrega al catálogo desde un pendiente con el formulario completado y cotiza el ítem', async ({ page }) => {
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso');
  await page.getByLabel('Escribe tu pedido').fill('3 Huilo Huilo oregón 80×210 para Juan Pérez, Temuco');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await panel.getByLabel(/^Editar detalles del ítem 1:/).click();
  const editor = panel.getByRole('group', { name: 'Datos editables del ítem 1', exact: true });

  // Un dato ausente se completa en el pedido; todavía no corresponde crear un producto.
  await editor.getByRole('button', { name: /^Editar madera/ }).click();
  await editor.getByLabel('Madera', { exact: true }).fill('');
  await editor.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(panel.getByText('Incompleto · no suma al total')).toBeVisible();
  await expect(editor.getByRole('group', { name: /^Madera para el ítem 1/ })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Agregar al catálogo', exact: true })).toHaveCount(0);

  // Una madera inexistente conserva las medidas y permite dar de alta ese producto.
  await editor.getByRole('button', { name: /^Editar madera/ }).click();
  await editor.getByLabel('Madera', { exact: true }).fill('Roble pendiente e2e');
  await editor.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Agregar al catálogo', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Agregar al catálogo', exact: true }).click();

  const dialogo = page.getByRole('dialog', { name: 'Agregar al catálogo', exact: true });
  const datos = dialogo.getByRole('form', { name: 'DATOS DEL PRODUCTO' });
  await expect(datos.getByRole('combobox', { name: 'Familia' })).toContainText('Puerta');
  await expect(datos.getByLabel('Modelo', { exact: true })).toHaveValue('Huilo Huilo');
  await expect(datos.getByLabel('Madera', { exact: true })).toHaveValue('Roble pendiente e2e');
  await expect(datos.getByLabel('Ancho mínimo')).toHaveValue('0,8');
  await expect(datos.getByLabel('Ancho máximo')).toHaveValue('0,8');
  await expect(datos.getByLabel('Alto', { exact: true })).toHaveValue('2,1');
  await expect(datos.getByLabel('Precio base neto')).toHaveValue('');
  await expect(datos.getByLabel('Precio base neto')).toBeFocused();
  await datos.getByLabel('Precio base neto').fill('145.000');
  await datos.getByRole('button', { name: 'Revisar propuesta' }).click();

  const revision = dialogo.locator('.catalog-preview');
  await expect(revision).toContainText('Huilo Huilo Roble Pendiente E2E');
  await expect(revision).toContainText('$145.000');
  const codigo = (await revision.locator('dl > div').filter({ hasText: 'Código interno asignado' }).locator('dd').innerText()).trim();
  const precio = (await revision.locator('dl > div').filter({ hasText: 'Unitario en cotizaciones' }).locator('dd').innerText()).trim();
  await revision.getByRole('button', { name: 'Confirmar y guardar' }).click();
  await page.getByRole('alertdialog', { name: 'Agregar al catálogo' })
    .getByRole('button', { name: 'Agregar al catálogo', exact: true }).click();

  await expect(dialogo).toHaveCount(0);
  await expect(panel.getByText('Incompleto · no suma al total')).toHaveCount(0);
  await expect(panel.locator('#producto-0').getByText(codigo, { exact: true })).toBeVisible();
  await expect(panel.locator('#producto-0').getByRole('button', { name: 'Editar precio unitario', exact: true })).toContainText(precio);
  await expect(page.getByTestId('total')).not.toHaveText('$0');

  // La actividad se consulta desde el historial del borrador, sin emitirlo.
  await page.getByRole('link', { name: 'Historial', exact: true }).click();
  const fila = page.locator('.history-list > li').filter({ hasText: /roble pendiente e2e/i });
  await fila.getByText('Actividad', { exact: true }).click();
  await expect(fila.locator('.actividad')).toContainText(`Ítem 1 cotizado con ${codigo}, agregado al catálogo`);
  await fila.locator('.history-fila').click();

  // Deja el borrador fuera del historial para las demás pruebas.
  await panel.getByRole('button', { name: 'Más acciones' }).click();
  await panel.getByRole('button', { name: 'Eliminar borrador' }).click();
  await page.getByRole('alertdialog', { name: 'Eliminar borrador' })
    .getByRole('button', { name: 'Eliminar borrador', exact: true }).click();
  await expect(page.getByLabel('Vista previa de la cotización').getByRole('heading', { level: 2 })).toHaveText('Vista previa');
});

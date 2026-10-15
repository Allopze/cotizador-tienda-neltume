import { test, expect } from './fixtures-e2e';
import { iniciarSesion } from './login-e2e';

// No emite nada: no mueve los correlativos que esperan otras pruebas, y al final el borrador vuelve a la papelera.
test('eliminar un borrador lo deja en la papelera y «Deshacer» lo restaura con su conversación', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso');
  const conversacion = page.getByTestId('conversacion');
  const pedido = '3 Huilo Huilo oregón 80×210 para Juan Pérez, Temuco';

  await page.getByLabel('Escribe tu pedido').fill(pedido);
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await expect(conversacion).toContainText(pedido);
  const eliminar = async () => {
    await panel.getByRole('button', { name: 'Más acciones' }).click();
    await panel.getByRole('button', { name: 'Eliminar borrador' }).click();
    const dialogo = page.getByRole('alertdialog', { name: 'Eliminar borrador' });
    // Ya no dice que no se puede deshacer: el borrador pasa a la papelera.
    await expect(dialogo).toContainText('pasa a la papelera');
    await expect(dialogo).not.toContainText('no se puede deshacer');
    await dialogo.getByRole('button', { name: 'Eliminar borrador' }).click();
    await expect(
      page.getByLabel('Vista previa de la cotización').getByRole('heading', { level: 2 }),
    ).toHaveText('Vista previa');
  };
  await eliminar();
  await expect(conversacion).not.toContainText(pedido);

  // El aviso ofrece deshacer y no se cierra solo (los de éxito sin acción duran 4 s).
  const aviso = page.getByRole('status').filter({ hasText: 'Borrador eliminado: quedó en la papelera.' });
  await expect(aviso).toBeVisible();
  await page.waitForTimeout(4500);
  await expect(aviso).toBeVisible();
  // Con teclado: el botón del aviso es alcanzable y se activa con Enter.
  await aviso.getByRole('button', { name: 'Deshacer' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Borrador restaurado.' })).toBeVisible();
  await expect(aviso).toHaveCount(0);
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Sin número');
  await expect(conversacion).toContainText(pedido);

  // Restaurado se edita como cualquier borrador; al terminar vuelve a la papelera.
  await eliminar();
});

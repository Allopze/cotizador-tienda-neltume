import { test, expect, type Page } from './fixtures-e2e';
import { iniciarSesion } from './login-e2e';

const sinScrollHorizontal = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

test('la guía «Cómo funciona» exige sesión', async ({ page }) => {
  await page.goto('/ayuda');
  await expect(page).toHaveURL(/\/login$/);
});

test('guía «Cómo funciona»: desde la pantalla vacía y el menú de cuenta, en 390 px y con teclado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await iniciarSesion(page);

  // Desde la pantalla vacía del cotizador.
  const enlaceInicio = page.getByRole('link', { name: 'Mira cómo funciona el cotizador' });
  await expect(enlaceInicio).toBeVisible();
  await enlaceInicio.click();
  await expect(page).toHaveURL(/\/ayuda$/);
  await expect(page.getByRole('heading', { name: 'Cómo funciona', level: 1 })).toBeVisible();
  const guia = page.getByRole('main');
  for (const titulo of ['Los pasos de una cotización', 'Qué significa cada estado', 'Cómo deshacer', 'A quién pedir ayuda'])
    await expect(guia.getByRole('heading', { name: titulo, level: 2 })).toBeVisible();
  // El ciclo completo, con los nombres de los botones tal como se ven.
  for (const paso of ['Emitir y generar PDF', 'Registrar aprobación del cliente', 'Registrar pago', 'Generar notas de pedido', 'Repartir entre fábricas', 'Cambiar N°', 'Registrar despacho', 'Marcar como facturada'])
    await expect(guia).toContainText(`«${paso}»`);
  await expect(guia).toContainText('50 %');
  for (const estado of ['Borrador', 'Emitida', 'Vencida', 'Aprobada', 'Reemplazada', 'Anulada'])
    await expect(guia.locator('dt').getByText(estado, { exact: true })).toBeVisible();
  for (const deshacer of ['Papelera', 'Deshacer aprobación', 'Volver al paso anterior'])
    await expect(guia).toContainText(deshacer);
  await sinScrollHorizontal(page);

  // El índice se usa con el teclado.
  await page.getByRole('link', { name: 'Qué significa cada estado' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/ayuda#ayuda-estados$/);

  // Desde el menú de cuenta (en el teléfono, plegado bajo «Cuenta»), también con el teclado.
  await page.goto('/historial');
  const cuenta = page.getByRole('button', { name: 'Cuenta' });
  await cuenta.focus();
  await page.keyboard.press('Enter');
  const enlaceMenu = page.getByRole('link', { name: 'Cómo funciona', exact: true });
  await expect(enlaceMenu).toBeVisible();
  await enlaceMenu.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/ayuda$/);
  // En la guía, ninguna pantalla de la navegación queda marcada; el enlace de la cuenta sí (el menú del
  // teléfono vuelve a quedar plegado al llegar).
  await expect(page.getByRole('navigation', { name: 'Pantallas' }).locator('[aria-current="page"]')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Cómo funciona', exact: true, includeHidden: true }),
  ).toHaveAttribute('aria-current', 'page');

  // En escritorio el enlace está a la vista en la cabecera, sin desbordarla.
  for (const width of [820, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('banner').getByRole('link', { name: 'Cómo funciona', exact: true })).toBeVisible();
    await sinScrollHorizontal(page);
  }
});

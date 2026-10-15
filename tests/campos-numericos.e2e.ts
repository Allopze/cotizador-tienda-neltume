import { test, expect, type Page } from './fixtures-e2e';
import { crearBorrador } from './api-e2e';
import { iniciarSesion } from './login-e2e';

// Los campos que siguen siendo numéricos (`type="number"`): la cantidad de la línea, la del diálogo «Agregar
// producto» y la ganancia de la línea. Corre en Chrome (proyecto «flujos») y además en Firefox y WebKit (proyectos
// «firefox» y «webkit» de playwright.config.ts, con el navegador en inglés), porque cada motor trata distinto lo
// escrito en esos campos y su validación nativa. Los errores deben llegar con el mensaje propio en español, junto al
// campo, y nunca con la burbuja del navegador (en su idioma). No emite nada: no mueve los correlativos.

const MENSAJE_CANTIDAD = 'La cantidad debe ser un número entero entre 1 y 10.000.';

async function abrirBorrador(page: Page, cliente: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await iniciarSesion(page);
  const borrador = await crearBorrador(page.request, { cliente });
  await page.goto(`/?cotizacion=${encodeURIComponent(borrador.id)}`);
  const panel = page.getByLabel('Cotización en curso');
  await expect(panel.getByText('HUIL-O-3-B', { exact: true }).first()).toBeVisible();
  return panel;
}

test('la página se declara en español y los formularios explican sus errores en español', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-CL');
  // El login valida por su cuenta (sin la burbuja del navegador): el mensaje propio queda junto al campo.
  await page.getByRole('button', { name: 'Ingresar' }).click();
  const correo = page.getByLabel('Correo electrónico');
  await expect(correo).toHaveAttribute('aria-invalid', 'true');
  await expect(correo).toHaveAccessibleDescription(/correo/i);
  await expect(correo).toBeFocused();
});

test('cantidad de la línea: fuera de rango se explica en español junto al campo y un entero se guarda', async ({ page }) => {
  const panel = await abrirBorrador(page, 'Cliente Campos Numéricos');
  const editar = panel.getByRole('button', { name: /^Editar cantidad de/ }).first();
  await expect(editar).toContainText('1');
  for (const invalido of ['0', '10001']) {
    await editar.click();
    const campo = panel.getByLabel(/^Cantidad de/).first();
    await expect(campo).toHaveAttribute('type', 'number');
    await campo.fill(invalido);
    await campo.press('Enter');
    // Antes, el navegador bloqueaba el envío con su burbuja («Value must be…» en un navegador en inglés) y el
    // mensaje propio nunca aparecía.
    await expect(panel.getByRole('alert')).toHaveText(MENSAJE_CANTIDAD);
    await expect(campo).toHaveAttribute('aria-invalid', 'true');
    await expect(campo).toBeFocused();
    await campo.press('Escape');
    await expect(editar).toContainText('1');
  }
  await editar.click();
  const campo = panel.getByLabel(/^Cantidad de/).first();
  await campo.fill('4');
  await campo.press('Enter');
  await expect(editar).toContainText('4');
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('«Agregar producto»: la cantidad numérica se valida en español y un entero agrega la línea', async ({ page }) => {
  const panel = await abrirBorrador(page, 'Cliente Agregar Numérico');
  await panel.getByRole('button', { name: /Agregar producto/ }).first().click();
  const dialogo = page.getByRole('dialog', { name: 'Agregar producto' });
  await dialogo.getByLabel('Busca por modelo, madera o código').fill('HUIL-O-3-B');
  await dialogo.locator('.producto-resultados button').first().click();
  const cantidad = dialogo.getByLabel('Cantidad', { exact: true });
  await expect(cantidad).toHaveAttribute('type', 'number');
  await dialogo.getByLabel('Ancho (m)').fill('0,8');
  await dialogo.getByLabel('Alto (m)').fill('2,1');
  await cantidad.fill('0');
  await dialogo.getByRole('button', { name: 'Agregar al pedido' }).click();
  await expect(dialogo.getByRole('alert')).toHaveText(MENSAJE_CANTIDAD);
  await cantidad.fill('2');
  await dialogo.getByRole('button', { name: 'Agregar al pedido' }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /^Editar cantidad de/ })).toHaveCount(2);
  await expect(panel.getByRole('button', { name: /^Editar cantidad de/ }).nth(1)).toContainText('2');
});

test('ganancia de la línea: fuera de rango avisa sin guardar y un valor válido se aplica', async ({ page }) => {
  const panel = await abrirBorrador(page, 'Cliente Ganancia Numérica');
  await panel.locator('.item-details > summary').first().click();
  const margen = panel.getByLabel('Ganancia de la línea (%)');
  await expect(margen).toHaveAttribute('type', 'number');
  await margen.fill('700');
  await margen.press('Enter');
  await expect(panel.getByRole('alert')).toContainText('entre -50 y 500');
  await margen.fill('30');
  await margen.press('Enter');
  await expect(
    panel.getByText('Ganancia estándar: 85 % · Ganancia aplicada: 30 % — cambiada a mano en esta línea', { exact: true }),
  ).toBeVisible();
  await expect(margen).toHaveValue('30');
});

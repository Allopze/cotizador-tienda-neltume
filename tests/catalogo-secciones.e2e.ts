import { test, expect, type Page } from '@playwright/test';
import { ADMIN_E2E, iniciarSesion } from './login-e2e';

const irA = async (page: Page, seccion: string) => {
  await page.getByRole('navigation', { name: 'Secciones del catálogo' }).getByRole('link', { name: seccion }).click();
};

test.beforeEach(async ({ page }) => {
  await iniciarSesion(page, ADMIN_E2E);
});

test('consultar: el ejemplo del buscador encuentra productos y la medida se lee en cm o con punto', async ({ page }) => {
  await page.goto('/catalogo');
  const buscar = page.getByLabel('Buscar en el catálogo');
  const ejemplo = (await buscar.getAttribute('placeholder'))!.replace(/^Ej\.:\s*/, '');
  for (const q of [ejemplo, 'molco 0.80', 'molco oregon 80']) {
    await buscar.fill(q);
    await expect(page.getByRole('main')).toContainText(/\d+ productos?\./);
    await expect(page.getByRole('main')).not.toContainText('Sin productos que coincidan');
  }
});

test('cambiar de sección mueve el foco al título y nombra la sección en la pestaña', async ({ page }) => {
  await page.goto('/catalogo');
  await irA(page, 'Importar');
  await expect(page.getByRole('heading', { level: 2, name: 'Importar catálogo desde Excel' })).toBeFocused();
  await expect(page).toHaveTitle('Neltume · Catálogo · Importar');
});

test('gestionar: el buscador conserva el foco y lo escrito; editar abre un diálogo y guarda', async ({ page }) => {
  await page.goto('/catalogo?seccion=manuales');
  const buscar = page.getByRole('searchbox', { name: /Buscar por código/ });
  await buscar.click();
  await page.keyboard.type('MOL-O-1-A', { delay: 40 });
  await expect(buscar).toBeFocused();
  await expect(buscar).toHaveValue('MOL-O-1-A');

  const fila = page.getByRole('row').filter({ hasText: 'MOL-O-1-A ·' });
  // Precio sin decimales: «$101.557», nunca «$101.557,273».
  await expect(fila.getByRole('cell').nth(2)).toHaveText(/^\$\d{1,3}(\.\d{3})*$/);

  await fila.getByRole('button', { name: 'Editar MOL-O-1-A' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toContainText('se reemplaza la próxima vez que importes');
  const tipo = dialogo.getByLabel('Tipo (opcional)');
  const original = await tipo.inputValue();
  await tipo.fill('PUERTA DE PRUEBA');
  await dialogo.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Cambios guardados en MOL-O-1-A' })).toBeVisible();
  // El foco vuelve al botón que abrió el editor.
  await expect(fila.getByRole('button', { name: 'Editar MOL-O-1-A' })).toBeFocused();

  // Se deja como estaba: otras pruebas cotizan este producto.
  await fila.getByRole('button', { name: 'Editar MOL-O-1-A' }).click();
  await dialogo.getByLabel('Tipo (opcional)').fill(original);
  await dialogo.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialogo).toHaveCount(0);

  // Validación junto al campo, sin ir al servidor.
  await fila.getByRole('button', { name: 'Editar MOL-O-1-A' }).click();
  await dialogo.getByLabel('Precio base neto').fill('');
  await dialogo.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(dialogo.getByLabel('Precio base neto')).toHaveAttribute('aria-invalid', 'true');
  await expect(dialogo.getByLabel('Precio base neto')).toBeFocused();
  await dialogo.getByRole('button', { name: 'Cancelar' }).click();
});

test('configuración: quitar una fila marca cambios sin guardar y se puede deshacer', async ({ page }) => {
  await page.goto('/catalogo?seccion=configuracion');
  const barra = page.locator('.config-barra');
  await expect(barra).toContainText('Sin cambios pendientes');
  await expect(barra.getByRole('button', { name: 'Guardar configuración' })).toBeDisabled();

  const maderas = page.getByRole('group', { name: 'Maderas' });
  const filas = maderas.locator('.config-editor-fila');
  const antes = await filas.count();
  const quitar = maderas.getByRole('button', { name: /^Quitar madera / }).first();
  const nombre = (await quitar.getAttribute('aria-label'))!.replace('Quitar madera ', '');
  await quitar.click();
  await expect(filas).toHaveCount(antes - 1);
  await expect(barra).toContainText('Hay cambios sin guardar');
  await expect(page.getByRole('link', { name: /Configuración \(cambios sin guardar\)/ })).toBeVisible();

  await page.getByRole('status').filter({ hasText: `Se quitó la madera ${nombre}` }).getByRole('button', { name: 'Deshacer' }).click();
  await expect(filas).toHaveCount(antes);
  await expect(filas.first().getByLabel('Nombre')).toHaveValue(nombre);
  await expect(barra).toContainText('Sin cambios pendientes');
});

test('configuración: duplicados se marcan en la fila antes de guardar', async ({ page }) => {
  await page.goto('/catalogo?seccion=configuracion');
  const maderas = page.getByRole('group', { name: 'Maderas' });
  const primera = await maderas.locator('.config-editor-fila').first().getByLabel('Nombre').inputValue();
  await maderas.locator('.config-editor-fila').nth(1).getByLabel('Nombre').fill(primera);
  await page.getByRole('button', { name: 'Guardar configuración' }).click();
  await expect(maderas.locator('.config-editor-fila').nth(1)).toContainText(`«${primera}» ya está en la fila 1.`);
  await expect(maderas.locator('.config-editor-fila').nth(1).getByLabel('Nombre')).toBeFocused();
  await page.getByRole('button', { name: 'Descartar cambios' }).click();
  await expect(page.locator('.config-barra')).toContainText('Sin cambios pendientes');
});

test('agregar: los datos que faltan se marcan en su campo', async ({ page }) => {
  await page.goto('/catalogo?seccion=agregar');
  await page.getByRole('button', { name: 'Revisar propuesta' }).click();
  const datos = page.getByRole('form', { name: 'DATOS DEL PRODUCTO' });
  await expect(datos.getByRole('combobox', { name: 'Familia' })).toBeFocused();
  await expect(datos.getByLabel('Modelo')).toHaveAttribute('aria-invalid', 'true');
  await expect(datos.getByLabel('Precio base neto')).toHaveAttribute('aria-invalid', 'true');
});

test('en móvil la pestaña activa queda a la vista', async ({ browser }) => {
  const contexto = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await contexto.newPage();
  await iniciarSesion(page, ADMIN_E2E);
  await page.goto('/catalogo?seccion=configuracion');
  const activa = page.getByRole('navigation', { name: 'Secciones del catálogo' }).getByRole('link', { name: 'Configuración' });
  await expect(activa).toBeInViewport({ ratio: 1 });
  expect((await activa.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await contexto.close();
});

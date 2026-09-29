import { test, expect } from '@playwright/test';
import { iniciarSesion } from './login-e2e';

// Corre después de flujo, gestion e historial (orden alfabético): el historial ya tiene varias filas.
test('cambiar de pantalla o de sección conserva el scroll, los filtros y lo escrito', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await iniciarSesion(page);
  const scrollY = () => page.evaluate(() => Math.round(window.scrollY));

  // Historial: búsqueda y scroll se recuperan al volver desde otra pantalla.
  await page.getByRole('link', { name: 'Historial' }).click();
  const buscar = page.getByLabel('Buscar cotizaciones');
  await buscar.fill('Juan');
  await expect(page.getByRole('heading', { name: 'Historial de cotizaciones' })).toBeVisible();
  await expect(page.locator('.history-fila').first()).toBeVisible();
  // La búsqueda se aplica con una espera: se mide cuando el listado filtrado ya está.
  await page.waitForTimeout(500);
  await expect(page.locator('section.history')).toHaveAttribute('aria-busy', 'false');
  // Tanto como permita el listado (depende de cuántas cotizaciones dejaron las pruebas anteriores).
  const objetivo = await page.evaluate(() =>
    Math.min(300, document.documentElement.scrollHeight - window.innerHeight),
  );
  expect(objetivo).toBeGreaterThan(100);
  await page.evaluate((y) => window.scrollTo(0, y), objetivo);
  await expect.poll(scrollY).toBe(objetivo);
  await page.waitForTimeout(100);
  // Abrir una cotización desde una fila visible (sin subir a la cabecera) y volver al historial.
  const fila = page.locator('.history-fila').nth(2);
  await expect(fila).toBeInViewport();
  await fila.click();
  await expect(page.getByLabel('Cotización en curso').getByRole('heading', { level: 2 })).toBeFocused();
  await page.getByRole('link', { name: 'Historial' }).click();
  await expect(buscar).toHaveValue('Juan');
  await expect.poll(scrollY).toBe(objetivo);

  // Catálogo: cambiar de sección no mueve la página ni borra la búsqueda o el borrador de alta.
  await page.getByRole('link', { name: 'Catálogo', exact: true }).click();
  const catalogo = page.getByLabel('Buscar en el catálogo');
  await catalogo.fill('HUIL-O-3-B');
  await page.evaluate(() => window.scrollTo(0, 120));
  await expect(page.getByRole('link', { name: 'Agregar producto' })).toBeInViewport();
  await page.getByRole('link', { name: 'Agregar producto' }).click();
  await expect(page).toHaveURL(/seccion=agregar/);
  await expect.poll(scrollY).toBe(120);
  await page.getByLabel('Describe el producto').fill('Puerta modelo Roble en raulí');
  await page.getByRole('link', { name: 'Consultar' }).click();
  await expect(catalogo).toHaveValue('HUIL-O-3-B');
  await page.getByRole('link', { name: 'Agregar producto' }).click();
  await expect(page.getByLabel('Describe el producto')).toHaveValue('Puerta modelo Roble en raulí');

  // Atrás vuelve a la sección anterior sin salir del catálogo.
  await page.goBack();
  await expect(page).toHaveURL(/\/catalogo$/);
  await expect(catalogo).toBeVisible();
  await expect.poll(scrollY).toBe(120);

  // La búsqueda del catálogo también sobrevive a salir de la pantalla y volver.
  await page.getByRole('link', { name: 'Cotizar', exact: true }).click();
  await page.getByRole('link', { name: 'Catálogo', exact: true }).click();
  await expect(page.getByLabel('Buscar en el catálogo')).toHaveValue('HUIL-O-3-B');
});

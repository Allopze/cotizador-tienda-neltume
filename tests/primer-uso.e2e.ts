import { test, expect } from './fixtures-e2e';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { DIR_E2E } from './login-e2e';

// «Crear la primera cuenta» a 390 px en modo táctil. La pantalla solo aparece con la base sin cuentas: las cuentas se
// apartan por un momento (sin tocar sesiones ni credenciales: sin claves foráneas en esta conexión) y se devuelven al
// terminar. Por eso corre en su propio proyecto, el último («primer-uso», después de la aceptación).

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('primera cuenta a 390 px: el formulario cabe, se toca con el dedo y explica el error junto al campo', async ({ page }) => {
  const db = abrirBaseDatos(`${DIR_E2E}/cotizador.sqlite`, { permitirJsonLegado: true, cachear: false });
  db.pragma('foreign_keys = OFF');
  const cuentas = db.prepare('SELECT * FROM "user"').all() as Record<string, unknown>[];
  expect(cuentas.length).toBeGreaterThan(0);
  db.prepare('DELETE FROM "user"').run();
  try {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Crear la primera cuenta', level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const campos = page.locator('form.login-form input');
    expect(await campos.count()).toBeGreaterThanOrEqual(5);
    for (const campo of await campos.all()) {
      const caja = (await campo.boundingBox())!;
      expect(caja.x).toBeGreaterThanOrEqual(0);
      expect(caja.x + caja.width).toBeLessThanOrEqual(390);
      expect(caja.height, 'alto táctil').toBeGreaterThanOrEqual(40);
    }
    const boton = page.locator('form.login-form button[type="submit"]');
    await boton.scrollIntoViewIfNeeded();
    expect((await boton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // Sin código: el error queda ligado al campo, a la vista, y el foco va a él.
    await boton.tap();
    const codigo = page.getByLabel('Código del registro del servidor');
    await expect(codigo).toHaveAttribute('aria-invalid', 'true');
    await expect(codigo).toHaveAccessibleDescription('Pega el código que aparece en el registro del servidor.');
    await expect(codigo).toBeFocused();
    await expect(codigo).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/movil-primera-cuenta.png', fullPage: true });
  } finally {
    const columnas = Object.keys(cuentas[0]);
    const insertar = db.prepare(
      `INSERT INTO "user" (${columnas.map((c) => `"${c}"`).join(', ')}) VALUES (${columnas.map((c) => `@${c}`).join(', ')})`,
    );
    for (const cuenta of cuentas) insertar.run(cuenta);
    db.close();
  }
});

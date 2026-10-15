import { createRequire } from 'node:module';
import { test, expect, type Page } from './fixtures-e2e';
import { crearBorrador } from './api-e2e';
import { ADMIN_E2E, iniciarSesion } from './login-e2e';

// Revisión automática de accesibilidad (WCAG 2.0 y 2.1, niveles A y AA) con axe-core sobre todas las pantallas.
// axe-core no es una dependencia directa: viene con eslint-plugin-jsx-a11y (eslint-config-next) y se usa la copia
// de node_modules. Revisa contraste, nombres accesibles, roles, etiquetas, idioma y estructura; no reemplaza la
// prueba con VoiceOver.

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const ETIQUETAS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

interface Violacion {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[]; failureSummary?: string }[];
}

async function revisar(page: Page, pantalla: string) {
  // Esperar a que la pantalla termine de cargar (sin «Cargando…») y a que acaben las animaciones de entrada.
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/^Cargando/).filter({ visible: true })).toHaveCount(0);
  await page.waitForTimeout(400);
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE });
  const { violaciones, aprobadas } = (await page.evaluate(async (etiquetas) => {
    const r = await (
      window as unknown as { axe: { run: (c: Document, o: unknown) => Promise<{ violations: unknown[]; passes: unknown[] }> } }
    ).axe.run(document, { runOnly: { type: 'tag', values: etiquetas } });
    return { violaciones: r.violations, aprobadas: r.passes.length };
  }, ETIQUETAS)) as { violaciones: Violacion[]; aprobadas: number };
  // Que axe de verdad revisó algo (y no corrió sobre una página vacía).
  expect(aprobadas, `reglas aprobadas en ${pantalla}`).toBeGreaterThan(10);
  const resumen = violaciones.map(
    (v) => `${pantalla} · ${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(' ')} · ${n.failureSummary?.split('\n').slice(1).join(' ').trim() ?? ''}`).join('\n')}`,
  );
  expect(resumen, `Accesibilidad de ${pantalla}`).toEqual([]);
}

test('login sin sesión', async ({ page }) => {
  // Control: axe detecta una imagen sin texto alternativo y un campo sin etiqueta.
  await page.setContent('<html lang="es"><head><title>x</title></head><body><main><img src="data:,"><input></main></body></html>');
  await page.addScriptTag({ path: AXE });
  const control = await page.evaluate(async () =>
    (await (window as unknown as { axe: { run: (c: Document) => Promise<{ violations: { id: string }[] }> } }).axe.run(document)).violations.map((v) => v.id),
  );
  expect(control).toEqual(expect.arrayContaining(['image-alt', 'label']));
  await page.goto('/login');
  await revisar(page, 'Login');
  // Con el aviso de sesión vencida y los errores del formulario a la vista.
  await page.goto('/login?motivo=sesion&desde=cotizador');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await revisar(page, 'Login con aviso y error');
});

for (const ancho of [1280, 390]) {
  test(`pantallas de la vendedora a ${ancho} px`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 900 });
    await iniciarSesion(page);
    const borrador = await crearBorrador(page.request, { cliente: 'Cliente Accesibilidad' });
    await page.goto('/');
    await revisar(page, `Cotizador vacío (${ancho})`);
    await page.goto(`/?cotizacion=${encodeURIComponent(borrador.id)}`);
    await expect(page.getByLabel('Cotización en curso').getByText('HUIL-O-3-B', { exact: true }).first()).toBeAttached();
    await revisar(page, `Cotizador con borrador (${ancho})`);
    for (const ruta of ['/historial', '/clientes', '/ayuda', '/catalogo']) {
      await page.goto(ruta);
      await revisar(page, `${ruta} (${ancho})`);
    }
    await page.goto('/historial');
    await page.getByRole('group', { name: 'Filtrar por estado' }).getByRole('button', { name: 'Papelera' }).click();
    await revisar(page, `Papelera (${ancho})`);
  });
}

test('Ajustes y Catálogo de la administradora, sección por sección', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await iniciarSesion(page, ADMIN_E2E);
  for (const seccion of ['cuenta', 'asistente', 'empresa', 'precios', 'cotizaciones', 'starken', 'usuarios']) {
    await page.goto(`/ajustes?seccion=${seccion}`);
    // Con «Avanzado» abierto, para revisar también lo plegado.
    for (const avanzado of await page.locator('details.ajustes-avanzado:not([open]) > summary').all()) await avanzado.click();
    await revisar(page, `Ajustes · ${seccion}`);
  }
  await page.goto('/catalogo');
  const secciones = page.getByRole('navigation', { name: /Secciones/ }).getByRole('link');
  const nombres = await secciones.allInnerTexts();
  expect(nombres.length).toBeGreaterThan(1);
  for (const nombre of nombres) {
    await page.getByRole('navigation', { name: /Secciones/ }).getByRole('link', { name: nombre.trim(), exact: true }).click();
    await revisar(page, `Catálogo · ${nombre.trim()}`);
  }
});

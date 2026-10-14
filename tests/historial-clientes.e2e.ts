import { test, expect, type Page } from '@playwright/test';
import { iniciarSesion } from './login-e2e';

// Fase 4 del plan: directorio de clientes, filtros del historial por seguimiento, operación y vendedora, plazo de
// la papelera y el motivo anunciado de los enlaces bloqueados (#36). Lo que crea queda en la papelera.

const sinScrollHorizontal = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

async function accion(page: Page, data: Record<string, unknown>) {
  const r = await page.request.post('/api/accion', { data });
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()).cotizacion as { id: string; actualizada: string };
}

test('la pantalla Clientes exige sesión', async ({ page }) => {
  await page.goto('/clientes');
  await expect(page).toHaveURL(/\/login$/);
});

test('Clientes: desde el historial, con búsqueda y sus cotizaciones, en 390 px y con teclado', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await iniciarSesion(page);
  let q = await accion(page, { tipo: 'chat', mensaje: 'Cotiza 3 Huilo Huilo en oregón de 80 × 2,10' });
  q = await accion(page, {
    tipo: 'editar',
    id: q.id,
    actualizada: q.actualizada,
    cliente: { nombre: 'Directorio Ñandú E2E', comuna: 'Pucón', proyecto: 'Cabaña del lago' },
  });

  await page.goto('/historial');
  const enlace = page.getByRole('link', { name: 'Clientes', exact: true });
  await enlace.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/clientes$/);
  await expect(page.getByRole('heading', { name: 'Clientes', level: 1 })).toBeVisible();

  const buscar = page.getByLabel('Buscar clientes');
  await buscar.fill('nandu e2e');
  const ficha = page.locator('.clientes-lista > li').filter({ hasText: 'Directorio Ñandú E2E' });
  await expect(ficha).toHaveCount(1);
  await expect(ficha).toContainText('Pucón');
  await expect(ficha).toContainText('1 cotización');
  await sinScrollHorizontal(page);

  // La ficha se abre con el teclado y lleva a la cotización.
  const resumen = ficha.locator('summary');
  await resumen.focus();
  await page.keyboard.press('Enter');
  const cotizacion = ficha.getByRole('list', { name: 'Cotizaciones de Directorio Ñandú E2E' }).getByRole('link');
  await expect(cotizacion).toHaveCount(1);
  await expect(cotizacion).toContainText('Cabaña del lago');
  await expect(cotizacion).toContainText('Borrador');
  await sinScrollHorizontal(page);
  await cotizacion.focus();
  await page.keyboard.press('Enter');
  // El cotizador abre la cotización (y limpia el parámetro de la dirección).
  const panel = page.getByLabel('Cotización en curso');
  await expect(panel).toContainText('Directorio Ñandú E2E');
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Sin número');

  await page.goto('/clientes');
  await page.getByLabel('Buscar clientes').fill('nadie se llama así');
  await expect(page.getByRole('main')).toContainText('Ningún cliente coincide con la búsqueda.');

  const { cotizacion: actual } = await (await page.request.get(`/api/accion?id=${q.id}`)).json();
  await accion(page, { tipo: 'eliminar', id: actual.id, actualizada: actual.actualizada });
});

test('Historial: filtros de seguimiento, operación y vendedora, y el plazo de la papelera', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await iniciarSesion(page);
  // Un borrador propio: su autora aparece en «Vendedora» aunque la base esté vacía. Al final vuelve a la papelera.
  const q = await accion(page, { tipo: 'chat', mensaje: 'Cotiza 3 Huilo Huilo en oregón de 80 × 2,10' });
  await page.goto('/historial');
  const grupo = page.getByRole('group', { name: 'Filtrar por seguimiento y vendedora' });
  await expect(grupo).toBeVisible();
  await sinScrollHorizontal(page);

  const comercial = page.waitForRequest((r) => r.url().includes('/api/accion?') && r.url().includes('comercial=seguimiento'));
  await grupo.getByLabel('Seguimiento').selectOption({ label: 'En seguimiento' });
  await comercial;
  const operativo = page.waitForRequest(
    (r) => r.url().includes('/api/accion?') && r.url().includes('operativo=despachada') && r.url().includes('comercial=seguimiento'),
  );
  await grupo.getByLabel('Operación').selectOption({ label: 'Despachada' });
  await operativo;

  // Vendedora: quienes crearon cotizaciones, desde el servidor.
  const { vendedoras } = (await (await page.request.get('/api/accion?vendedoras=1')).json()) as { vendedoras: string[] };
  expect(vendedoras.length).toBeGreaterThan(0);
  const vendedora = page.waitForRequest(
    // Como lo codifica URLSearchParams («+» para los espacios).
    (r) => r.url().includes('/api/accion?') && r.url().includes(new URLSearchParams({ vendedora: vendedoras[0] }).toString()),
  );
  await grupo.getByLabel('Vendedora').selectOption(vendedoras[0]);
  await vendedora;
  // «Limpiar filtros» los quita todos.
  const historial = page.locator('section.history');
  await expect(page.locator('.heading-meta')).toContainText('resultado');
  await grupo.getByLabel('Seguimiento').selectOption('');
  await grupo.getByLabel('Operación').selectOption('');
  await grupo.getByLabel('Vendedora').selectOption('');

  // La papelera dice cuándo se vacía y no muestra estos filtros.
  await page.getByRole('group', { name: 'Filtrar por estado' }).getByRole('button', { name: 'Papelera' }).click();
  await expect(historial).toContainText('Los borradores eliminados se guardan 30 días en la papelera');
  await expect(grupo).toHaveCount(0);
  await page.getByRole('group', { name: 'Filtrar por estado' }).getByRole('button', { name: 'Todas' }).click();
  const { cotizacion: actual } = await (await page.request.get(`/api/accion?id=${q.id}`)).json();
  await accion(page, { tipo: 'eliminar', id: actual.id, actualizada: actual.actualizada });
});

test('mientras el chat espera, el motivo de los enlaces bloqueados se anuncia', async ({ page }) => {
  await iniciarSesion(page);
  await page.route('**/api/accion', async (route) => {
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.tipo === 'chat')
      await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });
  await page.getByLabel('Escribe tu pedido').fill('hola');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  const historial = page.getByRole('navigation', { name: 'Pantallas' }).getByRole('link', { name: 'Historial' });
  await expect(historial).toHaveAttribute('aria-disabled', 'true');
  await expect(historial).toHaveAccessibleDescription('Espera la respuesta del asistente o cancélala.');
  await expect(historial).not.toHaveAttribute('aria-disabled', 'true');
  await expect(historial).not.toHaveAttribute('aria-describedby');
  await page.unroute('**/api/accion');
});

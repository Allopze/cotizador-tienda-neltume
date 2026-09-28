import { test, expect } from '@playwright/test';
import { CLAVE_E2E, iniciarSesion, USUARIO_E2E } from './login-e2e';

test('redirige a login y protege las APIs y los documentos hasta autenticar', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  const respuestas = await Promise.all([
    page.request.get('/api/accion'),
    page.request.get('/api/ajustes'),
    page.request.post('/api/catalogo', { data: { tipo: 'mensaje', mensaje: 'prueba' } }),
    page.request.get('/api/documento/cotizacion-323.pdf'),
  ]);
  for (const respuesta of respuestas) expect(respuesta.status()).toBe(401);

  await page.getByLabel('Correo electrónico').fill(USUARIO_E2E);
  await page.getByLabel('Contraseña').fill('contraseña-incorrecta-2026');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.locator('.login-error')).toHaveText(
    'No se pudo iniciar sesión. Revisa tus datos o espera un momento antes de volver a intentar.',
  );

  await page.getByLabel('Contraseña').fill(CLAVE_E2E);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { name: 'Cotizar, con claridad.' })).toBeVisible();
  await expect(page.getByText(USUARIO_E2E)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cotizar, con claridad.' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('una sesión vencida devuelve al login', async ({ page }) => {
  await iniciarSesion(page);

  const { auth } = await import('../src/servidor/autenticacion');
  const context = await auth.$context;
  const user = await context.internalAdapter.findUserByEmail(USUARIO_E2E);
  expect(user).not.toBeNull();
  const cookie = (await page.context().cookies()).find((item) => item.name.endsWith('session_token'));
  expect(cookie).toBeDefined();
  const session = await context.internalAdapter.createSession(user!.user.id);
  expect(session).not.toBeNull();
  await context.internalAdapter.updateSession(session!.token, { expiresAt: new Date(Date.now() - 1000) });
  await page.context().addCookies([{ ...cookie!, value: session!.token }]);

  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
});

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
    'Correo o contraseña incorrectos. Revísalos y vuelve a intentar.',
  );

  await page.getByLabel('Contraseña').fill(CLAVE_E2E);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { name: 'Cotizar', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole('banner').getByText('Usuario de prueba', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cotizar', exact: true, level: 1 })).toBeVisible();
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

test('el formulario valida con mensajes propios ligados al campo, sin enviar', async ({ page }) => {
  await page.goto('/login');
  const correo = page.getByLabel('Correo electrónico');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(correo).toHaveAttribute('aria-invalid', 'true');
  await expect(correo).toHaveAccessibleDescription('Escribe tu correo electrónico.');
  await expect(correo).toBeFocused();

  await correo.fill('persona-sin-arroba');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(correo).toHaveAccessibleDescription(/debe tener la forma nombre@dominio\.cl/);

  await correo.fill(USUARIO_E2E);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  const clave = page.getByLabel('Contraseña');
  await expect(clave).toHaveAccessibleDescription('Escribe tu contraseña.');
  await expect(clave).toBeFocused();
  await expect(correo).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/login$/);
});

test('el aviso de sesión vencida solo promete el borrador si se llegó desde el cotizador', async ({ page }) => {
  await page.goto('/login?motivo=sesion&desde=cotizador');
  await expect(page.locator('.login-aviso')).toHaveText('Tu sesión expiró. Vuelve a ingresar; tu borrador se conservó.');
  await page.goto('/login?motivo=sesion&desde=historial');
  await expect(page.locator('.login-aviso')).toHaveText('Tu sesión expiró. Vuelve a ingresar para continuar.');
  await page.goto('/login?motivo=sesion');
  await expect(page.locator('.login-aviso')).toHaveText('Tu sesión expiró. Vuelve a ingresar para continuar.');
});

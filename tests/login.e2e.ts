import { test, expect } from './fixtures-e2e';
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
  await expect(page.getByRole('banner').getByRole('button', { name: /Usuario de prueba/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cotizar', exact: true, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: /Cuenta/ }).click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('lo escrito antes de que la página termine de cargar no se pierde (teléfono lento)', async ({ page }) => {
  // Se retiene el JavaScript: el formulario ya se ve y admite texto, pero React todavía no lo controla. Así pasa en
  // un teléfono lento (la puerta 3D demora la carga) y le pasó a la E2E en WebKit el 17 nov: el correo escrito se
  // borraba al volver a dibujar el formulario y el ingreso fallaba con «Escribe tu correo electrónico».
  let soltar!: () => void;
  const retenido = new Promise<void>((resolver) => (soltar = resolver));
  await page.route('**/_next/static/**/*.js', async (ruta) => {
    await retenido;
    await ruta.continue();
  });
  await page.goto('/login', { waitUntil: 'commit' });
  await page.getByLabel('Correo electrónico').fill(USUARIO_E2E);
  await page.getByLabel('Contraseña').fill(CLAVE_E2E);
  soltar();
  // «Mostrar contraseña» responde recién cuando React tomó el formulario, y el clic lo vuelve a dibujar. No se envía
  // el formulario: el ingreso tiene un límite de intentos y aquí basta con ver que lo escrito sigue ahí.
  const ver = page.locator('.login-ver-clave');
  await expect(async () => {
    if ((await ver.getAttribute('aria-pressed')) !== 'true') await ver.click();
    await expect(ver).toHaveAttribute('aria-pressed', 'true', { timeout: 500 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByLabel('Correo electrónico')).toHaveValue(USUARIO_E2E);
  await expect(page.getByLabel('Contraseña')).toHaveValue(CLAVE_E2E);
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

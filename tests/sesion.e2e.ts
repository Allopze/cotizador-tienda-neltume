import { serializeSignedCookie } from 'better-call';
import { test, expect, type Page } from './fixtures-e2e';
import { accion, crearBorrador, crearEmitida, leer } from './api-e2e';
import { ADMIN_E2E, iniciarSesion, USUARIO_E2E } from './login-e2e';

// Sesión y cambios sin guardar: el aviso al salir de Ajustes con cambios (diálogo propio de los enlaces y
// «beforeunload» al recargar), la sesión que vence fuera del cotizador (Historial, Ajustes con cambios y un pago) y
// lo que se está escribiendo en cantidad, flete, descuento y ganancia cuando otra persona guarda la cotización.

const SECRETO = 'playwright-secret-neltume-0123456789abcdef';

/**
 * Cambia la cookie de la página por una sesión propia, firmada como la firma Better Auth, y devuelve cómo vencerla.
 * Así se vence solo esta sesión: la guardada que reutilizan las demás pruebas sigue vigente.
 */
async function sesionPropia(page: Page, email: string) {
  await iniciarSesion(page, email);
  const { auth } = await import('../src/servidor/autenticacion');
  const contexto = await auth.$context;
  const usuario = await contexto.internalAdapter.findUserByEmail(email);
  const sesion = await contexto.internalAdapter.createSession(usuario!.user.id);
  const cookie = (await page.context().cookies()).find((c) => c.name.endsWith('session_token'))!;
  const firmada = await serializeSignedCookie(cookie.name, sesion!.token, SECRETO);
  const valor = firmada.slice(cookie.name.length + 1).split(';', 1)[0];
  await page.context().addCookies([{ ...cookie, value: valor }]);
  return {
    vencer: () => contexto.internalAdapter.updateSession(sesion!.token, { expiresAt: new Date(Date.now() - 1000) }),
  };
}

test('Ajustes con cambios sin guardar: confirma antes de seguir un enlace y avisa al recargar', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await iniciarSesion(page, ADMIN_E2E);
  await page.goto('/ajustes?seccion=cotizaciones');
  const vigencia = page.getByLabel('Vigencia (días hábiles)');
  const original = await vigencia.inputValue();
  await vigencia.fill(String(Number(original || '10') + 3));
  await expect(page.getByRole('navigation', { name: 'Secciones de ajustes' }).locator('.seccion-sucia')).toHaveCount(1);

  // Un enlace de la cabecera: «Cancelar» deja la pantalla y lo escrito; «Aceptar» sale.
  const mensajes: string[] = [];
  page.once('dialog', async (d) => {
    mensajes.push(`${d.type()}: ${d.message()}`);
    await d.dismiss();
  });
  await page.getByRole('link', { name: 'Historial', exact: true }).click();
  await expect.poll(() => mensajes).toEqual(['confirm: Hay cambios sin guardar en Ajustes. ¿Salir de todos modos?']);
  await expect(page).toHaveURL(/\/ajustes\?seccion=cotizaciones$/);
  await expect(vigencia).toHaveValue(String(Number(original || '10') + 3));

  // Recargar con cambios: el navegador pide confirmar (beforeunload); descartarlo deja la página como estaba.
  page.once('dialog', async (d) => {
    mensajes.push(d.type());
    await d.dismiss();
  });
  const recarga = page.reload({ timeout: 3000 }).catch(() => 'cancelada');
  await expect.poll(() => mensajes).toContain('beforeunload');
  await recarga;
  await expect(vigencia).toHaveValue(String(Number(original || '10') + 3));

  page.once('dialog', (d) => d.accept());
  await page.getByRole('link', { name: 'Historial', exact: true }).click();
  await expect(page).toHaveURL(/\/historial$/);
  // Lo escrito no se guardó.
  await page.goto('/ajustes?seccion=cotizaciones');
  await expect(vigencia).toHaveValue(original);
});

test('sesión vencida en Historial: vuelve al login con el motivo y la pantalla de origen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { vencer } = await sesionPropia(page, USUARIO_E2E);
  await page.goto('/historial');
  await expect(page.getByRole('heading', { name: 'Historial', level: 1 })).toBeVisible();
  await vencer();
  await page.getByLabel('Buscar cotizaciones').fill('cualquier cliente');
  await expect(page).toHaveURL(/\/login\?motivo=sesion&desde=historial$/);
  await expect(page.locator('.login-aviso')).toHaveText('Tu sesión expiró. Vuelve a ingresar para continuar.');
});

test('sesión vencida en Ajustes con cambios: el aviso de salida protege lo escrito antes de ir al login', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { vencer } = await sesionPropia(page, ADMIN_E2E);
  await page.goto('/ajustes?seccion=cotizaciones');
  const vigencia = page.getByLabel('Vigencia (días hábiles)');
  const original = await vigencia.inputValue();
  await vigencia.fill(String(Number(original || '10') + 2));
  await vencer();
  const dialogos: string[] = [];
  page.on('dialog', async (d) => {
    dialogos.push(d.type());
    await d.accept();
  });
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  // Ir al login descartaría lo escrito: el navegador lo pregunta y, al aceptar, se llega con el motivo.
  await expect(page).toHaveURL(/\/login\?motivo=sesion&desde=ajustes$/);
  expect(dialogos).toEqual(['beforeunload']);
  await expect(page.locator('.login-aviso')).toHaveText('Tu sesión expiró. Vuelve a ingresar para continuar.');
});

test('sesión vencida al registrar un pago: avisa sin salir y conserva el monto escrito', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { vencer } = await sesionPropia(page, USUARIO_E2E);
  const aprobada = await crearEmitida(page.request, { cliente: 'Cliente Sesión Vencida', aprobar: true });
  await page.goto(`/?cotizacion=${encodeURIComponent(aprobada.id)}`);
  const flujo = page.getByLabel('Cotización en curso').locator('.quote-workflow');
  const monto = flujo.getByLabel(/^Monto recibido/);
  await monto.fill('10.000');
  await vencer();
  await flujo.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Tu sesión expiró. Vuelve a ingresar; tu borrador se conservó.' })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByLabel('Cotización en curso').getByRole('heading', { level: 2 })).toHaveText(`N° ${aprobada.numero}`);
  await expect(monto).toHaveValue('10.000');
  await expect(flujo.locator('.workflow-ledger')).toHaveCount(0);
});

test('lo escrito en cantidad, flete, descuento y ganancia se conserva cuando otra persona guarda', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await iniciarSesion(page);
  let q = await crearBorrador(page.request, { cliente: 'Cliente Campos Abiertos', cantidad: 2 });
  q = await accion(page.request, { tipo: 'editar', id: q.id, actualizada: q.actualizada, flete: 40000 });
  await page.goto(`/?cotizacion=${encodeURIComponent(q.id)}`);
  const panel = page.getByLabel('Cotización en curso');
  await expect(panel.getByText('HUIL-O-3-B', { exact: true }).first()).toBeVisible();
  const observaciones = panel.locator('.quote-details > summary').filter({ hasText: 'Observaciones' });

  const casos: { boton: RegExp; etiqueta: RegExp | string; valor: string; guardado: (c: Record<string, unknown>) => unknown; esperado: unknown }[] = [
    { boton: /^Editar cantidad de/, etiqueta: /^Cantidad de/, valor: '5', guardado: (c) => (c.solicitudes as { cantidad: number }[])[0].cantidad, esperado: 5 },
    { boton: /^Editar unitario del flete/, etiqueta: 'Unitario del flete', valor: '45000', guardado: (c) => c.flete, esperado: 45000 },
    { boton: /^Editar descuento/, etiqueta: 'Descuento', valor: '3', guardado: (c) => c.descuento, esperado: 3 },
    { boton: /^Editar ganancia especial de la cotización/, etiqueta: 'Ganancia especial de la cotización', valor: '40', guardado: (c) => c.margenCotizacion, esperado: 0.4 },
  ];
  for (const [i, caso] of casos.entries()) {
    await panel.getByRole('button', { name: caso.boton }).first().click();
    const campo = panel.getByLabel(caso.etiqueta, { exact: typeof caso.etiqueta === 'string' });
    await campo.fill(caso.valor);
    // Mientras tanto, otra vendedora guarda una observación en esta cotización.
    const vigente = await leer(page.request, q.id);
    const nota = `Nota de la otra vendedora ${i + 1}`;
    await accion(page.request, { tipo: 'editar', id: q.id, actualizada: vigente.actualizada, observaciones: nota });
    // Al volver a la ventana se relee la cotización.
    await expect(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(observaciones).toContainText(nota, { timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    // Lo escrito sigue en el campo y se guarda sobre la versión nueva, sin pisar la observación.
    await expect(campo, String(caso.boton)).toHaveValue(caso.valor);
    await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(campo).toHaveCount(0);
    await expect.poll(async () => caso.guardado(await leer(page.request, q.id)), { message: String(caso.boton) }).toBe(caso.esperado);
    expect((await leer(page.request, q.id)).observaciones).toBe(nota);
  }
});

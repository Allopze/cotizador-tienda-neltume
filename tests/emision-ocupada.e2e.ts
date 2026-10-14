import { test, expect } from '@playwright/test';
import { iniciarSesion } from './login-e2e';
import { resolverMedidasAntesDeEmitir } from './medidas-e2e';

// Si la misma cotización ya se está emitiendo (otra pestaña, un doble toque), el servidor responde 409 «ocupado»
// sin gastar un número. La pantalla lo informa como aviso, no como error, y ofrece actualizar.
test('emitir: el botón se bloquea durante la llamada y un 409 «ocupado» se informa sin tratarlo como falla', async ({
  page,
}) => {
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso');
  await page.getByLabel('Escribe tu pedido').fill('3 Huilo Huilo oregón 80×210 para Juan Pérez, Temuco');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await resolverMedidasAntesDeEmitir(page);

  const mensaje = 'Ya se está generando el PDF de esta cotización. Espera unos segundos y recarga.';
  let soltar!: () => void;
  const respuesta = new Promise<void>((listo) => (soltar = listo));
  // La emisión no llega al servidor: no mueve el correlativo que esperan las otras pruebas.
  await page.route('**/api/accion', async (route) => {
    const req = route.request();
    if (req.method() !== 'POST' || req.postDataJSON()?.tipo !== 'emitir') return route.continue();
    await respuesta;
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: mensaje, codigo: 'ocupado' }) });
  });

  await panel.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Emitir la cotización' })
    .getByRole('button', { name: 'Emitir y generar PDF' })
    .click();
  // Mientras la llamada está en curso, el botón no admite otro toque.
  await expect(panel.getByRole('button', { name: 'Emitiendo…' })).toBeDisabled();
  soltar();

  const aviso = page.locator('.aviso').filter({ hasText: mensaje });
  await expect(aviso).toBeVisible();
  await expect(aviso).toHaveAttribute('role', 'status');
  await expect(aviso).not.toHaveClass(/\berror\b/);
  await expect(aviso.getByRole('button', { name: 'Actualizar' })).toBeVisible();
  // Sigue siendo un borrador: se puede volver a emitir cuando termine la otra emisión.
  await expect(panel.getByRole('button', { name: 'Emitir y generar PDF', exact: true })).toBeEnabled();
  await page.unroute('**/api/accion');
  await aviso.getByRole('button', { name: 'Actualizar' }).click();
  await expect(aviso).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Emitir y generar PDF', exact: true })).toBeEnabled();
});

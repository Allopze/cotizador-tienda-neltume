import { test, expect, type Locator, type Page } from './fixtures-e2e';
import { crearEmitida } from './api-e2e';
import { iniciarSesion } from './login-e2e';
import { resolverMedidasAntesDeEmitir } from './medidas-e2e';

const sinScrollHorizontal = (page: Page, contexto = '') =>
  expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
      message: contexto,
    })
    .toBeLessThanOrEqual(0);

async function llenarCampoReceptor(contenedor: Locator, etiqueta: string, valor: string) {
  await contenedor.getByLabel(etiqueta).fill(valor);
}

test('facturación: aprobar con factura, editar receptor, copiar datos, pago, historial Por facturar y actividad', async ({
  page,
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await iniciarSesion(page);

  const panel = page.getByLabel('Cotización en curso');
  const flujo = panel.locator('.quote-workflow');
  const estados = flujo.locator('.workflow-states');

  await page.getByLabel('Escribe tu pedido').fill('3 Huilo Huilo oregón 80×210 para Juan Pérez, Temuco');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await resolverMedidasAntesDeEmitir(page);

  // B0: ayuda visible del autocompletar en los campos Nombre y RUT del cliente.
  await panel.locator('.quote-client-section > summary').click();
  await expect(
    panel.getByText('Escribe el nombre o el RUT para buscar clientes anteriores').first(),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Emitir la cotización' })
    .getByRole('button', { name: 'Emitir y generar PDF' })
    .click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(/^N° \d+$/);
  const numero = (await panel.getByRole('heading', { level: 2 }).textContent())!;
  const monto = Number(((await page.getByTestId('total').textContent()) ?? '').replace(/\D/g, ''));
  const anticipo = Math.ceil(monto * 0.5);

  // A3: aprobar eligiendo Factura, precargado desde el cliente, validando RUT y anotando receptor propio.
  await page.getByRole('button', { name: 'Registrar aprobación del cliente' }).click();
  const dialogoAprobar = page.getByRole('alertdialog', { name: /^¿Aprobar la cotización N° \d+\?$/ });
  await expect(dialogoAprobar.getByRole('radio', { name: /Aún no sabe/ })).toBeChecked();
  await dialogoAprobar.getByRole('radio', { name: /^Factura\b/ }).check();

  await expect(dialogoAprobar.getByLabel('Razón social *')).toHaveValue('Juan Pérez');
  await expect(dialogoAprobar.getByLabel('Comuna (opcional)')).toHaveValue('Temuco');

  await llenarCampoReceptor(dialogoAprobar, 'RUT *', '76.543.210-9');
  await dialogoAprobar.getByRole('button', { name: 'Registrar aprobación' }).click();
  await expect(dialogoAprobar).toBeVisible();
  await expect(dialogoAprobar.getByText('Revisa el RUT (ej. 76.543.210-3).')).toBeVisible();

  await llenarCampoReceptor(dialogoAprobar, 'Razón social *', 'Constructora Lingue SpA');
  await llenarCampoReceptor(dialogoAprobar, 'RUT *', '76543210-3');
  await llenarCampoReceptor(dialogoAprobar, 'Giro *', 'Construcción de obras');
  await llenarCampoReceptor(dialogoAprobar, 'Dirección *', 'Camino Villarrica Km 4');
  await llenarCampoReceptor(dialogoAprobar, 'Comuna (opcional)', 'Villarrica');
  await llenarCampoReceptor(dialogoAprobar, 'Correo para factura (opcional)', 'facturas@lingue.cl');
  await dialogoAprobar.getByRole('button', { name: 'Registrar aprobación' }).click();
  await expect(dialogoAprobar).toHaveCount(0);

  // A5 + A4: resumen visible con el receptor guardado.
  await expect(estados).toContainText('Comercial: Aprobada');
  await expect(estados).toContainText('Facturación: Pendiente de facturación');
  await expect(estados).toContainText('Documento: Factura a Constructora Lingue SpA (76.543.210-3)');

  // Registro de pago parcial en seguimiento.
  await flujo.getByLabel(/^Monto recibido/).fill(String(anticipo));
  await flujo.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(estados).toContainText('Operación: 50 % pagado');

  // Copiar datos en texto plano, una línea por campo.
  await flujo.getByRole('button', { name: 'Copiar datos para facturar' }).click();
  await expect(flujo.getByText('Datos copiados para facturar')).toBeVisible();
  const copiado = await page.evaluate(() => navigator.clipboard.readText());
  expect(copiado).toContain('Razón social: Constructora Lingue SpA');
  expect(copiado).toContain('RUT: 76.543.210-3');
  expect(copiado).toContain('Giro: Construcción de obras');
  expect(copiado).toContain('Dirección: Camino Villarrica Km 4');
  expect(copiado).toContain('Comuna: Villarrica');
  expect(copiado).toContain('Correo: facturas@lingue.cl');

  // Al borrar un campo obligatorio se muestra el aviso «Faltan datos para facturar» y se deshabilita el marcado.
  await llenarCampoReceptor(flujo, 'Dirección *', '');
  await expect(flujo.getByText('Faltan datos para facturar')).toBeVisible();
  await expect(flujo.getByRole('button', { name: 'Marcar como facturada' })).toBeDisabled();
  await llenarCampoReceptor(flujo, 'Dirección *', 'Camino Villarrica Km 4');
  await expect(flujo.getByText('Faltan datos para facturar')).toHaveCount(0);

  // Editar un campo y guardarlo explícitamente antes de marcar como facturada.
  await llenarCampoReceptor(flujo, 'Comuna (opcional)', 'Pucón');
  await expect(flujo.getByText('Cambios sin guardar')).toBeVisible();
  await expect(flujo.getByRole('button', { name: 'Marcar como facturada' })).toBeDisabled();
  await flujo.getByRole('button', { name: 'Guardar datos de facturación' }).click();
  await expect(flujo.getByText('Cambios sin guardar')).toHaveCount(0);
  await expect(flujo.getByRole('button', { name: 'Marcar como facturada' })).toBeEnabled();

  // Confirmación cuando el documento a emitir difiere del pedido por el cliente.
  await flujo.getByRole('combobox', { name: 'Documento' }).click();
  await flujo.getByRole('option', { name: 'Boleta', exact: true }).click();
  await flujo.getByLabel('N° o identificador externo').fill('88');
  await flujo.getByRole('button', { name: 'Marcar como facturada' }).click();
  const confirmacionDoc = page.getByRole('alertdialog', { name: '¿Marcar como Boleta?' });
  await expect(confirmacionDoc).toContainText('El cliente había pedido Factura, pero vas a registrar una Boleta.');
  await confirmacionDoc.getByRole('button', { name: 'Cancelar' }).click();
  await expect(confirmacionDoc).toHaveCount(0);

  // Marcar como facturada con Factura (coincide: sin confirmación extra).
  await flujo.getByRole('combobox', { name: 'Documento' }).click();
  await flujo.getByRole('option', { name: 'Factura', exact: true }).click();
  await flujo.getByLabel('N° o identificador externo').fill('7788');
  await flujo.getByRole('button', { name: 'Marcar como facturada' }).click();
  await expect(estados).toContainText('Facturación: Facturada · Factura N° 7788');
  await expect(flujo).toContainText('Constructora Lingue SpA');
  await expect(flujo).toContainText('facturas@lingue.cl');
  await expect(flujo.getByRole('button', { name: 'Copiar datos para facturar' })).toBeVisible();

  // Volver a pendiente y verificar Historial → filtro «Por facturar», distintivo y Actividad.
  await flujo.getByRole('button', { name: 'Volver a pendiente' }).click();
  await expect(estados).toContainText('Facturación: Pendiente de facturación');

  await page.getByRole('link', { name: 'Historial' }).click();
  await page.getByRole('button', { name: 'Por facturar', exact: true }).click();
  const fila = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: new RegExp(`^${numero}`) }) });
  await expect(fila).toHaveCount(1);
  await expect(fila.locator('.status.facturacion-doc')).toHaveText('Factura');

  await fila.getByText('Actividad', { exact: true }).click();
  await expect(fila.locator('.actividad')).toContainText(
    'Datos de facturación: Sin definir → Factura · Constructora Lingue SpA (76.543.210-3)',
  );
  await expect(fila.locator('.actividad')).toContainText('Facturada');
});

test('facturación en móvil 390 px: aprobación y seguimiento sin desborde horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await iniciarSesion(page);
  const emitida = await crearEmitida(page.request, {
    cliente: 'Inmobiliaria Móvil E2E',
    comuna: 'Villarrica',
    rutCuerpo: '76543210',
  });

  await page.goto(`/?cotizacion=${encodeURIComponent(emitida.id)}`);
  await expect(page).toHaveURL(/\/$/);
  const tabDerecha = page
    .getByRole('navigation', { name: 'Vista del cotizador' })
    .getByRole('button', { name: /^(Cotización|Seguimiento)$/ });
  await tabDerecha.click();
  await expect(tabDerecha).toHaveAttribute('aria-pressed', 'true');

  const panel = page.getByLabel('Cotización en curso');
  await panel.getByRole('button', { name: 'Registrar aprobación del cliente' }).click();
  const dialogo = page.getByRole('alertdialog', { name: /^¿Aprobar la cotización N° \d+\?$/ });
  await dialogo.getByRole('radio', { name: /^Factura\b/ }).check();
  await sinScrollHorizontal(page, 'Diálogo de aprobación con Factura en 390 px');

  await dialogo.getByRole('button', { name: 'Registrar aprobación' }).click();
  await expect(dialogo).toHaveCount(0);

  const tabSeguimiento = page
    .getByRole('navigation', { name: 'Vista del cotizador' })
    .getByRole('button', { name: 'Seguimiento' });
  if ((await tabSeguimiento.isVisible()) && (await tabSeguimiento.getAttribute('aria-pressed')) !== 'true') {
    await tabSeguimiento.click();
  }
  await expect(panel.locator('.quote-workflow').getByRole('button', { name: 'Copiar datos para facturar' })).toBeVisible();
  await sinScrollHorizontal(page, 'Bloque de facturación en seguimiento en 390 px');

  await page.goto('/historial');
  await page.getByRole('button', { name: 'Por facturar', exact: true }).click();
  await expect(page.locator('section.history .history-list li').filter({ hasText: 'Inmobiliaria Móvil E2E' })).toHaveCount(1);
  await sinScrollHorizontal(page, 'Historial filtro Por facturar en 390 px');
});

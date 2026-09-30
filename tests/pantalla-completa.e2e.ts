import { test, expect, type Page } from '@playwright/test';
import { iniciarSesion } from './login-e2e';

/** El documento no es más alto que la ventana: el cotizador se ve completo sin desplazar la página. */
async function sinScrollDePagina(page: Page) {
  const { alto, ventana } = await page.evaluate(() => ({
    alto: document.documentElement.scrollHeight,
    ventana: window.innerHeight,
  }));
  expect(alto).toBeLessThanOrEqual(ventana);
}

test('el cotizador cabe en la ventana en todos sus estados', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso');
  const enviar = async (texto: string) => {
    await page.getByLabel('Escribe tu pedido').fill(texto);
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.getByRole('button', { name: 'Enviar mensaje' })).toBeDisabled();
  };

  const vistaPrevia = page.getByLabel('Vista previa de la cotización');
  await expect(vistaPrevia.getByRole('heading', { name: 'Vista previa' })).toBeVisible();
  await expect(vistaPrevia.getByText('La cotización aparecerá aquí.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nueva cotización' })).toHaveCount(0);
  await expect(page.getByTestId('total')).toHaveCount(0);
  await sinScrollDePagina(page);

  await enviar('3 Huilo Huilo oregón 80×210 para Juan Pérez, Temuco');
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await enviar('agrega marcos de oregón');
  await enviar('3 de 2x4 de 2,1');
  await expect(panel.getByText('MAR-O-2X4-B', { exact: true })).toBeVisible();
  // Acciones y totales siguen a la vista con varios ítems.
  await sinScrollDePagina(page);
  await expect(panel.getByRole('button', { name: 'Emitir y generar PDF', exact: true })).toBeInViewport();
  await expect(page.getByTestId('total')).toBeInViewport();
  await page.screenshot({ path: 'test-results/pantalla-completa-borrador.png' });

  await panel.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Emitir la cotización' })
    .getByRole('button', { name: 'Emitir y generar PDF' })
    .click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(/^N° \d+$/);
  await sinScrollDePagina(page);

  await page.getByRole('button', { name: 'Registrar aprobación del cliente' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Registrar aprobación' }).click();
  await expect(panel.locator('.status.aprobada').first()).toBeVisible();
  const total = Number(((await page.getByTestId('total').textContent()) ?? '').replace(/\D/g, ''));
  await panel.getByLabel(/^Monto recibido/).fill(String(Math.ceil(total * 0.5)));
  await panel.getByRole('button', { name: 'Registrar pago' }).click();
  await panel.getByRole('button', { name: 'Generar nota de pedido' }).click();
  await sinScrollDePagina(page);
  await expect(panel.getByRole('button', { name: 'Descargar nota de pedido' })).toBeInViewport();
  await page.screenshot({ path: 'test-results/pantalla-completa-aprobada.png' });

  for (const [width, height] of [
    [1280, 720],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await sinScrollDePagina(page);
    await expect(page.getByTestId('total')).toBeInViewport();
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: 'test-results/pantalla-completa-720.png' });
});

test('ajustes y alta conservan sus bloques verticales; las listas cortas no agregan scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await iniciarSesion(page);

  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [1024, 768],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto('/ajustes');
    await expect(page.getByRole('heading', { name: 'Asistente' })).toBeVisible();
    const secciones = page.locator('.ajustes-pagina > section');
    const finCuenta = await secciones.first().evaluate((elemento) => elemento.getBoundingClientRect().bottom);
    const inicioAsistente = await secciones
      .nth(1)
      .evaluate((elemento) => elemento.getBoundingClientRect().top);
    expect(inicioAsistente).toBeGreaterThan(finCuenta);

    await page.goto('/historial');
    await page.getByRole('searchbox', { name: 'Buscar cotizaciones' }).fill('sin-resultados-scroll');
    await expect(page.locator('.heading-meta')).toHaveText('0 resultados');
    await sinScrollDePagina(page);

    await page.goto('/catalogo?seccion=agregar');
    const alta = page.locator('.alta-producto');
    const finDescripcion = await alta
      .locator('.alta-bloque')
      .first()
      .evaluate((elemento) => elemento.getBoundingClientRect().bottom);
    const inicioFormulario = await alta
      .locator('.alta-formulario')
      .evaluate((elemento) => elemento.getBoundingClientRect().top);
    expect(inicioFormulario).toBeGreaterThan(finDescripcion);
    await sinScrollDePagina(page);
    await alta.getByRole('button', { name: 'Revisar propuesta' }).scrollIntoViewIfNeeded();
    await expect(alta.getByRole('button', { name: 'Revisar propuesta' })).toBeInViewport();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ajustes');
  await expect(page.getByRole('heading', { name: 'Contraseña' })).toBeVisible();
  const estadoAsistente = page.getByText(/El asistente usa la clave definida en CMD_API_KEY/);
  await estadoAsistente.scrollIntoViewIfNeeded();
  await expect(estadoAsistente).toBeInViewport();

  await page.goto('/historial');
  await expect(page.locator('.heading-meta')).toHaveText('0 resultados');
  await sinScrollDePagina(page);

  await page.goto('/catalogo');
  const lista = page.locator('.catalogo-lista');
  await expect(lista).toBeVisible();
  await sinScrollDePagina(page);
  expect(await lista.evaluate((elemento) => elemento.scrollHeight)).toBeGreaterThan(
    await lista.evaluate((elemento) => elemento.clientHeight),
  );

  await page.goto('/catalogo?seccion=agregar');
  const alta = page.locator('.alta-producto');
  await expect(alta).toBeVisible();
  await sinScrollDePagina(page);
  await alta.getByRole('button', { name: 'Revisar propuesta' }).scrollIntoViewIfNeeded();
  await expect(alta.getByRole('button', { name: 'Revisar propuesta' })).toBeInViewport();
});

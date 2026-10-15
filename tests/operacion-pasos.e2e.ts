import { test, expect, type Page } from './fixtures-e2e';
import { pesos } from '../src/negocio/precios';
import { iniciarSesion } from './login-e2e';
import { resolverMedidasAntesDeEmitir } from './medidas-e2e';

const sinScrollHorizontal = (page: Page) =>
  expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);

test('operación: la nota y cada paso se confirman, se vuelve un paso con motivo y se deshace la aprobación', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso');
  const flujo = panel.locator('.quote-workflow');
  const estados = flujo.locator('.workflow-states');
  const titulo = panel.getByRole('heading', { level: 2 });

  await page.getByLabel('Escribe tu pedido').fill('3 Huilo Huilo oregón 80×210 para Juan Pérez, Temuco');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await resolverMedidasAntesDeEmitir(page);
  await page.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
  const emision = page.getByRole('alertdialog', { name: 'Emitir la cotización' });
  // Una cuenta estándar no elige el número: se le asigna el siguiente.
  await expect(emision.getByLabel('Número de cotización (opcional)')).toHaveCount(0);
  await expect(emision).toContainText('Se le asignará el siguiente número disponible.');
  await emision.getByRole('button', { name: 'Emitir y generar PDF' }).click();
  await expect(titulo).toHaveText(/^N° \d+$/);
  const numero = (await titulo.textContent())!.trim();
  const monto = Number(((await page.getByTestId('total').textContent()) ?? '').replace(/\D/g, ''));

  const aprobar = async () => {
    await page.getByRole('button', { name: 'Registrar aprobación del cliente' }).click();
    await page
      .getByRole('alertdialog', { name: /^¿Aprobar la cotización N° \d+\?$/ })
      .getByRole('button', { name: 'Registrar aprobación' })
      .click();
    await expect(estados).toContainText('Comercial: Aprobada');
  };

  // Sin pagos, nota ni factura la aprobación se deshace: vuelve a «Emitida» con su mismo número.
  await aprobar();
  await flujo.getByRole('button', { name: 'Deshacer aprobación' }).click();
  const deshacer = page.getByRole('alertdialog', { name: '¿Deshacer la aprobación?' });
  await expect(deshacer).toContainText(`La cotización ${numero} vuelve a «Emitida»`);
  await deshacer.getByRole('button', { name: 'Deshacer aprobación' }).click();
  await expect(flujo.getByText('Esperando la aprobación del cliente')).toBeVisible();
  await expect(titulo).toHaveText(numero);
  await aprobar();

  // Con un pago registrado ya no se ofrece.
  const anticipo = Math.ceil(monto * 0.5);
  await flujo.getByLabel(/^Monto recibido/).fill(String(anticipo));
  await flujo.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(flujo.locator('.workflow-ledger')).toContainText(pesos(anticipo));
  await expect(flujo.getByRole('button', { name: 'Deshacer aprobación' })).toHaveCount(0);

  // La nota de pedido consume un número: se confirma y Escape la cancela sin generarla.
  await flujo.getByRole('button', { name: 'Generar nota de pedido' }).click();
  const nota = page.getByRole('alertdialog', { name: '¿Generar la nota de pedido?' });
  await expect(nota).toContainText('Se asigna el siguiente N° de nota de pedido');
  await expect(nota.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(nota).toHaveCount(0);
  await expect(estados).not.toContainText('Nota de pedido generada');
  await flujo.getByRole('button', { name: 'Generar nota de pedido' }).click();
  await nota.getByRole('button', { name: 'Generar nota de pedido' }).click();
  await expect(estados).toContainText('Operación: Nota de pedido generada');

  // Un paso de producción tampoco se aplica sin confirmar; el diálogo dice su efecto.
  await flujo.getByRole('button', { name: 'Iniciar producción' }).click();
  const paso = page.getByRole('alertdialog', { name: '¿Iniciar producción?' });
  await expect(paso).toContainText('La operación pasa a «En producción»');
  await paso.getByRole('button', { name: 'Cancelar' }).click();
  await expect(estados).toContainText('Operación: Nota de pedido generada');
  await flujo.getByRole('button', { name: 'Iniciar producción' }).click();
  await paso.getByRole('button', { name: 'Iniciar producción' }).click();
  await expect(estados).toContainText('Operación: En producción');

  // Volver al paso anterior pide el motivo; se prueba en el teléfono y con teclado.
  await page.setViewportSize({ width: 390, height: 844 });
  const volver = flujo.getByRole('button', { name: 'Volver al paso anterior' });
  await volver.scrollIntoViewIfNeeded();
  await expect(volver).toBeInViewport();
  await sinScrollHorizontal(page);
  await volver.click();
  const retroceso = page.getByRole('alertdialog', { name: 'Volver al paso anterior' });
  await expect(retroceso).toContainText('La operación vuelve de «En producción» a «Nota de pedido generada»');
  const motivo = retroceso.getByLabel('Motivo');
  await expect(motivo).toBeFocused();
  await retroceso.getByRole('button', { name: 'Volver al paso anterior' }).click();
  await expect(retroceso.getByRole('alert')).toHaveText('Escribe el motivo: queda registrado en la actividad.');
  await expect(motivo).toBeFocused();
  await page.keyboard.type('Se marcó antes de tiempo');
  await expect(retroceso.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(retroceso.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(retroceso.getByRole('button', { name: 'Volver al paso anterior' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(retroceso).toHaveCount(0);
  await expect(estados).toContainText('Operación: Nota de pedido generada');
  await expect(flujo.getByRole('button', { name: 'Iniciar producción' })).toBeVisible();
  // Desde «Nota de pedido generada» no hay un paso anterior que ofrecer.
  await expect(volver).toHaveCount(0);
  await sinScrollHorizontal(page);

  // La actividad registra la aprobación retirada y el retroceso con su motivo.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('link', { name: 'Historial' }).click();
  const fila = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: new RegExp(`^${numero}(?!\\d)`) }) });
  await fila.getByText('Actividad', { exact: true }).click();
  await expect(fila.locator('.actividad')).toContainText('Aprobación retirada');
  await expect(fila.locator('.actividad')).toContainText('Paso operativo anterior: Se marcó antes de tiempo');
});

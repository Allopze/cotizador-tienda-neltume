import { test, expect } from './fixtures-e2e';
import { pesos } from '../src/negocio/precios';
import { iniciarSesion } from './login-e2e';
import { resolverMedidasAntesDeEmitir } from './medidas-e2e';

test('operación: pagos tras la aprobación, anular un pago, despacho con transportista y facturación', async ({
  page,
}) => {
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso');
  const flujo = panel.locator('.quote-workflow');
  const estados = flujo.locator('.workflow-states');
  const libro = flujo.locator('.workflow-ledger');
  const total = async () =>
    Number(((await page.getByTestId('total').textContent()) ?? '').replace(/\D/g, ''));

  await page.getByLabel('Escribe tu pedido').fill('3 Huilo Huilo oregón 80×210 para Juan Pérez, Temuco');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await resolverMedidasAntesDeEmitir(page);
  await page.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Emitir la cotización' })
    .getByRole('button', { name: 'Emitir y generar PDF' })
    .click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(/^N° \d+$/);
  const numero = (await panel.getByRole('heading', { level: 2 }).textContent())!;
  const monto = await total();
  const anticipo = Math.ceil(monto * 0.5);

  // Emitida: todavía no hay pagos ni facturación; el estado habla en etiquetas.
  await expect(flujo.getByText('Esperando la aprobación del cliente')).toBeVisible();
  await expect(estados).toContainText('Comercial: Enviada');
  await expect(flujo.getByLabel(/^Monto recibido/)).toHaveCount(0);
  await expect(flujo.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0);
  await expect(flujo.getByRole('button', { name: 'Marcar como facturada' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Registrar aprobación del cliente' }).click();
  await page
    .getByRole('alertdialog', { name: /^¿Aprobar la cotización N° \d+\?$/ })
    .getByRole('button', { name: 'Registrar aprobación' })
    .click();
  await expect(estados).toContainText('Comercial: Aprobada');
  await expect(estados).toContainText('Operación: Sin nota de pedido');
  await expect(estados).toContainText('Facturación: Pendiente de facturación');

  // Con la cotización aprobada los datos de despacho se editan en línea; el valor del flete queda fijo.
  await panel.locator('.quote-details > summary').filter({ hasText: 'Despacho' }).click();
  await panel.getByRole('button', { name: 'Editar destino' }).click();
  await panel.getByLabel('Destino', { exact: true }).fill('Osorno');
  await panel.getByRole('button', { name: 'Guardar' }).click();
  await expect(panel.getByRole('button', { name: 'Editar destino: Osorno' })).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Editar valor de despacho/ })).toHaveCount(0);

  // Un monto sobre el saldo se explica junto al campo y se borra al corregirlo.
  const montoRecibido = flujo.getByLabel(/^Monto recibido/);
  const errorPago = flujo.locator('.workflow-payment').getByRole('alert');
  await montoRecibido.fill(String(monto + 1));
  await flujo.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(errorPago).toHaveText(`Máximo ${pesos(monto)}.`);
  await expect(montoRecibido).toHaveAttribute('aria-invalid', 'true');
  await expect(montoRecibido).toHaveAccessibleDescription(`Máximo ${pesos(monto)}.`);
  await montoRecibido.fill(String(anticipo));
  await expect(errorPago).toHaveCount(0);
  // Una fecha a medio escribir no se envía: con el campo vacío el servidor registraría el pago con la de hoy.
  const fechaPago = flujo.getByLabel('Fecha del pago');
  const hoy = await fechaPago.inputValue();
  // Aprobada hoy: la fecha del pago va de la aprobación a hoy (hora de Chile). Fuera de ese rango no se envía y
  // el navegador lo explica en español.
  await expect(fechaPago).toHaveAttribute('min', hoy);
  await expect(fechaPago).toHaveAttribute('max', hoy);
  const [a, m, d] = hoy.split('-');
  for (const [fecha, explicacion] of [
    ['2020-01-01', `La fecha del pago no puede ser anterior a la aprobación (${d}-${m}-${a}).`],
    ['2099-12-31', `La fecha del pago no puede ser posterior a hoy (${d}-${m}-${a}).`],
  ]) {
    await fechaPago.fill(fecha);
    const fueraDeRango = page.waitForRequest(
      (r) => r.url().endsWith('/api/accion') && r.method() === 'POST' && r.postDataJSON()?.tipo === 'pago',
      { timeout: 1500 },
    );
    await flujo.getByRole('button', { name: 'Registrar pago' }).click();
    await expect(fueraDeRango).rejects.toThrow();
    expect(await fechaPago.evaluate((e) => (e as HTMLInputElement).validationMessage)).toBe(explicacion);
  }
  await expect(libro).toHaveCount(0);
  await fechaPago.fill('');
  await fechaPago.focus();
  await page.keyboard.type('1');
  expect(await fechaPago.evaluate((e) => (e as HTMLInputElement).validity.badInput)).toBe(true);
  const pagoEnviado = page.waitForRequest(
    (r) => r.url().endsWith('/api/accion') && r.method() === 'POST' && r.postDataJSON()?.tipo === 'pago',
    { timeout: 1500 },
  );
  await flujo.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(pagoEnviado).rejects.toThrow();
  await expect(libro).toHaveCount(0);
  await fechaPago.fill(hoy);

  // Un pago mal ingresado se anula con confirmación y deja la operación como estaba.
  await flujo.getByLabel(/^Monto recibido/).fill(String(anticipo));
  await flujo.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(libro).toContainText(pesos(anticipo));
  await expect(estados).toContainText('Operación: 50 % pagado');
  await flujo.getByRole('button', { name: /^Anular el pago de/ }).click();
  const dialogoPago = page.getByRole('alertdialog', { name: 'Anular el pago' });
  // Sin nota de pedido, anular el anticipo no afecta a la producción: el diálogo no advierte nada.
  await expect(dialogoPago).not.toContainText('producción');
  await dialogoPago.getByLabel('Motivo (opcional)').fill('Monto mal ingresado');
  await dialogoPago.getByRole('button', { name: 'Anular pago' }).click();
  await expect(libro).toHaveCount(0);
  await expect(estados).toContainText('Operación: Sin nota de pedido');
  await expect(flujo.getByRole('button', { name: 'Ir a pagos' })).toBeVisible();

  await flujo.getByLabel(/^Monto recibido/).fill(String(anticipo));
  await flujo.getByRole('button', { name: 'Registrar pago' }).click();
  await flujo.getByRole('button', { name: 'Generar nota de pedido' }).click();
  // Cada paso de la operación pide confirmación.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Generar nota de pedido', exact: true }).click();
  await expect(estados).toContainText('Operación: Nota de pedido generada');
  // Con la nota generada, anular el anticipo advierte que la producción volverá a exigirlo.
  await flujo.getByRole('button', { name: /^Anular el pago de/ }).click();
  await expect(dialogoPago).toContainText(
    'la producción no podrá iniciarse hasta volver a registrar el anticipo',
  );
  await dialogoPago.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialogoPago).toHaveCount(0);
  await expect(flujo.getByRole('button', { name: 'Iniciar producción' })).toBeEnabled();
  await flujo.getByLabel(/^Monto recibido/).fill(String(monto - anticipo));
  await flujo.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(estados).toContainText('Comercial: Vendida');
  await flujo.getByRole('button', { name: 'Iniciar producción' }).click();
  // Cada paso de la operación pide confirmación.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Iniciar producción', exact: true }).click();
  await flujo.getByRole('button', { name: 'Marcar producción terminada' }).click();
  // Cada paso de la operación pide confirmación.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Marcar producción terminada', exact: true }).click();
  await expect(estados).toContainText('Operación: 100 % pagado');
  // Todavía se puede anular un pago: la operación no llegó a «lista para despacho».
  await expect(flujo.getByRole('button', { name: /^Anular el pago de/ })).toHaveCount(2);
  await flujo.getByRole('button', { name: 'Marcar lista para despacho' }).click();
  // Cada paso de la operación pide confirmación.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Marcar lista para despacho', exact: true }).click();
  await expect(estados).toContainText('Operación: Lista para despacho');
  await expect(flujo.getByRole('button', { name: /^Anular el pago de/ })).toHaveCount(0);
  // Todavía se puede anular la cotización, pero el diálogo advierte que lo pagado no se devuelve.
  const masAcciones = panel.getByRole('button', { name: /^Más acciones/ });
  await masAcciones.click();
  await panel.locator('.menu-acciones').getByRole('button', { name: 'Anular', exact: true }).click();
  const dialogoAnular = page.getByRole('alertdialog', { name: /^Anular la cotización/ });
  await expect(dialogoAnular).toContainText(`Tiene ${pesos(monto)} pagado; anular no lo devuelve.`);
  await dialogoAnular.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialogoAnular).toHaveCount(0);

  // Registrar el despacho exige transportista; se elige en «Despacho» y el botón se habilita.
  await expect(flujo.getByRole('button', { name: 'Completar despacho' })).toBeVisible();
  await expect(flujo.getByText('Completa el transportista en Despacho antes de registrar la salida.')).toBeVisible();
  await panel.getByRole('combobox', { name: 'Transportista' }).click();
  await panel.getByRole('option', { name: 'Starken', exact: true }).click();
  await expect(flujo.getByRole('button', { name: 'Registrar despacho' })).toBeEnabled();
  await flujo.getByRole('button', { name: 'Registrar despacho' }).click();
  // Cada paso de la operación pide confirmación.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Registrar despacho', exact: true }).click();
  await expect(estados).toContainText('Operación: Despachada');
  await expect(panel.getByRole('combobox', { name: 'Transportista' })).toBeDisabled();
  // Despachada ya no se anula: la opción sigue en el menú, deshabilitada y con el motivo a la vista.
  await masAcciones.click();
  const anularDeshabilitado = panel.locator('.menu-acciones').getByRole('button', { name: /^Anular/ });
  await expect(anularDeshabilitado).toBeDisabled();
  await expect(anularDeshabilitado).toContainText('No se puede anular una cotización despachada, completada o facturada.');
  await page.keyboard.press('Escape');
  await expect(anularDeshabilitado).toHaveCount(0);
  // La fecha de la factura tiene el mismo rango que la del pago.
  await expect(flujo.getByLabel('Fecha de emisión')).toHaveAttribute('min', hoy);
  await expect(flujo.getByLabel('Fecha de emisión')).toHaveAttribute('max', hoy);
  await expect(panel.getByRole('button', { name: /^Editar destino/ })).toHaveCount(0);

  // Facturación: pendiente → facturada con tipo y número → vuelve a pendiente.
  await flujo.getByRole('combobox', { name: 'Documento' }).click();
  await flujo.getByRole('option', { name: 'Factura', exact: true }).click();
  await flujo.getByLabel('N° o identificador externo').fill('4321');
  await flujo.getByRole('button', { name: 'Marcar como facturada' }).click();
  await expect(estados).toContainText('Facturación: Facturada · Factura N° 4321');
  await flujo.getByRole('button', { name: 'Volver a pendiente' }).click();
  await expect(estados).toContainText('Facturación: Pendiente de facturación');

  // Los borradores de facturación y de nota interna son de esta cotización: no pasan a la siguiente.
  await flujo.getByLabel('N° o identificador externo').fill('999');
  await flujo.getByLabel('Nota interna').fill('Borrador de la primera');
  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await page.getByLabel('Escribe tu pedido').fill('3 Huilo Huilo oregón 80×210 para Juan Pérez, Temuco');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await resolverMedidasAntesDeEmitir(page);
  await page.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Emitir la cotización' })
    .getByRole('button', { name: 'Emitir y generar PDF' })
    .click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(/^N° \d+$/);
  await expect(panel.getByRole('heading', { level: 2 })).not.toHaveText(numero);
  await page.getByRole('button', { name: 'Registrar aprobación del cliente' }).click();
  await page
    .getByRole('alertdialog', { name: /^¿Aprobar la cotización N° \d+\?$/ })
    .getByRole('button', { name: 'Registrar aprobación' })
    .click();
  await expect(estados).toContainText('Comercial: Aprobada');
  await expect(flujo.getByLabel('N° o identificador externo')).toHaveValue('');
  await expect(flujo.getByLabel('Nota interna')).toHaveValue('');

  // El historial muestra etiquetas y el estado de pago; la actividad, el pago anulado con su motivo.
  await page.getByRole('link', { name: 'Historial' }).click();
  const fila = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: new RegExp(`^${numero}`) }) });
  const estadoFila = fila.locator('.history-estado');
  await expect(estadoFila).toContainText('Aprobada');
  await expect(estadoFila).toContainText('Despachada');
  await expect(estadoFila).toContainText('Pagada');
  await fila.getByText('Actividad', { exact: true }).click();
  await expect(fila.locator('.actividad')).toContainText('Pago anulado');
  await expect(fila.locator('.actividad')).toContainText('Motivo: Monto mal ingresado');
  await expect(fila.locator('.actividad')).toContainText('Nota de pedido generada → En producción');
  await expect(fila.locator('.actividad')).toContainText('Transportista: Starken · Destino: Osorno');
});

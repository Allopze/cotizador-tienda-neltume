import { test, expect } from './fixtures-e2e';
import { ADMIN_E2E, iniciarSesion } from './login-e2e';
import { resolverMedidasAntesDeEmitir } from './medidas-e2e';

// Corre después de flujo.e2e.ts (que espera la primera nota de Panguipulli, la 577): sus números salen de la pantalla.
test('reparto entre fábricas: una nota por fábrica, producción por fábrica y números cambiados desde el documento y por chat', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await iniciarSesion(page, ADMIN_E2E);
  const panel = page.getByLabel('Cotización en curso');
  const conversacion = page.getByTestId('conversacion');
  const flujo = panel.locator('.quote-workflow');
  const estados = flujo.locator('.workflow-states');
  const notas = flujo.locator('.workflow-notas');
  /** Con `esperar`, hasta que el chat responde; sin él (una respuesta que pide confirmar), solo lo envía. */
  async function enviar(texto: string, esperar = true) {
    await page.getByLabel('Escribe tu pedido').fill(texto);
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.getByRole('button', { name: 'Enviar mensaje' })).toBeDisabled();
    if (esperar) await expect(page.getByLabel('Escribe tu pedido')).toBeEnabled();
  }

  // Puertas y marcos, emitida y aprobada con el anticipo.
  await enviar('3 Huilo Huilo oregón 80×210 para Juan Pérez, Temuco');
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await enviar('agrega marcos de oregón');
  const faltantes = conversacion.getByRole('group', { name: 'Datos que faltan para cotizar' });
  await faltantes.getByRole('button', { name: /^2X4 · Sección o escuadría/ }).click();
  await faltantes.getByRole('button', { name: /^2,10 m \(como el ítem 1\) · Alto o largo/ }).click();
  await faltantes.getByRole('textbox', { name: /^Cantidad para el ítem 2/ }).fill('3');
  await faltantes.getByRole('button', { name: 'Aplicar' }).click();
  await expect(panel.getByText('MAR-O-2X4-B', { exact: true })).toBeVisible();
  await resolverMedidasAntesDeEmitir(page);
  await page.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
  await page.getByRole('alertdialog', { name: 'Emitir la cotización' }).getByRole('button', { name: 'Emitir y generar PDF' }).click();
  await page.getByRole('button', { name: 'Registrar aprobación del cliente' }).click();
  await page.getByRole('alertdialog', { name: /^¿Aprobar la cotización/ }).getByRole('button', { name: 'Registrar aprobación' }).click();
  await expect(estados).toContainText('Comercial: Aprobada');
  const total = Number(((await page.getByTestId('total').textContent()) ?? '').replace(/\D/g, ''));
  await panel.getByLabel(/^Monto recibido/).fill(String(Math.ceil(total * 0.5)));
  await panel.getByRole('button', { name: 'Registrar pago' }).click();

  // En una aprobada (con la conversación contraída), el chat reparte fábricas: solo la que el mensaje nombra.
  await expect(notas).toContainText('Sin fábrica: 2 ítems');
  await page.getByRole('button', { name: 'Ver conversación →' }).click();
  await enviar('las Huilo van a Panguipulli');
  await expect(conversacion).toContainText('Fábricas asignadas');
  await expect(conversacion).toContainText('Falta asignar la fábrica de');
  await expect(notas).toContainText('Panguipulli: 1 ítem · sin fábrica: 1 ítem');

  // Al generar, el diálogo trae lo asignado y pide la fábrica del resto.
  await flujo.getByRole('button', { name: 'Generar notas de pedido' }).click();
  const dialogo = page.getByRole('alertdialog', { name: '¿Generar las notas de pedido?' });
  await expect(dialogo.getByRole('radiogroup', { name: /Huilo/i }).getByRole('radio', { name: 'Panguipulli' })).toBeChecked();
  await dialogo.getByRole('radiogroup', { name: /Marco/i }).getByRole('radio', { name: 'Santiago' }).check();
  await expect(dialogo).toContainText('Se generarán 2 notas: Panguipulli, 1 ítem · Santiago, 1 ítem');
  const descarga = page.waitForEvent('download');
  await dialogo.getByRole('button', { name: 'Generar notas de pedido' }).click();
  expect((await descarga).suggestedFilename()).toMatch(/^nota-pedido-panguipulli-\d+\.pdf$/);
  await expect(page.getByText(/Se generaron 2 notas de pedido, una por fábrica/)).toBeVisible();
  await expect(estados).toContainText('Operación: Nota de pedido generada');
  const docs = panel.locator('.quote-docs');
  await expect(docs.getByText(/^Nota de pedido N° \d+ · Panguipulli$/)).toBeVisible();
  await expect(docs.getByText(/^Nota de pedido N° \d+ · Santiago$/)).toBeVisible();
  await expect(notas.locator('li').filter({ hasText: 'Fábrica Santiago' })).toContainText('Sin iniciar');

  // Cada fábrica inicia su producción por separado.
  await flujo.getByRole('button', { name: 'Iniciar producción en Panguipulli' }).first().click();
  await page.getByRole('alertdialog', { name: '¿Iniciar producción en Panguipulli?' }).getByRole('button', { name: 'Iniciar producción en Panguipulli' }).click();
  await expect(estados).toContainText('Operación: En producción');
  await expect(notas.locator('li').filter({ hasText: 'Fábrica Panguipulli' })).toContainText('En producción');
  await expect(notas.locator('li').filter({ hasText: 'Fábrica Santiago' })).toContainText('Sin iniciar');
  await expect(flujo.locator('#siguiente-accion')).toContainText('Iniciar producción en Santiago');

  // El número de una nota se cambia desde su documento.
  const santiago = (await docs.getByText(/^Nota de pedido N° \d+ · Santiago$/).textContent())!;
  const numeroSantiago = Number(santiago.match(/N° (\d+)/)![1]);
  await docs.getByRole('button', { name: `Cambiar el número de nota de pedido N° ${numeroSantiago} · Santiago` }).click();
  const cambio = page.getByRole('alertdialog', { name: `Cambiar el número de la nota de pedido N° ${numeroSantiago} de Santiago` });
  await cambio.getByLabel('Número nuevo').fill(String(numeroSantiago));
  await cambio.getByRole('button', { name: 'Cambiar número' }).click();
  await expect(cambio.getByRole('alert')).toContainText(`ya tiene el N° ${numeroSantiago}`);
  await cambio.getByLabel('Número nuevo').fill(String(numeroSantiago + 5));
  await cambio.getByRole('button', { name: 'Cambiar número' }).click();
  await expect(docs.getByText(`Nota de pedido N° ${numeroSantiago + 5} · Santiago`, { exact: true })).toBeVisible();

  // Y por chat: el asistente lo propone y se confirma.
  await enviar('la nota de Panguipulli debe ser la 950', false);
  const confirmar = page.getByRole('alertdialog', { name: /^¿Cambiar el número de la nota de pedido N° \d+ de Panguipulli\?$/ });
  const nueva = page.waitForEvent('download');
  await confirmar.getByRole('button', { name: 'Cambiar a N° 950' }).click();
  expect((await nueva).suggestedFilename()).toBe('nota-pedido-panguipulli-950.pdf');
  await expect(docs.getByText('Nota de pedido N° 950 · Panguipulli', { exact: true })).toBeVisible();
});

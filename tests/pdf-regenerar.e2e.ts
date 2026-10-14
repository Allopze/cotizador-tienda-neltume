import { test, expect } from '@playwright/test';
import { access, rm } from 'node:fs/promises';
import { ADMIN_E2E, DIR_E2E, iniciarSesion } from './login-e2e';
import { resolverMedidasAntesDeEmitir } from './medidas-e2e';

test('una cuenta administradora ve el número manual y regenera un PDF que falta en el servidor', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await iniciarSesion(page, ADMIN_E2E);
  const panel = page.getByLabel('Cotización en curso');

  await page.getByLabel('Escribe tu pedido').fill('3 Huilo Huilo oregón 80×210 para Juan Pérez, Temuco');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await resolverMedidasAntesDeEmitir(page);
  await page.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();

  // El número manual solo se ofrece a una cuenta administradora: muestra el último número y el tope (+1.000),
  // valida antes de enviar y muestra el salto.
  const emision = page.getByRole('alertdialog', { name: 'Emitir la cotización' });
  const numero = emision.getByLabel('Número de cotización (opcional)');
  await expect(numero).toBeVisible();
  const { ultimo, tope } = (await (await page.request.get('/api/accion?numeracion=1')).json()) as {
    ultimo: number;
    tope: number;
  };
  const miles = (n: number) => n.toLocaleString('es-CL');
  await expect(emision).toContainText(`Último número usado o reservado: N° ${miles(ultimo)}`);
  await expect(emision).toContainText(`puede ir del ${miles(ultimo + 1)} al ${miles(tope)}`);
  await expect(numero).toHaveAccessibleDescription(new RegExp(`del ${miles(ultimo + 1)} al ${miles(tope)}`));
  // Fuera del rango no se envía: el error lo dice antes de emitir.
  await numero.fill('1.000.000');
  await expect(emision.locator('.dialogo-advertencia')).toHaveCount(0);
  await emision.getByRole('button', { name: 'Emitir y generar PDF' }).click();
  await expect(emision.getByRole('alert')).toHaveText(
    `El número puede saltar hasta 1.000 sobre el último: elige uno entre el ${miles(ultimo + 1)} y el ${miles(tope)}.`,
  );
  await expect(emision).toBeVisible();
  await numero.fill(miles(ultimo));
  await emision.getByRole('button', { name: 'Emitir y generar PDF' }).click();
  await expect(emision.getByRole('alert')).toContainText(`ya se usó o quedó reservado`);
  await numero.fill(miles(tope));
  await expect(emision.locator('.dialogo-advertencia')).toContainText(`Se emitirá como N° ${miles(tope)}`);
  await expect(numero).toHaveAccessibleDescription(new RegExp(`Se emitirá como N° ${miles(tope).replace(/\./g, '\\.')}`));
  await numero.fill('');
  await expect(emision.locator('.dialogo-advertencia')).toHaveCount(0);
  const descarga = page.waitForEvent('download');
  await emision.getByRole('button', { name: 'Emitir y generar PDF' }).click();
  const archivo = (await descarga).suggestedFilename();
  expect(archivo).toMatch(/^cotizacion-\d+\.pdf$/);

  // El archivo ya no está en el disco (p. ej. un respaldo incompleto): descargar ofrece regenerarlo.
  await rm(`${DIR_E2E}/pdf/${archivo}`);
  await panel.getByRole('button', { name: 'Descargar cotización' }).click();
  const dialogo = page.getByRole('alertdialog', { name: 'No se encontró el PDF' });
  await expect(dialogo).toContainText('ya no está en el servidor');
  const otra = page.waitForEvent('download');
  await dialogo.getByRole('button', { name: 'Regenerar PDF' }).click();
  expect((await otra).suggestedFilename()).toBe(archivo);
  await access(`${DIR_E2E}/pdf/${archivo}`);
  await expect(page.getByRole('status').filter({ hasText: /se descargó/ })).toBeVisible();
});

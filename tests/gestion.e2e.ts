import { test, expect } from '@playwright/test';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { cotizar, pesos, REGLAS } from '../src/negocio/precios';
import { iniciarSesion } from './login-e2e';

// Corre después de flujo.e2e.ts (orden alfabético, un solo worker): no asume números fijos.
test('edición directa, conflicto de versión, duplicar, eliminar y anular', async ({ page }) => {
  const catalogo = new RepositorioCatalogoSqlite(
    abrirBaseDatos('data/test-e2e/cotizador.sqlite', { permitirJsonLegado: true }),
  );
  const puerta = catalogo.buscarPorCodigo('HUIL-O-3-B')!;
  const montos = (cantidad: number, extras: { descuento?: number; flete?: number } = {}) =>
    cotizar([{ producto: puerta, cantidad }], REGLAS, extras);
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso'),
    total = page.getByTestId('total');
  const guardarCampo = async (boton: string | RegExp, etiqueta: string | RegExp, valor: string) => {
    await panel.getByRole('button', { name: boton }).click();
    await panel.getByLabel(etiqueta, { exact: typeof etiqueta === 'string' }).fill(valor);
    await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
  };

  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await page
    .getByLabel('Escribe tu pedido')
    .fill('Cotiza 3 Huilo Huilo oregón de 80×210 para Juan Pérez, Temuco');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(total).toHaveText(pesos(montos(3).total));

  // Cantidad editada en la tabla.
  await guardarCampo(/^Editar cantidad de/, /^Cantidad de/, '5');
  await expect(total).toHaveText(pesos(montos(5).total));

  // Validación local del descuento: no llega al servidor.
  await guardarCampo('Editar descuento', 'Descuento', '60');
  await expect(panel.getByRole('alert')).toContainText('entre 0 y 50%');
  await panel.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await guardarCampo('Editar descuento', 'Descuento', '10');
  await expect(total).toHaveText(pesos(montos(5, { descuento: 10 }).total));

  // Conflicto de versión: otra pestaña (misma sesión) cambia la cotización por la API.
  const listado = await (await page.request.get('/api/accion?estado=borrador&q=Juan')).json();
  const id = listado.cotizaciones[0].id as string;
  const { cotizacion } = await (await page.request.get(`/api/accion?id=${id}`)).json();
  const cambio = await page.request.post('/api/accion', {
    data: { tipo: 'editar', id, actualizada: cotizacion.actualizada, cliente: { proyecto: 'Casa Soto' } },
  });
  expect(cambio.ok()).toBe(true);
  await guardarCampo('Editar flete (neto)', 'Flete (neto)', '20000');
  await expect(page.getByRole('alert').filter({ hasText: 'Se cargó la versión actual' })).toBeVisible();
  await expect(panel.getByText('Casa Soto', { exact: true })).toBeVisible();
  await guardarCampo('Editar flete (neto)', 'Flete (neto)', '20000');
  await expect(total).toHaveText(pesos(montos(5, { descuento: 10, flete: 20000 }).total));

  // Emitir para poder anular después.
  const descarga = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Generar PDF', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Emitir la cotización' })
    .getByRole('button', { name: 'Emitir y generar PDF' })
    .click();
  await descarga;
  const titulo = panel.getByRole('heading', { level: 2 });
  await expect(titulo).toHaveText(/^N° \d+$/);
  const numero = (await titulo.textContent())!.trim();

  // Duplicar: borrador nuevo sin descuento ni flete, con las mismas cantidades.
  await panel.getByRole('button', { name: 'Duplicar', exact: true }).click();
  await expect(titulo).toHaveText('Sin número');
  await expect(total).toHaveText(pesos(montos(5).total));

  // Eliminar el duplicado (borrador sin número).
  await panel.getByRole('button', { name: 'Eliminar borrador' }).click();
  await page
    .getByRole('alertdialog', { name: 'Eliminar borrador' })
    .getByRole('button', { name: 'Eliminar borrador' })
    .click();
  await expect(titulo).toHaveText('Nueva cotización');

  // Anular la emitida: exige marcar la confirmación.
  await page.getByRole('button', { name: new RegExp(`^${numero}`) }).click();
  await expect(titulo).toHaveText(numero);
  await panel.getByRole('button', { name: 'Anular', exact: true }).click();
  const dialogo = page.getByRole('alertdialog', { name: `Anular la cotización ${numero}` });
  await expect(dialogo.getByRole('button', { name: 'Anular cotización' })).toBeDisabled();
  await dialogo.getByLabel('Motivo (opcional)').fill('Cliente desistió');
  await dialogo.getByLabel('Entiendo que la anulación no se puede deshacer.').check();
  await dialogo.getByRole('button', { name: 'Anular cotización' }).click();
  await expect(panel.locator('.status.anulada').first()).toBeVisible();
  await expect(panel).toContainText('Motivo: Cliente desistió.');
  await expect(panel.getByRole('button', { name: 'Anular', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Escribe tu pedido')).toBeDisabled();
});

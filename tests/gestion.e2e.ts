import { test, expect } from '@playwright/test';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { cotizar, MARGENES_INICIALES, pesos, REGLAS } from '../src/negocio/precios';
import { DIR_E2E, iniciarSesion } from './login-e2e';

// Corre después de flujo.e2e.ts (orden alfabético, un solo worker): no asume números fijos.
test('edición directa, conflicto de versión, duplicar, eliminar y anular', async ({ page }) => {
  const catalogo = new RepositorioCatalogoSqlite(
    abrirBaseDatos(`${DIR_E2E}/cotizador.sqlite`, { permitirJsonLegado: true }),
  );
  const puerta = catalogo.buscarPorCodigo('HUIL-O-3-B')!;
  const reglas = { ...REGLAS, margenes: MARGENES_INICIALES };
  const montos = (cantidad: number, extras: { descuento?: number; flete?: number } = {}) =>
    cotizar([{ producto: puerta, cantidad }], reglas, extras);
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso'),
    total = page.getByTestId('total');
  const guardarCampo = async (boton: string | RegExp, etiqueta: string | RegExp, valor: string) => {
    await panel.getByRole('button', { name: boton }).click();
    await panel.getByLabel(etiqueta, { exact: typeof etiqueta === 'string' }).fill(valor);
    await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
  };

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
  await panel.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Emitir la cotización' })
    .getByRole('button', { name: 'Emitir y generar PDF' })
    .click();
  await descarga;
  const titulo = panel.getByRole('heading', { level: 2 });
  await expect(titulo).toHaveText(/^N° \d+$/);
  const numero = (await titulo.textContent())!.trim();

  // Duplicar: borrador nuevo con las mismas cantidades, descuento y flete.
  await panel.getByRole('button', { name: 'Más acciones' }).click();
  await panel.getByRole('button', { name: 'Duplicar', exact: true }).click();
  await expect(titulo).toHaveText('Sin número');
  await expect(total).toHaveText(pesos(montos(5, { descuento: 10, flete: 20000 }).total));

  // Eliminar el duplicado (borrador sin número).
  await panel.getByRole('button', { name: 'Más acciones' }).click();
  await panel.getByRole('button', { name: 'Eliminar borrador' }).click();
  await page
    .getByRole('alertdialog', { name: 'Eliminar borrador' })
    .getByRole('button', { name: 'Eliminar borrador' })
    .click();
  await expect(
    page.getByLabel('Vista previa de la cotización').getByRole('heading', { level: 2 }),
  ).toHaveText('Vista previa');

  // Anular la emitida: exige marcar la confirmación.
  await page.getByRole('link', { name: 'Historial' }).click();
  await page.getByRole('link', { name: new RegExp(`^${numero}`) }).click();
  await expect(titulo).toHaveText(numero);
  // Ir a otra pantalla y volver conserva la cotización abierta (una recarga, en cambio, parte en blanco).
  await page.getByRole('link', { name: 'Catálogo', exact: true }).click();
  await page.getByRole('link', { name: 'Cotizar', exact: true }).click();
  await expect(titulo).toHaveText(numero);
  await panel.getByRole('button', { name: 'Más acciones' }).click();
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

test('si el catálogo cambia antes de emitir, muestra los montos nuevos y pide confirmar', async ({
  page,
}) => {
  const db = abrirBaseDatos(`${DIR_E2E}/cotizador.sqlite`, { permitirJsonLegado: true });
  const puerta = new RepositorioCatalogoSqlite(db).buscarPorCodigo('HUIL-O-3-B')!;
  const reglas = { ...REGLAS, margenes: MARGENES_INICIALES };
  const antes = cotizar([{ producto: puerta, cantidad: 3 }], reglas);
  const despues = cotizar(
    [{ producto: { ...puerta, precioNeto: puerta.precioNeto + 1000 }, cantidad: 3 }],
    reglas,
  );
  const precio = db.prepare('UPDATE productos_catalogo SET precio_neto = ? WHERE codigo = ?');
  await iniciarSesion(page);
  const total = page.getByTestId('total');
  await page
    .getByLabel('Escribe tu pedido')
    .fill('Cotiza 3 Huilo Huilo oregón de 80×210 para Rosa Díaz, Valdivia');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(total).toHaveText(pesos(antes.total));
  precio.run(puerta.precioNeto + 1000, puerta.codigo);
  try {
    await page.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
    const emitir = page.getByRole('alertdialog', { name: 'Emitir la cotización' });
    await expect(emitir).toContainText(pesos(antes.total));
    await emitir.getByRole('button', { name: 'Emitir y generar PDF' }).click();
    // No se emite con un total distinto del revisado: el panel se actualiza y se pide confirmar.
    const cambio = page.getByRole('alertdialog', { name: 'Los precios cambiaron' });
    await expect(cambio).toContainText(pesos(despues.total));
    await expect(total).toHaveText(pesos(despues.total));
    const descarga = page.waitForEvent('download');
    await cambio.getByRole('button', { name: 'Emitir con los montos actualizados' }).click();
    expect((await descarga).suggestedFilename()).toMatch(/^cotizacion-\d+\.pdf$/);
    await expect(total).toHaveText(pesos(despues.total));
  } finally {
    precio.run(puerta.precioNeto, puerta.codigo);
  }
});

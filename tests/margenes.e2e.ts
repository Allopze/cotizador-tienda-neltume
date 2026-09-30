import { test, expect } from '@playwright/test';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { cotizar, MARGENES_INICIALES, pesos, REGLAS } from '../src/negocio/precios';
import { DIR_E2E, iniciarSesion } from './login-e2e';

test('margen especial de la cotización: se fija, la línea tiene prioridad y se restaura', async ({ page }) => {
  const catalogo = new RepositorioCatalogoSqlite(
    abrirBaseDatos(`${DIR_E2E}/cotizador.sqlite`, { permitirJsonLegado: true }),
  );
  const puerta = catalogo.buscarPorCodigo('HUIL-O-3-B')!;
  const reglas = { ...REGLAS, margenes: MARGENES_INICIALES };
  const total = (extras: { margenCotizacion?: number } = {}, margen?: number) =>
    pesos(cotizar([{ producto: puerta, cantidad: 3, margen }], reglas, extras).total);

  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso');
  await page.getByLabel('Escribe tu pedido').fill('3 Huilo Huilo oregón 80×210 para Juan Pérez, Temuco');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  const totalPantalla = page.getByTestId('total');
  await expect(totalPantalla).toHaveText(total());
  // Sin margen especial: la línea muestra el estándar de su categoría (Pino Oregón, 85 %), sin corrección manual.
  await expect(panel.getByText('Margen estándar: 85 % · Margen aplicado: 85 %', { exact: true })).toBeVisible();
  await expect(panel.getByText('Por categoría', { exact: true })).toBeVisible();

  // Margen especial de la cotización.
  await panel.getByRole('button', { name: 'Editar margen especial de la cotización' }).click();
  await panel.getByLabel('Margen especial de la cotización').fill('42');
  await panel.getByRole('button', { name: 'Guardar' }).click();
  await expect(totalPantalla).toHaveText(total({ margenCotizacion: 0.42 }));
  await expect(
    panel.getByText('Margen estándar: 85 % · Margen aplicado: 42 % — modificado manualmente (cotización)', { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText('42 %', { exact: true })).toBeVisible();

  // Un margen propio en la línea gana al de la cotización; quitarlo devuelve el de la cotización.
  const margenLinea = panel.getByLabel(/^Margen de la línea \(%\)/);
  await margenLinea.fill('30');
  await margenLinea.blur();
  await expect(totalPantalla).toHaveText(total({ margenCotizacion: 0.42 }, 0.3));
  await expect(
    panel.getByText('Margen estándar: 85 % · Margen aplicado: 30 % — modificado manualmente (línea)', { exact: true }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Usar el margen de la cotización' }).click();
  await expect(totalPantalla).toHaveText(total({ margenCotizacion: 0.42 }));

  // El margen queda guardado: se reabre desde el historial.
  await page.getByRole('link', { name: 'Historial' }).click();
  // El asistente de prueba siempre pone el mismo cliente: el borrador se reconoce por su total.
  await page.locator('.history-fila', { hasText: 'Sin número' }).filter({ hasText: total({ margenCotizacion: 0.42 }) }).first().click();
  await expect(panel.getByText('Margen estándar: 85 % · Margen aplicado: 42 % — modificado manualmente (cotización)', { exact: true })).toBeVisible();
  await expect(totalPantalla).toHaveText(total({ margenCotizacion: 0.42 }));

  // Restaurar vuelve a la categoría.
  await panel.getByRole('button', { name: 'Restaurar margen por categoría' }).click();
  await expect(totalPantalla).toHaveText(total());
  await expect(panel.getByText('Por categoría', { exact: true })).toBeVisible();
  await expect(panel.getByText('Margen estándar: 85 % · Margen aplicado: 85 %', { exact: true })).toBeVisible();

  // Un valor fuera de rango se rechaza en el formulario.
  await panel.getByRole('button', { name: 'Editar margen especial de la cotización' }).click();
  await panel.getByLabel('Margen especial de la cotización').fill('600');
  await panel.getByRole('button', { name: 'Guardar' }).click();
  await expect(panel.getByRole('alert')).toContainText('entre -50 y 500');
  await panel.getByRole('button', { name: 'Cancelar' }).click();

  // Deja el historial como estaba: el borrador se elimina.
  await panel.getByRole('button', { name: 'Más acciones' }).click();
  await panel.getByRole('button', { name: 'Eliminar borrador' }).click();
  await page.getByRole('alertdialog', { name: 'Eliminar borrador' }).getByRole('button', { name: 'Eliminar borrador' }).click();
  await expect(page.getByLabel('Vista previa de la cotización').getByRole('heading', { level: 2 })).toHaveText('Vista previa');
});

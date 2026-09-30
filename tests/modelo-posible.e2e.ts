import { test, expect } from '@playwright/test';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { cotizar, MARGENES_INICIALES, pesos, REGLAS } from '../src/negocio/precios';
import { DIR_E2E, iniciarSesion } from './login-e2e';

// Un nombre dudoso («Pillo») no se cotiza como Huilo Huilo hasta que la persona lo confirma.
test('una coincidencia posible de modelo queda pendiente y se cotiza al confirmarla', async ({ page }) => {
  const catalogo = new RepositorioCatalogoSqlite(
    abrirBaseDatos(`${DIR_E2E}/cotizador.sqlite`, { permitirJsonLegado: true }),
  );
  const puerta = catalogo.buscarPorCodigo('HUIL-O-3-B')!;
  const esperado = cotizar([{ producto: puerta, cantidad: 3 }], { ...REGLAS, margenes: MARGENES_INICIALES });
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso'),
    conversacion = page.getByTestId('conversacion');

  await page.getByLabel('Escribe tu pedido').fill('3 Pillo oregón 80×210 para Juan Pérez, Temuco');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  await expect(conversacion.getByText('¿Te refieres a Huilo Huilo? Confírmalo para cotizar.')).toBeVisible();
  await expect(panel.getByText('Incompleto · no suma al total')).toBeVisible();
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('total')).toHaveText(pesos(0));
  await expect(panel.getByRole('button', { name: 'Emitir y generar PDF', exact: true })).toBeDisabled();

  await panel.getByRole('button', { name: 'Confirmar Huilo Huilo' }).click();
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await expect(page.getByTestId('total')).toHaveText(pesos(esperado.total));
  await expect(panel.getByText('Incompleto · no suma al total')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /^Confirmar Huilo Huilo/ })).toHaveCount(0);

  // Deja el estado como estaba: las demás pruebas no suponen borradores previos.
  await panel.getByRole('button', { name: 'Más acciones' }).click();
  await panel.getByRole('button', { name: 'Eliminar borrador' }).click();
  await page
    .getByRole('alertdialog', { name: 'Eliminar borrador' })
    .getByRole('button', { name: 'Eliminar borrador' })
    .click();
  await expect(
    page.getByLabel('Vista previa de la cotización').getByRole('heading', { level: 2 }),
  ).toHaveText('Vista previa');
});

import { expect, type Page } from '@playwright/test';

/** Resuelve las medidas que el pedido de prueba dejó expresamente sin tipo. */
export async function resolverMedidasAntesDeEmitir(page: Page) {
  const panel = page.getByLabel('Cotización en curso');
  await expect.poll(async () => {
    if (await panel.locator('.measure-choice').count()) return 'resolver';
    const emitir = panel.getByRole('button', { name: 'Emitir y generar PDF', exact: true });
    if (await emitir.count() && await emitir.isEnabled()) return 'lista';
    return 'esperar';
  }).not.toBe('esperar');
  for (let i = 0; i < 20; i++) {
    const pendientes = await panel.locator('.measure-choice').count();
    if (!pendientes) return;
    await panel.getByRole('button', { name: 'Resolver medida' }).click();
    await panel.getByRole('button', { name: 'Medida de hoja' }).first().click();
    await expect(panel.locator('.measure-choice')).toHaveCount(pendientes - 1);
  }
  throw new Error('El pedido de prueba tiene demasiadas medidas por resolver.');
}

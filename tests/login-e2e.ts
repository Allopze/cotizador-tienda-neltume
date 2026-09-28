import { expect, type Page } from '@playwright/test';
import { CLAVE_E2E, USUARIO_E2E } from './datos-e2e';

export { CLAVE_E2E, USUARIO_E2E };

export async function iniciarSesion(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(USUARIO_E2E);
  await page.getByLabel('Contraseña').fill(CLAVE_E2E);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { name: 'Cotizar, con claridad.' })).toBeVisible();
}

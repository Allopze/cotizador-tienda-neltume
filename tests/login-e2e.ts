import { expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { CLAVE_E2E, DIR_E2E, USUARIO_E2E } from './datos-e2e';

export { CLAVE_E2E, DIR_E2E, USUARIO_E2E };

// El login tiene límite de 5 intentos cada 15 minutos por IP: la sesión se reutiliza entre pruebas
// (se guarda dentro del directorio aislado del E2E, que preparar-e2e borra en cada corrida).
const SESION = `${DIR_E2E}/sesion-e2e.json`;
const titulo = (page: Page) => page.getByRole('heading', { name: 'Cotizar', exact: true, level: 1 });

export async function iniciarSesion(page: Page) {
  try {
    const cookies = JSON.parse(await readFile(SESION, 'utf8'));
    await page.context().addCookies(cookies);
    await page.goto('/');
    if (await titulo(page).isVisible()) return;
  } catch {
    // Sin sesión guardada: se ingresa por el formulario.
  }
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(USUARIO_E2E);
  await page.getByLabel('Contraseña').fill(CLAVE_E2E);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(titulo(page)).toBeVisible();
  await writeFile(SESION, JSON.stringify(await page.context().cookies()));
}

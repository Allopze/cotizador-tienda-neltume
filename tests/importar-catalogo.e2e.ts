import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { escribirXlsx, planillaEnchapadas } from './fixture-xlsx';
import { ADMIN_E2E, DIR_E2E, iniciarSesion } from './login-e2e';

// La base del E2E solo tiene la planilla de puertas sólidas. Esta prueba importa la de enchapadas y al final
// deja el catálogo como estaba: las demás pruebas cotizan contra él.
const TABLAS = ['catalogo_meta', 'catalogo_origenes', 'catalogo_configuracion', 'catalogo_anterior', 'catalogo_ediciones'];
function conBase<T>(f: (db: Database.Database) => T) {
  const db = abrirBaseDatos(join(DIR_E2E, 'cotizador.sqlite'), { permitirJsonLegado: true, cachear: false });
  try {
    return f(db);
  } finally {
    db.close();
  }
}
let previa: Record<string, Record<string, unknown>[]> = {};
test.beforeAll(() => {
  previa = conBase((db) => Object.fromEntries(TABLAS.map((t) => [t, db.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[]])));
});
test.afterAll(() => {
  conBase((db) =>
    db.transaction(() => {
      db.prepare("DELETE FROM productos_catalogo WHERE origen = 'enchapadas'").run();
      for (const tabla of TABLAS) {
        db.prepare(`DELETE FROM ${tabla}`).run();
        for (const fila of previa[tabla] ?? []) {
          const columnas = Object.keys(fila);
          db.prepare(`INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES (${columnas.map((c) => `@${c}`).join(', ')})`).run(fila);
        }
      }
    }).immediate(),
  );
});

const irA = (page: Page, seccion: string) =>
  page.getByRole('navigation', { name: 'Secciones del catálogo' }).getByRole('link', { name: seccion }).click();

test('importar: sube una planilla, la compara, la aplica y avisa lo editado a mano que se reemplazará', async ({ page }) => {
  const { ruta, limpiar } = await escribirXlsx(planillaEnchapadas(), 'enchapadas-e2e.xlsx');
  try {
    await iniciarSesion(page, ADMIN_E2E);
    await page.goto('/catalogo?seccion=importar');
    const seccion = page.locator('.catalog-import');
    const vista = seccion.locator('.catalog-import-preview');
    const analizar = async () => {
      await seccion.locator('input[type="file"]').setInputFiles(ruta);
      await seccion.getByRole('button', { name: 'Analizar y comparar' }).click();
      await expect(vista.getByRole('heading', { name: 'Vista previa · enchapadas-e2e.xlsx' })).toBeVisible();
    };

    // 1. Vista previa: reconoce la planilla y compara solo sus productos.
    await analizar();
    await expect(vista).toContainText('Formato detectado: Planilla de enchapadas, prepintadas y marcos finger. 27 productos en la planilla.');
    await expect(vista.locator('.import-counts')).toContainText('27 Nuevos');
    await expect(vista).toContainText('No se modifican la planilla de puertas sólidas');
    await expect(vista).not.toContainText('a mano. Al confirmar');

    // 2. Confirmar aplica la planilla (antes respondía siempre 409 por la versión del catálogo).
    await seccion.getByRole('button', { name: 'Confirmar e importar' }).click();
    const dialogo = page.getByRole('alertdialog');
    await expect(dialogo).toContainText('Se aplicará enchapadas-e2e.xlsx');
    await dialogo.getByRole('button', { name: 'Importar planilla' }).click();
    await expect(seccion.getByRole('status')).toHaveText(
      'Planilla de enchapadas, prepintadas y marcos finger actualizada desde enchapadas-e2e.xlsx: 27 productos nuevos, 0 modificados y 0 retirados.',
    );
    await expect(seccion.getByRole('alert')).toHaveCount(0);
    await expect(vista).toHaveCount(0);

    // 3. Un producto de esta planilla editado a mano...
    await irA(page, 'Gestionar catálogo');
    await page.getByRole('searchbox', { name: /Buscar por código/ }).fill('HUIL-EM-085-240');
    const fila = page.getByRole('row').filter({ hasText: 'HUIL-EM-085-240 ·' });
    await fila.getByRole('button', { name: 'Editar HUIL-EM-085-240' }).click();
    const editor = page.getByRole('dialog');
    await editor.getByLabel('Precio base sin IVA').fill('110.000');
    await editor.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Cambios guardados en HUIL-EM-085-240' })).toBeVisible();

    // 4. ...se avisa en la vista previa siguiente y al confirmar, antes de reemplazarlo.
    await irA(page, 'Importar');
    await analizar();
    await expect(vista).toContainText('1 producto de esta planilla se editó a mano. Al confirmar, vuelven a los valores de la planilla');
    await expect(vista.locator('details').filter({ hasText: 'Editados a mano (1)' })).toContainText(
      'HUIL-EM-085-240 · HUILO HUILO MARA ENCHAPADA 0,85 MT X 2,21 A 2,4 MT · $110.000',
    );
    await seccion.getByRole('button', { name: 'Confirmar e importar' }).click();
    await expect(dialogo).toContainText('Se pierden los cambios hechos a mano en 1 producto de esta planilla.');
    await dialogo.getByRole('button', { name: 'Cancelar' }).click();
    await seccion.getByRole('button', { name: 'Descartar vista previa' }).click();
    await expect(vista).toHaveCount(0);

    // 5. La vista previa queda obsoleta si el catálogo cambia (aquí, otra edición a mano): confirmar responde 409,
    //    «Confirmar e importar» se deshabilita y se ofrece volver a analizar, en vez de repetir el error.
    await analizar();
    const edicion = await page.request.post('/api/catalogo', {
      data: { tipo: 'editar', codigo: 'HUIL-EM-085-240', cambios: { precioNeto: 111_000 } },
    });
    expect(edicion.ok()).toBe(true);
    await seccion.getByRole('button', { name: 'Confirmar e importar' }).click();
    await dialogo.getByRole('button', { name: 'Importar planilla' }).click();
    await expect(vista.getByRole('alert')).toContainText('El archivo o el catálogo cambiaron después de la vista previa');
    await expect(seccion.getByRole('button', { name: 'Confirmar e importar' })).toBeDisabled();
    await expect(seccion.getByRole('button', { name: 'Volver a analizar' })).toBeFocused();
    await seccion.getByRole('button', { name: 'Volver a analizar' }).click();
    await expect(vista.getByRole('alert')).toHaveCount(0);
    await expect(vista.locator('details').filter({ hasText: 'Editados a mano (1)' })).toContainText('$111.000');
    await expect(seccion.getByRole('button', { name: 'Volver a analizar' })).toHaveCount(0);

    // 6. Tras importar se puede volver a la planilla anterior: la confirmación explica qué vuelve, incluido lo
    //    editado a mano, que sigue marcado como tal.
    await seccion.getByRole('button', { name: 'Confirmar e importar' }).click();
    await dialogo.getByRole('button', { name: 'Importar planilla' }).click();
    await expect(seccion.getByRole('status')).toContainText('actualizada desde enchapadas-e2e.xlsx: 0 productos nuevos, 1 modificados');
    expect(conBase((db) => db.prepare("SELECT precio_neto FROM productos_catalogo WHERE codigo = 'HUIL-EM-085-240'").get())).toEqual({ precio_neto: 102019 });
    await seccion.getByRole('button', { name: 'Volver a la planilla anterior' }).click();
    const volver = page.getByRole('alertdialog', { name: 'Volver a la planilla anterior' });
    await expect(volver).toContainText('vuelve a como estaba antes de importar enchapadas-e2e.xlsx: los 27 productos de enchapadas-e2e.xlsx');
    await expect(volver).toContainText('Vuelven también los cambios hechos a mano en 1 producto de esa planilla');
    await volver.getByRole('button', { name: 'Volver a la planilla anterior' }).click();
    await expect(seccion.getByRole('status')).toHaveText(
      'Planilla de enchapadas, prepintadas y marcos finger de vuelta en enchapadas-e2e.xlsx: 27 productos, 1 editado a mano.',
    );
    await expect(seccion.getByRole('button', { name: 'Volver a la planilla anterior' })).toHaveCount(0);
    expect(conBase((db) => db.prepare("SELECT precio_neto FROM productos_catalogo WHERE codigo = 'HUIL-EM-085-240'").get())).toEqual({ precio_neto: 111_000 });
    await analizar();
    await expect(vista).toContainText('1 producto de esta planilla se editó a mano.');
    await seccion.getByRole('button', { name: 'Descartar vista previa' }).click();
  } finally {
    await limpiar();
  }
});

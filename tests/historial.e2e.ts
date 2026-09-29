import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { cotizar, pesos, REGLAS } from '../src/negocio/precios';
import { iniciarSesion } from './login-e2e';

async function textoPdf(ruta: string) {
  const task = getDocument({ data: new Uint8Array(await readFile(ruta)), useSystemFonts: true });
  const doc = await task.promise;
  let texto = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    texto += c.items.map((i) => ('str' in i ? i.str : '')).join(' ');
  }
  await task.destroy();
  return texto;
}

// Corre después de gestion.e2e.ts (orden alfabético, un solo worker): no asume números fijos.
test('charla sin borrador, catálogo, descuento decimal, actividad, anulada y exportación', async ({
  page,
}) => {
  const catalogo = new RepositorioCatalogoSqlite(
    abrirBaseDatos('data/test-e2e/cotizador.sqlite', { permitirJsonLegado: true }),
  );
  const puerta = catalogo.buscarPorCodigo('HUIL-O-3-B')!;
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso'),
    conversacion = page.getByTestId('conversacion'),
    titulo = panel.getByRole('heading', { level: 2 });
  const total = async () =>
    (await (await page.request.get('/api/accion?porPagina=1')).json()).total as number;
  const enviar = async (texto: string) => {
    await page.getByLabel('Escribe tu pedido').fill(texto);
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.getByRole('button', { name: 'Enviar mensaje' })).toBeDisabled();
  };

  // Un mensaje sin pedido se responde sin guardar un borrador vacío.
  const antes = await total();
  await enviar('hola');
  await expect(conversacion.getByText('No entendí, ¿puedes reformularlo?')).toBeVisible();
  await expect(
    page.getByLabel('Vista previa de la cotización').getByRole('heading', { level: 2 }),
  ).toHaveText('Vista previa');
  expect(await total()).toBe(antes);

  // Consulta del catálogo (pantalla propia) con el precio unitario de la cotización.
  await page.getByRole('link', { name: 'Catálogo', exact: true }).click();
  await expect(page).toHaveURL(/\/catalogo$/);
  const pantalla = page.getByRole('main');
  await expect(pantalla.getByLabel('Buscar en el catálogo')).toBeFocused();
  await pantalla.getByLabel('Buscar en el catálogo').fill('HUIL-O-3-B');
  await expect(pantalla.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await expect(pantalla).toContainText(pesos(Math.round(puerta.precioNeto * (1 + REGLAS.ajuste))));
  // El asistente tiene su propia pantalla, «Ajustes».
  await page.getByRole('link', { name: 'Ajustes', exact: true }).click();
  await expect(page).toHaveURL(/\/ajustes$/);
  await expect(page.getByRole('heading', { name: 'Asistente', level: 2 })).toBeVisible();
  // El cambio de contraseña también vive en «Ajustes» (ya no en el menú de la cabecera).
  await expect(page.getByRole('form', { name: 'Cambiar contraseña' })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Cambiar contraseña' })).toHaveCount(0);
  // Los enlaces antiguos a «Catálogo y ajustes» llevan a la pantalla que corresponde.
  await page.goto('/configuracion?seccion=asistente');
  await expect(page).toHaveURL(/\/ajustes$/);
  await page.getByRole('link', { name: 'Cotizar', exact: true }).click();
  await expect(
    page.getByLabel('Vista previa de la cotización').getByRole('heading', { level: 2 }),
  ).toHaveText('Vista previa');

  // «2.5» es 2,5 % de descuento (antes se leía como 25 %).
  await enviar('Cotiza 3 Huilo Huilo en oregón de 80 × 2,10 para Juan Pérez, Temuco');
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Editar descuento' }).click();
  await panel.getByLabel('Descuento', { exact: true }).fill('2.5');
  await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByTestId('total')).toHaveText(
    pesos(cotizar([{ producto: puerta, cantidad: 3 }], REGLAS, { descuento: 2.5 }).total),
  );

  const descarga = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Emitir la cotización' })
    .getByRole('button', { name: 'Emitir y generar PDF' })
    .click();
  const archivo = (await descarga).suggestedFilename();
  await expect(titulo).toHaveText(/^N° \d+$/);

  // Anulada: la descarga lleva la marca «ANULADA» y el original queda intacto.
  await panel.getByRole('button', { name: 'Más acciones' }).click();
  await panel.getByRole('button', { name: 'Anular', exact: true }).click();
  const anular = page.getByRole('alertdialog', { name: /^Anular la cotización/ });
  await anular.getByLabel('Entiendo que la anulación no se puede deshacer.').check();
  await anular.getByRole('button', { name: 'Anular cotización' }).click();
  await expect(panel.locator('.status.anulada').first()).toBeVisible();
  const anulada = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Descargar cotización' }).click();
  const nombreAnulada = (await anulada).suggestedFilename();
  expect(nombreAnulada).toBe(archivo.replace('.pdf', '-anulada.pdf'));
  expect(await textoPdf(`data/test-e2e/pdf/${nombreAnulada}`)).toContain('ANULADA');
  expect(await textoPdf(`data/test-e2e/pdf/${archivo}`)).not.toContain('ANULADA');

  // Exportación del listado (pantalla del historial).
  await page.getByRole('link', { name: 'Historial' }).click();
  await expect(page.getByRole('heading', { name: 'Historial de cotizaciones' })).toBeVisible();
  const fila = page.locator('.history-list li').filter({ hasText: 'Juan Pérez' }).first();
  await fila.getByText('Actividad', { exact: true }).click();
  const actividad = fila.locator('.actividad');
  await expect(actividad).toContainText('Emitida');
  await expect(actividad).toContainText('Descuento 0 % → 2,5 %');
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar CSV' }).click();
  const exportado = await csv;
  expect(exportado.suggestedFilename()).toMatch(/^cotizaciones-\d{4}-\d{2}-\d{2}\.csv$/);
  const contenido = await readFile((await exportado.path())!, 'utf8');
  expect(contenido.split('\r\n')[0]).toContain('N°;Estado;Fecha');
  expect(contenido).toContain('Juan Pérez');
});

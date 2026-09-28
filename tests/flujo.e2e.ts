import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Almacen } from '../src/servidor/almacen';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { cotizar, pesos } from '../src/negocio/precios';
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
test('pedido → accesorio incompleto → PDF 323 → aprobación y nota 1', async ({ page }) => {
  const catalogo = new RepositorioCatalogoSqlite(
    abrirBaseDatos('data/test-e2e/cotizador.sqlite', { permitirJsonLegado: true }),
  );
  const puerta = catalogo.buscarPorCodigo('HUIL-O-3-B')!,
    marco = catalogo.buscarPorCodigo('MAR-O-2X4-B')!;
  const primero = cotizar([{ producto: puerta, cantidad: 3 }]);
  const completo = cotizar([
    { producto: puerta, cantidad: 3 },
    { producto: marco, cantidad: 3 },
  ]);
  await iniciarSesion(page);
  const conversacion = page.getByTestId('conversacion'),
    panel = page.getByLabel('Cotización en curso');
  // Emitir consume un correlativo: la interfaz pide confirmarlo en un diálogo.
  async function emitir() {
    await page.getByRole('button', { name: 'Generar PDF', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: 'Emitir la cotización' })
      .getByRole('button', { name: 'Emitir y generar PDF' })
      .click();
  }
  async function enviar(texto: string) {
    await page.getByLabel('Escribe tu pedido').fill(texto);
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.getByRole('button', { name: 'Enviar mensaje' })).toBeDisabled();
  }
  await enviar('3 Huilo Huilo oregón 80×210 para Juan Pérez, Temuco');
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await expect(page.getByTestId('total')).toHaveText(pesos(primero.total));
  await expect(panel.getByText('Juan Pérez', { exact: true })).toBeVisible();
  await enviar('agrega marcos de oregón');
  await expect(conversacion.getByText(/¿Qué sección o escuadría/)).toContainText('alto o largo');
  await expect(conversacion.getByText(/¿Qué sección o escuadría/)).toContainText('cantidad');
  await expect(page.getByText('Incompleto · no suma al total')).toBeVisible();
  await expect(page.getByTestId('total')).toHaveText(pesos(primero.total));
  await expect(page.getByRole('button', { name: 'Generar PDF', exact: true })).toBeDisabled();
  await enviar('3 de 2x4 de 2,1');
  await expect(panel.getByText('MAR-O-2X4-B', { exact: true })).toBeVisible();
  await expect(page.getByTestId('total')).toHaveText(pesos(completo.total));
  const descarga = page.waitForEvent('download');
  await emitir();
  expect((await descarga).suggestedFilename()).toBe('cotizacion-323.pdf');
  const contenido = await textoPdf('data/test-e2e/pdf/cotizacion-323.pdf');
  expect(contenido).toContain('COTIZACIÓN N° 323');
  expect(contenido).toContain(pesos(completo.total));
  expect(contenido).not.toMatch(/precio de lista|ajuste|25 %/i);
  // Aprobación desde el panel: el diálogo pide el despacho (opcional) antes de generar la nota.
  const notaDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Aprobar y generar nota de pedido' }).click();
  const dialogo = page.getByRole('alertdialog', { name: '¿Aprobar la cotización N° 323?' });
  await expect(dialogo).toBeVisible();
  await dialogo.getByLabel('Transporte (opcional)').fill('Retira el cliente');
  await dialogo.getByRole('button', { name: 'Aprobar y generar nota' }).click();
  expect((await notaDownload).suggestedFilename()).toBe('nota-pedido-1.pdf');
  await expect(page.getByLabel('Escribe tu pedido')).toBeDisabled();
  // Una aprobada no ofrece quitar ítems.
  await expect(page.getByRole('button', { name: /^Quitar ítem 1:/ })).toHaveCount(0);
  const fabrica = cotizar(
    [
      { producto: puerta, cantidad: 3 },
      { producto: marco, cantidad: 3 },
    ],
    { ajuste: 0, iva: 0.19 },
  );
  const nota = await textoPdf('data/test-e2e/pdf/nota-pedido-1.pdf');
  expect(nota).toContain('NOTA DE PEDIDO N° 1');
  expect(nota).toContain('Ref. cotización N° 323');
  expect(nota).toContain(pesos(fabrica.total));
  for (const l of fabrica.lineas) expect(nota).toContain(pesos(l.precioUnitario));
  const estado = await new Almacen('data/test-e2e').leer();
  expect(estado.cotizaciones[0].estado).toBe('aprobada');
  expect(estado.siguienteCotizacion).toBe(324);
  expect(estado.siguienteNota).toBe(2);
  await page.reload();
  // Al recargar se parte en una cotización nueva; la aprobada se abre desde el historial.
  await expect(page.getByTestId('total')).toHaveText(pesos(0));
  await page.getByRole('button', { name: /^N° 323/ }).click();
  await expect(page.getByRole('heading', { name: 'N° 323' })).toBeFocused();
  await expect(page.getByLabel('Escribe tu pedido')).toBeDisabled();
  await expect(page.getByTestId('total')).toHaveText(pesos(completo.total));
  await page.screenshot({ path: 'test-results/cotizacion-aprobada.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Nueva cotización' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('modifica una cotización anterior por nombre y pide elegir entre coincidencias', async ({ page }) => {
  await iniciarSesion(page);
  const enviar = async (texto: string) => {
    await page.getByLabel('Escribe tu pedido').fill(texto);
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.getByRole('button', { name: 'Enviar mensaje' })).toBeDisabled();
  };
  const emitir = async () => {
    await page.getByRole('button', { name: 'Generar PDF', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: 'Emitir la cotización' })
      .getByRole('button', { name: 'Emitir y generar PDF' })
      .click();
  };
  const cotizarMaria = 'Cotiza 3 Huilo Huilo oregón de 80×210 para María José, Temuco';
  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await enviar(cotizarMaria);
  const primeraDescarga = page.waitForEvent('download');
  await emitir();
  expect((await primeraDescarga).suggestedFilename()).toBe('cotizacion-324.pdf');
  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await enviar('La cotización de Maria Jose ahora debe ser de 8 puertas y no de 3');
  await expect(page.getByLabel('Cotización en curso').getByText('8', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Cotización en curso')).toContainText('Revisión de la cotización N° 324');
  const revisionDescarga = page.waitForEvent('download');
  await emitir();
  expect((await revisionDescarga).suggestedFilename()).toBe('cotizacion-325.pdf');

  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await enviar(cotizarMaria);
  const segundaDescarga = page.waitForEvent('download');
  await emitir();
  expect((await segundaDescarga).suggestedFilename()).toBe('cotizacion-326.pdf');
  // La N° 324 quedó reemplazada por su revisión (8 puertas): para que haya ambigüedad se deja además
  // un borrador de María José con 3 puertas, sin emitir.
  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await enviar(cotizarMaria);
  await expect(page.getByTestId('total')).not.toHaveText(pesos(0));
  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await enviar('La cotización de María José ahora debe ser de 8 puertas y no de 3');
  const seleccion = page.getByRole('group', { name: 'Seleccionar cotización anterior' });
  await expect(seleccion.getByRole('button', { name: /^Elegir cotización/ })).toHaveCount(2);
  await expect(seleccion.getByRole('button', { name: /Ninguna de estas/ })).toBeVisible();
  await seleccion.getByRole('button', { name: 'Elegir cotización N° 326 de María José' }).click();
  await expect(page.getByLabel('Cotización en curso').getByText('8', { exact: true })).toBeVisible();

  const estado = await new Almacen('data/test-e2e').leer();
  expect(estado.cotizaciones.find((q) => q.numero === 324)?.solicitudes[0]?.cantidad).toBe(3);
  expect(estado.cotizaciones.find((q) => q.numero === 326)?.solicitudes[0]?.cantidad).toBe(3);
  expect(estado.cotizaciones.some((q) => q.origen === 326 && q.solicitudes[0]?.cantidad === 8)).toBe(true);
});

test('aprobación pedida por chat abre el diálogo de despacho y genera la nota', async ({ page }) => {
  await iniciarSesion(page);
  async function enviar(texto: string) {
    await page.getByLabel('Escribe tu pedido').fill(texto);
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.getByRole('button', { name: 'Enviar mensaje' })).toBeDisabled();
  }
  // Cotización propia: las pruebas anteriores ya aprobaron o reemplazaron las de números bajos.
  await enviar('2 Huilo Huilo oregón 80×210 para Ana Soto, Osorno');
  await expect(page.getByLabel('Cotización en curso').getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generar PDF', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Emitir la cotización' })
    .getByRole('button', { name: 'Emitir y generar PDF' })
    .click();
  const numero = Number((await descarga).suggestedFilename().match(/cotizacion-(\d+)\.pdf/)![1]);

  const nota = page.waitForEvent('download');
  await enviar(`se aprobó la ${numero}`);
  const dialogo = page.getByRole('alertdialog', { name: `¿Aprobar la cotización N° ${numero}?` });
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole('button', { name: 'Aprobar y generar nota' }).click();
  expect((await nota).suggestedFilename()).toMatch(/^nota-pedido-\d+\.pdf$/);
  await expect(page.getByLabel('Escribe tu pedido')).toBeDisabled();
});

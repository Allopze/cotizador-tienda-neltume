import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Almacen } from '../src/servidor/almacen';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { cotizar, pesos } from '../src/negocio/precios';
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
  await page.goto('/');
  async function enviar(texto: string) {
    await page.getByLabel('Escribe tu pedido').fill(texto);
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.getByRole('button', { name: 'Enviar mensaje' })).toBeDisabled();
  }
  await enviar('3 Huilo Huilo oregón 80×210 para Juan Pérez, Temuco');
  await expect(page.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await expect(page.getByTestId('total')).toHaveText(pesos(primero.total));
  await expect(page.getByLabel('Cotización en curso').getByText('Juan Pérez', { exact: true })).toBeVisible();
  await enviar('agrega marcos de oregón');
  await expect(page.getByText(/¿Qué sección o escuadría/)).toContainText('alto o largo');
  await expect(page.getByText(/¿Qué sección o escuadría/)).toContainText('cantidad');
  await expect(page.getByText('Incompleto · no suma al total')).toBeVisible();
  await expect(page.getByTestId('total')).toHaveText(pesos(primero.total));
  await expect(page.getByRole('button', { name: 'Generar PDF', exact: true })).toBeDisabled();
  await enviar('3 de 2x4 de 2,1');
  await expect(page.getByText('MAR-O-2X4-B', { exact: true })).toBeVisible();
  await expect(page.getByTestId('total')).toHaveText(pesos(completo.total));
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generar PDF', exact: true }).click();
  expect((await descarga).suggestedFilename()).toBe('cotizacion-323.pdf');
  const contenido = await textoPdf('data/test-e2e/pdf/cotizacion-323.pdf');
  expect(contenido).toContain('COTIZACIÓN N° 323');
  expect(contenido).toContain(pesos(completo.total));
  expect(contenido).not.toMatch(/precio de lista|ajuste|25 %/i);
  // La aprobación pedida por chat exige confirmación explícita antes de generar la nota.
  const dialogo = page.waitForEvent('dialog').then(async (d) => {
    expect(d.message()).toContain('N° 323');
    await d.accept();
  });
  const notaDownload = page.waitForEvent('download');
  await enviar('se aprobó la 323');
  await dialogo;
  expect((await notaDownload).suggestedFilename()).toBe('nota-pedido-1.pdf');
  await expect(page.getByLabel('Escribe tu pedido')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Quitar ítem 1' })).toBeDisabled();
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
  await expect(page.getByLabel('Escribe tu pedido')).toBeDisabled();
  await expect(page.getByTestId('total')).toHaveText(pesos(completo.total));
  await page.screenshot({ path: 'test-results/cotizacion-aprobada.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Nueva cotización' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('modifica una cotización anterior por nombre y pide elegir entre coincidencias', async ({ page }) => {
  await page.goto('/');
  const enviar = async (texto: string) => {
    await page.getByLabel('Escribe tu pedido').fill(texto);
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.getByRole('button', { name: 'Enviar mensaje' })).toBeDisabled();
  };
  const cotizarMaria = 'Cotiza 3 Huilo Huilo oregón de 80×210 para María José, Temuco';
  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await enviar(cotizarMaria);
  const primeraDescarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generar PDF', exact: true }).click();
  expect((await primeraDescarga).suggestedFilename()).toBe('cotizacion-324.pdf');
  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await enviar('La cotización de Maria Jose ahora debe ser de 8 puertas y no de 3');
  await expect(page.getByLabel('Cotización en curso').getByText('8', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Cotización en curso')).toContainText('Revisión de la cotización N° 324');
  const revisionDescarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generar PDF', exact: true }).click();
  expect((await revisionDescarga).suggestedFilename()).toBe('cotizacion-325.pdf');

  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await enviar(cotizarMaria);
  const segundaDescarga = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generar PDF', exact: true }).click();
  expect((await segundaDescarga).suggestedFilename()).toBe('cotizacion-326.pdf');
  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await enviar('La cotización de María José ahora debe ser de 8 puertas y no de 3');
  const seleccion = page.getByRole('group', { name: 'Seleccionar cotización anterior' });
  await expect(seleccion.getByRole('button')).toHaveCount(2);
  await seleccion.getByRole('button', { name: 'Elegir cotización N° 326 de María José' }).click();
  await expect(page.getByLabel('Cotización en curso').getByText('8', { exact: true })).toBeVisible();

  const estado = await new Almacen('data/test-e2e').leer();
  expect(estado.cotizaciones.find((q) => q.numero === 324)?.solicitudes[0]?.cantidad).toBe(3);
  expect(estado.cotizaciones.find((q) => q.numero === 326)?.solicitudes[0]?.cantidad).toBe(3);
  expect(
    estado.cotizaciones.some(
      (q) => q.origen === 326 && q.solicitudes[0]?.cantidad === 8,
    ),
  ).toBe(true);
});

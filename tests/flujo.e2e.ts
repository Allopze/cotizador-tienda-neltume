import { test, expect, type Download } from './fixtures-e2e';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Almacen } from '../src/servidor/almacen';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { cotizar, MARGENES_INICIALES, pesos, REGLAS } from '../src/negocio/precios';
import { DIR_E2E, iniciarSesion } from './login-e2e';
import { resolverMedidasAntesDeEmitir } from './medidas-e2e';
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
    abrirBaseDatos(`${DIR_E2E}/cotizador.sqlite`, { permitirJsonLegado: true }),
  );
  const puerta = catalogo.buscarPorCodigo('HUIL-O-3-B')!,
    marco = catalogo.buscarPorCodigo('MAR-O-2X4-B')!;
  const reglas = { ...REGLAS, margenes: MARGENES_INICIALES };
  const primero = cotizar([{ producto: puerta, cantidad: 3 }], reglas);
  const completo = cotizar(
    [
      { producto: puerta, cantidad: 3 },
      { producto: marco, cantidad: 3 },
    ],
    reglas,
  );
  await iniciarSesion(page);
  const conversacion = page.getByTestId('conversacion'),
    panel = page.getByLabel('Cotización en curso');
  // Emitir consume un correlativo: la interfaz pide confirmarlo en un diálogo.
  async function emitir() {
    await resolverMedidasAntesDeEmitir(page);
    await page.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
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
  await expect(panel.locator('.quote-overview').getByText('Juan Pérez', { exact: true })).toBeVisible();
  await enviar('agrega marcos de oregón');
  const faltantes = conversacion.getByRole('group', { name: 'Datos que faltan para cotizar' });
  await expect(faltantes.getByText('Sección o escuadría para el ítem 2 (Marco)')).toBeVisible();
  await expect(faltantes.getByText('Largo para el ítem 2 (Marco)')).toBeVisible();
  await expect(faltantes.getByText('Cantidad para el ítem 2 (Marco)')).toBeVisible();
  await expect(page.getByText('Incompleto · no suma al total')).toBeVisible();
  await expect(page.getByTestId('total')).toHaveText(pesos(primero.total));
  await expect(page.getByRole('button', { name: 'Emitir y generar PDF', exact: true })).toBeDisabled();
  // Las opciones guardan el dato directamente, sin volver a pasar por la IA; el alto de la puerta se sugiere.
  await faltantes.getByRole('button', { name: /^2X4 · Sección o escuadría/ }).click();
  await faltantes.getByRole('button', { name: /^2,10 m \(como el ítem 1\) · Largo/ }).click();
  await faltantes.getByRole('textbox', { name: /^Cantidad para el ítem 2/ }).fill('3');
  await faltantes.getByRole('button', { name: 'Aplicar' }).click();
  await expect(panel.getByText('MAR-O-2X4-B', { exact: true })).toBeVisible();
  await expect(faltantes).toHaveCount(0);
  await expect(page.getByTestId('total')).toHaveText(pesos(completo.total));
  // Una puerta sin tipo de medida sugiere la observación; con un clic queda escrita y ya no se ofrece.
  await panel.locator('.item-details > summary').first().click();
  const rectificar = 'Rectificar si la medida corresponde a hoja o vano.';
  await expect(panel.getByText(rectificar, { exact: true })).toHaveCount(1);
  await panel.getByRole('button', { name: /^Agregar como observación al ítem 1: / }).click();
  await expect(panel.getByRole('button', { name: /^Agregar como observación al ítem 1: / })).toHaveCount(0);
  await expect(panel.getByText(rectificar, { exact: true })).toHaveCount(2);
  const descarga = page.waitForEvent('download');
  await emitir();
  expect((await descarga).suggestedFilename()).toBe('Neltume - Cotización N.º 323.pdf');
  const contenido = await textoPdf(`${DIR_E2E}/pdf/cotizacion-323.pdf`);
  expect(contenido).toMatch(/Cotización\s+N\.º 323/);
  expect(contenido).toContain(pesos(completo.total));
  expect(contenido).not.toMatch(/precio de lista|ajuste|25 %/i);
  // El cliente no ve la referencia interna ni un tipo de medida sin definir; la observación escrita sí.
  expect(contenido).not.toMatch(/Referencia de catálogo|No especificado/);
  // El ítem se nombra con la medida pedida (80×210), no con el rango del catálogo que fija el precio.
  expect(contenido).toContain('Huilo Huilo Pino Oregon 0,80 m × 2,10 m');
  expect(contenido).not.toContain('0,8 a 0,85');
  expect(contenido).toContain(`Observación: ${rectificar}`);
  // La aprobación se registra primero; la nota queda habilitada después del anticipo del 50 %.
  await page.getByRole('button', { name: 'Registrar aprobación del cliente' }).click();
  const dialogo = page.getByRole('alertdialog', { name: '¿Aprobar la cotización N° 323?' });
  await expect(dialogo).toBeVisible();
  await dialogo.getByLabel('Transporte (opcional)').fill('Retira el cliente');
  await dialogo.getByRole('button', { name: 'Registrar aprobación' }).click();
  const notaDownload = page.waitForEvent('download');
  await panel.getByLabel(/^Monto recibido/).fill(String(Math.ceil(completo.total * 0.5)));
  await panel.getByRole('button', { name: 'Registrar pago' }).click();
  await panel.getByRole('button', { name: /^Generar notas? de pedido$/ }).click();
  // Cada paso de la operación pide confirmación.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Todo a Panguipulli' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Generar nota de pedido', exact: true }).click();
  expect((await notaDownload).suggestedFilename()).toBe('Neltume - Nota de pedido N.º 577 Panguipulli.pdf');
  // En una aprobada el chat solo reparte fábricas y cambia números: el compositor lo dice.
  await expect(page.getByLabel('Escribe tu pedido')).toHaveAttribute('placeholder', /aprobada: puedes repartir/);
  // Una aprobada no ofrece quitar ítems.
  await expect(page.getByRole('button', { name: /^Quitar ítem 1:/ })).toHaveCount(0);
  const fabrica = cotizar(
    [
      { producto: puerta, cantidad: 3 },
      { producto: marco, cantidad: 3 },
    ],
    { ajuste: 0, iva: 0.19 },
  );
  const nota = await textoPdf(`${DIR_E2E}/pdf/nota-pedido-panguipulli-577.pdf`);
  expect(nota).toMatch(/Nota de pedido\s+N\.º 577/);
  expect(nota).toContain('Fábrica Panguipulli');
  expect(nota).toMatch(/Cotización\s+N\.º 323/);
  expect(nota).toContain('Referencia de catálogo: HUIL-O-3-B');
  expect(nota).toContain(pesos(fabrica.total));
  for (const l of fabrica.lineas) expect(nota).toContain(pesos(l.precioUnitario));
  const estado = await new Almacen(DIR_E2E).leer();
  expect(estado.cotizaciones.find((q) => q.numero === 323)?.estado).toBe('aprobada');
  expect(estado.siguienteCotizacion).toBe(324);
  expect(new Almacen(DIR_E2E).correlativosNota()).toEqual({ panguipulli: 578, santiago: 59 });
  await page.reload();
  // Al recargar se vuelve al inicio sin una cotización creada.
  await expect(page.getByLabel('Vista previa de la cotización')).toBeVisible();
  await expect(page.getByTestId('total')).toHaveCount(0);
  await page.getByRole('link', { name: 'Historial' }).click();
  await page.getByRole('link', { name: /^N° 323/ }).click();
  await expect(page.getByRole('heading', { name: 'N° 323' })).toBeFocused();
  await expect(page.getByLabel('Escribe tu pedido')).toHaveAttribute('placeholder', /aprobada: puedes repartir/);
  await expect(page.getByTestId('total')).toHaveText(pesos(completo.total));
  await page.screenshot({ path: 'test-results/cotizacion-aprobada.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Conversación', exact: true }).click();
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
    await resolverMedidasAntesDeEmitir(page);
    await page.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: 'Emitir la cotización' })
      .getByRole('button', { name: 'Emitir y generar PDF' })
      .click();
  };
  // Números leídos de cada descarga: la prueba no depende de cuántas emitió la anterior.
  const numeroDe = async (descarga: Promise<Download>) => {
    const nombre = (await descarga).suggestedFilename();
    expect(nombre).toMatch(/^Neltume - Cotización N\.º \d+\.pdf$/);
    return Number(nombre.match(/\d+/)![0]);
  };
  const cotizarMaria = 'Cotiza 3 Huilo Huilo oregón de 80×210 para María José, Temuco';
  await enviar(cotizarMaria);
  const primeraDescarga = page.waitForEvent('download');
  await emitir();
  const original = await numeroDe(primeraDescarga);
  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await enviar('La cotización de Maria Jose ahora debe ser de 8 puertas y no de 3');
  await expect(page.getByLabel('Cotización en curso').getByText('8', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Cotización en curso')).toContainText(
    `Revisión de la cotización N° ${original}`,
  );
  const revisionDescarga = page.waitForEvent('download');
  await emitir();
  expect(await numeroDe(revisionDescarga)).toBe(original + 1);

  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await enviar(cotizarMaria);
  const segundaDescarga = page.waitForEvent('download');
  await emitir();
  const segunda = await numeroDe(segundaDescarga);
  expect(segunda).toBe(original + 2);
  // La original quedó reemplazada por su revisión (8 puertas): para que haya ambigüedad se deja además
  // un borrador de María José con 3 puertas, sin emitir.
  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await enviar(cotizarMaria);
  await expect(page.getByTestId('total')).not.toHaveText(pesos(0));
  await page.getByRole('button', { name: 'Nueva cotización' }).click();
  await enviar('La cotización de María José ahora debe ser de 8 puertas y no de 3');
  const seleccion = page.getByRole('group', { name: 'Seleccionar cotización anterior' });
  await expect(seleccion.getByRole('button', { name: /^Elegir cotización/ })).toHaveCount(2);
  await expect(seleccion.getByRole('button', { name: /Ninguna de estas/ })).toBeVisible();
  await seleccion.getByRole('button', { name: `Elegir cotización N° ${segunda} de María José` }).click();
  await expect(page.getByLabel('Cotización en curso').getByText('8', { exact: true })).toBeVisible();

  const estado = await new Almacen(DIR_E2E).leer();
  expect(estado.cotizaciones.find((q) => q.numero === original)?.solicitudes[0]?.cantidad).toBe(3);
  expect(estado.cotizaciones.find((q) => q.numero === segunda)?.solicitudes[0]?.cantidad).toBe(3);
  expect(estado.cotizaciones.some((q) => q.origen === segunda && q.solicitudes[0]?.cantidad === 8)).toBe(
    true,
  );
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
  await resolverMedidasAntesDeEmitir(page);
  await page.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Emitir la cotización' })
    .getByRole('button', { name: 'Emitir y generar PDF' })
    .click();
  const numero = Number((await descarga).suggestedFilename().match(/Cotización N\.º (\d+)\.pdf/)![1]);

  const textoTotal = (await page.getByTestId('total').textContent()) ?? '';
  const anticipo = Math.ceil(Number(textoTotal.replace(/\D/g, '')) * 0.5);
  await enviar(`se aprobó la ${numero}`);
  const dialogo = page.getByRole('alertdialog', { name: `¿Aprobar la cotización N° ${numero}?` });
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole('button', { name: 'Registrar aprobación' }).click();
  const nota = page.waitForEvent('download');
  const panel = page.getByLabel('Cotización en curso');
  await panel.getByLabel(/^Monto recibido/).fill(String(anticipo));
  await panel.getByRole('button', { name: 'Registrar pago' }).click();
  await panel.getByRole('button', { name: /^Generar notas? de pedido$/ }).click();
  // Cada paso de la operación pide confirmación.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Todo a Panguipulli' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Generar nota de pedido', exact: true }).click();
  expect((await nota).suggestedFilename()).toMatch(/^Neltume - Nota de pedido N\.º \d+ Panguipulli\.pdf$/);
  await expect(page.getByLabel('Escribe tu pedido')).toHaveAttribute('placeholder', /aprobada: puedes repartir/);
});

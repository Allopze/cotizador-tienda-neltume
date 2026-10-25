import { test, expect, type Download } from './fixtures-e2e';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Almacen } from '../src/servidor/almacen';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { cotizar, descripcionLinea, MARGENES_INICIALES, pesos, REGLAS } from '../src/negocio/precios';
import { nombreProducto } from '../src/app/formato';
import { DIR_E2E, iniciarSesion } from './login-e2e';

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

const numeroDe = async (descarga: Promise<Download>, rotulo: 'Cotización' | 'Nota de pedido') => {
  const nombre = (await descarga).suggestedFilename();
  expect(nombre).toMatch(new RegExp(`^Neltume - ${rotulo} N\\.º \\d+( Panguipulli)?\\.pdf$`));
  return Number(nombre.match(/\d+/)![0]);
};

const PREFIJO_DESCRIPCION = 'Castaya - Puertas interiores - ';
const PEDIDO = 'Cotiza 3 puertas Huilo Huilo en Mara de 83,5 x 236 medida vano para Juan Pérez.';

// Escenario completo de punta a punta: del pedido en lenguaje natural hasta la operación completada.
// Corre al final (proyecto «aceptacion» de playwright.config.ts): no consume correlativos que otras pruebas esperan.
test('aceptación: pedido en Mara por vano, edición manual, PDF, aprobación, nota, producción y despacho', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const catalogo = new RepositorioCatalogoSqlite(
    abrirBaseDatos(`${DIR_E2E}/cotizador.sqlite`, { permitirJsonLegado: true }),
  );
  // 83,5 × 236 cm cae en el hueco de alto entre 2,30 y 2,40: se cotiza la siguiente medida, 0,80–0,85 × 2,40 m.
  const puerta = catalogo.buscarPorCodigo('HUIL-M-3-E')!;
  const reglas = { ...REGLAS, margenes: MARGENES_INICIALES };
  const estandar = cotizar(
    [{ producto: puerta, cantidad: 3, anchoSolicitado: 0.835, altoSolicitado: 2.36 }],
    reglas,
  );
  const descripcionOriginal = nombreProducto(descripcionLinea(estandar.lineas[0]));
  const DESCRIPCION = `${PREFIJO_DESCRIPCION}${descripcionOriginal}`;
  const especial = cotizar(
    [{ producto: puerta, cantidad: 3, margen: 0.42, descripcionDocumento: DESCRIPCION }],
    reglas,
  );
  // La nota de pedido se calcula a precio de fábrica: sin margen, descuento ni flete.
  const fabrica = cotizar([{ producto: puerta, cantidad: 3 }], { ajuste: 0, iva: 0.19 });
  // Precio cliente = precio de fábrica × (1 + 55 %), el margen de las puertas sólidas de Mara.
  expect(estandar.lineas[0].precioUnitario).toBe(Math.round(puerta.precioNeto * 1.55));
  expect(especial.lineas[0].precioUnitario).toBe(Math.round(puerta.precioNeto * 1.42));
  expect(especial.total).not.toBe(estandar.total);
  expect(fabrica.lineas[0].precioUnitario).toBe(Math.round(puerta.precioNeto));

  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso'),
    flujo = panel.locator('.quote-workflow'),
    estados = flujo.locator('.workflow-states'),
    total = page.getByTestId('total');
  async function enviar(texto: string) {
    await page.getByLabel('Escribe tu pedido').fill(texto);
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(page.getByRole('button', { name: 'Enviar mensaje' })).toBeDisabled();
  }

  // 1-2. Huilo Huilo en Mara, medida de vano, cotizada con la siguiente medida del catálogo.
  await enviar(PEDIDO);
  await expect(panel.getByText('HUIL-M-3-E', { exact: true })).toBeVisible();
  await expect(panel.locator('.quote-overview').getByText('Juan Pérez', { exact: true })).toBeVisible();
  await expect(panel.locator('#producto-0 > td:first-child .quote-item-title > strong')).toHaveText(
    /^Huilo Huilo Mara 0,835 m × 2,36 m/,
  );
  await expect(panel.getByText(/Lo escribiste como|Incompleto/)).toHaveCount(0);
  await panel.locator('#producto-0 .item-provenance > summary').click();
  await expect(
    panel.getByText('Referencia HUIL-M-3-E · 0,80–0,85 × 2,40 m · siguiente medida del catálogo en alto', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByText('835 × 2360 mm (Vano)', { exact: true }),
  ).toBeVisible();
  await panel.locator('.item-details > summary').first().click();
  await expect(panel.getByRole('combobox', { name: /La medida corresponde a/ })).toContainText('Vano');
  // Con el tipo de medida definido no se sugiere rectificar la medida.
  await expect(panel.getByText('Rectificar si la medida corresponde a hoja o vano.')).toHaveCount(0);

  // 3. Precio del cliente = fábrica × 1,55.
  const linea = estandar.lineas[0];
  await expect(
    panel.getByText(`Costo de fábrica ${pesos(puerta.precioNeto)} · Precio al cliente ${pesos(linea.precioUnitario)}`, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    panel.getByText('Ganancia estándar: 55 % · Ganancia aplicada: 55 %', { exact: true }),
  ).toBeVisible();
  await expect(total).toHaveText(pesos(estandar.total));

  // 4. Descripción del documento y margen especial de la línea; el total sigue al margen.
  // Un monto se abre seleccionado: lo que se escribe lo reemplaza («0» y luego «5» es 5 %, no «05»).
  await panel.getByRole('button', { name: /^Editar descuento/ }).click();
  const campoDescuento = panel.getByLabel('Descuento', { exact: true });
  await expect(campoDescuento).toBeFocused();
  await page.keyboard.type('5');
  await expect(campoDescuento).toHaveValue('5');
  await panel.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(total).toHaveText(pesos(estandar.total));

  // La descripción, en cambio, se abre con el cursor al final para retocarla.
  await panel.getByRole('button', { name: /^Editar descripción para el documento/ }).click();
  const campoDescripcion = panel.getByLabel('Descripción para el documento');
  await expect(campoDescripcion).toHaveValue(descripcionOriginal);
  await expect(campoDescripcion).toBeFocused();
  await expect
    .poll(() => campoDescripcion.evaluate((campo: HTMLInputElement) => [campo.selectionStart, campo.selectionEnd]))
    .toEqual([descripcionOriginal.length, descripcionOriginal.length]);
  await campoDescripcion.fill('Texto temporal que se cancelará');
  await panel.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(
    panel.getByRole('button', { name: `Editar descripción para el documento: ${descripcionOriginal}` }),
  ).toBeVisible();

  await panel.getByRole('button', { name: /^Editar descripción para el documento/ }).click();
  await expect(campoDescripcion).toHaveValue(descripcionOriginal);
  await expect(campoDescripcion).toBeFocused();
  await expect
    .poll(() => campoDescripcion.evaluate((campo: HTMLInputElement) => campo.selectionStart))
    .toBe(descripcionOriginal.length);
  await campoDescripcion.evaluate((campo: HTMLInputElement) => campo.setSelectionRange(0, 0));
  expect(await campoDescripcion.evaluate((campo: HTMLInputElement) => campo.selectionStart)).toBe(0);
  await campoDescripcion.pressSequentially(PREFIJO_DESCRIPCION);
  await expect(campoDescripcion).toHaveValue(DESCRIPCION);
  await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(
    panel.getByRole('button', { name: `Editar descripción para el documento: ${DESCRIPCION}` }),
  ).toBeVisible();
  // La descripción es solo para el documento: el producto y su precio siguen siendo los del catálogo.
  await expect(panel.getByText('HUIL-M-3-E', { exact: true })).toBeVisible();
  await expect(total).toHaveText(pesos(estandar.total));
  const margenLinea = panel.getByLabel('Ganancia de la línea (%)');
  await margenLinea.fill('42');
  await margenLinea.press('Enter');
  await expect(total).toHaveText(pesos(especial.total));
  await expect(page.getByTestId('neto')).toHaveText(pesos(especial.neto));
  await expect(
    panel.getByText('Ganancia estándar: 55 % · Ganancia aplicada: 42 % · cambiada a mano en esta línea', {
      exact: true,
    }),
  ).toBeVisible();
  const unitario = especial.lineas[0].precioUnitario;
  await expect(
    panel.getByText(`Costo de fábrica ${pesos(puerta.precioNeto)} · Precio al cliente ${pesos(unitario)}`, { exact: true }),
  ).toBeVisible();

  // 5. Emitir: el PDF muestra lo del cliente y nada interno.
  const descargaCotizacion = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Emitir la cotización' })
    .getByRole('button', { name: 'Emitir y generar PDF' })
    .click();
  const numero = await numeroDe(descargaCotizacion, 'Cotización');
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(`N° ${numero}`);
  const cotizacionPdf = await textoPdf(`${DIR_E2E}/pdf/cotizacion-${numero}.pdf`);
  expect(cotizacionPdf).toMatch(new RegExp(`Cotización\\s+N\\.º ${numero}`));
  expect(cotizacionPdf).toContain('Juan Pérez');
  expect(cotizacionPdf).toContain(DESCRIPCION);
  expect(cotizacionPdf).not.toContain('Huilo Huilo Mara 0,8 a 0,85');
  // El panel muestra que es medida de vano (paso 1-2); al cliente se le informa la medida sin nombrar el vano.
  expect(cotizacionPdf).toContain('Medida solicitada: 835 × 2360 mm');
  expect(cotizacionPdf).not.toMatch(/vano/i);
  for (const monto of [unitario, especial.lineas[0].total, especial.neto, especial.iva, especial.total])
    expect(cotizacionPdf).toContain(pesos(monto));
  // Ni el precio de fábrica, ni la referencia de catálogo, ni nada de márgenes llegan al cliente.
  expect(cotizacionPdf).not.toContain(pesos(puerta.precioNeto));
  expect(cotizacionPdf).not.toMatch(
    /Referencia de catálogo|margen|ganancia|modificado manualmente|cambiada a mano|Costo de fábrica|No especificado/i,
  );

  // 6. La fila del historial resume la cotización emitida.
  await page.getByRole('link', { name: 'Historial' }).click();
  const fila = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: new RegExp(`^N° ${numero}(?!\\d)`) }) });
  await expect(fila).toHaveCount(1);
  const enlace = fila.getByRole('link', { name: new RegExp(`^N° ${numero}(?!\\d)`) });
  await expect(enlace).toContainText('Juan Pérez');
  await expect(enlace).toContainText(pesos(especial.total));
  await expect(fila.locator('.history-estado')).toContainText('Emitida');
  await expect(fila.locator('.history-estado')).toContainText('Enviada');
  await expect(fila.locator('.history-estado')).toContainText('Sin pagos');

  // 7. Aprobación del cliente, anticipo del 50 %, nota de pedido a precio de fábrica.
  await enlace.click();
  await expect(panel.getByRole('heading', { name: `N° ${numero}` })).toBeVisible();
  await expect(total).toHaveText(pesos(especial.total));
  await page.getByRole('button', { name: 'Registrar aprobación del cliente' }).click();
  await page
    .getByRole('alertdialog', { name: `¿Aprobar la cotización N° ${numero}?` })
    .getByRole('button', { name: 'Registrar aprobación' })
    .click();
  await expect(estados).toContainText('Comercial: Aprobada');
  await expect(estados).toContainText('Operación: Sin nota de pedido');
  await expect(flujo.getByRole('button', { name: 'Ir a pagos' })).toBeVisible();
  const anticipo = Math.ceil(especial.total * 0.5);
  await flujo.getByLabel(/^Monto recibido/).fill(String(anticipo));
  await flujo.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(estados).toContainText('Operación: 50 % pagado');
  const descargaNota = page.waitForEvent('download');
  await flujo.getByRole('button', { name: /^Generar notas? de pedido$/ }).click();
  // Cada paso de la operación pide confirmación.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Todo a Panguipulli' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Generar nota de pedido', exact: true }).click();
  const numeroNota = await numeroDe(descargaNota, 'Nota de pedido');
  await expect(estados).toContainText('Operación: Nota de pedido generada');
  const notaPdf = await textoPdf(`${DIR_E2E}/pdf/nota-pedido-panguipulli-${numeroNota}.pdf`);
  expect(notaPdf).toMatch(new RegExp(`Nota de pedido\\s+N\\.º ${numeroNota}`));
  expect(notaPdf).toMatch(new RegExp(`Cotización\\s+N\\.º ${numero}`));
  expect(notaPdf).toContain('Referencia de catálogo: HUIL-M-3-E');
  expect(notaPdf).toContain('Medida solicitada: 835 × 2360 mm (Vano)');
  for (const monto of [
    fabrica.lineas[0].precioUnitario,
    fabrica.lineas[0].total,
    fabrica.neto,
    fabrica.iva,
    fabrica.total,
  ])
    expect(notaPdf).toContain(pesos(monto));
  // Fábrica no ve el precio del cliente ni su total.
  for (const monto of [unitario, especial.lineas[0].total, especial.total])
    expect(notaPdf).not.toContain(pesos(monto));

  // 8. Producción, saldo, despacho con transportista y destino, y cierre de la operación.
  await flujo.getByRole('button', { name: 'Iniciar producción' }).click();
  // Cada paso de la operación pide confirmación.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Iniciar producción', exact: true }).click();
  await expect(estados).toContainText('Operación: En producción');
  await flujo.getByRole('button', { name: 'Marcar producción terminada' }).click();
  // Cada paso de la operación pide confirmación.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Marcar producción terminada', exact: true }).click();
  await expect(estados).toContainText('Operación: Saldo pendiente');
  await expect(
    flujo.getByText(/Faltan .* para continuar con el despacho/),
  ).toBeVisible();
  await expect(flujo.getByRole('button', { name: 'Marcar lista para despacho' })).toHaveCount(0);
  await flujo.getByLabel(/^Monto recibido/).fill(String(especial.total - anticipo));
  await flujo.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(estados).toContainText('Operación: 100 % pagado');
  await expect(estados).toContainText('Comercial: Vendida');
  await panel.locator('.quote-details > summary').filter({ hasText: 'Despacho' }).click();
  await panel.getByRole('button', { name: 'Editar destino', exact: true }).click();
  await panel.getByLabel('Destino', { exact: true }).fill('Osorno');
  await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Editar destino: Osorno' })).toBeVisible();
  await panel.getByRole('combobox', { name: 'Transportista' }).click();
  await panel.getByRole('option', { name: 'Starken', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: 'Transportista' })).toContainText('Starken');
  await flujo.getByRole('button', { name: 'Marcar lista para despacho' }).click();
  // Cada paso de la operación pide confirmación.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Marcar lista para despacho', exact: true }).click();
  await expect(estados).toContainText('Operación: Lista para despacho');
  await flujo.getByRole('button', { name: 'Registrar despacho' }).click();
  // Cada paso de la operación pide confirmación.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Registrar despacho', exact: true }).click();
  await expect(estados).toContainText('Operación: Despachada');
  await flujo.getByRole('button', { name: 'Completar operación' }).click();
  // Cada paso de la operación pide confirmación.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Completar operación', exact: true }).click();
  await expect(estados).toContainText('Operación: Completada');
  await expect(estados).toContainText('Facturación: Pendiente de facturación');

  // 9. Persistencia: al recargar, el historial conserva los estados y el rastro completo de la actividad.
  await page.reload();
  await expect(page.getByLabel('Vista previa de la cotización')).toBeVisible();
  await page.getByRole('link', { name: 'Historial' }).click();
  await expect(fila).toHaveCount(1);
  const estadoFila = fila.locator('.history-estado');
  await expect(estadoFila).toContainText('Aprobada');
  await expect(estadoFila).toContainText('Vendida');
  await expect(estadoFila).toContainText('Completada');
  await expect(estadoFila).toContainText(`Pagada · ${pesos(especial.total)}`);
  await expect(enlace).toContainText(`Nota N° ${numeroNota}`);
  await expect(enlace).toContainText(pesos(especial.total));
  await fila.getByText('Actividad', { exact: true }).click();
  const actividad = fila.locator('.actividad');
  await expect(actividad).toContainText('Transportista: Starken · Destino: Osorno');
  // Cronología (la lista muestra lo más reciente primero); ediciones repetidas se cuentan una vez.
  const hitos = [
    'Emitida',
    'Aprobada',
    'Pago registrado',
    'Nota de pedido generada',
    'Producción iniciada',
    'Producción terminada',
    'Pago registrado',
    'Despacho actualizado',
    'Lista para despacho',
    'Despachada',
    'Completada',
  ];
  await expect
    .poll(async () => {
      const eventos = (await actividad.locator('li strong').allTextContents()).reverse();
      return eventos.filter((e) => hitos.includes(e)).filter((e, i, todos) => e !== todos[i - 1]);
    })
    .toEqual(hitos);

  // La cotización reabierta conserva el detalle editado a mano, el despacho y los documentos.
  await enlace.click();
  await expect(panel.getByRole('heading', { name: `N° ${numero}` })).toBeVisible();
  await expect(total).toHaveText(pesos(especial.total));
  await expect(estados).toContainText('Comercial: Vendida');
  await expect(estados).toContainText('Operación: Completada');
  await expect(panel.locator('td strong').first()).toHaveText(DESCRIPCION);
  await expect(panel.getByText('HUIL-M-3-E', { exact: true })).toBeVisible();
  await expect(
    panel.getByText('Ganancia estándar: 55 % · Ganancia aplicada: 42 % · cambiada a mano en esta línea', {
      exact: true,
    }),
  ).toBeVisible();
  await panel.locator('.quote-details > summary').filter({ hasText: 'Despacho' }).click();
  await expect(panel.getByRole('combobox', { name: 'Transportista' })).toContainText('Starken');
  await expect(panel.getByRole('combobox', { name: 'Transportista' })).toBeDisabled();
  await expect(panel.getByText('Osorno', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Editar destino/ })).toHaveCount(0);
  await expect(panel.getByText(`Nota de pedido N° ${numeroNota}`)).toBeVisible();
  for (const archivo of [`cotizacion-${numero}.pdf`, `nota-pedido-panguipulli-${numeroNota}.pdf`])
    expect((await page.request.get(`/api/documento/${archivo}`)).ok()).toBe(true);

  const guardada = (await new Almacen(DIR_E2E).leer()).cotizaciones.find((q) => q.numero === numero)!;
  expect(guardada).toMatchObject({
    estado: 'aprobada',
    estadoComercial: 'vendida',
    estadoOperativo: 'completada',
    despacho: { transporte: 'Starken', destino: 'Osorno' },
  });
  expect(guardada.cliente.nombre).toBe('Juan Pérez');
  expect(guardada.solicitudes).toHaveLength(1);
  expect(guardada.solicitudes[0]).toMatchObject({
    cantidad: 3,
    ancho: 0.835,
    alto: 2.36,
    tipoMedida: 'vano',
    descripcion: DESCRIPCION,
    margen: 0.42,
  });
  expect(guardada.montos.total).toBe(especial.total);
  expect(guardada.pagos?.map((p) => p.monto)).toEqual([anticipo, especial.total - anticipo]);
  expect(guardada.notas[0]?.numero).toBe(numeroNota);
  expect(guardada.notas[0]?.montos.total).toBe(fabrica.total);
});

import { test, expect, type Locator, type Page } from './fixtures-e2e';
import { accion, completarOperacion, crearBorrador, crearEmitida, totalDe } from './api-e2e';
import { ADMIN_E2E, iniciarSesion } from './login-e2e';

// Pantallas en el teléfono, en modo táctil (isMobile + hasTouch): Historial con filas reales, el scroll del chat
// dentro de la página, las pestañas de Ajustes y Starken, el teléfono en horizontal, el barrido de anchos, la
// papelera, «Avanzado», el registro de cambios, los diálogos de la operación, el pago con decimales, compartir el
// PDF y «volver un paso» desde «Completada». Las cotizaciones se preparan por la API y la prueba solo mide.
// Corre después de flujo.e2e.ts (orden alfabético): emite, y la 323 y la nota 1 son de esa prueba.

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const ANCHOS = [320, 360, 390, 412, 640, 768];

const sinScrollHorizontal = (page: Page, contexto = '') =>
  expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), { message: contexto })
    .toBeLessThanOrEqual(0);

/** La caja del elemento cabe en el ancho de la ventana (no se corta a los lados). */
async function cabeEnAncho(page: Page, locator: Locator, contexto = '') {
  const caja = await locator.boundingBox();
  const ancho = page.viewportSize()!.width;
  expect(caja, contexto).not.toBeNull();
  expect(caja!.x, contexto).toBeGreaterThanOrEqual(-0.5);
  expect(caja!.x + caja!.width, contexto).toBeLessThanOrEqual(ancho + 0.5);
}

/** El elemento está a la vista y nada lo tapa (p. ej. la barra fija de la cotización): el punto central es suyo. */
async function aLaVistaSinTapar(locator: Locator) {
  await expect(locator).toBeInViewport({ ratio: 1 });
  const propio = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const encima = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!encima && (el === encima || el.contains(encima));
  });
  expect(propio, 'otro elemento tapa el aviso').toBe(true);
}

async function abrirCotizacion(page: Page, id: string) {
  await page.goto(`/?cotizacion=${encodeURIComponent(id)}`);
  // En el teléfono se elige la vista: «Cotización» en un borrador o emitida, «Seguimiento» si está aprobada.
  const pestana = page
    .getByRole('navigation', { name: 'Vista del cotizador' })
    .getByRole('button', { name: /^(Cotización|Seguimiento)$/ });
  await pestana.click();
  await expect(pestana).toHaveAttribute('aria-pressed', 'true');
}

test('Historial con filas reales a 320, 360 y 390 px: el cliente se lee y la fila no se estira', async ({ page }) => {
  await iniciarSesion(page);
  const sufijo = Date.now().toString(36);
  const clientes = [`Constructora Lago Ranco ${sufijo}`, `Inmobiliaria Los Coihues ${sufijo}`, `María José Fuentealba ${sufijo}`];
  await crearBorrador(page.request, { cliente: clientes[0], comuna: 'Futrono', proyecto: 'Cabañas del lago' });
  await crearEmitida(page.request, { cliente: clientes[1], comuna: 'Puerto Varas', cantidad: 4, rutCuerpo: '77111222' });
  await crearEmitida(page.request, { cliente: clientes[2], comuna: 'Valdivia', aprobar: true, rutCuerpo: '12345678' });

  await page.goto('/historial');
  const filas = page.locator('section.history .history-list li').filter({ hasText: sufijo });
  await expect(filas).toHaveCount(3);
  for (const ancho of [320, 360, 390]) {
    await page.setViewportSize({ width: ancho, height: 844 });
    await sinScrollHorizontal(page, `Historial a ${ancho} px`);
    for (let i = 0; i < 3; i++) {
      const fila = filas.nth(i);
      const enlace = fila.locator('.history-fila');
      const cliente = fila.locator('.history-client');
      const cajaCliente = (await cliente.boundingBox())!;
      const cajaFila = (await enlace.boundingBox())!;
      // El nombre del cliente tiene su ancho: no queda en una columna estrecha que lo parta palabra por palabra.
      expect(cajaCliente.width, `cliente de la fila ${i + 1} a ${ancho} px`).toBeGreaterThanOrEqual(200);
      expect(cajaFila.height, `alto de la fila ${i + 1} a ${ancho} px`).toBeLessThan(260);
      await cabeEnAncho(page, enlace, `fila ${i + 1} a ${ancho} px`);
      await cabeEnAncho(page, fila.getByRole('button', { name: /^Duplicar cotización/ }), `Duplicar a ${ancho} px`);
    }
  }
  await page.screenshot({ path: 'test-results/movil-historial-320.png', fullPage: false });
});

test('scroll anidado del chat: el gesto desplaza primero la conversación y después la página', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'El gesto táctil se sintetiza con CDP (solo Chromium).');
  await iniciarSesion(page);
  const nueva = page.getByRole('button', { name: 'Nueva cotización' });
  if (await nueva.isVisible()) await nueva.click();
  const pedido = page.getByRole('button', { name: 'Pedido', exact: true });
  if (await pedido.isVisible()) await pedido.click();
  const mensajes = page.locator('.messages');
  // Conversación más alta que su caja: preguntas sin producto (la IA fija responde sin tocar la cotización).
  for (let i = 0; i < 6; i++) {
    const respuesta = page.waitForResponse((r) => r.url().endsWith('/api/accion') && r.request().method() === 'POST');
    await page.getByLabel('Escribe tu pedido').fill(`¿Hacen despachos a Panguipulli? Consulta ${i + 1}`);
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await respuesta;
    await expect(mensajes).not.toHaveAttribute('aria-busy', 'true');
    if (await mensajes.evaluate((el) => el.scrollHeight > el.clientHeight + 200)) break;
  }
  await expect.poll(() => mensajes.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(150);

  // La conversación arriba y a la vista, con la página en una posición intermedia.
  await mensajes.evaluate((el) => {
    el.scrollTop = 0;
    el.scrollIntoView({ block: 'center' });
  });
  const caja = (await mensajes.boundingBox())!;
  const x = Math.round(caja.x + caja.width / 2);
  let y = Math.round(caja.y + caja.height / 2);
  const cdp = await page.context().newCDPSession(page);
  const gesto = (distancia: number, velocidad = 1200) =>
    cdp.send('Input.synthesizeScrollGesture', {
      x,
      y,
      yDistance: -distancia,
      gestureSourceType: 'touch',
      speed: velocidad,
      preventFling: velocidad > 600,
    });
  const medir = () =>
    page.evaluate(() => ({
      pagina: window.scrollY,
      chat: document.querySelector('.messages')!.scrollTop,
      maximo: document.querySelector('.messages')!.scrollHeight - document.querySelector('.messages')!.clientHeight,
    }));

  const antes = await medir();
  await gesto(120);
  const dentro = await medir();
  expect(dentro.chat, 'el gesto dentro de la conversación la desplaza').toBeGreaterThan(antes.chat + 40);
  expect(Math.abs(dentro.pagina - antes.pagina), 'la página no se mueve mientras la conversación tiene recorrido').toBeLessThan(2);

  // Al final de la conversación, el gesto siguiente pasa a la página: nadie queda atrapado en el chat. La página
  // parte arriba para que tenga recorrido hacia abajo.
  await page.evaluate(() => window.scrollTo(0, 0));
  await mensajes.evaluate((el) => (el.scrollTop = el.scrollHeight));
  const alFinal = await medir();
  const recorrido = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  expect(recorrido, 'la página tiene algo que desplazar').toBeGreaterThan(30);
  expect(alFinal.chat).toBeGreaterThanOrEqual(alFinal.maximo - 1);
  const arriba = (await mensajes.boundingBox())!;
  y = Math.round(Math.min(arriba.y + arriba.height / 2, 844 - 60));
  // Chromium deja el primer gesto enganchado al chat que acaba de llegar a su final (el de la fase anterior lo
  // retenía); el siguiente ya pasa a la página, como en el teléfono. Se permiten hasta tres gestos.
  let pagina = alFinal.pagina;
  for (let intento = 0; intento < 3 && pagina < Math.min(recorrido, 40) - 1; intento++) {
    await gesto(200, 300);
    await page.waitForTimeout(400);
    pagina = (await medir()).pagina;
  }
  expect(pagina, 'la página sigue al llegar al final del chat').toBeGreaterThanOrEqual(Math.min(recorrido, 40) - 1);
  expect((await medir()).chat).toBeGreaterThanOrEqual(alFinal.maximo - 1);
  await cdp.detach();
});

test('Ajustes en el teléfono: pestañas a la vista y Starken con los campos alineados y el error visible', async ({ page }) => {
  await iniciarSesion(page, ADMIN_E2E);
  await page.goto('/ajustes');
  const nav = page.getByRole('navigation', { name: 'Secciones de ajustes' });
  const titulo = page.locator('#seccion-titulo');
  for (const [pestana, encabezado] of [
    ['Asistente', 'Asistente'],
    ['Datos de la empresa', 'Datos de la empresa'],
    ['Precios y descuentos', 'Precios y descuentos'],
    ['Cotizaciones', 'Vigencia y transportistas'],
    ['Usuarios', 'Usuarios'],
    ['Starken', 'Despacho con Starken'],
    ['Mi cuenta', 'Mi cuenta'],
  ]) {
    const enlace = nav.getByRole('link', { name: pestana, exact: true });
    await enlace.tap();
    await expect(titulo).toHaveText(encabezado);
    await expect(enlace).toHaveAttribute('aria-current', 'page');
    // La fila de pestañas se desplaza sola para dejar la activa a la vista.
    await expect(enlace).toBeInViewport({ ratio: 0.9 });
    await sinScrollHorizontal(page, `Ajustes · ${pestana}`);
  }

  await nav.getByRole('link', { name: 'Starken', exact: true }).tap();
  const formulario = page.getByRole('form', { name: 'Despacho con Starken' });
  await expect(page.getByLabel('Puertas: peso por unidad (kg)')).toBeEnabled();
  const pesos = formulario.getByLabel(/: peso por unidad \(kg\)$/);
  const espesores = formulario.getByLabel(/: espesor \(cm\)$/);
  const n = await pesos.count();
  expect(n).toBeGreaterThanOrEqual(3);
  await expect(espesores).toHaveCount(n);
  const cajas = async (l: Locator) => Promise.all(Array.from({ length: n }, (_, i) => l.nth(i).boundingBox()));
  const cajasPeso = await cajas(pesos);
  const cajasEspesor = await cajas(espesores);
  for (let i = 0; i < n; i++) {
    // Cada campo, del mismo ancho y en la misma columna que los de las otras familias.
    expect(Math.abs(cajasPeso[i]!.x - cajasPeso[0]!.x), `peso ${i + 1}`).toBeLessThan(1);
    expect(Math.abs(cajasPeso[i]!.width - cajasPeso[0]!.width), `peso ${i + 1}`).toBeLessThan(1);
    expect(Math.abs(cajasEspesor[i]!.x - cajasEspesor[0]!.x), `espesor ${i + 1}`).toBeLessThan(1);
    expect(Math.abs(cajasEspesor[i]!.width - cajasEspesor[0]!.width), `espesor ${i + 1}`).toBeLessThan(1);
    await cabeEnAncho(page, pesos.nth(i), `peso ${i + 1}`);
    await cabeEnAncho(page, espesores.nth(i), `espesor ${i + 1}`);
    // Táctil: cada campo se puede tocar con el dedo.
    expect(cajasPeso[i]!.height).toBeGreaterThanOrEqual(40);
  }
  // Un dato incompleto no se guarda: el error queda a la vista sin desplazarse a buscarlo.
  await page.getByLabel('Marcos: peso por unidad (kg)').fill('3,5');
  await formulario.getByRole('button', { name: 'Guardar cambios' }).tap();
  const alerta = page.getByRole('alert').filter({ hasText: 'Marcos: completa el peso y el espesor' });
  await expect(alerta).toBeVisible();
  await aLaVistaSinTapar(alerta);
  await cabeEnAncho(page, alerta, 'error de Starken');
  await sinScrollHorizontal(page, 'Starken con error');
  await page.screenshot({ path: 'test-results/movil-starken-error.png' });
  // Se deshace lo escrito para no dejar la sección con cambios sin guardar.
  await page.getByLabel('Marcos: peso por unidad (kg)').fill('');
});

test('teléfono en horizontal (844 × 390): sin desplazamiento lateral y con la barra de la cotización a la vista', async ({ page }) => {
  await iniciarSesion(page);
  const borrador = await crearBorrador(page.request, { cliente: 'Cliente Horizontal' });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(`/?cotizacion=${encodeURIComponent(borrador.id)}`);
  const pestana = page.getByRole('button', { name: 'Cotización', exact: true });
  if (await pestana.isVisible()) await pestana.click();
  const barra = page.getByLabel('Resumen y acciones de la cotización');
  await expect(barra).toBeInViewport();
  const cajaBarra = (await barra.boundingBox())!;
  // La barra fija no se come la pantalla: deja al menos la mitad del alto para el detalle.
  expect(cajaBarra.height).toBeLessThanOrEqual(390 / 2);
  await sinScrollHorizontal(page, 'cotizador en horizontal');
  await expect(page.getByLabel('Cotización en curso').getByText('HUIL-O-3-B', { exact: true }).first()).toBeVisible();
  for (const ruta of ['/historial', '/ajustes', '/catalogo', '/clientes', '/ayuda']) {
    await page.goto(ruta);
    await expect(page.locator('h1').first()).toBeVisible();
    await sinScrollHorizontal(page, `${ruta} en horizontal`);
  }
  await page.screenshot({ path: 'test-results/movil-horizontal.png' });
});

test('barrido de anchos 320–768 en las pantallas principales', async ({ page }) => {
  await iniciarSesion(page);
  const borrador = await crearBorrador(page.request, { cliente: 'Cliente Barrido de Anchos' });
  for (const ruta of [`/?cotizacion=${encodeURIComponent(borrador.id)}`, '/historial', '/catalogo', '/clientes', '/ajustes', '/ayuda']) {
    await page.goto(ruta);
    await expect(page.locator('h1').first()).toBeVisible();
    for (const ancho of ANCHOS) {
      await page.setViewportSize({ width: ancho, height: 844 });
      await sinScrollHorizontal(page, `${ruta} a ${ancho} px`);
      await cabeEnAncho(page, page.locator('h1').first(), `título de ${ruta} a ${ancho} px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
});

test('papelera, «Avanzado» y registro de cambios a 390 px', async ({ page }) => {
  await iniciarSesion(page, ADMIN_E2E);
  // Un borrador en la papelera.
  const cliente = `Borrador Móvil Eliminado ${Date.now().toString(36)}`;
  const borrador = await crearBorrador(page.request, { cliente });
  await accion(page.request, { tipo: 'eliminar', id: borrador.id, actualizada: borrador.actualizada });
  await page.goto('/historial');
  await page.getByRole('group', { name: 'Filtrar por estado' }).getByRole('button', { name: 'Papelera' }).tap();
  const fila = page.locator('section.history .history-list li').filter({ hasText: cliente });
  await expect(fila).toContainText('Eliminado');
  const restaurar = fila.getByRole('button', { name: `Restaurar borrador de ${cliente}` });
  await restaurar.scrollIntoViewIfNeeded();
  await cabeEnAncho(page, fila, 'fila de la papelera');
  await cabeEnAncho(page, restaurar, 'Restaurar');
  expect((await restaurar.boundingBox())!.height).toBeGreaterThanOrEqual(40);
  await sinScrollHorizontal(page, 'papelera');

  // «Avanzado» de Precios y del Asistente, abiertos.
  await page.goto('/ajustes?seccion=precios');
  for (const [seccion, resumen] of [
    ['precios', /^Avanzado · IVA y ganancia por categoría/],
    ['asistente', /^Avanzado/],
  ] as const) {
    await page.goto(`/ajustes?seccion=${seccion}`);
    const avanzado = page.locator('details.ajustes-avanzado').filter({ has: page.locator('summary', { hasText: resumen }) }).first();
    const summary = avanzado.locator('> summary');
    await summary.scrollIntoViewIfNeeded();
    if (!(await avanzado.evaluate((d) => (d as HTMLDetailsElement).open))) await summary.tap();
    await expect(avanzado.locator('.ajustes-avanzado-aviso')).toBeVisible();
    await cabeEnAncho(page, avanzado, `Avanzado de ${seccion}`);
    for (const campo of await avanzado.locator('input:visible, select:visible, textarea:visible').all())
      await cabeEnAncho(page, campo, `campo de Avanzado de ${seccion}`);
    await sinScrollHorizontal(page, `Avanzado de ${seccion}`);
  }

  // Registro de cambios de Usuarios: tabla apilada que cabe en el teléfono.
  await page.goto('/ajustes?seccion=usuarios');
  const registro = page.locator('h3', { hasText: 'REGISTRO DE CAMBIOS' });
  await registro.scrollIntoViewIfNeeded();
  await expect(registro).toBeVisible();
  const tabla = page.locator('table', { has: page.locator('th', { hasText: 'CAMBIO' }) });
  await expect(tabla.locator('tbody tr').first()).toBeVisible();
  for (const celda of await tabla.locator('tbody tr').first().locator('td').all()) await cabeEnAncho(page, celda, 'celda del registro');
  await sinScrollHorizontal(page, 'registro de cambios');
  await page.screenshot({ path: 'test-results/movil-registro-cambios.png', fullPage: true });
});

test('operación táctil a 390 px: diálogos de la nota y de producción caben y el pago con decimales avisa a la vista', async ({
  page,
}) => {
  await iniciarSesion(page);
  const aprobada = await crearEmitida(page.request, { cliente: 'Cliente Pago Táctil', aprobar: true, cantidad: 3 });
  const total = await totalDe(page.request, aprobada.id);
  await abrirCotizacion(page, aprobada.id);
  const flujo = page.getByLabel('Cotización en curso').locator('.quote-workflow');
  const estados = flujo.locator('.workflow-states');
  const monto = flujo.getByLabel(/^Monto recibido/);
  const registrar = flujo.getByRole('button', { name: 'Registrar pago' });

  // «1.234,5» tiene decimales: no se registra y el aviso queda a la vista, por encima de la barra fija.
  await monto.scrollIntoViewIfNeeded();
  await monto.tap();
  await monto.fill('1.234,5');
  await registrar.tap();
  const error = flujo.locator('.workflow-payment').getByRole('alert');
  await expect(error).toHaveText('Escribe un monto en pesos, sin decimales.');
  await expect(monto).toHaveAttribute('aria-invalid', 'true');
  await aLaVistaSinTapar(error);
  const barra = page.getByLabel('Resumen y acciones de la cotización');
  const cajaBarra = await barra.boundingBox();
  if (cajaBarra) expect((await error.boundingBox())!.y + (await error.boundingBox())!.height).toBeLessThanOrEqual(cajaBarra.y + 0.5);
  await expect(flujo.locator('.workflow-ledger')).toHaveCount(0);

  // Con punto de miles y sin decimales sí es un monto: el anticipo.
  const anticipo = Math.ceil(total * 0.5);
  await monto.fill(anticipo.toLocaleString('es-CL'));
  await expect(error).toHaveCount(0);
  await registrar.tap();
  await expect(flujo.locator('.workflow-ledger')).toContainText(`$${anticipo.toLocaleString('es-CL')}`);

  const dialogoCabe = async (dialogo: Locator, aceptar: string) => {
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toBeInViewport({ ratio: 1 });
    await cabeEnAncho(page, dialogo, aceptar);
    for (const nombre of ['Cancelar', aceptar]) {
      const boton = dialogo.getByRole('button', { name: nombre, exact: true });
      await expect(boton).toBeInViewport({ ratio: 1 });
      expect((await boton.boundingBox())!.height, `${nombre}: alto táctil`).toBeGreaterThanOrEqual(40);
    }
    await sinScrollHorizontal(page, aceptar);
  };
  await flujo.getByRole('button', { name: /^Generar notas? de pedido$/ }).tap();
  const nota = page.getByRole('alertdialog', { name: '¿Generar las notas de pedido?' });
  await dialogoCabe(nota, 'Generar nota de pedido');
  await page.screenshot({ path: 'test-results/movil-dialogo-nota.png' });
  await nota.getByRole('button', { name: 'Todo a Panguipulli' }).tap();
  await nota.getByRole('button', { name: 'Generar nota de pedido', exact: true }).tap();
  await expect(estados).toContainText('Operación: Nota de pedido generada');

  await flujo.getByRole('button', { name: 'Iniciar producción' }).tap();
  const produccion = page.getByRole('alertdialog', { name: '¿Iniciar producción?' });
  await dialogoCabe(produccion, 'Iniciar producción');
  await produccion.getByRole('button', { name: 'Cancelar', exact: true }).tap();
  await expect(produccion).toHaveCount(0);
  await expect(estados).toContainText('Operación: Nota de pedido generada');
});

test('«volver un paso» desde «Completada» anuncia el destino «Despachada»', async ({ page }) => {
  await iniciarSesion(page);
  const completada = await completarOperacion(
    page.request,
    await crearEmitida(page.request, { cliente: 'Cliente Operación Completa', aprobar: true }),
  );
  expect(completada.estadoOperativo).toBe('completada');
  await abrirCotizacion(page, completada.id);
  const flujo = page.getByLabel('Cotización en curso').locator('.quote-workflow');
  await expect(flujo.locator('.workflow-states')).toContainText('Operación: Completada');
  const volver = flujo.getByRole('button', { name: 'Volver al paso anterior' });
  await volver.scrollIntoViewIfNeeded();
  await volver.tap();
  const dialogo = page.getByRole('alertdialog', { name: 'Volver al paso anterior' });
  await expect(dialogo).toContainText('La operación vuelve de «Completada» a «Despachada»');
  await expect(dialogo).toBeInViewport({ ratio: 1 });
  await dialogo.getByRole('button', { name: 'Cancelar' }).tap();
  await expect(dialogo).toHaveCount(0);
  await expect(flujo.locator('.workflow-states')).toContainText('Operación: Completada');
});

test('compartir el PDF: cancelar no avisa, «no permitido» pide otro toque y un segundo rechazo explica qué hacer', async ({
  page,
}) => {
  // El teléfono ofrece «Compartir» si admite archivos; se simula la hoja del sistema y su respuesta.
  await page.addInitScript(() => {
    const w = window as unknown as { __compartir: { respuestas: string[]; llamadas: number } };
    w.__compartir = { respuestas: [], llamadas: 0 };
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        w.__compartir.llamadas++;
        const r = w.__compartir.respuestas.shift() ?? 'ok';
        if (r !== 'ok') throw new DOMException('Simulado', r);
      },
    });
  });
  await iniciarSesion(page);
  const emitida = await crearEmitida(page.request, { cliente: 'Cliente Compartir' });
  await abrirCotizacion(page, emitida.id);
  const responder = (...respuestas: string[]) =>
    page.evaluate((r) => ((window as unknown as { __compartir: { respuestas: string[] } }).__compartir.respuestas = r), respuestas);
  const llamadas = () => page.evaluate(() => (window as unknown as { __compartir: { llamadas: number } }).__compartir.llamadas);
  const compartir = page.getByRole('button', { name: /^Compartir / }).first();
  await expect(compartir).toBeVisible();
  const avisos = page.getByRole('status').or(page.getByRole('alert'));

  // AbortError: la persona cerró la hoja; no es un error y no se avisa nada.
  await responder('AbortError');
  await compartir.tap();
  await expect.poll(llamadas).toBe(1);
  await page.waitForTimeout(300);
  await expect(avisos.filter({ hasText: /compartir/i })).toHaveCount(0);

  // NotAllowedError en el primer intento (la descarga gastó el toque): se ofrece compartir con otro toque.
  // El PDF ya descargado se reutiliza: el segundo rechazo ya no es por el toque y se explica qué hacer.
  await abrirCotizacion(page, emitida.id);
  await responder('NotAllowedError', 'NotAllowedError');
  await compartir.tap();
  const listo = page.getByRole('status').filter({ hasText: 'El PDF está listo para compartir.' });
  await expect(listo).toBeVisible();
  await listo.getByRole('button', { name: 'Compartir' }).tap();
  await expect(
    page.getByRole('alert').filter({ hasText: 'No se pudo compartir el PDF. Descárgalo y envíalo desde tus archivos.' }),
  ).toBeVisible();
  await expect.poll(llamadas).toBe(2);
});

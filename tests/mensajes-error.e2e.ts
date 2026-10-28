import { test, expect, type Page } from './fixtures-e2e';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { guardarConfiguracionStarken } from '../src/servidor/starken-configuracion';
import { accion, crearBorrador, leer } from './api-e2e';
import { ADMIN_E2E, DIR_E2E, iniciarSesion } from './login-e2e';

// Errores que antes llegaban como 500 («El cotizador tuvo un problema…») y hoy se explican en pantalla: el descuento
// máximo sobre 50 en Ajustes, la copia que recorta el descuento al máximo vigente y la tarifa de Starken que quedó
// vieja porque la cotización cambió en otra pestaña. «Emitir sin Chromium» lo cubre tests/pdf-numeracion.test.ts
// (503 sin reservar el número); en pantalla se revisa con la configuración aparte playwright.prod.config.ts.

const sin500 = (page: Page) => expect(page.getByText(/tuvo un problema \(error 5\d\d\)/)).toHaveCount(0);

async function configuracionNegocio(page: Page) {
  const r = await page.request.get('/api/configuracion-negocio');
  expect(r.ok()).toBe(true);
  return ((await r.json()) as { configuracion: Record<string, unknown> & { reglas: Record<string, unknown> } }).configuracion;
}

test('Ajustes: un descuento máximo sobre 50 % se explica junto al campo y la API responde 400 en español', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await iniciarSesion(page, ADMIN_E2E);
  await page.goto('/ajustes?seccion=precios');
  const campo = page.getByLabel('Descuento máximo (%)');
  const original = await campo.inputValue();
  await campo.fill('60');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(campo).toHaveAttribute('aria-invalid', 'true');
  await expect(campo).toHaveAccessibleDescription('No puede superar 50 %.');
  await sin500(page);
  await page.getByRole('button', { name: 'Descartar cambios' }).click();
  await expect(campo).toHaveValue(original);

  // Sin pasar por el formulario (otra versión de la pantalla, una llamada a mano): 400 con el motivo, no un 500.
  const actual = await configuracionNegocio(page);
  const r = await page.request.post('/api/configuracion-negocio', {
    data: { ...actual, reglas: { ...actual.reglas, descuentoMaximo: 60 } },
  });
  expect(r.status()).toBe(400);
  const { error } = (await r.json()) as { error: string };
  expect(error).toMatch(/50/);
  expect(error).toBe('El descuento máximo no puede superar 50 %.');
});

test('duplicar recorta el descuento al máximo vigente y lo avisa, desde el cotizador y desde el historial', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await iniciarSesion(page, ADMIN_E2E);
  const cliente = `Cliente Copia Recortada ${Date.now().toString(36)}`;
  let q = await crearBorrador(page.request, { cliente });
  q = await accion(page.request, { tipo: 'editar', id: q.id, actualizada: q.actualizada, descuento: 40 });
  expect(q.descuento).toBe(40);
  const original = await configuracionNegocio(page);
  const fijarMaximo = async (maximo: number) => {
    const r = await page.request.post('/api/configuracion-negocio', {
      data: { ...original, reglas: { ...original.reglas, descuentoMaximo: maximo } },
    });
    expect(r.ok(), await r.text()).toBe(true);
  };
  try {
    await fijarMaximo(30);
    // Desde el historial: la copia se abre en el cotizador y el aviso llega con ella.
    await page.goto('/historial');
    await page.getByLabel('Buscar cotizaciones').fill(cliente);
    const fila = page.locator('section.history .history-list li').filter({ hasText: cliente });
    await expect(fila).toHaveCount(1);
    await fila.getByRole('button', { name: /^Duplicar cotización/ }).click();
    await expect(page).toHaveURL(/\/(\?cotizacion=.*)?$/);
    await expect(page.getByLabel('Cotización en curso')).toBeVisible();
    await expect(page.getByText('Descuento 40 % → 30 % por el máximo permitido.')).toBeVisible();
    await sin500(page);
    // Desde el cotizador: «Más acciones» → «Duplicar».
    // La copia que se abrió no tiene nada que recortar: se vuelve al original.
    await page.goto(`/?cotizacion=${encodeURIComponent(q.id)}`);
    await expect(page).toHaveURL(/\/$/); // el router limpió la URL: ya no hay viaje en curso
    const panel = page.getByLabel('Cotización en curso');
    await panel.getByRole('button', { name: /^Más acciones/ }).click();
    await panel.locator('.menu-acciones').getByRole('button', { name: 'Duplicar', exact: true }).click();
    await expect(page.getByText('Descuento 40 % → 30 % por el máximo permitido.')).toBeVisible();
    await sin500(page);

  } finally {
    await fijarMaximo(original.reglas.descuentoMaximo as number);
  }
});

test('una tarifa de Starken cotizada antes de que la cotización cambiara en otra pestaña se rechaza con su motivo', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const db = abrirBaseDatos(`${DIR_E2E}/cotizador.sqlite`, { permitirJsonLegado: true, cachear: false });
  const vacia = { kg: null, espesorCm: null };
  guardarConfiguracionStarken(
    { origen: { codigoCiudad: 1, nombre: 'SANTIAGO' }, paquete: { PUERTA: { kg: 25, espesorCm: 4.5 }, MARCO: vacia, MOLDURA: vacia, PIEZAS_T: vacia } },
    db,
  );
  try {
    await iniciarSesion(page);
    let q = await crearBorrador(page.request, { cliente: 'Cliente Tarifa Vieja', cantidad: 2 });
    q = await accion(page.request, {
      tipo: 'editar', id: q.id, actualizada: q.actualizada, despacho: { transporte: 'Starken', destino: 'Temuco' },
    });
    await page.goto(`/?cotizacion=${encodeURIComponent(q.id)}`);
    await expect(page).toHaveURL(/\/$/); // el router limpió la URL: ya no hay viaje en curso
    const panel = page.getByLabel('Cotización en curso');
    await panel.locator('.quote-details > summary').filter({ hasText: 'Despacho' }).click();
    const respuestaCotizar = page.waitForResponse((r) => r.url().endsWith('/api/starken/cotizar'));
    await panel.getByRole('button', { name: 'Cotizar con Starken' }).click();
    const cotizada = (await (await respuestaCotizar).json()) as {
      destino: { codigoCiudad: number; nombre: string };
      tarifas: Record<string, string | number>[];
    };
    const tarifas = panel.getByLabel('Tarifas de Starken');
    await expect(tarifas.getByRole('listitem')).toHaveCount(2);

    // En otra pestaña (aquí, por la API, sin que esta pantalla se entere) cambian la cantidad: el bulto ya no es
    // el cotizado.
    const vigente = await leer(page.request, q.id);
    await accion(page.request, {
      tipo: 'editar', id: q.id, actualizada: vigente.actualizada, cantidades: [{ indice: 0, cantidad: 5 }],
    });
    await tarifas.getByRole('button', { name: /^Usar esta tarifa: Domicilio/ }).click();
    // La pantalla tenía la versión anterior: se avisa, se carga la actual y la tarifa vieja ya no se ofrece.
    await expect(
      page.getByRole('alert').filter({ hasText: 'La cotización cambió mientras la tenías abierta.' }),
    ).toBeVisible();
    await expect(tarifas).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /^Editar cantidad de/ })).toContainText('5');
    await sin500(page);

    // Con la versión al día (otra pantalla que no la descartó), la tarifa firmada para 2 puertas se rechaza con su
    // motivo, no con un 500.
    const domicilio = cotizada.tarifas.find((t) => t.tipoEntrega === 'DOMICILIO')!;
    const actual = await leer(page.request, q.id);
    const r = await page.request.post('/api/accion', {
      data: {
        tipo: 'editar', id: q.id, actualizada: actual.actualizada, despacho: { valor: Math.round(Number(domicilio.costoTotal) / 1.19) },
        tarifaStarken: {
          tipoEntrega: domicilio.tipoEntrega, servicio: domicilio.servicio, dias: domicilio.dias, costoTotal: domicilio.costoTotal,
          ciudadDestino: cotizada.destino.nombre, codigoCiudadDestino: cotizada.destino.codigoCiudad,
          vence: domicilio.vence, firma: domicilio.firma, huellaBulto: domicilio.huellaBulto,
        },
      },
    });
    expect(r.status()).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe('El pedido cambió. Vuelve a cotizar el despacho.');
    const final = await leer(page.request, q.id);
    expect(final.flete).toBe(0);
    expect((final.solicitudes as { cantidad: number }[])[0].cantidad).toBe(5);
  } finally {
    db.prepare('DELETE FROM ajustes WHERE clave = ?').run('starken');
    db.close();
  }
});

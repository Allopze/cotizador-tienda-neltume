import { test, expect, type Page } from './fixtures-e2e';
import { digitoVerificador } from '../src/negocio/cliente';
import { iniciarSesion } from './login-e2e';

// Edición en el detalle de la cotización: largos de accesorios hasta 6 m, medidas escritas como se escriben
// (coma, punto, «cm», «mm»), lo escrito que no se pierde al llegar otra versión, el autocompletar del cliente y el
// transportista «Otro» que no se guarda hasta escribir su nombre.

const rut = (cuerpo: string) => `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${digitoVerificador(cuerpo)}`;

async function agregarPuerta(page: Page) {
  await page.getByRole('button', { name: /Agregar producto/ }).first().click();
  const dialogo = page.getByRole('dialog', { name: 'Agregar producto' });
  await dialogo.getByLabel('Busca por modelo, madera o código').fill('HUIL-O-3-B');
  await dialogo.locator('.producto-resultados button').first().click();
  await dialogo.getByLabel('Ancho (m)', { exact: true }).fill('0,8');
  await dialogo.getByLabel('La medida corresponde a').selectOption('hoja');
  await dialogo.getByRole('button', { name: 'Agregar al pedido' }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(page.getByLabel('Cotización en curso').getByText('HUIL-O-3-B', { exact: true }).first()).toBeVisible();
}

/** Abre un campo del detalle, escribe y guarda. */
async function guardarCampo(page: Page, boton: RegExp, etiqueta: string, valor: string) {
  const panel = page.getByLabel('Cotización en curso');
  await panel.getByRole('button', { name: boton }).click();
  await panel.getByLabel(etiqueta, { exact: true }).fill(valor);
  await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
}

test('una moldura de 3,6 m se ve y se edita con el rango de 6 m de los accesorios', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await iniciarSesion(page);
  const panel = page.getByLabel('Cotización en curso');

  // Pedido especial: antes el formulario solo admitía hasta 3 m.
  await page.getByRole('button', { name: /Agregar producto/ }).first().click();
  await page.getByRole('dialog', { name: 'Agregar producto' }).getByRole('button', { name: 'Crear producto personalizado' }).click();
  const form = page.getByRole('dialog', { name: 'Producto personalizado' });
  await form.getByLabel('Nombre del producto').fill('Cornisa de prueba largo');
  await form.getByRole('combobox', { name: 'Tipo de producto' }).click();
  await form.getByRole('option', { name: 'Moldura' }).click();
  await form.getByLabel('Madera').fill('Roble');
  await form.getByLabel('Cantidad').fill('2');
  await form.getByLabel('Largo (m) · opcional').fill('7');
  await form.getByLabel('Precio unitario sin IVA ($)').fill('20.000');
  await form.getByRole('button', { name: 'Agregar al pedido' }).click();
  await expect(form.getByText('Indica un largo entre 0,3 y 6 m')).toBeVisible();
  await form.getByLabel('Largo (m) · opcional').fill('3,60');
  await form.getByRole('button', { name: 'Agregar al pedido' }).click();
  await expect(form).toHaveCount(0);
  await expect(panel.getByText('Incompleto · no suma al total')).toHaveCount(0);

  await panel.locator('.item-details > summary').first().click();
  const largo = panel.getByRole('button', { name: /^Editar alto \/ largo \(m\)/ });
  await expect(largo).toHaveText(/3,60/);
  await expect(panel.getByText('Agregar alto o largo')).toHaveCount(0);
  // En centímetros y sobre 3 m: lo admite el rango del accesorio.
  await guardarCampo(page, /^Editar alto \/ largo \(m\)/, 'Alto / largo (m)', '450 cm');
  await expect(largo).toHaveText(/4,50/);
  await expect(largo).toBeFocused();
  // Sobre 6 m se explica, sin guardar.
  await largo.click();
  await panel.getByLabel('Alto / largo (m)', { exact: true }).fill('6,5');
  await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Indica un largo entre 0,3 y 6 m');
  await panel.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(largo).toHaveText(/4,50/);
});

test('una moldura de más de 3 m del catálogo se agrega y muestra su largo', async ({ page }) => {
  await iniciarSesion(page);
  // La planilla de prueba no trae molduras de más de 3 m: se agrega una al catálogo por la API, como el alta manual.
  type Producto = { codigo: string; familia: string; modelo: string; largo: number };
  const molduras = async () =>
    ((await (await page.request.get('/api/catalogo?familia=MOLDURA')).json()).productos as Producto[]).filter(
      (p) => p.modelo.toUpperCase() === 'CORNISA LARGA E2E',
    );
  if (!(await molduras()).length) {
    const propuesta = await page.request.post('/api/catalogo', {
      data: {
        tipo: 'manual',
        producto: {
          modelo: 'Cornisa Larga E2E', familia: 'MOLDURA', madera: 'Roble', tipo: null, medida: '20x70 mm',
          anchoMin: null, anchoMax: null, largo: 3.6, precioNeto: 12000,
        },
      },
    });
    expect(propuesta.ok(), await propuesta.text()).toBe(true);
    const { id } = (await propuesta.json()) as { id: string };
    const confirmada = await page.request.post('/api/catalogo', { data: { tipo: 'confirmar', id } });
    expect(confirmada.ok(), await confirmada.text()).toBe(true);
  }
  const [larga] = await molduras();
  expect(larga.largo).toBe(3.6);
  await page.getByRole('button', { name: /Agregar producto/ }).first().click();
  const dialogo = page.getByRole('dialog', { name: 'Agregar producto' });
  await dialogo.getByLabel('Busca por modelo, madera o código').fill(larga.codigo);
  await dialogo.locator('.producto-resultados button').first().click();
  await dialogo.getByRole('button', { name: 'Agregar al pedido' }).click();
  await expect(dialogo).toHaveCount(0);
  const panel = page.getByLabel('Cotización en curso');
  await expect(panel.getByText(larga.codigo, { exact: true })).toBeVisible();
  await expect(panel.getByText('Incompleto · no suma al total')).toHaveCount(0);
  await panel.locator('.item-details > summary').first().click();
  await expect(panel.getByRole('button', { name: /^Editar alto \/ largo \(m\)/ })).toHaveText(/3,60/);
});

test('ancho y alto aceptan coma, punto, centímetros y milímetros, y avisan en vez de guardar vacío', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await iniciarSesion(page);
  await agregarPuerta(page);
  const panel = page.getByLabel('Cotización en curso');
  await panel.locator('.item-details > summary').first().click();
  const ancho = panel.getByRole('button', { name: /^Editar ancho \(m\)/ });
  await expect(ancho).toHaveText(/0,80/);
  // El campo abre con coma decimal, como se escribe en Chile.
  await ancho.click();
  await expect(panel.getByLabel('Ancho (m)', { exact: true })).toHaveValue('0,8');
  await panel.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(ancho).toBeFocused();

  for (const [escrito, visto] of [
    ['0,81', '0,81'],
    ['0.82', '0,82'],
    ['80 cm', '0,80'],
    ['815 mm', '0,815'],
    ['80', '0,80'],
  ]) {
    await guardarCampo(page, /^Editar ancho \(m\)/, 'Ancho (m)', escrito);
    await expect(ancho, escrito).toHaveText(new RegExp(visto));
    // Tras guardar, el foco vuelve al valor (no al body): en el teléfono el teclado no salta.
    await expect(ancho).toBeFocused();
  }
  await guardarCampo(page, /^Editar alto \/ largo \(m\)/, 'Alto / largo (m)', '2100 mm');
  await expect(panel.getByRole('button', { name: /^Editar alto \/ largo \(m\)/ })).toHaveText(/2,10/);

  // Lo que no es una medida, o queda fuera del rango de una puerta, se explica y no se guarda vacío.
  for (const escrito of ['ochenta', '3,6', '']) {
    await ancho.click();
    await panel.getByLabel('Ancho (m)', { exact: true }).fill(escrito);
    await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(panel.getByRole('alert'), escrito).toContainText('Indica un ancho entre 0,3 y 3 m');
    await panel.getByRole('button', { name: 'Cancelar', exact: true }).click();
  }
  await expect(ancho).toHaveText(/0,80/);
  await expect(panel.getByText('Incompleto · no suma al total')).toHaveCount(0);
});

test('autocompletar del cliente y lo escrito que no se pierde cuando otra vendedora guarda', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await iniciarSesion(page);
  // Cotización anterior del cliente, creada por la API como la habría hecho otra vendedora.
  const rutCliente = rut('76111222');
  const creada = await page.request.post('/api/accion', {
    data: { tipo: 'agregar_producto', codigo: 'HUIL-O-3-B', cantidad: 1, ancho: 0.8, alto: 2.1, tipoMedida: 'hoja' },
  });
  expect(creada.ok()).toBe(true);
  const anterior = (await creada.json()).cotizacion;
  const conCliente = await page.request.post('/api/accion', {
    data: {
      tipo: 'editar', id: anterior.id, actualizada: anterior.actualizada,
      cliente: { nombre: 'Constructora Autocompletar Sur', rut: rutCliente, giro: 'Construcción', telefono: '+56 9 8765 4321', direccion: 'Los Aromos 12', comuna: 'Temuco', proyecto: 'Casa vieja' },
    },
  });
  expect(conCliente.ok()).toBe(true);

  await agregarPuerta(page);
  const panel = page.getByLabel('Cotización en curso');
  await panel.locator('.quote-client-section > summary').click();
  await panel.getByRole('button', { name: /^Editar cliente/ }).click();
  const nombre = panel.getByRole('combobox', { name: 'Cliente', exact: true });
  await nombre.fill('autocompletar s');
  const sugerencia = panel.getByRole('option', { name: /Constructora Autocompletar Sur/ });
  await expect(sugerencia).toBeVisible();
  await expect(sugerencia).toContainText(rutCliente);
  // Con el teclado: flecha abajo y Enter.
  await nombre.press('ArrowDown');
  await expect(nombre).toHaveAttribute('aria-activedescendant', /.+/);
  await nombre.press('Enter');
  await expect(panel.getByRole('button', { name: 'Editar cliente: Constructora Autocompletar Sur' })).toBeVisible();
  await expect(panel.getByRole('button', { name: `Editar rut: ${rutCliente}` })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Editar giro: Construcción' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Editar teléfono: +56 9 8765 4321' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Editar dirección: Los Aromos 12' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Editar ciudad / comuna: Temuco' })).toBeVisible();
  // El proyecto es de cada cotización: no se copia.
  await expect(panel.getByRole('button', { name: 'Editar proyecto', exact: true })).toBeVisible();

  // Por RUT: sugiere al escribir las cifras; Escape cierra la lista y un segundo Escape cancela.
  await panel.getByRole('button', { name: `Editar rut: ${rutCliente}` }).click();
  const campoRut = panel.getByRole('combobox', { name: 'RUT', exact: true });
  await campoRut.fill('76111');
  await expect(panel.getByRole('option', { name: new RegExp(rutCliente.replace(/\./g, '\\.')) })).toBeVisible();
  // En el teléfono la lista cabe en la pantalla y no agrega desplazamiento horizontal.
  await page.setViewportSize({ width: 390, height: 844 });
  const pestana = page.getByRole('button', { name: 'Cotización', exact: true });
  if (await pestana.isVisible()) await pestana.click();
  // Salir del campo cierra la lista: se vuelve a escribir para abrirla en el teléfono.
  await campoRut.fill('761112');
  await expect(panel.getByRole('listbox')).toBeVisible();
  const caja = await panel.getByRole('listbox').boundingBox();
  expect(caja && caja.x >= 0 && caja.x + caja.width <= 390).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await campoRut.press('Escape');
  await expect(panel.getByRole('listbox')).toHaveCount(0);
  await campoRut.press('Escape');
  await expect(panel.getByRole('button', { name: `Editar rut: ${rutCliente}` })).toBeFocused();

  // Se escribe el proyecto y, mientras tanto, otra vendedora guarda una observación en esta cotización.
  await panel.getByRole('button', { name: 'Editar proyecto', exact: true }).click();
  await panel.getByLabel('Proyecto', { exact: true }).fill('Casa a medio escribir');
  const listado = await (await page.request.get('/api/accion?estado=borrador&q=Autocompletar')).json();
  const id = (listado.cotizaciones as { id: string }[]).find((q) => q.id !== anterior.id)!.id;
  const { cotizacion } = await (await page.request.get(`/api/accion?id=${id}`)).json();
  const otra = await page.request.post('/api/accion', {
    data: { tipo: 'editar', id, actualizada: cotizacion.actualizada, observaciones: 'Nota de la otra vendedora' },
  });
  expect(otra.ok()).toBe(true);
  // Al volver a la ventana se relee la cotización (como al volver a la pestaña).
  const observaciones = panel.locator('.quote-details > summary').filter({ hasText: 'Observaciones' });
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(observaciones).toContainText('Nota de la otra vendedora', { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  // Lo escrito sigue ahí y se guarda sobre la versión nueva.
  await expect(panel.getByLabel('Proyecto', { exact: true })).toHaveValue('Casa a medio escribir');
  await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
  const proyecto = panel.getByRole('button', { name: 'Editar proyecto: Casa a medio escribir' });
  await expect(proyecto).toBeVisible();
  await expect(proyecto).toBeFocused();
});

test('transportista: la lista se lee al abrir Despacho y «Otro» no se guarda hasta escribir el nombre', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await iniciarSesion(page);
  await agregarPuerta(page);
  const panel = page.getByLabel('Cotización en curso');
  let lista = ['Transportes Sur Prueba', 'Otro'];
  await page.route('**/api/configuracion-negocio', async (ruta) => {
    if (ruta.request().method() !== 'GET') return ruta.continue();
    const respuesta = await ruta.fetch();
    const cuerpo = await respuesta.json();
    await ruta.fulfill({ response: respuesta, json: { ...cuerpo, configuracion: { ...cuerpo.configuracion, transportistas: lista } } });
  });
  const despacho = panel.locator('.quote-details > summary').filter({ hasText: 'Despacho' });
  const selector = panel.getByRole('combobox', { name: 'Transportista' });
  await despacho.click();
  await selector.click();
  await expect(panel.getByRole('option', { name: 'Transportes Sur Prueba', exact: true })).toBeVisible();
  await expect(panel.getByRole('option', { name: 'Transportes Paredes' })).toHaveCount(0);
  await selector.press('Escape');
  // Cambió en Ajustes: al volver a abrir Despacho se ve sin recargar la página.
  lista = ['Camiones Norte Prueba', 'Otro'];
  await despacho.click();
  await despacho.click();
  await selector.click();
  await expect(panel.getByRole('option', { name: 'Camiones Norte Prueba', exact: true })).toBeVisible();

  // «Otro» abre el nombre y no guarda nada.
  await panel.getByRole('option', { name: 'Otro', exact: true }).click();
  const nombre = panel.getByLabel('Nombre del transportista', { exact: true });
  await expect(nombre).toBeFocused();
  const { cotizaciones } = await (await page.request.get('/api/accion?porPagina=1')).json();
  const leer = async () =>
    (await (await page.request.get(`/api/accion?id=${cotizaciones[0].id}`)).json()).cotizacion.despacho?.transporte ?? null;
  expect(await leer()).toBeNull();
  // Escape vuelve a la selección anterior, sin guardar.
  await nombre.press('Escape');
  await expect(selector).toBeFocused();
  await expect(selector).toContainText('Seleccionar transportista');
  expect(await leer()).toBeNull();

  await selector.click();
  await panel.getByRole('option', { name: 'Otro', exact: true }).click();
  await nombre.fill('Otro');
  await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Escribe el nombre del transportista');
  await nombre.fill('Fletes Araucanía');
  await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(selector).toContainText('Otro · Fletes Araucanía');
  await expect(despacho).toContainText('Fletes Araucanía');
  expect(await leer()).toBe('Fletes Araucanía');
  await page.unroute('**/api/configuracion-negocio');
});

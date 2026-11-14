import { test, expect, type Page } from './fixtures-e2e';
import { digitoVerificador } from '../src/negocio/cliente';
import { ADMIN_E2E, iniciarSesion } from './login-e2e';
import { resolverMedidasAntesDeEmitir } from './medidas-e2e';

const sinScrollHorizontal = (page: Page, contexto = '') =>
  expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
      message: contexto,
    })
    .toBeLessThanOrEqual(0);

const rutConDv = (cuerpo: string) =>
  `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${digitoVerificador(cuerpo)}`;

async function accion(page: Page, data: Record<string, unknown>) {
  const r = await page.request.post('/api/accion', { data });
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()).cotizacion as { id: string; actualizada: string; numero?: number | null };
}

test('Clientes frecuentes: crear con 0 cotizaciones, editar, RUT duplicado, autocompletar y precarga al aprobar (móvil + escritorio)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await iniciarSesion(page);

  const sufijo = Date.now().toString().slice(-4);
  const nombreCliente = `Constructora Lingue ${sufijo}`;
  const rutBody = `768${sufijo}1`;
  const rutLingue = rutConDv(rutBody);

  await page.goto('/clientes');
  await expect(page.getByRole('heading', { name: 'Clientes', level: 1 })).toBeVisible();
  await sinScrollHorizontal(page, 'Clientes inicial 390px');

  // 1. Alta de cliente con 0 cotizaciones y facturación por omisión.
  await page.getByRole('button', { name: 'Nuevo cliente' }).click();
  const dlgNuevo = page.getByRole('dialog', { name: 'Nuevo cliente frecuente' });
  await expect(dlgNuevo).toBeVisible();
  await dlgNuevo.getByLabel('Nombre *').fill(nombreCliente);
  await dlgNuevo.getByLabel('RUT', { exact: true }).fill(rutLingue);
  await dlgNuevo.getByLabel('Giro', { exact: true }).fill('Construcción de obras');
  await dlgNuevo.getByLabel('Teléfono').fill('+56 9 4444 1111');
  await dlgNuevo.getByLabel('Comuna', { exact: true }).fill('Villarrica');
  await dlgNuevo.getByLabel('Dirección', { exact: true }).fill('Av. Costanera 210');
  await dlgNuevo.getByLabel('Correo', { exact: true }).fill('contacto@lingue-e2e.cl');
  await dlgNuevo.getByLabel('Notas (opcional)').fill('Llamar antes de despachar');
  await dlgNuevo.getByRole('radio', { name: 'Factura' }).check();
  await dlgNuevo.getByRole('button', { name: 'Copiar datos de la ficha' }).click();
  await dlgNuevo.getByLabel('Razón social *').fill(`Constructora Lingue Holding ${sufijo} SpA`);
  await dlgNuevo.getByLabel('Correo para factura (opcional)').fill('dte@lingue-e2e.cl');
  await dlgNuevo.getByRole('button', { name: 'Guardar cliente' }).click();
  await expect(dlgNuevo).toHaveCount(0);

  await page.getByLabel('Buscar clientes').fill(nombreCliente);
  const ficha = page.locator('.clientes-lista > li').filter({ hasText: nombreCliente });
  await expect(ficha).toHaveCount(1);
  await expect(ficha).toContainText('Frecuente');
  await expect(ficha).toContainText('0 cotizaciones');
  await sinScrollHorizontal(page, 'Clientes listado con ficha nueva 390px');

  await ficha.locator('summary').click();
  await expect(ficha).toContainText(`Documento habitual: Factura a Constructora Lingue Holding ${sufijo} SpA`);
  await expect(ficha).toContainText('Llamar antes de despachar');

  // Usuario estándar: botón Eliminar no aparece y la API rechaza DELETE con 403.
  await expect(ficha.getByRole('button', { name: 'Eliminar cliente' })).toHaveCount(0);
  const buscado = await (await page.request.get(`/api/clientes?rut=${encodeURIComponent(rutLingue)}`)).json();
  const clienteId = buscado.cliente.id as string;
  const rDelUser = await page.request.delete('/api/clientes', { data: { id: clienteId } });
  expect(rDelUser.status()).toBe(403);

  // 2. Edición del cliente.
  await ficha.getByRole('button', { name: 'Editar' }).click();
  const dlgEditar = page.getByRole('dialog', { name: `Editar cliente: ${nombreCliente}` });
  await dlgEditar.getByLabel('Teléfono').fill('+56 9 7777 8888');
  await dlgEditar.getByRole('button', { name: 'Guardar cliente' }).click();
  await expect(dlgEditar).toHaveCount(0);
  await expect(ficha).toContainText('+56 9 7777 8888');

  // 3. RUT duplicado ofrece «Abrir ficha existente».
  await page.getByRole('button', { name: 'Nuevo cliente' }).click();
  const dlgDup = page.getByRole('dialog', { name: 'Nuevo cliente frecuente' });
  await dlgDup.getByLabel('Nombre *').fill('Intento Duplicado');
  await dlgDup.getByLabel('RUT', { exact: true }).fill(rutLingue.replace(/[.-]/g, ''));
  await dlgDup.getByRole('button', { name: 'Guardar cliente' }).click();
  await expect(dlgDup.getByText(/Ya existe un cliente frecuente con el RUT/)).toBeVisible();
  await dlgDup.getByRole('button', { name: 'Abrir ficha existente' }).click();
  await expect(page.getByRole('dialog', { name: `Editar cliente: ${nombreCliente}` })).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).click();

  // 4. Autocompletar en nueva cotización (escritorio) + precarga estricta por RUT al aprobar.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByLabel('Escribe tu pedido').fill('2 Huilo Huilo oregón 80×210');
  await page.getByRole('button', { name: 'Enviar mensaje' }).click();
  const panel = page.getByLabel('Cotización en curso');
  await expect(panel.getByText('HUIL-O-3-B', { exact: true })).toBeVisible();
  await resolverMedidasAntesDeEmitir(page);

  await panel.locator('.quote-client-section > summary').click();
  await panel.locator('.cliente-nombre').getByRole('button', { name: /Editar|Agregar/ }).click();
  const inputNombre = panel.locator('.cliente-nombre input');
  await inputNombre.fill(sufijo);
  const opcion = panel.locator('.cliente-nombre .selector-opcion', { hasText: nombreCliente });
  await expect(opcion).toContainText('Cliente frecuente');
  await opcion.click();
  await expect(panel).toContainText('+56 9 7777 8888');
  await expect(panel.getByText('Cliente frecuente registrado')).toBeVisible();

  await page.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Emitir la cotización' })
    .getByRole('button', { name: 'Emitir y generar PDF' })
    .click();
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(/^N° \d+$/);
  const idCot = await page.evaluate(() => sessionStorage.getItem('neltume:abierta'));
  expect(idCot).toBeTruthy();

  // Al aprobar se precarga «Factura» y el receptor + correo desde el registro por RUT.
  await page.getByRole('button', { name: 'Registrar aprobación del cliente' }).click();
  const dlgAprobar = page.getByRole('alertdialog', { name: /^¿Aprobar la cotización N° \d+\?$/ });
  await expect(dlgAprobar.getByRole('radio', { name: /^Factura\b/ })).toBeChecked();
  await expect(dlgAprobar.getByLabel('Razón social *')).toHaveValue(`Constructora Lingue Holding ${sufijo} SpA`);
  await expect(dlgAprobar.getByLabel('Correo para factura (opcional)')).toHaveValue('dte@lingue-e2e.cl');
  await dlgAprobar.getByRole('button', { name: 'Registrar aprobación' }).click();
  await expect(dlgAprobar).toHaveCount(0);
  await expect(panel.locator('.workflow-states')).toContainText(
    `Documento: Factura a Constructora Lingue Holding ${sufijo} SpA (${rutLingue})`,
  );

  // B5: autocompletar del receptor desde clientes frecuentes dentro del seguimiento.
  await panel.getByLabel('Razón social *').fill(sufijo);
  const sugReceptor = panel.locator('.receptor-autocompletar .selector-opcion', {
    hasText: `Constructora Lingue Holding ${sufijo} SpA`,
  });
  await expect(sugReceptor).toBeVisible();
  await sugReceptor.click();

  // Editar el cliente maestro NO modifica la cotización ya emitida/aprobada.
  const rGetCli = await page.request.get(`/api/clientes?id=${encodeURIComponent(clienteId)}`);
  const { cliente: cliActual } = await rGetCli.json();
  await page.request.patch('/api/clientes', {
    data: { id: clienteId, actualizado: cliActual.actualizado, nombre: `Lingue Renombrado ${sufijo}`, rut: rutLingue },
  });
  await page.goto(`/?cotizacion=${encodeURIComponent(idCot!)}`);
  await panel.locator('.quote-client-section > summary').click();
  await expect(panel).toContainText(nombreCliente);
  await expect(panel).not.toContainText(`Lingue Renombrado ${sufijo}`);
});

test('B7 y baja lógica admin: guardar desde cotización, promover desde historial y eliminar solo como admin', async ({
  page,
  browser,
}) => {
  await iniciarSesion(page);
  const sufijo = Date.now().toString().slice(-4);
  const rutCarp = rutConDv(`779${sufijo}2`);
  const nombreCarp = `Carpintería Lago ${sufijo}`;
  const nombreHist = `Solo Historial ${sufijo}`;

  // Cotización 1: cliente con RUT aún no registrado -> guardar desde B7 en el panel de la cotización.
  let q1 = await accion(page, { tipo: 'chat', mensaje: 'Cotiza 2 Huilo Huilo oregón de 80 × 2,10' });
  q1 = await accion(page, {
    tipo: 'editar',
    id: q1.id,
    actualizada: q1.actualizada,
    cliente: { nombre: nombreCarp, rut: rutCarp, comuna: 'Pucón' },
  });
  await page.goto(`/?cotizacion=${encodeURIComponent(q1.id)}`);
  await page.getByLabel('Cotización en curso').locator('.quote-client-section > summary').click();
  await page.getByRole('button', { name: 'Guardar como cliente frecuente' }).click();
  await expect(page.getByText('Cliente frecuente registrado')).toBeVisible();

  // Cotización 2: solo nombre, se promueve desde «Guardar como cliente» en /clientes.
  let q2 = await accion(page, { tipo: 'chat', mensaje: 'Cotiza 1 Huilo Huilo oregón de 80 × 2,10' });
  q2 = await accion(page, {
    tipo: 'editar',
    id: q2.id,
    actualizada: q2.actualizada,
    cliente: { nombre: nombreHist, comuna: 'Temuco' },
  });

  await page.goto('/clientes');
  await page.getByLabel('Buscar clientes').fill(nombreHist);
  const filaHist = page.locator('.clientes-lista > li').filter({ hasText: nombreHist });
  await expect(filaHist).toContainText('Solo en cotizaciones');
  await filaHist.locator('summary').click();
  await filaHist.getByRole('button', { name: 'Guardar como cliente' }).click();
  const dlgPromover = page.getByRole('dialog', { name: 'Guardar como cliente frecuente' });
  await dlgPromover.getByRole('button', { name: 'Guardar cliente' }).click();
  await expect(dlgPromover).toHaveCount(0);
  await expect(filaHist).toContainText('Frecuente');

  // Cuenta administradora: da de baja lógica el cliente creado desde B7 y su cotización conserva los datos.
  const ctxAdmin = await browser.newContext();
  const pageAdmin = await ctxAdmin.newPage();
  await iniciarSesion(pageAdmin, ADMIN_E2E);
  await pageAdmin.goto('/clientes');
  await pageAdmin.getByLabel('Buscar clientes').fill(nombreCarp);
  const filaCarp = pageAdmin.locator('.clientes-lista > li').filter({ hasText: nombreCarp });
  await filaCarp.locator('summary').click();
  await filaCarp.getByRole('button', { name: 'Eliminar cliente' }).click();
  const dlgConfirmar = pageAdmin.getByRole('alertdialog', { name: `¿Eliminar a «${nombreCarp}»?` });
  await dlgConfirmar.getByRole('button', { name: 'Eliminar cliente' }).click();
  await expect(dlgConfirmar).toHaveCount(0);
  await expect(pageAdmin.getByText(`Cliente «${nombreCarp}» eliminado del registro.`)).toBeVisible();
  // Como todavía tiene la cotización q1, vuelve a figurar solo como historial y sale del registro frecuente.
  await expect(filaCarp).toContainText('Solo en cotizaciones');
  const rCarp = await pageAdmin.request.get(`/api/clientes?rut=${encodeURIComponent(rutCarp)}`);
  expect((await rCarp.json()).cliente).toBeNull();

  // Si un cliente sin cotizaciones (solo del registro) se da de baja, desaparece del listado.
  const nombreSinCot = `Sin Cotizaciones Admin ${sufijo}`;
  const crearSinCot = await pageAdmin.request.post('/api/clientes', { data: { nombre: nombreSinCot } });
  expect(crearSinCot.status()).toBe(201);
  await pageAdmin.getByLabel('Buscar clientes').fill(nombreSinCot);
  const filaSinCot = pageAdmin.locator('.clientes-lista > li').filter({ hasText: nombreSinCot });
  await expect(filaSinCot).toHaveCount(1);
  await filaSinCot.locator('summary').click();
  await filaSinCot.getByRole('button', { name: 'Eliminar cliente' }).click();
  await pageAdmin.getByRole('alertdialog', { name: `¿Eliminar a «${nombreSinCot}»?` }).getByRole('button', { name: 'Eliminar cliente' }).click();
  await expect(filaSinCot).toHaveCount(0);

  // La cotización q1 sigue existiendo intacta en el panel.
  await pageAdmin.goto(`/?cotizacion=${encodeURIComponent(q1.id)}`);
  await expect(pageAdmin.getByLabel('Cotización en curso')).toContainText(nombreCarp);
  await ctxAdmin.close();

  // Limpiar borradores creados para dejar limpia la bandeja.
  const a1 = await (await page.request.get(`/api/accion?id=${q1.id}`)).json();
  await accion(page, { tipo: 'eliminar', id: q1.id, actualizada: a1.cotizacion.actualizada });
  const a2 = await (await page.request.get(`/api/accion?id=${q2.id}`)).json();
  await accion(page, { tipo: 'eliminar', id: q2.id, actualizada: a2.cotizacion.actualizada });
});

import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SECCIONES } from '../src/app/catalogo/secciones';
import { seccionesVisibles } from '../src/app/ajustes/secciones';
import { Almacen } from '../src/servidor/almacen';
import { accion, completarOperacion, crearBorrador, crearEmitida, totalDe } from './api-e2e';
import { ADMIN_E2E, DIR_E2E, iniciarSesion } from './login-e2e';

// `npm run ss` (playwright.capturas.config.ts): una captura por pantalla y por estado de la cotización, en
// capturas/<escritorio|telefono>/. No revisa nada: si una pantalla cambia de forma, su captura falla sola y las
// demás siguen. Los escenarios se preparan una vez por la API y se comparten entre los dos proyectos.

const ESCENARIOS = join(DIR_E2E, 'ss-escenarios.json');
type Escenarios = Record<'borrador' | 'emitida' | 'aprobada' | 'conAnticipo' | 'conNota' | 'completada' | 'anulada', string>;

async function escenarios(page: Page): Promise<Escenarios> {
  if (existsSync(ESCENARIOS)) return JSON.parse(readFileSync(ESCENARIOS, 'utf8'));
  const r = page.request;
  // Los números de nota que trae cada fábrica al empezar a usar el cotizador.
  const almacen = new Almacen(DIR_E2E);
  almacen.fijarCorrelativoNota('panguipulli', 577);
  almacen.fijarCorrelativoNota('santiago', 59);
  const pagar = async (q: Awaited<ReturnType<typeof crearEmitida>>, parte: number) =>
    accion(r, { tipo: 'pago', id: q.id, actualizada: q.actualizada, monto: Math.ceil((await totalDe(r, q.id)) * parte) });

  const borrador = await crearBorrador(r, { cliente: 'Constructora Los Alerces', cantidad: 3, proyecto: 'Edificio Alerces' });
  const emitida = await crearEmitida(r, { cliente: 'María González', cantidad: 2, comuna: 'Valdivia' });
  const aprobada = await crearEmitida(r, { cliente: 'Pedro Soto', aprobar: true, comuna: 'Osorno' });
  const conAnticipo = await pagar(await crearEmitida(r, { cliente: 'Ana Muñoz', aprobar: true, cantidad: 4 }), 0.5);
  let conNota = await pagar(await crearEmitida(r, { cliente: 'Inmobiliaria Sur', aprobar: true, cantidad: 6 }), 0.5);
  conNota = await accion(r, { tipo: 'generar_nota', id: conNota.id, actualizada: conNota.actualizada, fabrica: 'santiago' });
  const completada = await completarOperacion(r, await crearEmitida(r, { cliente: 'Hotel Puerto Fuy', aprobar: true }));
  const porAnular = await crearEmitida(r, { cliente: 'Luis Rojas', comuna: 'Panguipulli' });
  const anulada = await accion(r, { tipo: 'anular', id: porAnular.id, actualizada: porAnular.actualizada, motivo: 'El cliente desistió' });

  const ids: Escenarios = {
    borrador: borrador.id,
    emitida: emitida.id,
    aprobada: aprobada.id,
    conAnticipo: conAnticipo.id,
    conNota: conNota.id,
    completada: completada.id,
    anulada: anulada.id,
  };
  writeFileSync(ESCENARIOS, JSON.stringify(ids));
  return ids;
}

const telefono = (info: TestInfo) => info.project.name === 'telefono';

async function capturar(page: Page, info: TestInfo, nombre: string) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  // Los avisos de una acción anterior taparían parte de la pantalla.
  for (const cerrar of await page.getByRole('button', { name: 'Cerrar aviso', exact: true }).all())
    if (await cerrar.isVisible()) await cerrar.click();
  // Sin el recuadro de foco que la app pone en el título al abrir una cotización; en un diálogo se deja.
  await page.evaluate(() => {
    if (!document.querySelector('dialog[open]')) (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join('capturas', info.project.name, `${nombre}.png`),
    fullPage: process.env.SS_COMPLETA === '1',
    animations: 'disabled',
    caret: 'hide',
  });
}

/** Abre una cotización; en el teléfono elige la vista «Cotización» o «Seguimiento». */
async function abrir(page: Page, info: TestInfo, id: string, vista?: 'Cotización' | 'Seguimiento') {
  await page.goto(`/?cotizacion=${encodeURIComponent(id)}`);
  await expect(page.getByLabel('Cotización en curso')).toBeVisible();
  if (telefono(info)) {
    const pestana = page
      .getByRole('navigation', { name: 'Vista del cotizador' })
      .getByRole('button', { name: vista ?? /^(Cotización|Seguimiento)$/ });
    await pestana.click();
  } else if (vista === 'Seguimiento') {
    await page.getByLabel('Cotización en curso').locator('.quote-workflow').scrollIntoViewIfNeeded();
  }
}

test.beforeEach(async ({ page }) => {
  await iniciarSesion(page, ADMIN_E2E);
});

test.describe('sin sesión', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.beforeEach(async ({ context }) => context.clearCookies());
  test('01 login', async ({ page }, info) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
    await capturar(page, info, '01-login');
  });
});

test('02 cotizar vacío', async ({ page }, info) => {
  await page.goto('/');
  await capturar(page, info, '02-cotizar-vacio');
});

test('03 borrador', async ({ page }, info) => {
  await abrir(page, info, (await escenarios(page)).borrador, 'Cotización');
  await capturar(page, info, '03-cotizacion-borrador');
});

test('04 diálogo emitir', async ({ page }, info) => {
  await abrir(page, info, (await escenarios(page)).borrador, 'Cotización');
  await page.getByRole('button', { name: 'Emitir y generar PDF', exact: true }).first().click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await capturar(page, info, '04-dialogo-emitir');
});

test('05 emitida', async ({ page }, info) => {
  await abrir(page, info, (await escenarios(page)).emitida, 'Cotización');
  await capturar(page, info, '05-cotizacion-emitida');
});

test('06 diálogo aprobar', async ({ page }, info) => {
  await abrir(page, info, (await escenarios(page)).emitida, 'Cotización');
  await page.getByRole('button', { name: 'Registrar aprobación del cliente' }).first().click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await capturar(page, info, '06-dialogo-aprobar');
});

test('07 aprobada', async ({ page }, info) => {
  await abrir(page, info, (await escenarios(page)).aprobada, 'Seguimiento');
  await capturar(page, info, '07-aprobada-seguimiento');
});

test('08 diálogo nota de pedido', async ({ page }, info) => {
  await abrir(page, info, (await escenarios(page)).conAnticipo, 'Seguimiento');
  await page.getByLabel('Cotización en curso').locator('.quote-workflow').getByRole('button', { name: 'Generar nota de pedido' }).click();
  await expect(page.getByRole('alertdialog', { name: '¿Generar la nota de pedido?' })).toBeVisible();
  await capturar(page, info, '08-dialogo-nota-pedido');
});

test('09 nota generada', async ({ page }, info) => {
  await abrir(page, info, (await escenarios(page)).conNota, 'Seguimiento');
  await capturar(page, info, '09-nota-generada');
});

test('10 completada', async ({ page }, info) => {
  await abrir(page, info, (await escenarios(page)).completada, 'Seguimiento');
  await capturar(page, info, '10-completada');
});

test('11 anulada', async ({ page }, info) => {
  await abrir(page, info, (await escenarios(page)).anulada, 'Cotización');
  await capturar(page, info, '11-anulada');
});

test('12 historial', async ({ page }, info) => {
  await escenarios(page);
  await page.goto('/historial');
  await expect(page.locator('.history-fila').first()).toBeVisible();
  await capturar(page, info, '12-historial');
});

test('13 clientes', async ({ page }, info) => {
  await escenarios(page);
  await page.goto('/clientes');
  await capturar(page, info, '13-clientes');
});

for (const [i, s] of SECCIONES.entries())
  test(`catálogo · ${s.titulo}`, async ({ page }, info) => {
    await page.goto(`/catalogo?seccion=${s.id}`);
    await expect(page.getByRole('heading', { name: s.encabezado }).first()).toBeVisible();
    await capturar(page, info, `${14 + i}-catalogo-${s.id}`);
  });

for (const [i, s] of seccionesVisibles(true).entries())
  test(`ajustes · ${s.titulo}`, async ({ page }, info) => {
    await page.goto(`/ajustes?seccion=${s.id}`);
    await expect(page.getByRole('heading', { name: s.encabezado }).first()).toBeVisible();
    await capturar(page, info, `${14 + SECCIONES.length + i}-ajustes-${s.id}`);
  });

test('ayuda', async ({ page }, info) => {
  await page.goto('/ayuda');
  await capturar(page, info, `${14 + SECCIONES.length + seccionesVisibles(true).length}-ayuda`);
});

test('página inexistente', async ({ page }, info) => {
  await page.goto('/no-existe');
  await capturar(page, info, `${15 + SECCIONES.length + seccionesVisibles(true).length}-pagina-404`);
});

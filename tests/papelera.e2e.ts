import { test, expect, type Page } from '@playwright/test';
import { ADMIN_E2E, iniciarSesion } from './login-e2e';

// Las dos papeleras (borradores en Historial, productos agregados a mano en Catálogo → Gestionar), los filtros
// de seguimiento del historial y el rango de largo al editar. Cada prueba deja lo que crea otra vez eliminado.

async function accion(page: Page, data: Record<string, unknown>) {
  const r = await page.request.post('/api/accion', { data });
  expect(r.ok(), await r.text()).toBe(true);
  return (await r.json()).cotizacion as { id: string; actualizada: string };
}

test('historial: la papelera restaura un borrador eliminado; filtros de seguimiento y búsqueda por teléfono', async ({ page }) => {
  await iniciarSesion(page);
  // Un borrador con un cliente reconocible (IA fija), enviado a la papelera.
  let q = await accion(page, { tipo: 'chat', mensaje: 'Cotiza 3 Huilo Huilo en oregón de 80 × 2,10' });
  q = await accion(page, {
    tipo: 'editar',
    id: q.id,
    actualizada: q.actualizada,
    cliente: { nombre: 'Cliente Papelera', telefono: '+56 9 5555 0123' },
  });
  await accion(page, { tipo: 'eliminar', id: q.id, actualizada: q.actualizada });

  await page.goto('/historial');
  const historial = page.locator('section.history');
  const filtros = page.getByRole('group', { name: 'Filtrar por estado' });
  const buscar = page.getByLabel('Buscar cotizaciones');
  await expect(buscar).toHaveAttribute('placeholder', 'Buscar N°, cliente, RUT, teléfono o producto');
  await expect(historial.locator('.history-list li').filter({ hasText: 'Cliente Papelera' })).toHaveCount(0);

  // 1. Papelera: el borrador eliminado, con su fecha de eliminación, y «Restaurar».
  await filtros.getByRole('button', { name: 'Papelera' }).click();
  await expect(filtros.getByRole('button', { name: 'Papelera' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Exportar CSV' })).toHaveCount(0);
  const enPapelera = historial.locator('.history-list li').filter({ hasText: 'Cliente Papelera' });
  await expect(enPapelera).toContainText('Eliminado');
  await expect(enPapelera).toContainText('1 ítem');
  // La búsqueda filtra también la papelera.
  await buscar.fill('cliente papelera');
  await expect(enPapelera).toHaveCount(1);
  await buscar.fill('nadie se llama así');
  await expect(historial).toContainText('Ningún borrador eliminado coincide con la búsqueda.');
  await buscar.fill('');
  await enPapelera.getByRole('button', { name: 'Restaurar borrador de Cliente Papelera' }).click();
  await expect(historial.getByRole('status')).toContainText('Borrador de Cliente Papelera restaurado: volvió al historial.');
  await expect(enPapelera).toHaveCount(0);

  // 2. Vuelve al listado y se encuentra por teléfono.
  await filtros.getByRole('button', { name: 'Todas' }).click();
  await buscar.fill('955550123');
  await expect(historial.locator('.history-list li').filter({ hasText: 'Cliente Papelera' })).toHaveCount(1);
  await buscar.fill('');

  // 3. Filtros de seguimiento: se piden al servidor.
  const vencen = page.waitForRequest((r) => r.url().includes('/api/accion?') && r.url().includes('vencenPronto=true'));
  await filtros.getByRole('button', { name: 'Vencen pronto' }).click();
  await vencen;
  await expect(filtros.getByRole('button', { name: 'Vencen pronto' })).toHaveAttribute('aria-pressed', 'true');
  const saldo = page.waitForRequest((r) => r.url().includes('/api/accion?') && r.url().includes('saldoPendiente=true'));
  await filtros.getByRole('button', { name: 'Con saldo pendiente' }).click();
  await saldo;
  await expect(historial.locator('.history-list li').filter({ hasText: 'Cliente Papelera' })).toHaveCount(0);
  await filtros.getByRole('button', { name: 'Todas' }).click();

  // Deja el borrador otra vez en la papelera, como lo encontró.
  const { cotizacion } = await (await page.request.get(`/api/accion?id=${q.id}`)).json();
  await accion(page, { tipo: 'eliminar', id: cotizacion.id, actualizada: cotizacion.actualizada });
});

test('catálogo: un producto agregado a mano eliminado se restaura con su autor; editar respeta el alto máximo', async ({ page }) => {
  await iniciarSesion(page, ADMIN_E2E);
  const alta = await page.request.post('/api/catalogo', {
    data: {
      tipo: 'manual',
      producto: {
        modelo: 'Papelera Prueba',
        familia: 'PUERTA',
        madera: 'PINO OREGON',
        tipo: null,
        medida: null,
        anchoMin: 0.6,
        anchoMax: 0.65,
        largo: 2,
        precioNeto: 90000,
      },
    },
  });
  expect(alta.ok(), await alta.text()).toBe(true);
  const confirmado = await page.request.post('/api/catalogo', { data: { tipo: 'confirmar', id: (await alta.json()).id } });
  expect(confirmado.ok(), await confirmado.text()).toBe(true);
  const codigo = (await confirmado.json()).producto.codigo as string;
  try {
    await page.goto('/catalogo?seccion=manuales');
    const gestion = page.locator('.gestion-manuales');
    const fila = gestion
      .getByRole('region', { name: 'Productos encontrados' })
      .getByRole('row')
      .filter({ hasText: codigo });

    // 1. Editar: un alto de 4 m (el servidor lo rechazaría) se avisa en el campo y no se envía.
    await fila.getByRole('button', { name: `Editar ${codigo}` }).click();
    const editor = page.getByRole('dialog');
    await expect(editor).toContainText('entre 0,3 y 3 m');
    await editor.getByLabel('Alto', { exact: true }).fill('4');
    await editor.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(editor).toContainText('Indica un alto entre 0,3 y 3 m: en metros (2,10), centímetros (210 cm) o milímetros (2100 mm).');
    await expect(editor.getByLabel('Alto', { exact: true })).toBeFocused();
    await editor.getByRole('button', { name: 'Cancelar' }).click();

    // 2. Eliminar lo deja en «Productos eliminados», de donde vuelve con quien lo agregó.
    await fila.getByRole('button', { name: `Eliminar ${codigo}` }).click();
    await page
      .getByRole('alertdialog', { name: 'Eliminar producto' })
      .getByRole('button', { name: 'Eliminar producto' })
      .click();
    await expect(page.getByRole('status').filter({ hasText: `Producto ${codigo} eliminado` })).toBeVisible();
    await expect(fila).toHaveCount(0);
    const eliminados = gestion.locator('details.gestion-eliminados');
    await eliminados.locator('summary').click();
    const borrado = eliminados.getByRole('row').filter({ hasText: codigo });
    await expect(borrado).toContainText('Eliminado el');
    await expect(borrado).toContainText('por Administrador de prueba');
    await borrado.getByRole('button', { name: `Restaurar ${codigo}` }).click();
    await expect(page.getByRole('status').filter({ hasText: `Producto ${codigo} restaurado` })).toBeVisible();
    await expect(borrado).toHaveCount(0);
    await expect(fila).toHaveCount(1);
  } finally {
    await page.request.post('/api/catalogo', { data: { tipo: 'eliminar', codigo } });
  }
});

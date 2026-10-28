// Corre después de flujo.e2e.ts (orden alfabético): emite y genera una nota, y flujo espera los primeros correlativos.
import { test, expect } from './fixtures-e2e';
import { accion, crearEmitida, leer, totalDe, type CotizacionApi } from './api-e2e';
import { iniciarSesion } from './login-e2e';

type Nota = { numero: number; pdf: string; montos: { lineas: { cantidad: number }[] } };
const notas = (q: CotizacionApi) => q.notas as Nota[];

// Con la nota de pedido ya generada, la cantidad (y las medidas, hoja o vano, descripción y observación) se corrigen
// desde «Corregir pedido» mientras la fábrica no empiece a producir: cambian la cotización y la nota, con el mismo
// número. El resto del ítem queda como se aprobó.
test('nota generada: «Corregir pedido» cambia la cantidad en la cotización y en la nota, con el mismo número', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await iniciarSesion(page);
  let q = await crearEmitida(page.request, { cliente: 'Cliente Corrige Pedido', aprobar: true });
  const totalAprobado = await totalDe(page.request, q.id);
  q = await accion(page.request, { tipo: 'pago', id: q.id, actualizada: q.actualizada, monto: totalAprobado });
  q = await accion(page.request, { tipo: 'generar_nota', fabrica: 'panguipulli', id: q.id, actualizada: q.actualizada });
  const antes = notas(q)[0];
  await page.goto(`/?cotizacion=${encodeURIComponent(q.id)}`);
  await expect(page).toHaveURL(/\/$/);
  const panel = page.getByLabel('Cotización en curso');
  await expect(panel.locator('#aviso-corregir-pedido')).toContainText('Corregir pedido');
  // El precio no se corrige aquí: sigue siendo el aprobado.
  await expect(panel.getByRole('button', { name: /^Editar precio unitario/i })).toHaveCount(0);
  const editar = panel.getByRole('button', { name: /^Editar cantidad de/ }).first();
  await editar.click();
  const campo = panel.getByLabel(/^Cantidad de/).first();
  await campo.fill('3');
  await campo.press('Enter');
  await expect(editar).toContainText('3');
  const corregida = await leer(page.request, q.id);
  expect(corregida.estado).toBe('aprobada');
  expect(corregida.numero).toBe(q.numero);
  expect(notas(corregida)[0].numero).toBe(antes.numero);
  expect(notas(corregida)[0].pdf).not.toBe(antes.pdf);
  expect(notas(corregida)[0].montos.lineas[0].cantidad).toBe(3);
  // El total subió con la cantidad: se paga la diferencia y, al empezar la producción, ya no se corrige.
  const diferencia = (await totalDe(page.request, q.id)) - totalAprobado;
  expect(diferencia).toBeGreaterThan(0);
  const pagada = await accion(page.request, { tipo: 'pago', id: q.id, actualizada: corregida.actualizada, monto: diferencia });
  await accion(page.request, { tipo: 'operacion', paso: 'iniciar_produccion', id: q.id, actualizada: pagada.actualizada });
  await page.reload();
  await expect(panel.locator('#aviso-corregir-pedido')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /^Editar cantidad de/ })).toHaveCount(0);
});

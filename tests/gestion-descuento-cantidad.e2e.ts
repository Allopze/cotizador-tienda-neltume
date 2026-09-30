import { test, expect } from '@playwright/test';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { guardarConfiguracionNegocio, leerConfiguracionNegocio } from '../src/servidor/configuracion-negocio';
import { RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { cotizar, MARGENES_INICIALES, pesos, REGLAS } from '../src/negocio/precios';
import { DIR_E2E, iniciarSesion, USUARIO_E2E } from './login-e2e';

// Corre después de flujo.e2e.ts (orden alfabético, un solo worker): ese espera que la primera cotización de la base
// sea la suya (la 323 al emitirla). Este tampoco emite nada, así no mueve los correlativos de los demás.
test('descuento por cantidad: se configura en Ajustes, se aplica solo, se fija a mano y se restaura', async ({
  page,
}) => {
  const db = abrirBaseDatos(`${DIR_E2E}/cotizador.sqlite`, { permitirJsonLegado: true });
  const puerta = new RepositorioCatalogoSqlite(db).buscarPorCodigo('HUIL-O-3-B')!;
  const reglas = { ...REGLAS, margenes: MARGENES_INICIALES };
  const total = (cantidad: number, descuento = 0) =>
    pesos(cotizar([{ producto: puerta, cantidad }], reglas, { descuento }).total);
  const fijarTramos = (tramos: { desdePuertas: number; porcentaje: number }[]) => {
    const actual = leerConfiguracionNegocio(db);
    guardarConfiguracionNegocio(
      { ...actual, reglas: { ...actual.reglas, descuentosPorCantidad: tramos } },
      db,
    );
  };
  const rol = db.prepare('UPDATE "user" SET role = ? WHERE email = ?');

  await iniciarSesion(page);
  const aviso = page.getByRole('status');
  try {
    fijarTramos([]);
    // La cuenta de prueba no es administradora: ve la sección, pero no puede editarla.
    await page.goto('/ajustes');
    await expect(page.getByRole('heading', { name: 'DESCUENTO POR CANTIDAD' })).toBeVisible();
    await expect(
      page.getByText('Sin tramos: las cotizaciones no llevan descuento por cantidad.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Agregar tramo' })).toHaveCount(0);

    // Una administradora agrega los tramos, con sus validaciones.
    rol.run('admin', USUARIO_E2E);
    await page.goto('/ajustes');
    await page.getByRole('button', { name: 'Agregar tramo' }).click();
    await page.getByRole('button', { name: 'Agregar tramo' }).click();
    await page.getByLabel('Tramo 1: desde (puertas)').fill('10');
    await page.getByLabel('Tramo 1: descuento (%)').fill('5');
    await page.getByLabel('Tramo 2: desde (puertas)').fill('10');
    await page.getByLabel('Tramo 2: descuento (%)').fill('10');
    const alerta = page.getByRole('alert').filter({ hasText: 'tramo' });
    await expect(alerta).toHaveText('Hay más de un tramo «desde 10 puertas»: cada umbral debe ser distinto.');
    await page.getByRole('button', { name: 'Guardar configuración' }).click();
    await expect(alerta.first()).toContainText('cada umbral debe ser distinto');
    await page.getByLabel('Tramo 2: desde (puertas)').fill('20');
    await page.getByLabel('Tramo 2: descuento (%)').fill('60');
    await expect(alerta).toHaveText(
      'El porcentaje del tramo «desde 20 puertas» no puede superar el descuento máximo (50 %).',
    );
    await page.getByLabel('Tramo 2: descuento (%)').fill('10');
    await expect(alerta).toHaveCount(0);
    // Agregar un tramo y quitarlo no deja nada pendiente.
    await page.getByRole('button', { name: 'Agregar tramo' }).click();
    await page.getByRole('button', { name: 'Quitar el tramo 3' }).click();
    await expect(page.getByLabel('Tramo 3: desde (puertas)')).toHaveCount(0);
    await page.getByRole('button', { name: 'Guardar configuración' }).click();
    await expect(aviso.filter({ hasText: 'Configuración comercial guardada.' })).toBeVisible();
    expect(leerConfiguracionNegocio(db).reglas.descuentosPorCantidad).toEqual([
      { desdePuertas: 10, porcentaje: 5 },
      { desdePuertas: 20, porcentaje: 10 },
    ]);
    // Recargar muestra lo guardado.
    await page.reload();
    await expect(page.getByLabel('Tramo 1: desde (puertas)')).toHaveValue('10');
    await expect(page.getByLabel('Tramo 2: descuento (%)')).toHaveValue('10');
  } finally {
    rol.run('user', USUARIO_E2E);
  }
  // Sin permiso de administradora ve los tramos guardados, sin poder cambiarlos.
  await page.goto('/ajustes');
  await expect(page.getByLabel('Tramo 1: desde (puertas)')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Quitar el tramo 1' })).toHaveCount(0);

  try {
    await page.goto('/');
    const panel = page.getByLabel('Cotización en curso'),
      totalPantalla = page.getByTestId('total'),
      origen = panel.getByTestId('descuento-origen');
    const guardarCampo = async (boton: string | RegExp, etiqueta: string | RegExp, valor: string) => {
      await panel.getByRole('button', { name: boton }).click();
      await panel.getByLabel(etiqueta, { exact: typeof etiqueta === 'string' }).fill(valor);
      await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
    };
    await page
      .getByLabel('Escribe tu pedido')
      .fill('Cotiza 3 Huilo Huilo oregón de 80×210 para Juan Pérez, Temuco');
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    await expect(totalPantalla).toHaveText(total(3));
    // Bajo el primer tramo: no hay descuento y se sugiere el siguiente.
    await expect(origen).toContainText('Descuento por cantidad: aún no aplica (3 puertas)');
    await expect(origen).toContainText('Siguiente tramo: desde 10 puertas −5 %');

    // 10 puertas alcanzan el primer tramo: se aplica solo y se explica.
    await guardarCampo(/^Editar cantidad de/, /^Cantidad de/, '10');
    await expect(totalPantalla).toHaveText(total(10, 5));
    await expect(origen).toContainText('Descuento por cantidad: 10 puertas → 5 %');
    await expect(origen).toContainText('Siguiente tramo: desde 20 puertas −10 %');
    await expect(panel.getByText('5% · −', { exact: false })).toBeVisible();

    // Fijar otro porcentaje lo vuelve manual: ya no sigue a las puertas.
    await guardarCampo('Editar descuento', 'Descuento', '3');
    await expect(totalPantalla).toHaveText(total(10, 3));
    await expect(origen).toContainText('Descuento manual: 3 %');
    await expect(origen).toContainText('Automático: 5 % con 10 puertas');
    await guardarCampo(/^Editar cantidad de/, /^Cantidad de/, '25');
    await expect(totalPantalla).toHaveText(total(25, 3));
    await expect(origen).toContainText('Descuento manual: 3 %');
    // Un descuento manual sigue sujeto al máximo.
    await guardarCampo('Editar descuento', 'Descuento', '60');
    await expect(panel.getByRole('alert')).toContainText('entre 0 y 50%');
    await panel.getByRole('button', { name: 'Cancelar', exact: true }).click();

    // Restaurar el automático: 25 puertas están en el tramo del 10 %, sin tramo siguiente.
    await panel.getByRole('button', { name: 'Restaurar automático' }).click();
    await expect(totalPantalla).toHaveText(total(25, 10));
    await expect(origen).toContainText('Descuento por cantidad: 25 puertas → 10 %');
    await expect(origen).not.toContainText('Siguiente tramo');
    await expect(panel.getByRole('button', { name: 'Restaurar automático' })).toHaveCount(0);

    // Fijar 0 % también es una decisión: la persona no quiere descuento aunque haya tramo.
    await guardarCampo('Editar descuento', 'Descuento', '0');
    await expect(totalPantalla).toHaveText(total(25));
    await expect(origen).toContainText('Descuento manual: 0 %');
    await panel.getByRole('button', { name: 'Restaurar automático' }).click();
    await expect(totalPantalla).toHaveText(total(25, 10));

    // La actividad lo cuenta, y lo guardado se reabre igual desde el historial.
    await page.getByRole('link', { name: 'Historial' }).click();
    // El asistente de prueba siempre pone el mismo cliente: el borrador se reconoce por su total.
    const fila = page
      .locator('.history-list li')
      .filter({ hasText: 'Sin número' })
      .filter({ hasText: total(25, 10) })
      .first();
    await fila.getByText('Actividad', { exact: true }).click();
    const actividad = fila.locator('.actividad');
    await expect(actividad).toContainText('Descuento por cantidad 0 % → 5 % (10 puertas)');
    await expect(actividad).toContainText('Descuento 5 % → 3 % (manual)');
    await expect(actividad).toContainText('Descuento automático restaurado: 3 % → 10 % (25 puertas)');
    await fila.locator('.history-fila').click();
    await expect(totalPantalla).toHaveText(total(25, 10));
    await expect(origen).toContainText('Descuento por cantidad: 25 puertas → 10 %');
  } finally {
    fijarTramos([]);
  }
});

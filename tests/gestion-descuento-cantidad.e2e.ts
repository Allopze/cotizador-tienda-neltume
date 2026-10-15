import { test, expect } from './fixtures-e2e';
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
    await page.goto('/ajustes?seccion=precios');
    await expect(page.getByRole('heading', { name: 'DESCUENTO POR CANTIDAD' })).toBeVisible();
    await expect(
      page.getByText('Sin tramos: las cotizaciones no llevan descuento por cantidad.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Agregar tramo' })).toHaveCount(0);

    // Una administradora agrega los tramos, con sus validaciones.
    rol.run('admin', USUARIO_E2E);
    await page.goto('/ajustes?seccion=precios');
    // El IVA y las ganancias por categoría van plegados en «Avanzado», con su advertencia.
    const ivaCampo = page.getByLabel('IVA (%)');
    const avanzado = page.locator('summary', { hasText: 'Avanzado · IVA y ganancia por categoría' });
    await expect(ivaCampo).toBeHidden();
    await avanzado.click();
    await expect(page.getByText(/Un valor equivocado \(por ejemplo, IVA 1,9 en vez de\s+19\)/)).toBeVisible();
    // Un campo vacío no se guarda como 0: queda marcado, con el foco, hasta corregirlo o descartar. Aunque
    // «Avanzado» se haya vuelto a plegar, guardar lo abre para mostrar el error.
    await expect(ivaCampo).toHaveValue('19');
    await ivaCampo.fill('');
    await avanzado.click();
    await expect(ivaCampo).toBeHidden();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(ivaCampo).toBeVisible();
    await expect(ivaCampo).toHaveAttribute('aria-invalid', 'true');
    await expect(ivaCampo).toBeFocused();
    await page.getByRole('button', { name: 'Descartar cambios' }).click();
    await expect(ivaCampo).toHaveValue('19');
    await expect(ivaCampo).not.toHaveAttribute('aria-invalid', 'true');
    const agregar = page.getByRole('button', { name: 'Agregar tramo' });
    const alerta = page.getByRole('alert').filter({ hasText: /tramo|Desde/ });
    const desde = (n: number) => page.getByLabel(`Tramo ${n}: desde (puertas)`);
    const descuento = (n: number) => page.getByLabel(`Tramo ${n}: descuento (%)`);
    await agregar.click();
    await agregar.click();
    // Las filas vacías recién agregadas no muestran ningún error.
    await expect(alerta).toHaveCount(0);
    await desde(1).fill('10');
    await descuento(1).fill('5');
    await desde(2).fill('10');
    await descuento(2).fill('10');
    // Tampoco se valida mientras se escribe: el aviso sale al salir de la fila.
    await expect(alerta).toHaveCount(0);
    await page.getByRole('heading', { name: 'DESCUENTO POR CANTIDAD' }).click();
    await expect(alerta).toHaveText('Hay más de un tramo «desde 10 puertas»: cada umbral debe ser distinto.');
    // El campo con el problema queda marcado y descrito por el aviso; los demás no.
    await expect(desde(2)).toHaveAttribute('aria-invalid', 'true');
    await expect(desde(2)).toHaveAttribute('aria-describedby', /.+/);
    await expect(desde(1)).not.toHaveAttribute('aria-invalid', 'true');
    // Guardar con el problema avisa una sola vez y lleva el foco al campo.
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(alerta).toHaveCount(1);
    await expect(desde(2)).toBeFocused();
    // Corregir el campo con el problema quita el aviso a medida que se escribe; uno nuevo sale al salir de la fila.
    await desde(2).fill('20');
    await expect(alerta).toHaveCount(0);
    await descuento(2).fill('60');
    await expect(alerta).toHaveCount(0);
    await page.getByRole('heading', { name: 'DESCUENTO POR CANTIDAD' }).click();
    await expect(alerta).toHaveText(
      'El porcentaje del tramo «desde 20 puertas» no puede superar el descuento máximo (50 %).',
    );
    await expect(descuento(2)).toHaveAttribute('aria-invalid', 'true');
    await descuento(2).fill('10');
    await expect(alerta).toHaveCount(0);
    await expect(descuento(2)).not.toHaveAttribute('aria-invalid', 'true');
    // Agregar un tramo y quitarlo deja el foco en «Agregar tramo», sin avisos pendientes.
    await agregar.click();
    await page.getByRole('button', { name: 'Quitar el tramo 3' }).click();
    await expect(desde(3)).toHaveCount(0);
    await expect(agregar).toBeFocused();
    await expect(alerta).toHaveCount(0);
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(aviso.filter({ hasText: 'Precios y descuentos guardados.' })).toBeVisible();
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
  await page.goto('/ajustes?seccion=precios');
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

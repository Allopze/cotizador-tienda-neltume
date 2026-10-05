import { test, expect } from '@playwright/test';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { leerConfiguracionStarken } from '../src/servidor/starken-configuracion';
import { DIR_E2E, iniciarSesion, USUARIO_E2E } from './login-e2e';

// Starken simulado (NELTUME_STARKEN=fijo en playwright.config.ts): ciudades y tarifas fijas, sin red. Las tarifas
// dependen del peso del bulto: agencia = kilos × $1.000 neto; domicilio, $10.000 más; con IVA, × 1,19.
// Corre al final de los flujos y no emite nada: el borrador se elimina al terminar, así no mueve los correlativos.
test('despacho con Starken: ajustes, bulto, tarifas, elección de ciudad y auditoría', async ({ page }) => {
  const db = abrirBaseDatos(`${DIR_E2E}/cotizador.sqlite`, { permitirJsonLegado: true });
  const rol = db.prepare('UPDATE "user" SET role = ? WHERE email = ?');
  const limpiarConfiguracion = () => db.prepare('DELETE FROM ajustes WHERE clave = ?').run('starken');
  limpiarConfiguracion();
  let id: string | null = null;

  await iniciarSesion(page);
  try {
    // --- Un borrador con 3 puertas para Temuco, con Starken de transportista ---
    await page.goto('/');
    const panel = page.getByLabel('Cotización en curso');
    const respuestaChat = page.waitForResponse(
      (r) => r.url().includes('/api/accion') && r.request().method() === 'POST',
    );
    await page
      .getByLabel('Escribe tu pedido')
      .fill('Cotiza 3 Huilo Huilo oregón de 80×210 para Juan Pérez, Temuco');
    await page.getByRole('button', { name: 'Enviar mensaje' }).click();
    id = ((await (await respuestaChat).json()) as { cotizacion: { id: string } }).cotizacion.id;
    await expect(page.getByTestId('total')).not.toHaveText('$0');

    await panel.locator('.quote-details > summary').filter({ hasText: 'Despacho' }).click();
    // Sin transportista Starken no hay botón.
    await expect(panel.getByRole('button', { name: 'Cotizar con Starken' })).toHaveCount(0);

    // --- Starken sin configurar (la API se simula como no disponible): botón desactivado y aviso ---
    await page.route('**/api/starken', (ruta) =>
      ruta.request().method() === 'GET'
        ? ruta.fulfill({
            json: {
              disponible: false,
              mensaje: 'Starken no está configurado',
              configuracion: { origen: null, paquete: {} },
              puedeEditar: false,
            },
          })
        : ruta.continue(),
    );
    await panel.getByRole('combobox', { name: 'Transportista' }).click();
    await panel.getByRole('option', { name: 'Starken', exact: true }).click();
    const boton = panel.getByRole('button', { name: 'Cotizar con Starken' });
    await expect(boton).toBeDisabled();
    await expect(panel.getByText('Starken no está configurado')).toBeVisible();
    await page.unroute('**/api/starken');

    // --- Configurado, pero sin ciudad de origen: desactivado hasta elegirla en Ajustes (los pesos se estiman) ---
    await panel.getByRole('combobox', { name: 'Transportista' }).click();
    await panel.getByRole('option', { name: 'Seleccionar transportista', exact: true }).click();
    await expect(boton).toHaveCount(0);
    await panel.getByRole('combobox', { name: 'Transportista' }).click();
    await panel.getByRole('option', { name: 'Starken', exact: true }).click();
    await expect(boton).toBeDisabled();
    await expect(panel.getByText('Configura la ciudad de origen de Starken en Ajustes')).toBeVisible();
    await expect(panel.getByTestId('starken-bulto')).toHaveCount(0);

    // --- Ajustes: sin ser administradora se ve, pero no se edita ---
    const formularioStarken = page.getByRole('form', { name: 'Despacho con Starken' });
    const irAStarken = () =>
      page
        .getByRole('navigation', { name: 'Secciones de ajustes' })
        .getByRole('link', { name: 'Starken' })
        .click();
    await panel.getByRole('link', { name: 'Abrir Ajustes' }).click();
    await expect(page).toHaveURL(/\/ajustes\?seccion=starken$/);
    await expect(page.getByRole('heading', { name: 'Despacho con Starken', level: 2 })).toBeVisible();
    await expect(page.getByLabel('Puertas: peso por unidad (kg)')).toBeDisabled();
    await expect(formularioStarken.getByRole('button', { name: 'Guardar cambios' })).toHaveCount(0);

    // --- Una administradora elige el origen y define los pesos, con sus validaciones ---
    rol.run('admin', USUARIO_E2E);
    await page.getByRole('link', { name: 'Cotizar', exact: true }).click();
    await expect(panel).toBeVisible();
    await page.getByRole('link', { name: 'Ajustes', exact: true }).click();
    await irAStarken();
    const origen = page.getByLabel('Ciudad de origen');
    await expect(origen.locator('option')).toHaveCount(4);
    await origen.selectOption({ label: 'SANTIAGO' });
    const alerta = page.getByRole('alert').filter({ hasText: /peso|Marcos/ });
    await page.getByLabel('Marcos: peso por unidad (kg)').fill('3,5');
    await formularioStarken.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(alerta).toHaveText('Marcos: completa el peso y el espesor, o deja ambos vacíos.');
    await page.getByLabel('Marcos: peso por unidad (kg)').fill('');
    await page.getByLabel('Puertas: peso por unidad (kg)').fill('veinticinco');
    await page.getByLabel('Puertas: espesor (cm)').fill('4,5');
    await formularioStarken.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(alerta).toContainText('Puertas: el peso por unidad debe ser un número mayor que cero');
    await page.getByLabel('Puertas: peso por unidad (kg)').fill('25');
    await formularioStarken.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Configuración de Starken guardada.' }),
    ).toBeVisible();
    const guardada = leerConfiguracionStarken(db);
    expect(guardada.origen).toEqual({ codigoCiudad: 1, nombre: 'SANTIAGO' });
    expect(guardada.paquete.PUERTA).toEqual({ kg: 25, espesorCm: 4.5 });
    expect(guardada.paquete.MARCO).toEqual({ kg: null, espesorCm: null });
    await page.getByRole('link', { name: 'Historial', exact: true }).click();
    await page.getByRole('link', { name: 'Ajustes', exact: true }).click();
    await irAStarken();
    await expect(page.getByLabel('Puertas: peso por unidad (kg)')).toHaveValue('25');
    await expect(page.getByLabel('Puertas: espesor (cm)')).toHaveValue('4,5');
    await expect(page.getByLabel('Ciudad de origen')).toHaveValue('1');

    // --- De vuelta en la cotización: muestra el bulto y cotiza sin aplicar nada ---
    await page.getByRole('link', { name: 'Cotizar', exact: true }).click();
    await panel.locator('.quote-details > summary').filter({ hasText: 'Despacho' }).click();
    await expect(boton).toBeEnabled();
    // 3 puertas × 4,5 cm = 13,5 cm apilados; el ancho y el alto salen de la medida de la puerta; 3 × 25 = 75 kg.
    await expect(panel.getByTestId('starken-bulto')).toHaveText(
      /^Bulto: 3 puertas · 1 línea · total 13,5 × \d+(?:,\d+)? × \d+(?:,\d+)? cm, 75 kg$/,
    );
    // El valor de despacho es la línea de flete del detalle: sin flete, no hay línea.
    const lineaFlete = panel.locator('#linea-flete');
    await expect(lineaFlete).toHaveCount(0);
    const cotizada = page.waitForResponse((r) => r.url().endsWith('/api/starken/cotizar'));
    await boton.click();
    const tarifasFirmadas = (await (await cotizada).json()) as {
      destino: { codigoCiudad: number; nombre: string };
      tarifas: Record<string, string | number>[];
    };
    const tarifas = panel.getByLabel('Tarifas de Starken');
    await expect(tarifas).toContainText('TEMUCO');
    // El texto del bulto es el que calculó el servidor, con las medidas de la puerta del catálogo.
    await expect(tarifas).toContainText(/Bulto cotizado: 3 puertas · 1 línea · total 13,5 × /);
    await expect(tarifas.getByRole('listitem')).toHaveText([
      /Agencia · 2 días · \$89\.250 IVA incl\. \(\$75\.000 neto\)/,
      /Domicilio · 3 días · \$101\.150 IVA incl\. \(\$85\.000 neto\)/,
    ]);
    // Cotizar no aplica nada: el valor sigue en $0 hasta que la persona elige.
    await expect(lineaFlete).toHaveCount(0);

    // --- Elegir domicilio deja su neto como valor de despacho ---
    await tarifas.getByRole('button', { name: /^Usar esta tarifa: Domicilio/ }).click();
    await expect(
      panel.getByRole('status').filter({ hasText: 'Valor de despacho fijado en $85.000 neto' }),
    ).toBeVisible();
    await expect(lineaFlete.locator('.celda-total')).toHaveText('$85.000');
    await expect(lineaFlete).toContainText('Starken');
    await expect(tarifas).toHaveCount(0);

    // --- Sigue pudiéndose escribir a mano ---
    await lineaFlete.getByRole('button', { name: /^Editar unitario del flete/ }).click();
    await panel.getByLabel('Unitario del flete').fill('90000');
    await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(lineaFlete.locator('.celda-total')).toHaveText('$90.000');

    // --- Destino dudoso: se elige la ciudad de una lista con búsqueda ---
    await panel.getByRole('button', { name: /^Editar destino/ }).click();
    await panel.getByLabel('Destino', { exact: true }).fill('Av. Los Lagos 10, San Pablo');
    await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
    // La comuna del cliente (Temuco) es el respaldo, pero el destino del despacho manda y es dudoso.
    await boton.click();
    const selector = panel.getByRole('group', { name: 'Elegir ciudad de destino' });
    await expect(selector).toContainText('El destino coincide con varias ciudades de Starken');
    const lista = selector.getByRole('list', { name: 'Ciudades de destino' });
    await expect(lista.getByRole('listitem')).toHaveCount(2);
    await expect(lista).toContainText('OSORNO');
    await expect(lista).toContainText('RIO NEGRO');
    await selector.getByLabel('Buscar ciudad o comuna de destino').fill('río');
    await expect(lista.getByRole('listitem')).toHaveCount(1);
    await lista.getByRole('button', { name: /RIO NEGRO/ }).click();
    await expect(tarifas).toContainText('RIO NEGRO');
    await expect(tarifas.getByRole('listitem')).toHaveCount(2);

    // --- Un destino sin cobertura muestra el mensaje de Starken y no cambia nada ---
    await tarifas.getByRole('button', { name: 'Cambiar ciudad' }).click();
    await selector.getByLabel('Buscar ciudad o comuna de destino').fill('williams');
    await lista.getByRole('button', { name: /PUERTO WILLIAMS/ }).click();
    await expect(
      panel.getByRole('alert').filter({ hasText: 'Starken: El destino no tiene cobertura' }),
    ).toBeVisible();
    await expect(lineaFlete.locator('.celda-total')).toHaveText('$90.000');
    await selector.getByRole('button', { name: 'Cancelar' }).click();

    // --- La actividad guarda la tarifa elegida: tipo de entrega, días, costo total y ciudad de destino ---
    const detalle = await page.request.get(`/api/accion?id=${id}`);
    const { eventos, cotizacion } = (await detalle.json()) as {
      eventos: { tipo: string; detalle: string | null }[];
      cotizacion: { flete: number; despacho: { transporte: string; valor: number } };
    };
    expect(cotizacion.flete).toBe(90000);
    expect(cotizacion.despacho).toMatchObject({ transporte: 'Starken', valor: 90000 });
    const tarifaAplicada = eventos.filter((e) => e.detalle?.includes('Tarifa Starken aplicada'));
    expect(tarifaAplicada).toHaveLength(1);
    expect(tarifaAplicada[0].detalle).toContain('Flete $0 → $85.000');
    expect(tarifaAplicada[0].detalle).toContain(
      'Tarifa Starken aplicada: Domicilio · 3 días · $101.150 IVA incl. ($85.000 neto) · destino TEMUCO (ciudad 2)',
    );
    // Los cambios manuales no dicen que vengan de Starken.
    expect(
      eventos.filter((e) => e.detalle?.includes('Flete $85.000 → $90.000') && !e.detalle.includes('Starken')),
    ).toHaveLength(1);

    // --- Una tarifa alterada en la petición (costo menor, con su neto) no se acepta aunque lleve una firma real ---
    const domicilio = tarifasFirmadas.tarifas.find((t) => t.tipoEntrega === 'DOMICILIO')!;
    const vigente = (await (await page.request.get(`/api/accion?id=${id}`)).json()) as {
      cotizacion: { actualizada: string };
    };
    const forjada = await page.request.post('/api/accion', {
      data: {
        tipo: 'editar',
        id,
        actualizada: vigente.cotizacion.actualizada,
        despacho: { valor: 10000 },
        tarifaStarken: {
          tipoEntrega: domicilio.tipoEntrega,
          servicio: domicilio.servicio,
          dias: domicilio.dias,
          costoTotal: 11900,
          ciudadDestino: tarifasFirmadas.destino.nombre,
          codigoCiudadDestino: tarifasFirmadas.destino.codigoCiudad,
          vence: domicilio.vence,
          firma: domicilio.firma,
        },
      },
    });
    expect(forjada.status()).toBe(400);
    expect(((await forjada.json()) as { error: string }).error).toContain(
      'no es válida para esta cotización',
    );
    const intacta = (await (await page.request.get(`/api/accion?id=${id}`)).json()) as {
      cotizacion: { flete: number };
    };
    expect(intacta.cotizacion.flete).toBe(90000);
  } finally {
    rol.run('user', USUARIO_E2E);
    limpiarConfiguracion();
    if (id) {
      const actual = await page.request.get(`/api/accion?id=${id}`);
      if (actual.ok()) {
        const { cotizacion } = (await actual.json()) as { cotizacion: { actualizada: string } };
        await page.request.post('/api/accion', {
          data: { tipo: 'eliminar', id, actualizada: cotizacion.actualizada },
        });
      }
    }
  }
});

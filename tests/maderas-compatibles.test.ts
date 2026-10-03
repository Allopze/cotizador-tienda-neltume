import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pregunta } from '../src/asistente/preguntas';
import { resolverItem } from '../src/catalogo/resolver';
import type { Catalogo, Producto, SolicitudItem } from '../src/catalogo/tipos';
import { preguntasPendientes } from '../src/negocio/pendientes';
import { PreguntasPendientes } from '../src/app/preguntas-pendientes';

const producto = (cambios: Partial<Producto>): Producto => ({
  codigo: 'MAR-F-220', modelo: 'MARCO', familia: 'MARCO', tipo: 'SET DE MARCO',
  madera: 'PINO FINGER', medida: '30X90', anchoMin: null, anchoMax: null,
  largo: 2.2, precioNeto: 50_000, descripcion: 'MARCO', filaOrigen: 1,
  ...cambios,
});
const catalogoDe = (productos: Producto[]): Catalogo => ({
  fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos,
});
const catalogo = catalogoDe([
  ...[2.5, 3].map((largo) => producto({ codigo: `MAR-FE-${largo}`, tipo: null, madera: 'PINO FINGER ENCHAPADO MARA', largo })),
  ...[2.2, 2.4, 2.5, 3].map((largo) => producto({ codigo: `MAR-F-${largo}`, largo })),
  producto({ codigo: 'MAR-L', madera: 'LENGA', medida: '2X4', largo: 2.1 }),
  producto({ codigo: 'MAR-M', madera: 'MARA', medida: '2X5', largo: 2.1 }),
  producto({ codigo: 'PU-EM', modelo: 'HUILO HUILO', familia: 'PUERTA', madera: 'MARA ENCHAPADA' }),
]);
const item = (cambios: Partial<SolicitudItem>): SolicitudItem => ({
  modelo: 'Marco', madera: 'Mara Enchapada', ancho: null, alto: null, medida: null, cantidad: 1,
  ...cambios,
});

describe('maderas compatibles con las medidas pedidas', () => {
  it.each([
    ['Roble inexistente', 'madera_desconocida'],
    ['Mara Enchapada', 'madera_no_disponible'],
  ])('%s ofrece solo las maderas que calzan con la sección y el escalón de alto', (madera, tipo) => {
    const solicitud = item({ madera, medida: '30 x 90', alto: 227 });
    expect(resolverItem(catalogo, solicitud)).toMatchObject({
      ok: false, rechazo: { tipo, disponibles: ['PINO FINGER'] },
    });
    expect(resolverItem(catalogo, { ...solicitud, madera: 'PINO FINGER' })).toMatchObject({
      ok: true, producto: { largo: 2.4 }, ajusteAlto: 'siguiente',
    });
    expect(resolverItem(catalogo, { ...solicitud, alto: null })).toMatchObject({
      ok: false, rechazo: { tipo, disponibles: ['PINO FINGER ENCHAPADO MARA', 'PINO FINGER'] },
    });
  });

  it('sin medidas ofrece todas las maderas del modelo, sin duplicados', () => {
    expect(resolverItem(catalogo, item({}))).toMatchObject({
      ok: false, rechazo: { disponibles: ['PINO FINGER ENCHAPADO MARA', 'PINO FINGER', 'LENGA', 'MARA'] },
    });
  });

  it.each(['4', '2 x 4', '2×4', '2*4'])('normaliza la sección %s de los accesorios antes de filtrar', (medida) => {
    expect(resolverItem(catalogo, item({ medida }))).toMatchObject({
      ok: false, rechazo: { disponibles: ['LENGA'] },
    });
  });

  it('una moldura con medida 4 conserva esa medida, sin convertirla a 2X4', () => {
    const molduras = catalogoDe([
      producto({ modelo: 'GUARDAPOLVO', familia: 'MOLDURA', madera: 'LENGA', medida: '4' }),
      producto({ codigo: 'GUARD-M', modelo: 'GUARDAPOLVO', familia: 'MOLDURA', madera: 'MARA', medida: '2X4' }),
    ]);
    expect(resolverItem(molduras, item({ modelo: 'Guardapolvo', medida: '4' }))).toMatchObject({
      ok: false, rechazo: { disponibles: ['LENGA'] },
    });
  });

  it.each([
    [2.27, ['PINO FINGER']],
    [2.1, ['LENGA', 'MARA']],
    [2, []],
    [3.01, []],
  ])('filtra solo por alto %s si no se pidió sección', (alto, disponibles) => {
    expect(resolverItem(catalogo, item({ alto }))).toMatchObject({ ok: false, rechazo: { disponibles } });
  });

  const puertas = catalogoDe([
    producto({ codigo: 'PU-L-80', modelo: 'MOLCO', familia: 'PUERTA', madera: 'LENGA', anchoMin: 0.8, anchoMax: 0.85, largo: 2.1 }),
    producto({ codigo: 'PU-L-90', modelo: 'MOLCO', familia: 'PUERTA', madera: 'LENGA', anchoMin: 0.9, anchoMax: 0.95, largo: 2.5 }),
    producto({ codigo: 'PU-M-90', modelo: 'MOLCO', familia: 'PUERTA', madera: 'MARA', anchoMin: 0.9, anchoMax: 0.95, largo: 2.1 }),
  ]);

  it.each([
    [82, ['LENGA']],
    [87, ['LENGA']],
    [90, ['LENGA', 'MARA']],
    [79, []],
    [96, []],
  ])('filtra puertas por ancho %s usando los escalones de cada madera', (ancho, disponibles) => {
    expect(resolverItem(puertas, item({ modelo: 'Molco', ancho }))).toMatchObject({
      ok: false, rechazo: { disponibles },
    });
  });

  it('el alto se evalúa en el ancho elegido, sin probar otro ancho ni ignorar rangos de alto', () => {
    expect(resolverItem(puertas, item({ modelo: 'Molco', ancho: 82, alto: 2.5 }))).toMatchObject({
      ok: false, rechazo: { disponibles: [] },
    });
    const conRango = catalogoDe(puertas.productos.map((p) => p.codigo === 'PU-L-80' ? { ...p, altoMin: 2.1, altoMax: 2.4 } : p));
    expect(resolverItem(conRango, item({ modelo: 'Molco', ancho: 82, alto: 2.27 }))).toMatchObject({
      ok: false, rechazo: { disponibles: ['LENGA'] },
    });
  });

  it.each(['Mara Enchapada', 'Roble inexistente'])('sin ninguna madera compatible explica el motivo y conserva el alta (%s)', (madera) => {
    const solicitud = item({ madera, medida: '30X100', alto: 2.27 });
    const res = resolverItem(catalogo, solicitud);
    expect(res).toMatchObject({ ok: false, rechazo: { disponibles: [] } });
    if (res.ok) throw new Error('El ítem debe quedar pendiente');
    const texto = pregunta(res.rechazo, solicitud.modelo);
    expect(texto).toContain('ninguna madera de Marco es compatible con las medidas pedidas.');
    expect(texto).not.toContain('Maderas disponibles:');
    const preguntas = preguntasPendientes({
      solicitudes: [solicitud], incompletos: [{ indice: 0, rechazo: res.rechazo, pregunta: texto }],
    });
    expect(preguntas[0]).toMatchObject({ detalle: texto, opciones: [], alta: { familia: 'MARCO', medida: '30X100' } });
    const h = renderToStaticMarkup(createElement(PreguntasPendientes, {
      preguntas, editable: true, asistente: false, guardando: null, responder: async () => true,
    }));
    expect(h).toContain(texto);
    expect(h).toContain('Agregar al catálogo');
    expect(h).not.toContain('<select');
    expect(h).not.toContain('Maderas disponibles:');
  });

  it('con opciones conserva el formato del texto y el rechazo de madera precede a la cantidad', () => {
    const res = resolverItem(catalogo, item({ medida: '4', cantidad: 0 }));
    if (res.ok) throw new Error('El ítem debe quedar pendiente');
    expect(res.rechazo.tipo).toBe('madera_no_disponible');
    expect(pregunta(res.rechazo, 'Marco')).toBe('Marco no viene en Mara Enchapada. Maderas disponibles: Lenga.');
  });
});

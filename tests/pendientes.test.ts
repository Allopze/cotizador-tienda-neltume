import { describe, expect, it } from 'vitest';
import { cambiosRespuesta, faltantesItem, preguntasPendientes } from '../src/negocio/pendientes';
import type { Rechazo } from '../src/catalogo/resolver';
import type { SolicitudItem } from '../src/catalogo/tipos';

const item = (s: Partial<SolicitudItem>): SolicitudItem => ({
  modelo: 'Huilo Huilo',
  madera: null,
  ancho: 0.8,
  alto: 2.1,
  medida: null,
  cantidad: 3,
  ...s,
});
const faltan = (campos: string[], disponibles: Record<string, string[]> = {}): Rechazo => ({
  tipo: 'faltan_datos',
  campos,
  disponibles,
});
const MADERAS = { madera: ['PINO OREGON', 'LENGA', 'RAULI'] };

describe('preguntas de los ítems pendientes', () => {
  it('agrupa la misma pregunta de varios ítems en una sola, con sus opciones', () => {
    const preguntas = preguntasPendientes({
      solicitudes: [item({}), item({}), item({ madera: 'LENGA' })],
      incompletos: [
        { indice: 0, rechazo: faltan(['madera'], MADERAS), pregunta: '' },
        { indice: 1, rechazo: faltan(['madera'], MADERAS), pregunta: '' },
      ],
    });
    expect(preguntas).toHaveLength(1);
    expect(preguntas[0]).toMatchObject({
      campo: 'madera',
      indices: [0, 1],
      texto: 'Madera para los ítems 1 y 2',
    });
    // El valor que ya tiene otro ítem del pedido se sugiere primero, sin aplicarse solo.
    expect(preguntas[0].opciones[0]).toEqual({
      etiqueta: 'Lenga',
      valor: 'LENGA',
      sugerencia: 'Como el ítem 3',
    });
    expect(preguntas[0].opciones.map((o) => o.valor)).toEqual(['LENGA', 'PINO OREGON', 'RAULI']);
  });

  it('la respuesta se aplica a todos los ítems del grupo con una edición directa', () => {
    const [p] = preguntasPendientes({
      solicitudes: [item({}), item({})],
      incompletos: [
        { indice: 0, rechazo: faltan(['madera'], MADERAS), pregunta: '' },
        { indice: 1, rechazo: faltan(['madera'], MADERAS), pregunta: '' },
      ],
    });
    expect(cambiosRespuesta(p, 'LENGA')).toEqual({
      items: [
        { indice: 0, cambios: { madera: 'LENGA' } },
        { indice: 1, cambios: { madera: 'LENGA' } },
      ],
    });
  });

  it('alto con botones en metros, ancho y cantidad como entrada numérica', () => {
    const preguntas = preguntasPendientes({
      solicitudes: [item({ ancho: null, alto: null, cantidad: null, madera: 'LENGA' })],
      incompletos: [
        {
          indice: 0,
          rechazo: faltan(['ancho', 'alto', 'cantidad'], {
            ancho: ['0,60 A 0,65', '1,30 A 1,35'],
            alto: ['2', '2.1'],
            cantidad: ['Entero entre 1 y 10.000'],
          }),
          pregunta: '',
        },
      ],
    });
    const [ancho, alto, cantidad] = preguntas;
    expect(ancho).toMatchObject({
      campo: 'ancho',
      opciones: [],
      entrada: { min: 0.6, max: 1.35, unidad: 'm' },
    });
    expect(alto.opciones).toEqual([
      { etiqueta: '2,00 m', valor: 2 },
      { etiqueta: '2,10 m', valor: 2.1 },
    ]);
    expect(cantidad).toMatchObject({ campo: 'cantidad', entrada: { min: 1, max: 10000, unidad: null } });
    expect(cambiosRespuesta(cantidad, 4)).toEqual({ cantidades: [{ indice: 0, cantidad: 4 }] });
    expect(cambiosRespuesta(alto, 2.1)).toEqual({ items: [{ indice: 0, cambios: { alto: 2.1 } }] });
  });

  it('un modelo dudoso se confirma con un botón y explica el motivo sin la lista', () => {
    const [p] = preguntasPendientes({
      solicitudes: [item({ modelo: 'Pillo', madera: 'PINO OREGON' })],
      incompletos: [
        {
          indice: 0,
          rechazo: {
            tipo: 'modelo_posible',
            valor: 'Pillo',
            sugerido: 'Huilo Huilo',
            disponibles: ['Huilo Huilo'],
          },
          pregunta: '¿Te refieres a Huilo Huilo? Confírmalo para cotizar.',
        },
      ],
    });
    expect(p.opciones).toEqual([{ etiqueta: 'Confirmar Huilo Huilo', valor: 'Huilo Huilo' }]);
    expect(p.detalle).toBe('¿Te refieres a Huilo Huilo? Confírmalo para cotizar.');
  });

  it('una madera que no existe para el modelo muestra el motivo y las maderas posibles', () => {
    const [p] = preguntasPendientes({
      solicitudes: [item({ madera: 'ROBLE' })],
      incompletos: [
        {
          indice: 0,
          rechazo: { tipo: 'madera_desconocida', valor: 'ROBLE', disponibles: ['LENGA', 'MARA'] },
          pregunta: 'No trabajamos “ROBLE” en este catálogo. Maderas disponibles: Lenga, Mara.',
        },
      ],
    });
    expect(p).toMatchObject({
      campo: 'madera',
      detalle: 'No trabajamos “ROBLE” en este catálogo.',
      opciones: [
        { etiqueta: 'Lenga', valor: 'LENGA' },
        { etiqueta: 'Mara', valor: 'MARA' },
      ],
    });
  });

  it('una medida fuera de catálogo con tramo pide un valor dentro del tramo y sugiere el de otro ítem', () => {
    const [p] = preguntasPendientes({
      solicitudes: [item({ madera: 'LENGA', ancho: 0.82 }), item({ madera: 'LENGA', ancho: 1.6 })],
      incompletos: [
        {
          indice: 1,
          rechazo: {
            tipo: 'medida_no_disponible',
            campo: 'ancho',
            valor: 1.6,
            disponibles: [],
            rango: { min: 0.6, max: 1.45 },
          },
          pregunta: 'Huilo Huilo no viene en 1,60 m de ancho. Se cotizan anchos entre 0,60 y 1,45 m.',
        },
      ],
    });
    expect(p.entrada).toMatchObject({ min: 0.6, max: 1.45 });
    expect(p.opciones).toEqual([{ etiqueta: '0,82 m', valor: 0.82, sugerencia: 'Como el ítem 1' }]);
  });

  it('un producto ambiguo no se responde con un control: queda el texto', () => {
    const [p] = preguntasPendientes({
      solicitudes: [item({ madera: 'LENGA' })],
      incompletos: [
        {
          indice: 0,
          rechazo: { tipo: 'producto_ambiguo', valor: 'HUILO HUILO', disponibles: ['A: uno', 'B: otro'] },
          pregunta: 'Hay más de un producto…',
        },
      ],
    });
    expect(p).toMatchObject({
      campo: null,
      opciones: [],
      entrada: null,
      texto: 'Revisa el ítem 1 (Huilo Huilo)',
    });
    expect(cambiosRespuesta(p, 'x')).toEqual({});
  });

  it('resume qué falta en cada ítem', () => {
    const q = {
      incompletos: [{ indice: 1, rechazo: faltan(['madera', 'alto']), pregunta: '' }],
    };
    expect(faltantesItem(q, 0)).toBeNull();
    expect(faltantesItem(q, 1)).toEqual(['madera', 'alto']);
  });
});

import { describe, expect, it } from 'vitest';
import { pregunta } from '../src/asistente/preguntas';
import { preguntasPendientes } from '../src/negocio/pendientes';
import { respuestaDirecta } from '../src/asistente/respuesta-directa';
import { resolverItem, resolverNombres } from '../src/catalogo/resolver';
import type { Catalogo, Producto, SolicitudItem } from '../src/catalogo/tipos';

const MADERAS = ['PINO OREGON', 'LENGA', 'RAULI'];
const puerta = (madera: string, ancho: number, largo: number): Producto => ({
  codigo: `MOL-${madera[0]}-${ancho}-${largo}`,
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera,
  medida: `${ancho} A ${ancho + 0.05}`,
  anchoMin: ancho,
  anchoMax: ancho + 0.05,
  largo,
  precioNeto: 100_000,
  descripcion: 'MOLCO',
  filaOrigen: 1,
});
const marco = (madera: string, medida: string, largo: number): Producto => ({
  codigo: `MAR-${madera[0]}-${medida}-${largo}`,
  modelo: 'MARCO',
  familia: 'MARCO',
  tipo: 'PULG KIT',
  madera,
  medida,
  anchoMin: null,
  anchoMax: null,
  largo,
  precioNeto: 20_000,
  descripcion: 'MARCO',
  filaOrigen: 2,
});
const catalogo: Catalogo = {
  fuente: 'test',
  sha256: 'test',
  fecha: '2026-01-01',
  productos: MADERAS.flatMap((m) => [
    ...[0.8, 0.9].flatMap((a) => [2, 2.1].map((l) => puerta(m, a, l))),
    ...['2X4', '2X6'].flatMap((s) => [2.1, 2.2].map((l) => marco(m, s, l))),
  ]),
};
const resolver = resolverNombres(catalogo);
const solicitud = (s: Partial<SolicitudItem>): SolicitudItem => ({
  modelo: null,
  madera: null,
  ancho: null,
  alto: null,
  medida: null,
  cantidad: null,
  ...s,
});
/** Borrador con los ítems pendientes que calcularía el servidor. */
function borrador(...items: Partial<SolicitudItem>[]) {
  const solicitudes = items.map(solicitud);
  const incompletos = solicitudes.flatMap((s, indice) => {
    const r = resolverItem(catalogo, s);
    return r.ok ? [] : [{ indice, rechazo: r.rechazo, pregunta: pregunta(r.rechazo, s.modelo) }];
  });
  return { solicitudes, incompletos };
}
const respuesta = (q: ReturnType<typeof borrador>, mensaje: string) =>
  respuestaDirecta(q, mensaje, resolver)?.input.items?.map((i) => ({ indice: i.indice, ...i.cambios })) ??
  null;

describe('respuesta directa a una pregunta pendiente', () => {
  const sinMadera = borrador({ modelo: 'MOLCO', ancho: 0.8, alto: 2, cantidad: 3 });
  it('aplica una madera dicha sola o con palabras de relleno', () => {
    expect(respuesta(sinMadera, 'lenga')).toEqual([{ indice: 0, madera: 'LENGA', fuente: 'lenga' }]);
    expect(respuesta(sinMadera, 'en raulí por favor')).toEqual([
      { indice: 0, madera: 'RAULI', fuente: 'en raulí por favor' },
    ]);
    expect(respuesta(sinMadera, 'de pino oregon')?.[0]).toMatchObject({ madera: 'PINO OREGON' });
  });
  it('deja a la IA lo que no es un único dato claro', () => {
    for (const mensaje of [
      'lenga y rauli',
      'no, lenga',
      '3 lenga',
      '2 Molco lenga',
      '¿viene en lenga?',
      'roble',
      'mejor la otra',
    ])
      expect(respuesta(sinMadera, mensaje)).toBeNull();
  });
  it('responde la misma pregunta en todos los ítems que la comparten', () => {
    const dos = borrador(
      { modelo: 'MOLCO', ancho: 0.8, alto: 2, cantidad: 3 },
      { modelo: 'MOLCO', ancho: 0.9, alto: 2, cantidad: 1 },
    );
    expect(respuesta(dos, 'lenga')?.map((c) => [c.indice, c.madera])).toEqual([
      [0, 'LENGA'],
      [1, 'LENGA'],
    ]);
  });
  it('aplica una cantidad en cifras o palabras', () => {
    const sinCantidad = borrador({ modelo: 'MOLCO', madera: 'LENGA', ancho: 0.8, alto: 2 });
    expect(respuesta(sinCantidad, 'son 3')).toEqual([{ indice: 0, cantidad: 3, fuente: 'son 3' }]);
    expect(respuesta(sinCantidad, 'media docena')?.[0]).toMatchObject({ cantidad: 6 });
    expect(respuesta(sinCantidad, 'necesito 12 unidades')?.[0]).toMatchObject({ cantidad: 12 });
    expect(respuesta(sinCantidad, 'son 3 de 80')).toBeNull();
  });
  it('aplica un alto en metros, centímetros o con «de alto»', () => {
    const sinAlto = borrador({ modelo: 'MOLCO', madera: 'LENGA', ancho: 0.8, cantidad: 2 });
    expect(respuesta(sinAlto, 'de 210 de alto')).toEqual([
      { indice: 0, alto: 2.1, fuente: 'de 210 de alto' },
    ]);
    expect(respuesta(sinAlto, '2,10')?.[0]).toMatchObject({ alto: 2.1 });
    expect(respuesta(sinAlto, '210cm')?.[0]).toMatchObject({ alto: 2.1 });
    // «3» sin unidad no es un alto del catálogo: podría ser una cantidad.
    expect(respuesta(sinAlto, '3')).toBeNull();
  });
  it('aplica la escuadría de un marco, también en pulgadas', () => {
    const sinSeccion = borrador({ modelo: 'MARCO', madera: 'LENGA', alto: 2.1, cantidad: 2 });
    expect(respuesta(sinSeccion, '6 pulgadas')).toEqual([{ indice: 0, medida: '2X6', fuente: '6 pulgadas' }]);
    expect(respuesta(sinSeccion, '2x4')?.[0]).toMatchObject({ medida: '2X4' });
    expect(respuesta(sinSeccion, '2x5')).toBeNull();
  });
  it('con varios datos pendientes, cada valor responde el suyo y lo ambiguo va a la IA', () => {
    const sinMaderaNiAlto = borrador({ modelo: 'MOLCO', ancho: 0.8, cantidad: 3 });
    expect(respuesta(sinMaderaNiAlto, 'lenga')?.[0]).toMatchObject({ madera: 'LENGA' });
    expect(respuesta(sinMaderaNiAlto, '2,10')?.[0]).toMatchObject({ alto: 2.1 });
    const sinAltoNiCantidad = borrador({ modelo: 'MOLCO', madera: 'LENGA', ancho: 0.8 });
    // «210» puede ser 2,10 m o 210 unidades.
    expect(respuesta(sinAltoNiCantidad, '210')).toBeNull();
    expect(respuesta(sinAltoNiCantidad, '210 de alto')?.[0]).toMatchObject({ alto: 2.1 });
    expect(respuesta(sinAltoNiCantidad, 'son 4')?.[0]).toMatchObject({ cantidad: 4 });
  });
  it('sin preguntas pendientes no hace nada', () => {
    expect(
      respuesta(borrador({ modelo: 'MOLCO', madera: 'LENGA', ancho: 0.8, alto: 2, cantidad: 1 }), 'lenga'),
    ).toBeNull();
  });
});

describe('respuesta directa al largo de un accesorio de más de 3 m', () => {
  const guardapolvo = (largo: number): Producto => ({
    codigo: `GUA-O-12X1-${largo}`,
    modelo: 'GUARDAPOLVO',
    familia: 'MOLDURA',
    tipo: null,
    madera: 'PINO OREGON',
    medida: '12X1',
    anchoMin: null,
    anchoMax: null,
    largo,
    precioNeto: 5_000,
    descripcion: 'GUARDAPOLVO',
    filaOrigen: 3,
  });
  const conMolduras: Catalogo = { ...catalogo, productos: [...catalogo.productos, guardapolvo(2.4), guardapolvo(3.6)] };
  const resolverMolduras = resolverNombres(conMolduras);
  const familia = (modelo: string) => conMolduras.productos.find((p) => p.modelo === modelo)?.familia ?? null;
  const solicitudes = [solicitud({ modelo: 'GUARDAPOLVO', madera: 'PINO OREGON', medida: '12x1', cantidad: 4 })];
  const q = {
    solicitudes,
    incompletos: solicitudes.flatMap((s, indice) => {
      const r = resolverItem(conMolduras, s);
      return r.ok ? [] : [{ indice, rechazo: r.rechazo, pregunta: pregunta(r.rechazo, s.modelo) }];
    }),
  };
  const largo = (mensaje: string, conFamilia = true) =>
    respuestaDirecta(q, mensaje, resolverMolduras, conFamilia ? familia : undefined)?.input.items?.[0]?.cambios.alto ??
    null;

  it('«3,6» o «360 cm» responden el largo de 3,6 m, con o sin la familia del catálogo', () => {
    expect(q.incompletos.map((p) => p.rechazo.tipo)).toEqual(['faltan_datos']);
    for (const mensaje of ['3,6', '3,6 m', '360 cm', 'de 3.6 de largo']) {
      expect(largo(mensaje), mensaje).toBe(3.6);
      // Sin la familia, la sección del ítem dice que es un accesorio.
      expect(largo(mensaje, false), mensaje).toBe(3.6);
    }
    expect(largo('2,4')).toBe(2.4);
    // Un largo que no es una de las opciones va a la IA.
    expect(largo('5 m')).toBeNull();
  });
});

describe('una sola regla de familia: el botón y el chat leen igual el largo de un marco', () => {
  it('un «Marco» pendiente sin sección acepta 3,6 m desde el botón y escrito en el chat', () => {
    // Un largo de 7 m es implausible incluso para un accesorio: el rechazo trae la familia del modelo.
    const q = borrador({ modelo: 'MARCO', madera: 'LENGA', alto: 7, cantidad: 2 });
    expect(q.incompletos[0].rechazo).toMatchObject({ tipo: 'medida_implausible', campo: 'alto', familia: 'MARCO' });
    const [p] = preguntasPendientes(q);
    expect(p.campo).toBe('alto');
    expect(p.entrada).toMatchObject({ max: 6, familia: 'MARCO' });
    // Sin consultar el catálogo, como en las pruebas de servicio sin familia: el rechazo basta.
    expect(respuesta(q, '3,6')).toEqual([{ indice: 0, alto: 3.6, fuente: '3,6' }]);
    expect(respuesta(q, '360 cm')?.[0]).toMatchObject({ alto: 3.6 });
  });
  it('un nombre de marco que el catálogo no conoce se lee con la familia que dice su nombre', () => {
    const q = {
      solicitudes: [solicitud({ modelo: 'Marco curvo', madera: 'LENGA', alto: 7, cantidad: 1 })],
      incompletos: [
        {
          indice: 0,
          rechazo: { tipo: 'medida_implausible' as const, campo: 'alto' as const, valor: 7, disponibles: [] },
          pregunta: '¿Qué largo?',
        },
      ],
    };
    expect(preguntasPendientes(q)[0].entrada).toMatchObject({ max: 6 });
    expect(respuesta(q, '3,6')?.[0]).toMatchObject({ alto: 3.6 });
  });
});

describe('respuesta directa con la escuadría invertida', () => {
  it('«4x2» responde la sección 2X4 que ofrece la pregunta', () => {
    const q = borrador({ modelo: 'MARCO', madera: 'LENGA', alto: 2.1, cantidad: 2 });
    expect(respuesta(q, '4x2')).toEqual([{ indice: 0, medida: '2X4', fuente: '4x2' }]);
    expect(respuesta(q, '6 x 2')?.[0]).toMatchObject({ medida: '2X6' });
  });
});

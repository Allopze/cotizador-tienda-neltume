import { describe, expect, it } from 'vitest';
import {
  anclarFrases,
  anclarNombres,
  cantidadesDichas,
  nombresDichos,
  palabrasDesconocidas,
  parMedidaPuerta,
} from '../src/asistente/anclaje';
import { normalizar, normalizarMedida, resolverNombres } from '../src/catalogo/resolver';
import type { SolicitudItem } from '../src/catalogo/tipos';

// Casos reales de la prueba de paridad con Excel (npm run paridad:excel-ia), donde la IA mezcló datos entre ítems.
const MADERAS: Record<string, string> = {
  'PINO OREGON': 'PINO OREGON',
  PINO: 'PINO OREGON',
  OREGON: 'PINO OREGON',
  LENGA: 'LENGA',
  MARA: 'MARA',
  RAULI: 'RAULI',
  'MARA ENCHAPADA': 'MARA ENCHAPADA',
  ENCHAPADA: 'MARA ENCHAPADA',
  'PINO FINGER': 'PINO FINGER',
};
const MODELOS = [
  'MOLCO',
  'BAKER',
  'TOLTEN',
  'LANCO',
  'FUTRONO',
  'LOS LAGOS',
  'MARCO',
  'CHAUQUEN',
  'RINIHUE',
  'FUY',
  'PETROHUE',
  'COZ COZ',
  'ANCACOMOE',
  'RANCO',
  'GUARDAPOLVO',
  'PIEZAS T',
];
const porClave = new Map(Object.entries(MADERAS).map(([alias, nombre]) => [normalizar(alias), nombre]));
const resolver = {
  madera: (s: string) => porClave.get(normalizar(s)) ?? null,
  modelo: (s: string) => MODELOS.find((m) => normalizar(m) === normalizar(s)) ?? null,
};
const item = (s: Partial<SolicitudItem>): SolicitudItem => ({
  modelo: null,
  madera: null,
  ancho: null,
  alto: null,
  medida: null,
  cantidad: null,
  ...s,
});

describe('anclaje por frase de cada ítem', () => {
  it('no deja que un ítem tome la madera de otro ítem del mismo mensaje', () => {
    const mensaje = 'futrono pino oregón 0,64 x 220 cm, una unidad, LOS LAGOS rauli 102 x 250 cm, 2 unidades';
    const { items, avisos } = anclarFrases(
      [
        item({
          modelo: 'FUTRONO',
          madera: 'RAULI',
          cantidad: 1,
          fuente: 'futrono pino oregón 0,64 x 220 cm, una unidad',
        }),
        item({
          modelo: 'LOS LAGOS',
          madera: 'RAULI',
          cantidad: 2,
          fuente: 'LOS LAGOS rauli 102 x 250 cm, 2 unidades',
        }),
      ],
      [],
      mensaje,
      resolver,
    );
    // La frase nombra una sola madera: se usa esa, y se avisa para que la corrección no pase en silencio.
    expect(items.map((i) => i.madera)).toEqual(['PINO OREGON', 'RAULI']);
    expect(avisos).toEqual([
      'Revisa el ítem 1 (FUTRONO): el asistente leyó la madera «RAULI», pero tu pedido dice «PINO OREGON»; usé «PINO OREGON».',
    ]);
  });

  it('deja pendiente una madera desconocida en vez de copiar la de otro ítem', () => {
    const { items, avisos } = anclarFrases(
      [
        item({ modelo: 'RINIHUE', madera: 'RAULI', cantidad: 6, fuente: '6 RIÑIHUE en cedro de 62 x 210' }),
        item({ modelo: 'FUY', madera: 'RAULI', cantidad: 1, fuente: '1 puerta fuy Raulí 0.71 m por 250 cm' }),
      ],
      [],
      'Cotiza\n- 6 RIÑIHUE en cedro de 62 x 210\n- 1 puerta fuy Raulí 0.71 m por 250 cm',
      resolver,
    );
    expect(items.map((i) => i.madera)).toEqual([null, 'RAULI']);
    expect(avisos).toEqual([expect.stringMatching(/ítem 1 \(RINIHUE\).*corresponde a otro ítem/)]);
  });

  it('no deja que un ítem tome la cantidad de otro ítem', () => {
    const mensaje =
      'solicito cotización de lanco Mara 1,25 x 2,1 m, 5 unidades y también 1 chauquen de mara medida 125 cm x 2,5.';
    const { items, avisos } = anclarFrases(
      [
        item({ modelo: 'LANCO', madera: 'MARA', cantidad: 1, fuente: 'lanco Mara 1,25 x 2,1 m, 5 unidades' }),
        item({
          modelo: 'CHAUQUEN',
          madera: 'MARA',
          cantidad: 1,
          fuente: '1 chauquen de mara medida 125 cm x 2,5',
        }),
      ],
      [],
      mensaje,
      resolver,
    );
    // La frase dice «5 unidades»: se corrige en vez de preguntar, y se avisa.
    expect(items.map((i) => i.cantidad)).toEqual([5, 1]);
    expect(avisos).toEqual([
      'Revisa el ítem 1 (LANCO): el asistente leyó la cantidad 1, pero tu pedido dice 5; usé 5.',
    ]);
    // Si la frase no dice una cantidad, la tomada de otro ítem queda pendiente.
    const sinCantidad = anclarFrases(
      [
        item({ modelo: 'LANCO', madera: 'MARA', cantidad: 1, fuente: 'lanco Mara 1,25 x 2,1 m' }),
        item({
          modelo: 'CHAUQUEN',
          madera: 'MARA',
          cantidad: 1,
          fuente: '1 chauquen de mara medida 125 cm x 2,5',
        }),
      ],
      [],
      'cotiza lanco Mara 1,25 x 2,1 m y también 1 chauquen de mara medida 125 cm x 2,5',
      resolver,
    );
    expect(sinCantidad.items.map((i) => i.cantidad)).toEqual([null, 1]);
    expect(sinCantidad.avisos).toEqual([expect.stringMatching(/cantidad 1 para el ítem 1.*otro ítem/)]);
  });

  it('corrige «marcos mara» leído como MARA ENCHAPADA', () => {
    const { items } = anclarFrases(
      [
        item({
          modelo: 'MARCO',
          madera: 'MARA ENCHAPADA',
          cantidad: 15,
          medida: '2x6',
          alto: 2.5,
          fuente: '15 marcos Mara 2x6 de 2,5',
        }),
      ],
      [],
      'Cotiza 15 marcos Mara 2x6 de 2,5',
      resolver,
    );
    expect(items[0].madera).toBe('MARA');
  });

  it('«encha en mara» es MARA ENCHAPADA: no la cambia por la Mara sólida', () => {
    // Alias de la configuración base, como los recibe la aplicación.
    const configurado = resolverNombres({
      fuente: 'test',
      sha256: 'test',
      fecha: '2026-01-01',
      productos: [],
    });
    const madera = (fuente: string) =>
      anclarFrases(
        [
          item({
            modelo: 'HUILO HUILO',
            madera: 'MARA ENCHAPADA',
            ancho: 0.73,
            alto: 2.07,
            cantidad: 1,
            fuente,
          }),
        ],
        [],
        fuente,
        configurado,
      ).items[0].madera;
    expect(madera('1 und huilo huilo encha en mara 0.73x2.07 mt (hoja)')).toBe('MARA ENCHAPADA');
    expect(madera('1 und huilo huilo encha mara 0.73x2.07 mt (hoja)')).toBe('MARA ENCHAPADA');
    expect(madera('1 und huilo huilo enchap. en mara 0.73x2.07 mt (hoja)')).toBe('MARA ENCHAPADA');
    expect(madera('1 und huilo huilo ench mara 0.73x2.07 mt (hoja)')).toBe('MARA ENCHAPADA');
    expect(madera('1 und huilo huilo en mara 0.73x2.07 mt (hoja)')).toBe('MARA');
  });

  it('avisa la palabra que no reconoce junto al producto y la corrección que hizo con ella', () => {
    // Sin el alias «encha mara» la frase solo nombra «mara»: la corrección a MARA queda a la vista.
    const fuente = '1 lanco encha en mara 0.73x2.07';
    const { items, avisos } = anclarFrases(
      [item({ modelo: 'LANCO', madera: 'MARA ENCHAPADA', ancho: 0.73, alto: 2.07, cantidad: 1, fuente })],
      [],
      fuente,
      resolver,
    );
    expect(items[0].madera).toBe('MARA');
    expect(avisos).toEqual([
      'No reconocí «encha» en el ítem 1 (LANCO): revisa que el producto sea el que se pidió.',
      'Revisa el ítem 1 (LANCO): el asistente leyó la madera «MARA ENCHAPADA», pero tu pedido dice «MARA»; usé «MARA».',
    ]);
    expect(palabrasDesconocidas('2 molco tablero en lenga natural 80x200', resolver)).toEqual([
      'tablero',
      'natural',
    ]);
    // Lo que va antes del modelo, los conectores y las unidades no cuentan.
    expect(palabrasDesconocidas('cotizar 3 lanco en pino oregon por favor', resolver)).toEqual([]);
    expect(palabrasDesconocidas('1 und lanco en mara de 0.73x2.07 mt (hoja)', resolver)).toEqual([]);
  });

  it('usa la sección escrita en la frase si la IA propuso otra', () => {
    const { items } = anclarFrases(
      [
        item({
          modelo: 'MARCO',
          madera: 'PINO FINGER',
          medida: '30x70',
          alto: 2.5,
          cantidad: 11,
          fuente: '11 juegos de marco 2x5 pino de 2,5 m',
        }),
        item({
          modelo: 'MARCO',
          madera: 'PINO OREGON',
          medida: '2x4',
          alto: 2.4,
          cantidad: 5,
          fuente: 'cinco juegos de marco 2x4 oregon de 2,4 m',
        }),
      ],
      [],
      'Necesito cotizar 11 juegos de marco 2x5 pino de 2,5 m; cinco juegos de marco 2x4 oregon de 2,4 m',
      resolver,
    );
    expect(items.map((i) => [i.madera, i.medida])).toEqual([
      ['PINO OREGON', '2X5'],
      ['PINO OREGON', '2x4'],
    ]);
  });

  it('«con su marco» lleva la cantidad de las puertas y «otra» es una', () => {
    const conMarco = anclarFrases(
      [
        item({
          modelo: 'FUY',
          madera: 'RAULI',
          cantidad: 11,
          ancho: 0.71,
          alto: 2.2,
          fuente: '11 fuy de raulí medida 71 cm x 2,2',
        }),
        item({
          modelo: 'MARCO',
          madera: 'RAULI',
          cantidad: 11,
          medida: '2x4',
          alto: 2.2,
          fuente: 'con marco 2x4 en Raulí',
        }),
      ],
      [],
      'Cotiza 11 fuy de raulí medida 71 cm x 2,2 con marco 2x4 en Raulí',
      resolver,
    );
    expect(conMarco.items.map((i) => i.cantidad)).toEqual([11, 11]);
    expect(conMarco.avisos).toEqual([]);
    // Otros modelos guardan la frase del marco sin el «con».
    const sinCon = anclarFrases(
      [
        item({
          modelo: 'FUY',
          madera: 'RAULI',
          cantidad: 9,
          ancho: 1.05,
          alto: 2.4,
          fuente: '9 fuy de raulí medida 105 x 240',
        }),
        item({
          modelo: 'MARCO',
          madera: 'RAULI',
          cantidad: 9,
          medida: '2x8',
          alto: 2.4,
          fuente: 'su marco 2x8 en Raulí',
        }),
      ],
      [],
      'Cotiza 9 fuy de raulí medida 105 x 240 con su marco 2x8 en Raulí',
      resolver,
    );
    expect(sinCon.items.map((i) => i.cantidad)).toEqual([9, 9]);
    const dos = anclarFrases(
      [
        item({ modelo: 'LANCO', madera: 'LENGA', cantidad: 1, fuente: 'una en lenga' }),
        item({ modelo: 'LANCO', madera: 'RAULI', cantidad: 1, fuente: 'otra en rauli' }),
      ],
      [],
      'dame 2 LANCO, una en lenga y otra en rauli, ambas de 123x210',
      resolver,
    );
    expect(dos.items.map((i) => [i.madera, i.cantidad])).toEqual([
      ['LENGA', 1],
      ['RAULI', 1],
    ]);
  });

  it('acepta lo que la persona dijo en un mensaje anterior', () => {
    const { items } = anclarFrases(
      [
        item({
          modelo: 'LANCO',
          madera: 'RAULI',
          cantidad: 63,
          ancho: 0.8,
          alto: 2.1,
          fuente: 'de 210 de alto',
        }),
      ],
      [],
      'de 210 de alto',
      resolver,
      ['63 lanco Raulí de 80'],
    );
    expect(items[0]).toMatchObject({ madera: 'RAULI', cantidad: 63, alto: 2.1 });
  });

  it('no usa la cantidad como largo («2 guardapolvos 12x1» no dice 2 m)', () => {
    const guardapolvo = (fuente: string) =>
      anclarFrases(
        [item({ modelo: 'GUARDAPOLVO', madera: 'RAULI', cantidad: 2, medida: '12x1', alto: 2, fuente })],
        [],
        fuente,
        resolver,
      );
    expect(guardapolvo('2 guardapolvos 12x1 en Raulí').items[0]).toMatchObject({ cantidad: 2, alto: null });
    expect(guardapolvo('2 guardapolvos 12x1 en Raulí de 2 m').items[0]).toMatchObject({
      cantidad: 2,
      alto: 2,
    });
    expect(guardapolvo('dos guardapolvos 12x1 en Raulí de 2 m').items[0]).toMatchObject({
      cantidad: 2,
      alto: 2,
    });
    // Una puerta de 80 x 210 no tiene «sección»: su medida no cambia.
    const puerta = anclarFrases(
      [
        item({
          modelo: 'MOLCO',
          madera: 'LENGA',
          cantidad: 2,
          ancho: 0.8,
          alto: 2,
          fuente: '2 molco lenga 80x200',
        }),
      ],
      [],
      '2 molco lenga 80x200',
      resolver,
    );
    expect(puerta.items[0]).toMatchObject({ cantidad: 2, ancho: 0.8, alto: 2, medida: null });
  });

  it('respeta lo que el mensaje dice para todo el pedido y los datos del borrador', () => {
    const mensaje = '3 Lanco 80x210 y 2 Molco de 70x210, todas en lenga';
    const { items, avisos } = anclarFrases(
      [
        item({ modelo: 'LANCO', madera: 'LENGA', cantidad: 3, fuente: '3 Lanco 80x210' }),
        item({ modelo: 'MOLCO', madera: 'LENGA', cantidad: 2, fuente: '2 Molco de 70x210' }),
      ],
      [],
      mensaje,
      resolver,
    );
    expect(items.map((i) => [i.madera, i.cantidad])).toEqual([
      ['LENGA', 3],
      ['LENGA', 2],
    ]);
    expect(avisos).toEqual([]);
    // Un ítem sin frase reconocible (fuente parafraseada o de otro turno) no se toca.
    const previo = item({ modelo: 'MOLCO', madera: 'RAULI', cantidad: 4, fuente: 'cuatro molco en raulí' });
    expect(anclarFrases([previo], [previo], 'agrega otra igual', resolver).items[0]).toEqual(previo);
  });
});

describe('maderas que no son del catálogo', () => {
  it('«pino radiata» no respalda Pino Oregón; «pino» solo, «pino oregon» y «pino finger» sí', () => {
    const dichas = (t: string) => [...nombresDichos(t, resolver.madera, resolver.modelo).resueltos.values()];
    expect(dichas('2 PETROHUE en pino radiata de 140 x 250')).toEqual([]);
    expect(dichas('2 Petrohue pino insigne')).toEqual([]);
    expect(dichas('4 molco pino de 80 x 200')).toEqual(['PINO OREGON']);
    expect(dichas('4 molco pino medida 80 x 200')).toEqual(['PINO OREGON']);
    expect(dichas('2 marcos pino 2x4')).toEqual(['PINO OREGON']);
    expect(dichas('4 molco en pino oregon')).toEqual(['PINO OREGON']);
    expect(dichas('marco pino finger 30x70')).toEqual(['PINO FINGER']);
    const { items } = anclarNombres(
      [item({ modelo: 'PETROHUE', madera: 'PINO OREGON' })],
      [],
      ['Cotiza 2 PETROHUE en pino radiata de 140 x 250'],
      { modelo: {}, madera: { 'PINO OREGON': ['PINO', 'OREGON'] } },
      resolver,
    );
    expect(items[0].madera).toBeNull();
  });
});

describe('escuadría en pulgadas', () => {
  it('«6 pulgadas», 6" y «2x6 pulg» son la misma sección', () => {
    expect(['6 pulgadas', '6"', '6 pulg', '6 PULGADA'].map(normalizarMedida)).toEqual(['6', '6', '6', '6']);
    expect(normalizarMedida('2x6 pulg.')).toBe('2X6');
    expect(normalizarMedida('6 x 4.5')).toBe('6X4,5');
  });
});

describe('cantidades y medidas que dice la frase', () => {
  it('lee cantidades en cifras y palabras, sin confundirlas con medidas', () => {
    expect(cantidadesDichas('media docena de Pirihueico de mara medida 1,24 x 2,3')).toEqual([6]);
    expect(cantidadesDichas('una docena de ENCO de mara medida 72 x 2,3 m')).toEqual([12]);
    expect(cantidadesDichas('un par de puertas LICAN lenga 91 por 2,4')).toEqual([2]);
    expect(cantidadesDichas('8 marcos de 4 en oregón de 2')).toEqual([8]);
    expect(cantidadesDichas('lanco Mara 1,25 x 2,1 m, 5 unidades')).toEqual([5]);
    expect(cantidadesDichas('treinta y dos puertas molco')).toEqual([32]);
    expect(cantidadesDichas('9 Futaleufu en lenga de 1230 x 2600 mm')).toEqual([9]);
  });
  it('lee un único par de medidas de puerta, en cualquier orden y unidad', () => {
    expect(parMedidaPuerta('9 Futaleufu en lenga de 1230 x 2600 mm')).toEqual({ ancho: 1.23, alto: 2.6 });
    expect(parMedidaPuerta('molco 2,1 x 0,8')).toEqual({ ancho: 0.8, alto: 2.1 });
    expect(parMedidaPuerta('82 cm por 240 cm')).toEqual({ ancho: 0.82, alto: 2.4 });
    expect(parMedidaPuerta('molco 80x200 y 90x210')).toBeNull();
    // Con su nombre, el orden no importa.
    expect(parMedidaPuerta('7 lipinza lenga, 240 de alto por 110 de ancho')).toEqual({
      ancho: 1.1,
      alto: 2.4,
    });
    expect(parMedidaPuerta('molco lenga alto 2,1 ancho 0,8')).toEqual({ ancho: 0.8, alto: 2.1 });
    expect(parMedidaPuerta('marcos 2x6 de 2,5')).toBeNull();
  });
  it('corrige una cantidad o unas medidas mal leídas con lo que dice la frase', () => {
    const corregir = (s: Partial<SolicitudItem>, fuente: string) =>
      anclarFrases([item({ ...s, fuente })], [], fuente, resolver).items[0];
    expect(
      corregir(
        { modelo: 'MOLCO', madera: 'MARA', cantidad: 0.5, ancho: 1.24, alto: 2.3 },
        'media docena de molco de mara medida 1,24 x 2,3',
      ),
    ).toMatchObject({ cantidad: 6, ancho: 1.24, alto: 2.3 });
    expect(
      corregir(
        { modelo: 'MOLCO', madera: 'LENGA', cantidad: 9, ancho: 12.3, alto: 26 },
        '9 molco en lenga de 1230 x 2600 mm',
      ),
    ).toMatchObject({ ancho: 1.23, alto: 2.6 });
    // La IA dejó vacío el ancho de «240 de alto por 110 de ancho».
    expect(
      corregir(
        { modelo: 'MOLCO', madera: 'LENGA', cantidad: 7, ancho: null, alto: 2.4 },
        '7 molco lenga, 240 de alto por 110 de ancho',
      ),
    ).toMatchObject({ ancho: 1.1, alto: 2.4 });
    // Invertidas: el menor es el ancho.
    expect(
      corregir(
        { modelo: 'MOLCO', madera: 'LENGA', cantidad: 2, ancho: 2.1, alto: 0.8 },
        '2 molco lenga 2,1 x 0,8',
      ),
    ).toMatchObject({ ancho: 0.8, alto: 2.1 });
    // La IA leyó el alto del par pero dejó vacío el ancho: lo completa el mismo par.
    expect(
      corregir({ modelo: 'MOLCO', cantidad: 2, ancho: null, alto: 2 }, '2 molco de 93 por 200'),
    ).toMatchObject({
      ancho: 0.93,
      alto: 2,
    });
    // Un accesorio sin medidas no toma una sección («30x70») como ancho y alto.
    expect(
      corregir({ modelo: 'MARCO', cantidad: 2, ancho: null, alto: null }, '2 marcos finger 30x70'),
    ).toMatchObject({
      ancho: null,
      alto: null,
    });
    // Con dos pares en la frase no hay una lectura única: no se toca.
    expect(
      corregir(
        { modelo: 'MOLCO', madera: 'LENGA', cantidad: 2, ancho: 12.3, alto: 2 },
        '2 molco lenga 80x200 o 90x210',
      ),
    ).toMatchObject({ ancho: 12.3 });
  });
  it('no deja que un ítem tome el alto o el modelo de otro ítem', () => {
    const mensaje = '2 Molco lenga 80 x 200 y 3 Fuy raulí de 90';
    const { items, avisos } = anclarFrases(
      [
        item({
          modelo: 'MOLCO',
          madera: 'LENGA',
          cantidad: 2,
          ancho: 0.8,
          alto: 2,
          fuente: '2 Molco lenga 80 x 200',
        }),
        item({
          modelo: 'FUY',
          madera: 'RAULI',
          cantidad: 3,
          ancho: 0.9,
          alto: 2,
          fuente: '3 Fuy raulí de 90',
        }),
      ],
      [],
      mensaje,
      resolver,
    );
    expect(items[1]).toMatchObject({ ancho: 0.9, alto: null });
    expect(avisos).toEqual([expect.stringMatching(/alto 2 m para el ítem 2.*otro ítem/)]);
    // La frase nombra un modelo y la IA propuso otro: gana el de la frase.
    const modelo = anclarFrases(
      [item({ modelo: 'COZ COZ', madera: 'LENGA', cantidad: 4, fuente: '4 molco lenga 80x200' })],
      [],
      '4 molco lenga 80x200',
      resolver,
    );
    expect(modelo.items[0].modelo).toBe('MOLCO');
  });
  it('una frase sin modelo, «otra igual» o «ambas de» heredan lo que no dicen', () => {
    const continua = anclarFrases(
      [
        item({
          modelo: 'LANCO',
          madera: 'LENGA',
          cantidad: 3,
          ancho: 0.8,
          alto: 2.1,
          fuente: '3 Lanco lenga 80x210',
        }),
        item({ modelo: 'LANCO', madera: 'LENGA', cantidad: 2, ancho: 0.7, alto: 2.1, fuente: '2 de 70x210' }),
      ],
      [],
      '3 Lanco lenga 80x210 y 2 de 70x210',
      resolver,
    );
    expect(continua.items[1]).toMatchObject({
      modelo: 'LANCO',
      madera: 'LENGA',
      cantidad: 2,
      ancho: 0.7,
      alto: 2.1,
    });
    expect(continua.avisos).toEqual([]);
    const igual = anclarFrases(
      [
        item({
          modelo: 'MOLCO',
          madera: 'LENGA',
          cantidad: 1,
          ancho: 0.8,
          alto: 2,
          fuente: '1 Molco 80x200 lenga',
        }),
        item({
          modelo: 'MOLCO',
          madera: 'LENGA',
          cantidad: 1,
          ancho: 0.9,
          alto: 2,
          fuente: 'otra igual pero de 90',
        }),
      ],
      [],
      '1 Molco 80x200 lenga y otra igual pero de 90',
      resolver,
    );
    expect(igual.items[1]).toMatchObject({ modelo: 'MOLCO', madera: 'LENGA', ancho: 0.9, alto: 2 });
    expect(igual.avisos).toEqual([]);
    const ambas = anclarFrases(
      [
        item({
          modelo: 'LANCO',
          madera: 'LENGA',
          cantidad: 1,
          ancho: 1.23,
          alto: 2.1,
          fuente: 'una en lenga',
        }),
        item({
          modelo: 'LANCO',
          madera: 'RAULI',
          cantidad: 1,
          ancho: 1.23,
          alto: 2.1,
          fuente: 'otra en rauli',
        }),
      ],
      [],
      'dame 2 LANCO, una en lenga y otra en rauli, ambas de 123x210',
      resolver,
    );
    expect(ambas.items.map((i) => [i.madera, i.ancho, i.alto])).toEqual([
      ['LENGA', 1.23, 2.1],
      ['RAULI', 1.23, 2.1],
    ]);
  });
});

describe('lo que la frase dice completa o corrige a la IA (casos de la semilla 3)', () => {
  const ACCESORIOS = ['MARCO', 'GUARDAPOLVO', 'PIEZAS T'];
  const familia = (m: string) => (ACCESORIOS.includes(normalizar(m)) ? 'MARCO' : 'PUERTA');
  const anclar = (items: Partial<SolicitudItem>[], mensaje: string) =>
    anclarFrases(items.map(item), [], mensaje, resolver, [], familia);

  it('«un par de» son 2 aunque la IA leyera «un»', () => {
    const fuente = 'un par de ancacomoe en raulí de 80 x 240 cm';
    expect(
      anclar([{ modelo: 'ANCACOMOE', madera: 'RAULI', ancho: 0.8, alto: 2.4, cantidad: 1, fuente }], fuente)
        .items[0].cantidad,
    ).toBe(2);
  });
  it('la escuadría en pulgadas y el largo «para puerta de 240» salen de la frase de cada marco', () => {
    const mensaje =
      'Cotiza 5 marcos en lenga escuadría 2x8 para puerta de 240, marco lenga de 8 pulgadas 2,2 m, 2 unidades y marco Lenga de 6 pulgadas 2,4 m, 10 unidades';
    const { items } = anclar(
      [
        {
          modelo: 'MARCO',
          madera: 'LENGA',
          medida: '2x8',
          alto: 2.2,
          cantidad: 5,
          fuente: '5 marcos en lenga escuadría 2x8 para puerta de 240',
        },
        {
          modelo: 'MARCO',
          madera: 'LENGA',
          medida: '2x6',
          alto: 2.2,
          cantidad: 2,
          fuente: 'marco lenga de 8 pulgadas 2,2 m, 2 unidades',
        },
        {
          modelo: 'MARCO',
          madera: 'LENGA',
          medida: '2x6',
          alto: 2.4,
          cantidad: 10,
          fuente: 'marco Lenga de 6 pulgadas 2,4 m, 10 unidades',
        },
      ],
      mensaje,
    );
    expect(items.map((i) => [normalizarMedida(i.medida!), i.alto, i.cantidad])).toEqual([
      ['2X8', 2.4, 5],
      ['2X8', 2.2, 2],
      ['2X6', 2.4, 10],
    ]);
    const trescientos = anclar(
      [
        {
          modelo: 'MARCO',
          madera: 'RAULI',
          medida: '2x4',
          alto: 0.3,
          cantidad: 8,
          fuente: '8 marcos en raulí escuadría 2x4 para puerta de 300',
        },
      ],
      '8 marcos en raulí escuadría 2x4 para puerta de 300',
    );
    expect(trescientos.items[0].alto).toBe(3);
  });
  it('la puerta conserva la cantidad que comparte con «con marco», en cualquier sentido', () => {
    const { items, avisos } = anclar(
      [
        {
          modelo: 'RANCO',
          madera: 'LENGA',
          ancho: 0.85,
          alto: 2.1,
          cantidad: 12,
          fuente: 'RANCO lenga 85 x 210 cm',
        },
        {
          modelo: 'MARCO',
          madera: 'LENGA',
          medida: '2x4',
          alto: 2.1,
          cantidad: 12,
          fuente: '12 unidades con marco 2x4 en lenga',
        },
      ],
      'Cotiza RANCO lenga 85 x 210 cm, 12 unidades con marco 2x4 en lenga',
    );
    expect(items.map((i) => i.cantidad)).toEqual([12, 12]);
    expect(avisos).toEqual([]);
  });
  it('completa lo que la IA dejó vacío y la frase dice sin ambigüedad', () => {
    const fuente = 'marco oregon de 5 pulgadas 2,3 m, 21 unidades';
    expect(
      anclar([{ modelo: 'MARCO', cantidad: 1, fuente }], `un juego de marco 2x8 pino de 2,6 m y ${fuente}`)
        .items[0],
    ).toMatchObject({
      madera: 'PINO OREGON',
      medida: '2X5',
      alto: 2.3,
      cantidad: 21,
    });
    // Una puerta con una sola medida: 1,41 m solo puede ser el ancho.
    const riñihue = 'media docena de RIÑIHUE mara de 141';
    expect(
      anclar([{ modelo: 'RINIHUE', madera: 'MARA', cantidad: 6, fuente: riñihue }], riñihue).items[0],
    ).toMatchObject({
      ancho: 1.41,
      alto: null,
    });
  });
  it('con una frase compartida por dos ítems conserva la cantidad de cada uno', () => {
    const mensaje = '- 39 marcos 2 x 5 mara, alto 2,5 m\n- 11 marcos 2 x 5 mara, alto 3 m';
    const fuente = '- 39 marcos 2 x 5 mara, alto 2,5 m - 11 marcos 2 x 5 mara, alto 3 m';
    const { items } = anclar(
      [
        { modelo: 'MARCO', madera: 'MARA', medida: '2x5', alto: 2.5, cantidad: 39, fuente },
        { modelo: 'MARCO', madera: 'MARA', medida: '2x5', alto: 3, cantidad: 11, fuente },
      ],
      mensaje,
    );
    expect(items.map((i) => [i.alto, i.cantidad])).toEqual([
      [2.5, 39],
      [3, 11],
    ]);
  });
  it('la cantidad escrita justo antes del modelo gana a otra de la misma frase', () => {
    const mensaje = 'baker raulí 1,45 x 240 cm, 7 unidades y 1 TOLTEN de Raulí medida 0,82 x 2';
    const { items } = anclar(
      [
        {
          modelo: 'BAKER',
          madera: 'RAULI',
          ancho: 1.45,
          alto: 2.4,
          cantidad: 1,
          fuente: 'baker raulí 1,45 x 240 cm',
        },
        {
          modelo: 'TOLTEN',
          madera: 'RAULI',
          ancho: 0.82,
          alto: 2,
          cantidad: 7,
          fuente: '7 unidades y 1 TOLTEN de Raulí medida 0,82 x 2',
        },
      ],
      mensaje,
    );
    // La Tolten queda en 1, como dice el pedido; la Baker no se cotiza con una cantidad ajena.
    expect(items.map((i) => i.cantidad)).toEqual([null, 1]);
  });
  it('el marco «con marco» toma la cantidad y el alto de su única puerta si la IA los dejó vacíos', () => {
    const { items } = anclar(
      [
        {
          modelo: 'MOLCO',
          madera: 'PINO OREGON',
          ancho: 1.23,
          alto: 2,
          cantidad: 3,
          fuente: '3 Molco en pino oregon de 123 x 200 cm',
        },
        { modelo: 'MARCO', madera: 'PINO OREGON', medida: '2x4', fuente: 'con marco 2x4 en pino oregón' },
      ],
      'Cotiza 3 Molco en pino oregon de 123 x 200 cm con marco 2x4 en pino oregón',
    );
    expect(items[1]).toMatchObject({ cantidad: 3, alto: 2 });
  });
  it('lo vago o ambiguo sigue pendiente', () => {
    const guardapolvo = '20 guardapolvos 12x2 en lenga';
    expect(
      anclar(
        [{ modelo: 'GUARDAPOLVO', madera: 'LENGA', medida: '12x2', cantidad: 20, fuente: guardapolvo }],
        guardapolvo,
      ).items[0].alto,
    ).toBeNull();
    // «de 2, 73»: ¿largo 2 y 73 puertas, o 2,73 m? No se elige.
    const piezas = 'dos piezas T pino oregon 2x6 de 2, 73';
    expect(
      anclar(
        [
          {
            modelo: 'PIEZAS T',
            madera: 'PINO OREGON',
            medida: '2x6',
            alto: 2.73,
            cantidad: 2,
            fuente: piezas,
          },
        ],
        `${piezas} puertas`,
      ).items[0].alto,
    ).toBe(2.73);
    const sinCantidad = 'puerta molco en lenga de 90 x 210';
    expect(
      anclar([{ modelo: 'MOLCO', madera: 'LENGA', ancho: 0.9, alto: 2.1, fuente: sinCantidad }], sinCantidad)
        .items[0].cantidad,
    ).toBeNull();
  });
});

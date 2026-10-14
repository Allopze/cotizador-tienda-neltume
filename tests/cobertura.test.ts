import { describe, expect, it } from 'vitest';
import {
  fleteAlFinal,
  pareceUnPedido,
  pedidosSinRegistrar,
  sinLineasDeFlete,
} from '../src/asistente/cobertura';
import { normalizar } from '../src/catalogo/resolver';

const MODELOS = ['MARCO', 'MOLCO', 'TOLEDO', 'PANGUIPULLI', 'COZ COZ'];
const MADERAS: Record<string, string> = {
  PINOOREGON: 'PINO OREGON',
  PINO: 'PINO OREGON',
  OREGON: 'PINO OREGON',
  LENGA: 'LENGA',
  RAULI: 'RAULI',
};
const resolver = {
  modelo: (s: string) => MODELOS.find((m) => normalizar(m) === normalizar(s)) ?? null,
  madera: (s: string) => MADERAS[normalizar(s)] ?? null,
};

describe('pedidos sin registrar', () => {
  const mensaje =
    'Cotiza 8 marcos de 4 en oregón de 2; 6 marcos pino 2x8 de 2; 5 juegos de marco 2x6 oregon de 3 m';
  it('encuentra los ítems que la IA omitió, con el texto tal como se escribió', () => {
    expect(pedidosSinRegistrar(mensaje, ['8 marcos de 4 en oregón de 2'], [], resolver)).toEqual([
      '6 marcos pino 2x8 de 2',
      '5 juegos de marco 2x6 oregon de 3 m',
    ]);
    expect(
      pedidosSinRegistrar(
        mensaje,
        ['8 marcos de 4 en oregón de 2', '6 marcos pino 2x8 de 2', '5 juegos de marco 2x6 oregon de 3 m'],
        [],
        resolver,
      ),
    ).toEqual([]);
  });
  it('separa por líneas, «y» y comas, y tolera diferencias de puntuación en la frase', () => {
    expect(
      pedidosSinRegistrar(
        '- 2 Molco lenga 80x200\n- 3 Toledo raulí 90x210',
        ['2 Molco lenga 80x200'],
        [],
        resolver,
      ),
    ).toEqual(['3 Toledo raulí 90x210']);
    expect(
      pedidosSinRegistrar(
        '2 Molco lenga 80x200 y 3 Toledo raulí 90x210',
        ['2 molco lenga 80 x200'],
        [],
        resolver,
      ),
    ).toEqual(['3 Toledo raulí 90x210']);
  });
  it('no confunde datos del cliente, despacho, ediciones ni relleno con pedidos', () => {
    expect(
      pedidosSinRegistrar(
        '2 Molco lenga 80x200 para Juan Toledo, despacho a Panguipulli 2 días',
        ['2 Molco lenga 80x200'],
        ['Juan Toledo'],
        resolver,
      ),
    ).toEqual([]);
    expect(
      pedidosSinRegistrar('6 Coz Coz 80x200, lo de siempre', ['6 Coz Coz 80x200'], [], resolver),
    ).toEqual([]);
    expect(pedidosSinRegistrar('saca los 2 marcos', [], [], resolver)).toEqual([]);
  });
  it('un trozo con medidas es un pedido aunque nombre al cliente', () => {
    expect(
      pedidosSinRegistrar(
        'necesito precio de doce puertas Molco lenga 1.02 m por 2,1 y también 1 puerta TOLEDO Raulí 1.15 m por 2,3 m para Juan Soto, Osorno',
        ['doce puertas Molco lenga 1.02 m por 2,1'],
        ['Juan Soto', 'Osorno'],
        resolver,
      ),
    ).toEqual(['1 puerta TOLEDO Raulí 1.15 m por 2,3 m']);
  });
  it('la línea de un flete registrado no es un pedido aunque el destino se llame como un modelo', () => {
    // Como en un pedido real («DEPACHO A RIÑIHUE»): mal escrito y con un destino que también es un modelo.
    const mensaje =
      'COTIZAR JUAN SOTO\nDEPACHO A PANGUIPULLI con un valor de $350.000 + iva\n2 Molco lenga 80x200';
    const revisar = (conFlete: boolean) =>
      pedidosSinRegistrar(mensaje, ['2 Molco lenga 80x200'], ['JUAN SOTO'], resolver, { conFlete });
    expect(revisar(false)).toEqual(['DEPACHO A PANGUIPULLI con un valor de $350.000 + iva']);
    expect(revisar(true)).toEqual([]);
    expect(
      pedidosSinRegistrar(
        '2 Molco lenga 80x200\nflete a Panguipulli 350 mil',
        ['2 Molco lenga 80x200'],
        [],
        resolver,
      ),
    ).toEqual([]);
  });
  it('quita del mensaje la línea del flete, no la de un producto con precio', () => {
    expect(
      sinLineasDeFlete(
        'COTIZAR JUAN SOTO\nDEPACHO A PANGUIPULLI con un valor de $350.00 + iva\n2 Molco lenga 80x200\n1 Toledo 1,90x2,20 a $450.000',
      ),
    ).toBe('COTIZAR JUAN SOTO\n2 Molco lenga 80x200\n1 Toledo 1,90x2,20 a $450.000');
  });
  it('la IA recibe la línea del flete al final, sin cambiar ninguna línea', () => {
    expect(
      fleteAlFinal('COTIZAR JUAN SOTO\nDEPACHO A PANGUIPULLI $350.000 + iva\n2 Molco lenga 80x200'),
    ).toBe('COTIZAR JUAN SOTO\n2 Molco lenga 80x200\nDEPACHO A PANGUIPULLI $350.000 + iva');
    // Sin flete, o solo con el flete, el mensaje queda igual.
    expect(fleteAlFinal('2 Molco lenga 80x200\n1 Toledo 1,90x2,20 a $450.000')).toBe(
      '2 Molco lenga 80x200\n1 Toledo 1,90x2,20 a $450.000',
    );
    expect(fleteAlFinal('flete a Chillán $380.000 + IVA')).toBe('flete a Chillán $380.000 + IVA');
  });
  it('mantiene la cobertura si una frase no aparece en el mensaje', () => {
    // La IA parafraseó la frase del ítem que sí registró («Cotiza 8 marcos de 4 en oregón de 2»): solo faltan
    // los otros dos pedidos.
    expect(pedidosSinRegistrar(mensaje, ['ocho marcos 2x4 oregón'], [], resolver)).toEqual([
      '6 marcos pino 2x8 de 2',
      '5 juegos de marco 2x6 oregon de 3 m',
    ]);
  });
  it('una frase parafraseada o cortada cubre la línea con su modelo y su cantidad, no otra', () => {
    const lineas = '3 Molco lenga 80x200\n2 Toledo raulí 90x210';
    expect(
      pedidosSinRegistrar(lineas, ['tres puertas Molco de lenga', '2 Toledo raulí 90x210'], [], resolver),
    ).toEqual([]);
    expect(
      pedidosSinRegistrar(lineas, ['3 Molco lenga 80x20', '2 Toledo raulí 90x210'], [], resolver),
    ).toEqual([]);
    // Otra cantidad u otro modelo no es su línea: esa sí falta.
    expect(pedidosSinRegistrar(lineas, ['tres puertas Molco de lenga'], [], resolver)).toEqual([
      '2 Toledo raulí 90x210',
    ]);
    expect(
      pedidosSinRegistrar('3 Molco lenga 80x200\n2 Molco raulí 90x210', ['dos Molco'], [], resolver),
    ).toEqual(['3 Molco lenga 80x200']);
  });
  it('con el mismo modelo y la misma cantidad, la madera y las medidas dicen cuál línea registró', () => {
    // Nunca acusa la línea registrada: acusa la que falta.
    const maderas = '2 Molco lenga 80x200\n2 Molco raulí 90x210';
    expect(pedidosSinRegistrar(maderas, ['dos Molco de raulí'], [], resolver)).toEqual(['2 Molco lenga 80x200']);
    expect(pedidosSinRegistrar(maderas, ['dos Molco raulí de 90 por 210'], [], resolver)).toEqual([
      '2 Molco lenga 80x200',
    ]);
    const medidas = '2 Molco lenga 80x200\n2 Molco lenga 90x210';
    expect(pedidosSinRegistrar(medidas, ['dos Molco lenga de 90 por 210'], [], resolver)).toEqual([
      '2 Molco lenga 80x200',
    ]);
    expect(pedidosSinRegistrar(medidas, ['dos Molco lenga de 0,9 por 2,1'], [], resolver)).toEqual([
      '2 Molco lenga 80x200',
    ]);
    // Dos líneas iguales: falta una, da lo mismo cuál se cita.
    expect(
      pedidosSinRegistrar('2 Molco lenga 80x200\n2 Molco lenga 80x200', ['dos Molco lenga de 80 por 200'], [], resolver),
    ).toEqual(['2 Molco lenga 80x200']);
    // Si la frase calza igual con dos líneas distintas, no se sabe cuál registró: no acusa ninguna.
    expect(pedidosSinRegistrar('2 Molco lenga 80x200\n2 Molco raulí 80x200', ['dos Molco'], [], resolver)).toEqual(
      [],
    );
  });
  it('cada ítem toma una aparición distinta de su frase', () => {
    const iguales = '2 Molco lenga 80x200\n2 Molco lenga 80x200';
    // Dos líneas iguales registradas no son omisiones; con un solo ítem falta una.
    expect(
      pedidosSinRegistrar(iguales, ['2 Molco lenga 80x200', '2 Molco lenga 80x200'], [], resolver),
    ).toEqual([]);
    expect(pedidosSinRegistrar(iguales, ['2 Molco lenga 80x200'], [], resolver)).toEqual([
      '2 Molco lenga 80x200',
    ]);
    // La frase contenida en otra línea no le quita esa línea a la más larga, en cualquier orden.
    const frases = ['2 Molco lenga 80x200', '2 Molco lenga 80x200 con vidrio'];
    for (const texto of [
      '2 Molco lenga 80x200 y 2 Molco lenga 80x200 con vidrio',
      '2 Molco lenga 80x200 con vidrio y 2 Molco lenga 80x200',
    ])
      expect(pedidosSinRegistrar(texto, frases, [], resolver)).toEqual([]);
    // Dos ítems de una misma frase (la puerta y su marco) no tapan una línea que falta.
    const conMarco = '3 Molco lenga 80x200 con su marco\n3 Molco raulí 90x210';
    expect(
      pedidosSinRegistrar(
        conMarco,
        ['3 Molco lenga 80x200 con su marco', '3 Molco lenga 80x200 con su marco'],
        [],
        resolver,
      ),
    ).toEqual(['3 Molco raulí 90x210']);
  });
  it('reconoce un pedido en un mensaje completo, pero no una pregunta', () => {
    expect(pareceUnPedido('precio de 3 Molco de 83 x 240 para Juan Pérez', resolver)).toBe(true);
    expect(pareceUnPedido('¿la Molco viene en 90?', resolver)).toBe(false);
    // Un pedido con medidas cuenta aunque venga escrito como pregunta.
    expect(
      pareceUnPedido(
        'oye me pasai el valor de 9 puertas Molco rauli 71 por 200 cm? es pa una obra',
        resolver,
      ),
    ).toBe(true);
    expect(pareceUnPedido('hola, buenas tardes', resolver)).toBe(false);
  });
});

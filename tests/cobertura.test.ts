import { describe, expect, it } from 'vitest';
import { pareceUnPedido, pedidosSinRegistrar } from '../src/asistente/cobertura';
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
  it('no revisa si una frase no aparece en el mensaje', () => {
    expect(pedidosSinRegistrar(mensaje, ['ocho marcos 2x4 oregón'], [], resolver)).toBeNull();
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

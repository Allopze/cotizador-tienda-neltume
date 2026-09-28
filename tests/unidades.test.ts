import { describe, expect, it } from 'vitest';
import { normalizar, metros, normalizarMedida } from '../src/catalogo/resolver';
import { cotizar, ErrorPrecio } from '../src/negocio/precios';
import { pregunta } from '../src/asistente/preguntas';
import { contextoSeguro } from '../src/asistente/llm';
import { clienteVacio, type Producto } from '../src/catalogo/tipos';
const producto: Producto = {
  codigo: 'PRUEBA',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'LENGA',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100.4,
  descripcion: 'Puerta',
  filaOrigen: 4,
};
describe('Motor de precios', () => {
  it('redondea unitario antes de multiplicar y el IVA después del neto', () => {
    const r = cotizar([{ producto, cantidad: 3 }], { ajuste: 0.25, iva: 0.19 });
    expect(r.lineas[0].precioUnitario).toBe(126);
    expect([r.neto, r.iva, r.total]).toEqual([378, 72, 450]);
  });
  it('respeta el ajuste de las reglas, incluido cero (nota de pedido)', () => {
    expect(cotizar([{ producto, cantidad: 2 }], { ajuste: 0, iva: 0.19 }).lineas[0].precioUnitario).toBe(100);
    expect(cotizar([{ producto, cantidad: 1 }], { ajuste: -0.5, iva: 0.19 }).lineas[0].precioUnitario).toBe(
      50,
    );
  });
  it('aplica descuento al subtotal y suma el flete antes del IVA, redondeando a pesos', () => {
    const r = cotizar(
      [{ producto, cantidad: 3 }],
      { ajuste: 0.25, iva: 0.19 },
      { descuento: 12.5, flete: 1000 },
    );
    expect(r.subtotal).toBe(378);
    expect(r.descuento).toBe(47); // round(378 × 0,125) = 47,25 → 47
    expect(r.neto).toBe(378 - 47 + 1000);
    expect(r.iva).toBe(Math.round(1331 * 0.19));
    expect(r.total).toBe(1331 + 253);
    for (const descuento of [-1, 50.01, 1.234, NaN])
      expect(() => cotizar([{ producto, cantidad: 1 }], undefined, { descuento })).toThrowError(
        'descuento_invalido',
      );
    for (const flete of [-1, 1.5, Infinity])
      expect(() => cotizar([{ producto, cantidad: 1 }], undefined, { flete })).toThrowError('flete_invalido');
  });
  it('valida sin ítems, cantidades, precios, ajustes e IVA', () => {
    expect(() => cotizar([])).toThrowError(ErrorPrecio);
    for (const cantidad of [0, 1.5, 10001, NaN, Infinity])
      expect(() => cotizar([{ producto, cantidad }])).toThrowError('cantidad_invalida');
    for (const precioNeto of [0, -1, NaN, Infinity])
      expect(() => cotizar([{ producto: { ...producto, precioNeto }, cantidad: 1 }])).toThrowError(
        'precio_invalido',
      );
    for (const ajuste of [-0.51, 1.01, NaN, Infinity]) {
      expect(() => cotizar([{ producto, cantidad: 1 }], { ajuste, iva: 0.19 })).toThrowError(
        'ajuste_invalido',
      );
    }
    for (const iva of [-1, 1.01, NaN])
      expect(() => cotizar([{ producto, cantidad: 1 }], { ajuste: 0.25, iva })).toThrowError('iva_invalido');
    expect(() =>
      cotizar([{ producto: { ...producto, precioNeto: Number.MAX_SAFE_INTEGER }, cantidad: 10000 }]),
    ).toThrowError('desbordamiento');
  });
});
it('normaliza nombres, centímetros y secciones sin inventar datos', () => {
  expect(normalizar('Puñir')).toBe('PUNIR');
  expect(normalizar('  Huilo-huilo!')).toBe('HUILOHUILO');
  expect(metros(210)).toBe(2.1);
  expect(metros(2.1)).toBe(2.1);
  expect(metros(300)).toBe(3);
  expect(metros(2100)).toBe(2.1);
  expect(metros(800)).toBe(0.8);
  // B2: fuera de 0,3–3 m es implausible (se pregunta en vez de adivinar).
  for (const n of [0.2, 5, 20, 3500, 0, -1]) expect(metros(n)).toBeNull();
  expect(normalizarMedida('6 x 4.5')).toBe('6X4,5');
  // B1: ×, * y todos los puntos.
  expect(normalizarMedida('6×4.5')).toBe('6X4,5');
  expect(normalizarMedida('1.5*4.5')).toBe('1,5X4,5');
});
it('preguntas determinísticas contienen los datos que faltan y las opciones', () => {
  const texto = pregunta(
    {
      tipo: 'faltan_datos',
      campos: ['medida', 'alto', 'cantidad'],
      disponibles: { medida: ['2X4', '2X6'], alto: ['2.1', '2.2'], cantidad: ['Entero entre 1 y 10.000'] },
    },
    'MARCO',
  );
  expect(texto).toMatch(/escuadría.*2X4/);
  expect(texto).toContain('alto o largo');
  expect(texto).toContain('cantidad');
  expect(
    pregunta(
      {
        tipo: 'medida_no_disponible',
        campo: 'ancho',
        valor: 0.67,
        disponibles: ['0,60 A 0,65', '0,70 A 0,75'],
      },
      'MOLCO',
    ),
  ).toContain('0,60–0,65');
  expect(pregunta({ tipo: 'madera_desconocida', valor: 'roble', disponibles: ['RAULI'] }, 'MOLCO')).toContain(
    'Raulí',
  );
  expect(pregunta({ tipo: 'cantidad_invalida', valor: 0, disponibles: [] }, 'MOLCO')).toContain('1 y 10.000');
  expect(pregunta({ tipo: 'modelo_desconocido', valor: 'Los Ríos', disponibles: ['MOLCO'] }, null)).toContain(
    'Molco',
  );
});
it('el contexto del LLM proyecta exclusivamente solicitudes y cliente sin precios', () => {
  const s = {
    modelo: 'MOLCO',
    madera: 'LENGA',
    ancho: 0.8,
    alto: 2,
    medida: null,
    cantidad: 1,
    precioNeto: 999,
    costo: 888,
  };
  const c = { ...clienteVacio(), total: 777 };
  const contexto = contextoSeguro('cotiza', [s], c, ['MOLCO'], ['LENGA']);
  expect(JSON.stringify(contexto)).not.toMatch(/precio|costo|total|999|888|777/);
  expect(contexto.borrador.items[0].modelo).toBe('MOLCO');
});

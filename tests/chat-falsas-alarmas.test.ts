import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Catalogo, Producto } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

/**
 * Falsas alarmas de la paridad con la IA (modo «avisar»), con las frases que el modelo pudo haber copiado como
 * `fuente`. Caso 37: la cantidad inventada se deja pendiente y se avisa una vez, sin «anoté…». Caso 50: «dame 2
 * LOS LAGOS, una en lenga y otra en mara, ambas de 74x220» no avisa nada.
 */
const puerta = (codigo: string, modelo: string, madera: string, ancho: number, alto: number): Producto => ({
  codigo, modelo, familia: 'PUERTA', tipo: 'PUERTA SÓLIDA', madera, medida: `${ancho} A ${ancho + 0.05}`,
  anchoMin: ancho, anchoMax: ancho + 0.05, altoMin: alto, altoMax: alto, largo: alto, precioNeto: 100_000,
  descripcion: `${modelo} ${madera} ${ancho} MT X ${alto} MT`, filaOrigen: 7,
});
const catalogo: Catalogo = {
  fuente: 'test.xlsx', sha256: 'falsas-alarmas', fecha: '2026-01-01T00:00:00.000Z',
  productos: [
    puerta('ENS-L', 'ENSENADA', 'LENGA', 0.9, 2.5),
    puerta('LLAG-L-2-C', 'LOS LAGOS', 'LENGA', 0.7, 2.2),
    puerta('LLAG-M-2-C', 'LOS LAGOS', 'MARA', 0.7, 2.2),
    puerta('FUT-L', 'FUTRONO', 'LENGA', 0.9, 2.1),
    puerta('PIR-L', 'PIRIHUEICO', 'LENGA', 0.8, 2),
    puerta('PIR-M', 'PIRIHUEICO', 'MARA', 0.8, 2),
    ...[2.4, 3].map((largo) => ({
      codigo: `GUA-L-12X2-${largo}`, modelo: 'GUARDAPOLVO', familia: 'MOLDURA' as const, tipo: null, madera: 'LENGA',
      medida: '12X2', anchoMin: null, anchoMax: null, largo, precioNeto: 5_000,
      descripcion: `GUARDAPOLVO LENGA 12X2 ${largo} MT`, filaOrigen: 3,
    })),
  ],
};
const MODOS = ['avisar', 'corregir'] as const;

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});
async function setup(anclaje: (typeof MODOS)[number]) {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-chat-'));
  dirs.push(dir);
  const llm = { interpretar: vi.fn(), verificarCifras: true, anclaje };
  const servicio = new Servicio(catalogo, llm, new Almacen(dir));
  return async (mensaje: string, agregar: object[]) => {
    llm.interpretar.mockResolvedValueOnce({ name: 'modificar_cotizacion', input: { agregar } });
    return servicio.ejecutar({ tipo: 'chat', mensaje });
  };
}
const item = (modelo: string, madera: string, ancho: number, alto: number, cantidad: number | null, fuente: string) => ({
  modelo, madera, ancho, alto, medida: null, cantidad, tipoMedida: null, fuente,
});

describe('caso 37: cantidad inventada que queda pendiente', () => {
  const mensaje = 'Por favor cotizar puerta tipo ensenada en Lenga de 91 x 250';
  for (const modo of MODOS)
    for (const fuente of [
      'Por favor cotizar puerta tipo ensenada en Lenga de 91 x 250',
      'puerta tipo ensenada en Lenga de 91 x 250',
      'ensenada en Lenga de 91 x 250',
    ])
      it(`pregunta la cantidad y avisa una sola vez, sin «anoté…» (modo ${modo}, «${fuente}»)`, async () => {
        const chat = await setup(modo);
        const r = await chat(mensaje, [item('ENSENADA', 'LENGA', 0.91, 2.5, 1, fuente)]);
        expect(r.cotizacion.incompletos.map((i) => i.pregunta)).toEqual([
          '¿Qué cantidad necesitas para Ensenada? Opciones: Entero entre 1 y 10.000.',
        ]);
        expect(r.cotizacion.solicitudes[0].cantidad).toBeNull();
        // Un solo aviso: ni «anoté la cantidad 1» (no quedó anotada) ni, en «corregir», que la cifra es de otro
        // ítem (no hay otro).
        expect(r.avisos).toEqual([
          'El asistente propuso la cantidad 1 para el ítem 1 (ENSENADA), pero esa cifra no aparece en tu mensaje: quedó pendiente para que la confirmes.',
        ]);
      });

  it('una cantidad que la frase no dice y sí queda en la cotización se sigue avisando (modo avisar)', async () => {
    const chat = await setup('avisar');
    // El 2 es de la otra línea: el anclaje de cifras lo acepta (está en el mensaje), pero no es de la Ensenada.
    const r = await chat('2 Los Lagos lenga 74x220 y Ensenada lenga 91x250', [
      item('LOS LAGOS', 'LENGA', 0.74, 2.2, 2, '2 Los Lagos lenga 74x220'),
      item('ENSENADA', 'LENGA', 0.91, 2.5, 2, 'Ensenada lenga 91x250'),
    ]);
    expect(r.cotizacion.solicitudes[1].cantidad).toBe(2);
    expect(r.avisos).toEqual(['Revisa el ítem 2 (ENSENADA): anoté la cantidad 2, pero no lo encuentro en tu mensaje.']);
  });
});

describe('caso 50: «dame 2 LOS LAGOS, una en lenga y otra en mara, ambas de 74x220»', () => {
  const mensaje = 'dame 2 LOS LAGOS, una en lenga y otra en mara, ambas de 74x220';
  const variantes: [string, string][] = [
    ['una en lenga, ambas de 74x220', 'otra en mara, ambas de 74x220'],
    ['una en lenga', 'otra en mara, ambas de 74x220'],
    ['una en lenga', 'otra en mara'],
    ['2 LOS LAGOS, una en lenga, ambas de 74x220', 'otra en mara, ambas de 74x220'],
    ['dame 2 LOS LAGOS, una en lenga... ambas de 74x220', 'otra en mara, ambas de 74x220'],
    ['dame 2 LOS LAGOS, una en lenga', 'otra en mara, ambas de 74x220'],
  ];
  for (const modo of MODOS)
    for (const [a, b] of variantes)
      it(`cotiza una de cada madera sin avisos (modo ${modo}, «${a}» / «${b}»)`, async () => {
        const chat = await setup(modo);
        const r = await chat(mensaje, [
          item('LOS LAGOS', 'LENGA', 0.74, 2.2, 1, a),
          item('LOS LAGOS', 'MARA', 0.74, 2.2, 1, b),
        ]);
        expect(r.avisos).toBeUndefined();
        expect(r.cotizacion.montos.lineas.map((l) => `${l.producto.codigo}×${l.cantidad}`)).toEqual([
          'LLAG-L-2-C×1',
          'LLAG-M-2-C×1',
        ]);
      });

  it('un pedido de verdad sin registrar se sigue avisando', async () => {
    const chat = await setup('avisar');
    const r = await chat('dame 2 LOS LAGOS, una en lenga y otra en mara, ambas de 74x220. Y 3 ENSENADA lenga 91x250', [
      item('LOS LAGOS', 'LENGA', 0.74, 2.2, 1, 'una en lenga'),
      item('LOS LAGOS', 'MARA', 0.74, 2.2, 1, 'otra en mara, ambas de 74x220'),
    ]);
    expect(r.avisos).toEqual(['No registré: «3 ENSENADA lenga 91x250». Revisa si falta y escríbelo de nuevo.']);
  });
});

/** Casos de evals/cotizacion.json donde Qwen3.7-Flash (modo «avisar») dio las mismas falsas alarmas. */
describe('casos de la evaluación con otra IA', () => {
  it('sin-cantidad: «Puerta Futrono en lenga de 90 por 210» con la cantidad 1 inventada avisa una vez', async () => {
    const chat = await setup('avisar');
    const mensaje = 'Puerta Futrono en lenga de 90 por 210';
    const r = await chat(mensaje, [item('FUTRONO', 'LENGA', 0.9, 2.1, 1, mensaje)]);
    expect(r.avisos).toEqual([
      'El asistente propuso la cantidad 1 para el ítem 1 (FUTRONO), pero esa cifra no aparece en tu mensaje: quedó pendiente para que la confirmes.',
    ]);
    expect(r.cotizacion.incompletos.map((i) => i.pregunta)).toEqual([
      '¿Qué cantidad necesitas para Futrono? Opciones: Entero entre 1 y 10.000.',
    ]);
  });

  it('guardapolvo-sin-largo: el 2 de «12x2» leído como largo se avisa una vez y queda la pregunta', async () => {
    const chat = await setup('avisar');
    const mensaje = '20 guardapolvos 12x2 en lenga';
    const r = await chat(mensaje, [{ ...item('GUARDAPOLVO', 'LENGA', null as never, 2, 20, mensaje), ancho: null, medida: '12x2' }]);
    expect(r.cotizacion.solicitudes[0].alto).toBeNull();
    expect(r.cotizacion.incompletos).toHaveLength(1);
    // La IA sí inventó ese largo: el aviso es cierto. No se suma «tu mensaje parece decir el alto 2 m».
    expect(r.avisos).toEqual([
      'El asistente propuso el alto o largo 2 m para el ítem 1 (GUARDAPOLVO), pero esa cifra no aparece en tu mensaje: quedó pendiente para que la confirmes.',
    ]);
  });

  for (const [a, b] of [
    ['una en lenga, ambas de 80x200', 'otra en mara, ambas de 80x200'],
    ['una en lenga', 'otra en mara'],
    // Qwen3.7-Flash pega la parte común sin coma (8 de 8 corridas, 24 oct).
    ['una en lenga de 80x200', 'otra en mara de 80x200'],
  ])
    it(`dos-maderas: «dame 2 Pirihueico, una en lenga y otra en mara…» sin avisos («${a}» / «${b}»)`, async () => {
      const chat = await setup('avisar');
      const r = await chat('dame 2 Pirihueico, una en lenga y otra en mara, ambas de 80x200', [
        item('PIRIHUEICO', 'LENGA', 0.8, 2, 1, a),
        item('PIRIHUEICO', 'MARA', 0.8, 2, 1, b),
      ]);
      expect(r.avisos).toBeUndefined();
      expect(r.cotizacion.montos.lineas.map((l) => `${l.producto.codigo}×${l.cantidad}`)).toEqual(['PIR-L×1', 'PIR-M×1']);
    });
});

/**
 * I7 con la salida de Qwen3.7-Flash: la IA puso el total como precio unitario (valor 400000) en vez de dejarlo vacío.
 * El total se detecta en el texto, no en cómo la IA llenó el precio.
 */
describe('precio «en total» que la IA tomó como unitario', () => {
  const TOTAL = 'Escribiste un precio total para el ítem 1; indica el valor por unidad.';
  for (const modo of MODOS)
    for (const [mensaje, valor] of [
      ['2 los lagos lenga 74x220 a $400.000 en total', 400_000],
      ['2 los lagos lenga 74x220 a $400.000 por las dos', 400_000],
      ['2 los lagos lenga 74x220 a 900 mil las dos', 900_000],
      ['2 los lagos lenga 74x220, total $400.000', 400_000],
      ['2 los lagos lenga 74x220 a $400.000, en total', 400_000],
    ] as const)
      it(`no aplica el total como unitario y avisa (modo ${modo}, «${mensaje}»)`, async () => {
        const chat = await setup(modo);
        const r = await chat(mensaje, [
          { ...item('LOS LAGOS', 'LENGA', 0.74, 2.2, 2, mensaje), precio: { valor, iva: null } },
        ]);
        expect(r.avisos).toContain(TOTAL);
        expect(r.cotizacion.solicitudes[0].precioUnitario ?? null).toBeNull();
      });

  it('el precio por unidad escrito junto al total se aplica', async () => {
    const chat = await setup('avisar');
    const mensaje = '2 los lagos lenga 74x220 a $200.000 c/u, $400.000 en total';
    const r = await chat(mensaje, [
      { ...item('LOS LAGOS', 'LENGA', 0.74, 2.2, 2, mensaje), precio: { valor: 200_000, iva: 'neto' } },
    ]);
    expect(r.avisos ?? []).not.toContain(TOTAL);
    expect(r.cotizacion.solicitudes[0].precioUnitario).toBe(200_000);
  });

  it('con una sola unidad, «total» no cambia el precio', async () => {
    const chat = await setup('avisar');
    const mensaje = '1 los lagos lenga 74x220 a $400.000 en total';
    const r = await chat(mensaje, [
      { ...item('LOS LAGOS', 'LENGA', 0.74, 2.2, 1, mensaje), precio: { valor: 400_000, iva: 'neto' } },
    ]);
    expect(r.avisos ?? []).not.toContain(TOTAL);
    expect(r.cotizacion.solicitudes[0].precioUnitario).toBe(400_000);
  });
});

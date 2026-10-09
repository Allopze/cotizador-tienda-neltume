import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cantidadesDichas, cifrasDelTexto } from '../src/asistente/anclaje';
import type { Catalogo, Producto } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

// Huilo Huilo enchapada: anchos exactos de 0,70 a 0,90 y alto 2,00–2,20, como la planilla de enchapadas.
const huilo = [0.7, 0.75, 0.8, 0.85, 0.9].map((ancho, i): Producto => ({
  codigo: `HUIL-EM-0${Math.round(ancho * 100)}-220`,
  modelo: 'Huilo Huilo',
  familia: 'PUERTA',
  tipo: 'PUERTA ENCHAPADA',
  madera: 'MARA ENCHAPADA',
  medida: ancho.toFixed(2).replace('.', ','),
  anchoMin: ancho,
  anchoMax: ancho,
  altoMin: 2,
  altoMax: 2.2,
  largo: 2.2,
  precioNeto: 80_000 + i * 2_000,
  descripcion: `HUILO HUILO MARA ENCHAPADA ${ancho} MT X 2 A 2,2 MT`,
  filaOrigen: 10 + i,
}));
const molco: Producto = {
  codigo: 'MOL-L-0.8-2',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'LENGA',
  medida: '0.8 A 0.85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100_000,
  descripcion: 'MOLCO LENGA',
  filaOrigen: 1,
};
const catalogo: Catalogo = {
  fuente: 'test',
  sha256: 'test',
  fecha: '2026-01-01',
  productos: [...huilo, molco],
};

const dirs: string[] = [];
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-especial-'));
  dirs.push(dir);
  const llm = { interpretar: vi.fn(), verificarCifras: true };
  return { llm, servicio: new Servicio(catalogo, llm, new Almacen(dir)) };
}
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

type Precio = { valor: number | null; iva: 'neto' | 'incluido' | null };
const item = (fuente: string, datos: Record<string, unknown>, precio?: Precio) => ({
  modelo: 'HUILO HUILO',
  madera: 'MARA ENCHAPADA',
  ancho: 1.9,
  alto: 2.2,
  medida: null,
  cantidad: 1,
  tipoMedida: null,
  fuente,
  ...datos,
  ...(precio ? { precio } : {}),
});
const agregar = (...items: ReturnType<typeof item>[]) => ({
  name: 'modificar_cotizacion',
  input: { agregar: items },
});

describe('pedidos especiales desde el chat', () => {
  it('una medida que no existe, con su precio escrito, queda como pedido especial con ese precio', async () => {
    const { servicio, llm } = await setup();
    const mensaje = '1 huilo huilo enchapada en mara de 1.90x2.20 a $450.000 + iva';
    llm.interpretar.mockResolvedValueOnce(agregar(item(mensaje, {}, { valor: 450000, iva: 'neto' })));
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje });
    const [s] = r.cotizacion.solicitudes;
    expect(s).toMatchObject({
      modelo: 'Huilo Huilo',
      madera: 'MARA ENCHAPADA',
      ancho: 1.9,
      alto: 2.2,
      cantidad: 1,
      precioUnitario: 450000,
      personalizado: { familia: 'PUERTA' },
    });
    expect(s).not.toHaveProperty('precio');
    expect(r.cotizacion.incompletos).toEqual([]);
    expect(r.cotizacion.montos.lineas[0]).toMatchObject({
      precioUnitario: 450000,
      producto: { codigo: 'ESPECIAL' },
    });
    expect(r.avisos).toEqual([
      expect.stringMatching(
        /«Huilo Huilo MARA ENCHAPADA 1,90 × 2,20 m» no está en el catálogo: lo cotizo como pedido especial a \$450\.000 neto c\/u/,
      ),
    ]);
  });

  it('sin precio queda pendiente y explica cómo cotizarlo; el precio puede llegar en otro mensaje', async () => {
    const { servicio, llm } = await setup();
    const mensaje = '1 huilo huilo enchapada en mara de 1.90x2.20';
    llm.interpretar.mockResolvedValueOnce(agregar(item(mensaje, {})));
    const q = (await servicio.ejecutar({ tipo: 'chat', mensaje })).cotizacion;
    expect(q.incompletos).toHaveLength(1);
    expect(q.historial.at(-1)?.texto).toMatch(/Si es un pedido especial, escribe su precio/);
    const cambio = 'la de 1,90 cotízala en 450 mil más iva';
    llm.interpretar.mockResolvedValueOnce({
      name: 'modificar_cotizacion',
      input: { items: [{ indice: 0, cambios: { precio: { valor: 450000, iva: 'neto' }, fuente: cambio } }] },
    });
    const r = await servicio.ejecutar({
      tipo: 'chat',
      id: q.id,
      actualizada: q.actualizada,
      mensaje: cambio,
    });
    expect(r.cotizacion.incompletos).toEqual([]);
    expect(r.cotizacion.solicitudes[0]).toMatchObject({
      precioUnitario: 450000,
      personalizado: { familia: 'PUERTA' },
    });
  });

  it('un producto del catálogo con precio escrito usa ese precio y avisa el de catálogo; el precio no es la cantidad', async () => {
    const { servicio, llm } = await setup();
    const mensaje = '2 Molco lenga 80x200 a $120.000';
    llm.interpretar.mockResolvedValueOnce(
      agregar(
        item(
          mensaje,
          { modelo: 'MOLCO', madera: 'LENGA', ancho: 0.8, alto: 2, cantidad: 2 },
          { valor: 120000, iva: null },
        ),
      ),
    );
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje });
    expect(r.cotizacion.solicitudes[0]).toMatchObject({ cantidad: 2, precioUnitario: 120000 });
    expect(r.cotizacion.solicitudes[0].personalizado ?? null).toBeNull();
    expect(r.cotizacion.montos.lineas[0]).toMatchObject({
      cantidad: 2,
      precioUnitario: 120000,
      producto: { codigo: 'MOL-L-0.8-2' },
    });
    expect(r.avisos).toEqual([
      expect.stringMatching(/Tomé \$120\.000 como precio neto/),
      expect.stringMatching(
        /Usé el precio que indicaste para el ítem 1 \(MOLCO\): \$120\.000 neto c\/u; el de catálogo es \$[\d.]+/,
      ),
    ]);
  });

  it('un precio fuera del margen permitido sobre el costo no se aplica: avisa en vez de fallar', async () => {
    const { servicio, llm } = await setup();
    // El costo de fábrica de la Molco es $100.000: $40.000 sería un margen de −60 %.
    const mensaje = '2 Molco lenga 80x200 a $40.000 + iva';
    llm.interpretar.mockResolvedValueOnce(
      agregar(
        item(
          mensaje,
          { modelo: 'MOLCO', madera: 'LENGA', ancho: 0.8, alto: 2, cantidad: 2 },
          { valor: 40000, iva: 'neto' },
        ),
      ),
    );
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje });
    expect(r.cotizacion.solicitudes[0].precioUnitario ?? null).toBeNull();
    expect(r.cotizacion.montos.lineas[0].precioUnitario).toBeGreaterThan(100000);
    expect(r.avisos).toEqual([
      expect.stringMatching(/No apliqué el precio del ítem 1 \(MOLCO\): \$40\.000 queda fuera del margen/),
    ]);
  });

  it('no aplica un precio que no está escrito en la línea del ítem, ni el de otra línea', async () => {
    const { servicio, llm } = await setup();
    const linea = '1 huilo huilo enchapada en mara de 1.90x2.20';
    const mensaje = `${linea}\nflete a Riñihue $350.000 + iva`;
    llm.interpretar.mockResolvedValueOnce(agregar(item(linea, {}, { valor: 350000, iva: 'neto' })));
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje });
    expect(r.cotizacion.solicitudes[0].precioUnitario ?? null).toBeNull();
    expect(r.cotizacion.solicitudes[0].personalizado ?? null).toBeNull();
    expect(r.avisos).toContainEqual(
      expect.stringMatching(/No apliqué el precio del ítem 1.*no aparece escrito/),
    );
  });

  it('vale el precio de la misma línea aunque la IA corte la frase antes del precio', async () => {
    const { servicio, llm } = await setup();
    const mensaje = 'Cotizar\n1 huilo huilo enchapada en mara de 1.90x2.20 a $450.000 + iva';
    llm.interpretar.mockResolvedValueOnce(
      agregar(item('1 huilo huilo enchapada en mara de 1.90x2.20', {}, { valor: 450000, iva: 'neto' })),
    );
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje });
    expect(r.cotizacion.solicitudes[0]).toMatchObject({
      precioUnitario: 450000,
      personalizado: { familia: 'PUERTA' },
    });
  });

  it('un precio con IVA incluido se guarda neto, y «$450.00» leído como 450 vale $450.000', async () => {
    const { servicio, llm } = await setup();
    const incluido = '1 huilo huilo enchapada en mara de 1.90x2.20 a $535.500 iva incluido';
    llm.interpretar.mockResolvedValueOnce(agregar(item(incluido, {}, { valor: 535500, iva: 'incluido' })));
    expect(
      (await servicio.ejecutar({ tipo: 'chat', mensaje: incluido })).cotizacion.solicitudes[0].precioUnitario,
    ).toBe(450000);
    const ceros = '1 huilo huilo enchapada en mara de 1.90x2.20 a $450.00 + iva';
    llm.interpretar.mockResolvedValueOnce(agregar(item(ceros, {}, { valor: 450, iva: 'neto' })));
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje: ceros });
    expect(r.cotizacion.solicitudes[0]).toMatchObject({
      precioUnitario: 450000,
      personalizado: { familia: 'PUERTA' },
    });
  });

  it('«Cotizar como especial» desde el detalle pide el precio y deja el pendiente como especial', async () => {
    const { servicio, llm } = await setup();
    const mensaje = '1 huilo huilo enchapada en mara de 1.90x2.20';
    llm.interpretar.mockResolvedValueOnce(agregar(item(mensaje, {})));
    const q = (await servicio.ejecutar({ tipo: 'chat', mensaje })).cotizacion;
    const especial = { personalizado: { familia: 'PUERTA' as const } };
    await expect(
      servicio.ejecutar({
        tipo: 'editar',
        id: q.id,
        actualizada: q.actualizada,
        items: [{ indice: 0, cambios: especial }],
      }),
    ).rejects.toThrow(/precio unitario del pedido especial/);
    const r = await servicio.ejecutar({
      tipo: 'editar',
      id: q.id,
      actualizada: q.actualizada,
      items: [{ indice: 0, cambios: { ...especial, precioUnitario: 450000 } }],
    });
    expect(r.cotizacion.incompletos).toEqual([]);
    expect(r.cotizacion.montos.lineas[0]).toMatchObject({
      precioUnitario: 450000,
      producto: { codigo: 'ESPECIAL' },
    });
  });
});

describe('montos dentro de la frase de un ítem', () => {
  it('un precio no es una cantidad ni una medida', () => {
    expect(cantidadesDichas('huilo huilo 1.90x2.20 a 450 mil')).toEqual([]);
    expect(cantidadesDichas('2 Molco lenga 80x200 a $120.000')).toEqual([2]);
    expect(cifrasDelTexto('a $450.000 + iva y 2 lucas')).toEqual([]);
    expect(cifrasDelTexto('3 Molco a $120.000')).toEqual([3]);
  });
});

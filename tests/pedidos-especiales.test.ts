import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cantidadesDichas, cifrasDelTexto } from '../src/asistente/anclaje';
import type { Catalogo, Producto } from '../src/catalogo/tipos';
import { familiaEspecial } from '../src/negocio/personalizados';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
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
  return { dir, llm, servicio: new Servicio(catalogo, llm, new Almacen(dir)) };
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
        /«Huilo Huilo MARA ENCHAPADA 1,90 × 2,20 m» no está en el catálogo: lo cotizo como pedido especial a \$450\.000 sin IVA c\/u/,
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
      expect.stringMatching(/Tomé \$120\.000 como precio sin IVA/),
      expect.stringMatching(
        /Usé el precio que indicaste para el ítem 1 \(MOLCO\): \$120\.000 sin IVA c\/u; el de catálogo es \$[\d.]+/,
      ),
    ]);
  });

  it('un precio fuera de rango queda pendiente y conserva lo escrito', async () => {
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
    expect(r.cotizacion.solicitudes[0].precioUnitario).toBe(40000);
    expect(r.cotizacion.incompletos[0].pregunta).toMatch(/fuera del rango/);
    expect(r.cotizacion.montos.lineas).toHaveLength(0);
    // La pregunta del pendiente ya lo explica: el chat no repite la explicación como aviso.
    expect(r.avisos).toBeUndefined();
    const texto = r.cotizacion.historial.at(-1)!.texto;
    expect(texto).toBe(r.cotizacion.incompletos[0].pregunta);
    expect(texto.match(/queda fuera del (?:rango|margen) permitido/g)).toHaveLength(1);
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

describe('pedidos especiales en la nota de pedido', () => {
  it('van a su costo de fábrica si se conoce; sin él no suman, y nunca van con el precio de venta', async () => {
    const { servicio, llm } = await setup();
    const mensaje = '2 Molco lenga 80x200 para Ana Soto';
    llm.interpretar.mockResolvedValueOnce({
      name: 'modificar_cotizacion',
      input: {
        agregar: [
          item('2 Molco lenga 80x200', {
            modelo: 'MOLCO',
            madera: 'LENGA',
            ancho: 0.8,
            alto: 2,
            cantidad: 2,
            tipoMedida: 'hoja',
          }),
        ],
        cliente: { nombre: 'Ana Soto' },
      },
    });
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje })).cotizacion;
    const especial = (nombre: string) => ({
      nombre,
      familia: 'PUERTA' as const,
      madera: 'Roble',
      cantidad: 1,
      precioUnitario: 450000,
      ancho: 1.9,
      alto: 2.2,
      tipoMedida: 'hoja' as const,
    });
    for (const nombre of ['Puerta doble', 'Puerta japonesa'])
      q = (
        await servicio.ejecutar({
          tipo: 'agregar_personalizado',
          id: q.id,
          actualizada: q.actualizada,
          item: especial(nombre),
        })
      ).cotizacion;
    await expect(
      servicio.ejecutar({
        tipo: 'editar',
        id: q.id,
        actualizada: q.actualizada,
        items: [{ indice: 0, cambios: { costoFabrica: 50000 } }],
      }),
    ).rejects.toThrow(/Solo un pedido especial lleva costo de fábrica/);
    q = (
      await servicio.ejecutar({
        tipo: 'editar',
        id: q.id,
        actualizada: q.actualizada,
        items: [{ indice: 1, cambios: { costoFabrica: 300000 } }],
      })
    ).cotizacion;
    expect(q.solicitudes[1].costoFabrica).toBe(300000);
    q = (await servicio.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'aprobar', id: q.id, actualizada: q.actualizada })).cotizacion;
    q = (
      await servicio.ejecutar({
        tipo: 'pago',
        id: q.id,
        actualizada: q.actualizada,
        monto: Math.ceil(q.montos.total * 0.5),
      })
    ).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'generar_nota', id: q.id, actualizada: q.actualizada })).cotizacion;
    // La Molco a costo de fábrica, la especial con costo a ese costo, y la otra fuera (va «Por definir» en el PDF).
    expect(q.nota!.montos.lineas.map((l) => [l.indice, l.precioUnitario, l.total])).toEqual([
      [0, 100000, 200000],
      [1, 300000, 300000],
    ]);
    expect(q.nota!.montos.subtotal).toBe(500000);
  });
});

describe('familia y precio a mano', () => {
  it('la familia de un especial sale del catálogo, del nombre o de su forma: solo una puerta cuenta como puerta', () => {
    const desconocido = { tipo: 'modelo_desconocido' as const, valor: 'x', disponibles: [] };
    const sinMedida = {
      tipo: 'medida_no_disponible' as const,
      familia: 'MARCO' as const,
      campo: 'alto' as const,
      valor: 3,
      disponibles: [],
    };
    expect(familiaEspecial(sinMedida)).toBe('MARCO');
    expect(familiaEspecial(desconocido, { modelo: 'Marco de raulí', ancho: null, medida: '2x4' })).toBe(
      'MARCO',
    );
    expect(familiaEspecial(desconocido, { modelo: 'Guardapolvo curvo', ancho: null, medida: null })).toBe(
      'MOLDURA',
    );
    expect(familiaEspecial(desconocido, { modelo: 'Tablón', ancho: null, medida: '6x2' })).toBe('MOLDURA');
    expect(familiaEspecial(desconocido, { modelo: 'Puerta japonesa', ancho: 0.8, medida: null })).toBe(
      'PUERTA',
    );
  });

  it('un precio a mano fuera del margen permitido explica el rango en vez de un error genérico', async () => {
    const { dir, servicio, llm } = await setup();
    const mensaje = '2 Molco lenga 80x200';
    llm.interpretar.mockResolvedValueOnce(
      agregar(item(mensaje, { modelo: 'MOLCO', madera: 'LENGA', ancho: 0.8, alto: 2, cantidad: 2 })),
    );
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje })).cotizacion;
    const editar = (precioUnitario: number) =>
      servicio.ejecutar({
        tipo: 'editar',
        id: q.id,
        actualizada: q.actualizada,
        items: [{ indice: 0, cambios: { precioUnitario } }],
      });
    // Escrito en el detalle se rechaza con el rango en pesos: el campo sigue abierto y no se guarda nada.
    await expect(editar(40000)).rejects.toThrow(
      /\$40\.000 del ítem 1 queda fuera de la ganancia permitida.*entre \$50\.000 y \$600\.000/,
    );
    expect(new Almacen(dir).obtener(q.id)).toMatchObject({ actualizada: q.actualizada, incompletos: [] });
    q = (await editar(90000)).cotizacion;
    expect(q.montos.lineas[0].precioUnitario).toBe(90000);
  });

  it('bajar el precio de un pedido especial bajo su descuento en monto se rechaza; otro dato del ítem pendiente no', async () => {
    const { dir, servicio, llm } = await setup();
    const mensaje = '2 Molco lenga 80x200';
    llm.interpretar.mockResolvedValueOnce(
      agregar(item(mensaje, { modelo: 'MOLCO', madera: 'LENGA', ancho: 0.8, alto: 2, cantidad: 2 })),
    );
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje })).cotizacion;
    const especial = {
      nombre: 'Puerta doble', familia: 'PUERTA' as const, madera: 'Roble', cantidad: 1, precioUnitario: 100_000,
      ancho: 1.9, alto: 2.2, tipoMedida: 'hoja' as const,
    };
    q = (await servicio.ejecutar({ tipo: 'agregar_personalizado', id: q.id, actualizada: q.actualizada, item: especial }))
      .cotizacion;
    const editar = async (cambios: Record<string, unknown>) =>
      (q = (await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, items: [{ indice: 1, cambios }] }))
        .cotizacion);
    await editar({ descuento: { tipo: 'monto', valor: 50_000 } });
    await expect(editar({ precioUnitario: 40_000 })).rejects.toThrow(/supera su precio unitario/);
    expect(new Almacen(dir).obtener(q.id)!.solicitudes[1].precioUnitario).toBe(100_000);
    // Deshacer sí lo deja pendiente; editar otro dato del ítem lo deja igual, y un precio que sigue bajo el
    // descuento se rechaza.
    q = (
      await servicio.ejecutar({
        tipo: 'restaurar_items', id: q.id, actualizada: q.actualizada,
        items: q.solicitudes.map((s, i) => (i === 1 ? { ...s, precioUnitario: 40_000 } : s)),
      })
    ).cotizacion;
    expect(q.incompletos.map((p) => p.indice)).toEqual([1]);
    await editar({ observaciones: 'Con bisagras dobles' });
    expect(q.incompletos.map((p) => p.indice)).toEqual([1]);
    await expect(editar({ precioUnitario: 45_000 })).rejects.toThrow(/supera su precio unitario/);
    await editar({ precioUnitario: 60_000 });
    expect(q.incompletos).toEqual([]);
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

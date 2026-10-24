import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anclarCifras, anclarNombres, cifrasDelTexto } from '../src/asistente/anclaje';
import { HERRAMIENTAS_COTIZACION, herramientas } from '../src/asistente/llm';
import { CAMPOS_ITEM, avisosDeRevision, casosSchema, categoriaEvaluada, puntuar, resumen } from '../src/asistente/evaluacion';
import { contextoSeguro, problemaSalida, SYSTEM } from '../src/asistente/llm';
import { mapaCatalogo } from '../src/catalogo/mapa';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const puerta = (ancho: number, largo: number, madera = 'PINO OREGON', fila = 1): Producto => ({
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
  filaOrigen: fila,
});
const marco = (medida: string, largo: number): Producto => ({
  codigo: `MAR-O-${medida}-${largo}`,
  modelo: 'MARCO',
  familia: 'MARCO',
  tipo: 'PULG KIT',
  madera: 'PINO OREGON',
  medida,
  anchoMin: null,
  anchoMax: null,
  largo,
  precioNeto: 20_000,
  descripcion: 'MARCO',
  filaOrigen: 9,
});
const catalogo: Catalogo = {
  fuente: 'test',
  sha256: 'test',
  fecha: '2026-01-01',
  productos: [
    puerta(0.8, 2),
    puerta(0.8, 2.1),
    puerta(0.9, 2),
    puerta(0.8, 2, 'LENGA'),
    marco('2X4', 2.1),
    marco('2X5', 2.1),
  ],
};
const item = (s: Partial<SolicitudItem> = {}): SolicitudItem => ({
  modelo: 'MOLCO',
  madera: 'PINO OREGON',
  ancho: 0.8,
  alto: 2,
  medida: null,
  cantidad: 3,
  ...s,
});

const dirs: string[] = [];
async function setup(verificarCifras = true) {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-precision-'));
  dirs.push(dir);
  const llm = { interpretar: vi.fn(), verificarCifras };
  return { llm, servicio: new Servicio(catalogo, llm, new Almacen(dir)) };
}
async function setupConAlmacen() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-precision-'));
  dirs.push(dir);
  const llm = { interpretar: vi.fn(), verificarCifras: true };
  const almacen = new Almacen(dir);
  return { llm, almacen, servicio: new Servicio(catalogo, llm, almacen) };
}
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

describe('cifras del texto', () => {
  it('lee dígitos, decimales con coma, miles y cantidades en palabras', () => {
    expect(cifrasDelTexto('4 coscos de 80 por 2,10')).toEqual(expect.arrayContaining([4, 80, 2.1]));
    expect(cifrasDelTexto('10.000 tablas')).toContain(10000);
    expect(cifrasDelTexto('tres puertas y media docena de marcos')).toEqual(expect.arrayContaining([3, 6]));
    expect(cifrasDelTexto('treinta y dos Molco')).toContain(32);
    expect(cifrasDelTexto('una Molco')).toContain(1);
  });
  it('sin palabras, solo cuenta los dígitos', () => {
    expect(cifrasDelTexto('dos Molco de 80', false)).toEqual([80]);
  });
});

describe('anclaje de cifras', () => {
  it('acepta medidas en otra unidad y deja pendiente la cifra que nadie escribió', () => {
    const { items, avisos } = anclarCifras(
      [item({ cantidad: 3, ancho: 0.8, alto: 2.1 })],
      [],
      ['3 Molco oregón de 80'],
    );
    expect(items[0]).toMatchObject({ cantidad: 3, ancho: 0.8, alto: null });
    expect(avisos).toEqual([expect.stringMatching(/alto o largo 2,1 m para el ítem 1.*no aparece/)]);
  });
  it('una cantidad en palabras respalda la cantidad, pero no una medida', () => {
    const { items } = anclarCifras([item({ cantidad: 2, ancho: 0.8, alto: 2 })], [], ['dos Molco de 80']);
    expect(items[0]).toMatchObject({ cantidad: 2, ancho: 0.8, alto: null });
  });
  it('la sección del accesorio no respalda su largo', () => {
    const guardapolvo = item({ modelo: 'GUARDAPOLVO', ancho: null, medida: '12X2', alto: 2, cantidad: 20 });
    expect(anclarCifras([guardapolvo], [], ['20 guardapolvos 12x2 en lenga']).items[0]).toMatchObject({
      medida: '12X2',
      alto: null,
      cantidad: 20,
    });
    expect(anclarCifras([guardapolvo], [], ['20 guardapolvos 12x2 de 2 metros']).items[0].alto).toBe(2);
  });
  it('una cifra que ya estaba en el borrador se acepta («otra igual»)', () => {
    const previo = item({ cantidad: 2, ancho: 0.8, alto: 2 });
    const { items, avisos } = anclarCifras(
      [previo, item({ cantidad: 1, ancho: 0.9, alto: 2 })],
      [previo],
      ['agrega 1 igual pero de 90'],
    );
    expect(items[1]).toMatchObject({ cantidad: 1, ancho: 0.9, alto: 2 });
    expect(avisos).toEqual([]);
  });
});

describe('anclaje de nombres', () => {
  const alias = {
    modelo: { 'HUILO HUILO': ['WILLOW'], 'COZ COZ': ['COSCOS'] },
    madera: { 'PINO OREGON': ['PINO', 'OREGON'], 'MARA ENCHAPADA': ['ENCHAPADA EN MARA'] },
  };
  it('no deja que la IA cambie un nombre dudoso por otro modelo del catálogo', () => {
    const { items, avisos } = anclarNombres(
      [item({ modelo: 'PIEZAS T', madera: 'PINO OREGON' })],
      [],
      ['3 Pillo oregón 80×210'],
      alias,
    );
    expect(items[0]).toMatchObject({ modelo: null, madera: 'PINO OREGON' });
    expect(avisos).toEqual([expect.stringMatching(/modelo del ítem 1 como «PIEZAS T».*no aparece/)]);
  });
  it('reconoce alias, palabras del nombre y valores que ya estaban en el borrador', () => {
    const { items, avisos } = anclarNombres(
      [
        item({ modelo: 'COZ COZ', madera: 'MARA ENCHAPADA' }),
        item({ modelo: 'Huilo Huilo', madera: 'LENGA' }),
      ],
      [item({ modelo: 'HUILO HUILO', madera: 'LENGA' })],
      ['4 coscos enchapada en mara'],
      alias,
    );
    expect(items.map((i) => [i.modelo, i.madera])).toEqual([
      ['COZ COZ', 'MARA ENCHAPADA'],
      ['Huilo Huilo', 'LENGA'],
    ]);
    expect(avisos).toEqual([]);
  });
  it('a la IA se le exige decidir tipoMedida y fuente en cada ítem nuevo', () => {
    const [modificar] = herramientas(HERRAMIENTAS_COTIZACION);
    const esquema = JSON.parse(JSON.stringify(modificar.input_schema));
    const agregar = esquema.properties.agregar.items;
    expect(agregar.required).toEqual(expect.arrayContaining(['tipoMedida', 'fuente']));
  });
});

describe('validación de la respuesta antes de usarla', () => {
  const contexto = contextoSeguro('lenga', [item()], clienteVacio(), ['MOLCO'], ['LENGA']);
  it('detecta índices inexistentes, repetidos, vacíos y formato inválido', () => {
    expect(
      problemaSalida(
        { name: 'modificar_cotizacion', input: { items: [{ indice: 1, cambios: { madera: 'LENGA' } }] } },
        contexto,
      ),
    ).toMatch(/índice 1 no existe/);
    expect(
      problemaSalida(
        {
          name: 'modificar_cotizacion',
          input: {
            items: [
              { indice: 0, cambios: { madera: 'LENGA' } },
              { indice: 0, cambios: { cantidad: 2 } },
            ],
          },
        },
        contexto,
      ),
    ).toMatch(/Repetiste/);
    expect(problemaSalida({ name: 'modificar_cotizacion', input: {} }, contexto)).toMatch(/no trae cambios/);
    expect(problemaSalida({ name: 'modificar_cotizacion', input: { precio: 1 } }, contexto)).toMatch(
      /formato/,
    );
    expect(problemaSalida(null, contexto)).toMatch(/exactamente una herramienta/);
  });
  it('acepta una respuesta válida', () => {
    expect(
      problemaSalida(
        { name: 'modificar_cotizacion', input: { items: [{ indice: 0, cambios: { madera: 'LENGA' } }] } },
        contexto,
      ),
    ).toBeNull();
  });
});

describe('contexto de la IA', () => {
  it('describe el catálogo por modelo sin precios ni códigos', () => {
    const mapa = mapaCatalogo(catalogo);
    expect(mapa).toEqual([
      {
        modelo: 'MOLCO',
        familia: 'PUERTA',
        maderas: ['PINO OREGON', 'LENGA'],
        anchos: '0,80–0,95',
        altos: '2,00, 2,10',
      },
      { modelo: 'MARCO', familia: 'MARCO', maderas: ['PINO OREGON'], medidas: ['2X4', '2X5'], altos: '2,10' },
    ]);
    expect(JSON.stringify(mapa)).not.toMatch(/precio|codigo|100000|MOL-/);
  });
  it('separa las secciones de un accesorio por grupo de maderas', () => {
    const finger: Producto = { ...marco('30X70', 2.2), codigo: 'MARC-PF-30X70-220', madera: 'PINO FINGER' };
    const mapa = mapaCatalogo({ ...catalogo, productos: [...catalogo.productos, finger] });
    expect(mapa.find((m) => m.modelo === 'MARCO')).toEqual({
      modelo: 'MARCO',
      familia: 'MARCO',
      maderas: ['PINO OREGON', 'PINO FINGER'],
      variantes: [
        { maderas: ['PINO OREGON'], medidas: ['2X4', '2X5'], altos: '2,10' },
        { maderas: ['PINO FINGER'], medidas: ['30X70'], altos: '2,20' },
      ],
    });
  });
  it('el prompt trae ejemplos y pide la frase de origen de cada ítem', () => {
    expect(SYSTEM).toMatch(/## Ejemplos/);
    expect(SYSTEM).toMatch(/fuente: copia literal/);
  });
});

describe('servicio con un modelo real (cifras verificadas)', () => {
  it('en una cotización nueva aplica cambios por índice y conserva la frase de origen', async () => {
    const { servicio, llm } = await setup();
    llm.interpretar.mockResolvedValueOnce({
      name: 'modificar_cotizacion',
      input: {
        agregar: [{ ...item({ madera: null, alto: 2 }), fuente: '3 Molco de 80 por 200' }],
        cliente: { nombre: 'Juan Pérez' },
      },
    });
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: '3 Molco de 80 por 200 para Juan Pérez' }))
      .cotizacion;
    expect(llm.interpretar.mock.calls[0][0].catalogo.map((m: { modelo: string }) => m.modelo)).toEqual([
      'MOLCO',
      'MARCO',
    ]);
    expect(q.incompletos).toHaveLength(1);
    expect(q.solicitudes[0].fuente).toBe('3 Molco de 80 por 200');
    llm.interpretar.mockResolvedValueOnce({
      name: 'modificar_cotizacion',
      input: { items: [{ indice: 0, cambios: { madera: 'LENGA', fuente: 'cámbiala a lenga' } }] },
    });
    q = (
      await servicio.ejecutar({ tipo: 'chat', id: q.id, actualizada: q.actualizada, mensaje: 'cámbiala a lenga' })
    ).cotizacion;
    expect(q.incompletos).toEqual([]);
    expect(q.solicitudes).toHaveLength(1);
    expect(q.solicitudes[0]).toMatchObject({ madera: 'LENGA', fuente: '3 Molco de 80 por 200 · cámbiala a lenga' });
    expect(q.cliente.nombre).toBe('Juan Pérez');
    expect(llm.interpretar.mock.calls[1][0].borrador.items[0]).toMatchObject({
      indice: 0,
      fuente: '3 Molco de 80 por 200',
    });
  });

  it('deja pendiente la cifra inventada y avisa', async () => {
    const { servicio, llm } = await setup();
    llm.interpretar.mockResolvedValueOnce({
      name: 'modificar_cotizacion',
      input: { agregar: [item({ cantidad: 1, alto: 2 })] },
    });
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje: 'Molco oregón de 80 por 200' });
    expect(r.cotizacion.solicitudes[0]).toMatchObject({ cantidad: null, ancho: 0.8, alto: 2 });
    expect(r.avisos).toEqual(expect.arrayContaining([expect.stringMatching(/la cantidad 1 .*no aparece/)]));
    expect(r.cotizacion.incompletos[0].rechazo).toMatchObject({ tipo: 'faltan_datos', campos: ['cantidad'] });
  });

  it('un doble de prueba sin verificación conserva sus cifras', async () => {
    const { servicio, llm } = await setup(false);
    llm.interpretar.mockResolvedValueOnce({
      name: 'modificar_cotizacion',
      input: { agregar: [item({ cantidad: 1 })] },
    });
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje: 'algo' });
    expect(r.cotizacion.solicitudes[0].cantidad).toBe(1);
  });

  it('la frase de origen se guarda en la base y sobrevive a la relectura', async () => {
    const { servicio, llm } = await setup();
    llm.interpretar.mockResolvedValueOnce({
      name: 'modificar_cotizacion',
      input: { agregar: [{ ...item(), fuente: '3 Molco oregón 80x200' }] },
    });
    const q = (await servicio.ejecutar({ tipo: 'chat', mensaje: '3 Molco oregón 80x200' })).cotizacion;
    const detalle = await servicio.ejecutar({
      tipo: 'editar',
      id: q.id,
      actualizada: q.actualizada,
      cantidades: [{ indice: 0, cantidad: 4 }],
    });
    expect(detalle.cotizacion.solicitudes[0]).toMatchObject({ cantidad: 4, fuente: '3 Molco oregón 80x200' });
  });
});

describe('servicio: respuestas directas, pedidos omitidos y preguntas por el chat', () => {
  it('un dato suelto que responde la pregunta pendiente se aplica sin consultar a la IA', async () => {
    const { servicio, llm, almacen } = await setupConAlmacen();
    llm.interpretar.mockResolvedValueOnce({
      name: 'modificar_cotizacion',
      input: { agregar: [{ ...item({ madera: null }), fuente: '3 Molco de 80 por 200' }] },
    });
    const q = (await servicio.ejecutar({ tipo: 'chat', mensaje: '3 Molco de 80 por 200' })).cotizacion;
    expect(q.incompletos).toHaveLength(1);
    const r = await servicio.ejecutar({ tipo: 'chat', id: q.id, actualizada: q.actualizada, mensaje: 'en lenga' });
    expect(llm.interpretar).toHaveBeenCalledTimes(1);
    expect(r.cotizacion.incompletos).toEqual([]);
    expect(r.cotizacion.solicitudes[0]).toMatchObject({ madera: 'LENGA', fuente: '3 Molco de 80 por 200 · en lenga' });
    expect(r.cotizacion.historial.slice(-2).map((m) => m.rol)).toEqual(['usuario', 'asistente']);
    expect(almacen.eventos(q.id).map((e) => e.tipo)).toEqual(['creada', 'modificada']);
  });

  it('avisa los pedidos del mensaje que la IA no registró y le pide corregirlos', async () => {
    const { servicio, llm } = await setup();
    const mensaje = '3 Molco oregón 80x200 y 2 Molco lenga 80x200';
    const parcial = {
      name: 'modificar_cotizacion',
      input: { agregar: [{ ...item(), fuente: '3 Molco oregón 80x200' }] },
    };
    // La misma revisión es la que el cliente de IA usa para pedir una corrección (antes de guardar nada).
    const revisiones: (string | null)[] = [];
    llm.interpretar.mockImplementationOnce(async (_ctx: unknown, opciones: { revisar: (s: unknown) => string | null }) => {
      revisiones.push(
        opciones.revisar(parcial),
        opciones.revisar({ name: 'responder', input: { texto: '¿Qué madera?' } }),
        opciones.revisar({
          name: 'modificar_cotizacion',
          input: {
            agregar: [
              { ...item(), fuente: '3 Molco oregón 80x200' },
              { ...item({ madera: 'LENGA', cantidad: 2 }), fuente: '2 Molco lenga 80x200' },
            ],
          },
        }),
      );
      return parcial;
    });
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje });
    expect(revisiones[0]).toMatch(/no registró .*«2 Molco lenga 80x200».*agregar todos los ítems/);
    expect(revisiones[1]).toMatch(/regístralos con modificar_cotizacion/);
    expect(revisiones[2]).toBeNull();
    // Lo que sigue sin registrar tras la corrección se avisa.
    expect(r.avisos).toEqual(expect.arrayContaining([expect.stringMatching(/No registré: «2 Molco lenga 80x200»/)]));
  });
});

describe('servicio: el marco de «con su marco»', () => {
  it('si la IA no crea el marco, pide corregir y avisa que falta', async () => {
    const { servicio, llm } = await setup();
    const mensaje = 'Cotiza 3 Molco oregón 80x200 con su marco 2x4 en oregón';
    const sinMarco = { name: 'modificar_cotizacion', input: { agregar: [{ ...item(), fuente: '3 Molco oregón 80x200 con su marco 2x4 en oregón' }] } };
    let correccion: string | null = null;
    llm.interpretar.mockImplementationOnce(async (_ctx: unknown, opciones: { revisar: (s: unknown) => string | null }) => {
      correccion = opciones.revisar(sinMarco);
      return sinMarco;
    });
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje });
    expect(correccion).toMatch(/no registró .*«con su marco 2x4 en oregón»/);
    expect(r.avisos).toEqual(expect.arrayContaining([expect.stringMatching(/No registré: «con su marco 2x4 en oregón»/)]));
  });
});

describe('servicio: anclaje en modo «avisar»', () => {
  async function setupAvisar() {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-precision-'));
    dirs.push(dir);
    const llm = { interpretar: vi.fn(), verificarCifras: true, anclaje: 'avisar' as const };
    return { llm, servicio: new Servicio(catalogo, llm, new Almacen(dir)) };
  }
  const mensaje = '3 Molco oregón 80x200 y 2 Molco lenga 80x200';
  const leida = {
    name: 'modificar_cotizacion',
    input: {
      agregar: [
        { ...item({ cantidad: 2 }), fuente: '3 Molco oregón 80x200' },
        { ...item({ madera: 'LENGA', cantidad: 2 }), fuente: '2 Molco lenga 80x200' },
      ],
    },
  };

  it('conserva la lectura de la IA y avisa en qué difiere de la frase, sin pedirle corregir', async () => {
    const { servicio, llm } = await setupAvisar();
    let correccion: unknown;
    llm.interpretar.mockImplementationOnce(async (_ctx: unknown, opciones: { revisar: (s: unknown) => unknown }) => {
      correccion = opciones.revisar(leida);
      return leida;
    });
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje });
    expect(correccion).toBeNull();
    expect(r.cotizacion.solicitudes.map((s) => s.cantidad)).toEqual([2, 2]);
    expect(r.avisos).toEqual([
      'Revisa el ítem 1 (MOLCO): anoté la cantidad 2, pero tu mensaje parece decir 3.',
    ]);
  });

  it('reintenta y avisa la fábrica dicha que la IA no asignó; Panguipulli suelto no es la fábrica', async () => {
    const { servicio, llm } = await setupAvisar();
    const mensaje = '3 Molco oregón de 80 x 200 para la fábrica de Panguipulli';
    const sinFabrica = { name: 'modificar_cotizacion', input: { agregar: [{ ...item(), fuente: '3 Molco oregón de 80 x 200' }] } };
    const revisiones: unknown[] = [];
    llm.interpretar.mockImplementationOnce(async (_ctx: unknown, opciones: { revisar: (s: unknown) => unknown }) => {
      revisiones.push(
        opciones.revisar(sinFabrica),
        opciones.revisar({ name: 'modificar_cotizacion', input: { agregar: [{ ...item(), fabrica: 'panguipulli' }] } }),
      );
      // Ni el reintento la asignó.
      return sinFabrica;
    });
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje });
    expect(revisiones[0]).toMatch(/fábrica va cada producto \(Panguipulli\).*pon en cada uno la fábrica/);
    expect(revisiones[1]).toBeNull();
    expect(r.avisos).toEqual(['No registré la fábrica de Panguipulli que indicaste: revisa a qué ítems va.']);

    // «Despacho a Santiago» o el modelo Panguipulli no dicen a qué fábrica va.
    let otra: unknown;
    llm.interpretar.mockImplementationOnce(async (_ctx: unknown, opciones: { revisar: (s: unknown) => unknown }) => {
      otra = opciones.revisar(sinFabrica);
      return sinFabrica;
    });
    const r2 = await servicio.ejecutar({ tipo: 'chat', mensaje: '3 Molco oregón de 80 x 200, despacho a Santiago' });
    expect(otra).toBeNull();
    expect(r2.avisos ?? []).not.toContainEqual(expect.stringMatching(/fábrica/));
  });

  it('el reintento de un pedido respondido por el chat (Qwen3.7-Flash pregunta la madera)', async () => {
    const { servicio, llm } = await setupAvisar();
    const mensaje = 'precio de 3 Molco de 80 x 200';
    const revisiones: unknown[] = [];
    llm.interpretar.mockImplementationOnce(async (_ctx: unknown, opciones: { revisar: (s: unknown) => unknown }) => {
      revisiones.push(
        opciones.revisar({ name: 'responder', input: { texto: '¿De qué madera quieres las 3 Molco de 80 x 200?' } }),
        // Un ítem omitido no se reintenta: se avisa.
        opciones.revisar({ name: 'modificar_cotizacion', input: { agregar: [] } }),
      );
      return { name: 'modificar_cotizacion', input: { agregar: [{ ...item({ madera: null }), fuente: '3 Molco de 80 x 200' }] } };
    });
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje });
    expect(revisiones[0]).toMatch(/regístralos con modificar_cotizacion/);
    expect(revisiones[1]).toBeNull();
    expect(r.cotizacion.solicitudes[0]).toMatchObject({ modelo: 'MOLCO', madera: null, cantidad: 3 });
  });

  it('en modo «corregir» la misma lectura se corrige con la frase', async () => {
    const { servicio, llm } = await setup();
    llm.interpretar.mockResolvedValueOnce(leida);
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje });
    expect(r.cotizacion.solicitudes.map((s) => s.cantidad)).toEqual([3, 2]);
  });

  it('sin atajos: la respuesta a una pregunta pendiente y el mensaje con flete van tal cual a la IA', async () => {
    const { servicio, llm } = await setupAvisar();
    const conFlete = 'Despacho a Chillán $380.000 + iva\n3 Molco 80x200';
    llm.interpretar.mockResolvedValueOnce({
      name: 'modificar_cotizacion',
      input: { agregar: [{ ...item({ madera: null }), fuente: '3 Molco 80x200' }] },
    });
    const q = (await servicio.ejecutar({ tipo: 'chat', mensaje: conFlete })).cotizacion;
    expect(llm.interpretar.mock.calls[0][0].mensaje).toBe(conFlete);
    llm.interpretar.mockResolvedValueOnce({
      name: 'modificar_cotizacion',
      input: { items: [{ indice: 0, cambios: { madera: 'LENGA', fuente: 'en lenga' } }] },
    });
    const r = await servicio.ejecutar({ tipo: 'chat', id: q.id, actualizada: q.actualizada, mensaje: 'en lenga' });
    expect(llm.interpretar).toHaveBeenCalledTimes(2);
    expect(r.cotizacion.solicitudes[0].madera).toBe('LENGA');
  });

  it('si la IA responde con texto a un pedido, avisa que no agregó productos', async () => {
    const { servicio, llm } = await setupAvisar();
    llm.interpretar.mockResolvedValueOnce({ name: 'responder', input: { texto: '¿En qué madera las quieres?' } });
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje: '3 Molco de 80 por 200' });
    expect(r.avisos).toEqual([expect.stringMatching(/^No agregué productos y tu mensaje parece un pedido/)]);
    // Una pregunta sin productos no es un pedido.
    llm.interpretar.mockResolvedValueOnce({ name: 'responder', input: { texto: 'Hay en lenga y oregón.' } });
    const pregunta = await servicio.ejecutar({ tipo: 'chat', mensaje: '¿en qué maderas viene la Molco?' });
    expect(pregunta.avisos).toBeUndefined();
  });

  it('una cifra que nadie escribió se anula igual que en «corregir»', async () => {
    const { servicio, llm } = await setupAvisar();
    llm.interpretar.mockResolvedValueOnce({
      name: 'modificar_cotizacion',
      input: { agregar: [item({ cantidad: 1, alto: 2 })] },
    });
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje: 'Molco oregón de 80 por 200' });
    expect(r.cotizacion.solicitudes[0]).toMatchObject({ cantidad: null, ancho: 0.8, alto: 2 });
  });
});

describe('evaluación', () => {
  it('los casos del repositorio son válidos', async () => {
    const casos = casosSchema.parse(JSON.parse(await readFile('evals/cotizacion.json', 'utf8')));
    expect(new Set(casos.map((c) => c.id)).size).toBe(casos.length);
  });
  it('puntúa por campo, compara medidas en metros y cuenta ítems sobrantes', () => {
    const caso = casosSchema.parse([
      {
        id: 'x',
        descripcion: 'x',
        mensajes: ['x'],
        esperado: {
          items: [{ modelo: 'Huilo Huilo', madera: 'LENGA', ancho: 0.8, alto: 2, medida: null, cantidad: 4 }],
          cliente: { comuna: 'Temuco' },
        },
      },
    ])[0];
    const perfecto = puntuar(caso, {
      items: [item({ modelo: 'HUILO HUILO', madera: 'LENGA', ancho: 80, alto: 200, cantidad: 4 })],
      cliente: { ...clienteVacio(), comuna: 'temuco' },
    });
    expect(perfecto.diferencias).toEqual([]);
    const conError = puntuar(caso, {
      items: [item({ modelo: 'HUILO HUILO', madera: null, cantidad: 4 }), item()],
      cliente: clienteVacio(),
    });
    expect(conError.diferencias.map((d) => d.campo)).toEqual(
      expect.arrayContaining(['madera', 'cliente.comuna']),
    );
    expect(conError.total).toBe(CAMPOS_ITEM.length * 2 + 1);
    expect(resumen([perfecto, conError])).toMatchObject({ perfectos: 1, casos: 2 });
  });
  it('los casos nuevos de la revisión están y usan avisos y pendientes', async () => {
    const casos = casosSchema.parse(JSON.parse(await readFile('evals/cotizacion.json', 'utf8')));
    const porId = new Map(casos.map((c) => [c.id, c]));
    for (const id of [
      'i2-madera-no-fija-alto',
      'i2-alto-no-fija-madera',
      'i3-4-marcos-de-6',
      'i4-x-pegada',
      'i4-x-espacios',
      'i4-x-signo',
      'i6-responde-segundo-pendiente',
      'i7-precio-total',
      'i8-un-millon',
      'i8-cu-pegado',
      'i8-flete-cien-mil',
      'mismo-item-dos-veces',
      'riñihue-despacho-no-es-pedido',
    ])
      expect(porId.has(id), id).toBe(true);
    expect(porId.get('i2-madera-no-fija-alto')?.esperado.pendientes).toEqual([{ item: 1, campo: 'alto' }]);
    expect(porId.get('i7-precio-total')?.esperado.avisos).toEqual([{ categoria: 'precio', texto: 'precio total' }]);
    expect(porId.get('riñihue-despacho-no-es-pedido')?.esperado).toMatchObject({ items: [] });
    // Los tres separadores de medida de I4 («x», « x », «×»).
    expect(['i4-x-pegada', 'i4-x-espacios', 'i4-x-signo'].map((id) => porId.get(id)?.mensajes[0])).toEqual([
      expect.stringContaining('80x200'),
      expect.stringContaining('80 x 200'),
      expect.stringContaining('80×200'),
    ]);
  });

  it('el esquema rechaza avisos sin categoría ni texto, categorías desconocidas y campos pendientes inválidos', () => {
    const base = { id: 'x', descripcion: 'x', mensajes: ['x'] };
    const con = (esperado: Record<string, unknown>) =>
      casosSchema.safeParse([{ ...base, esperado: { items: [], ...esperado } }]).success;
    expect(con({ avisos: [{ categoria: 'precio' }, { texto: 'flete' }, { categoria: 'noRegistre', ausente: true }] })).toBe(true);
    expect(con({ avisos: [{ ausente: true }] })).toBe(false);
    expect(con({ avisos: [{ categoria: 'inventada' }] })).toBe(false);
    expect(con({ avisos: [{ categoria: 'precio', ausente: false }] })).toBe(false);
    expect(con({ pendientes: [{ item: 1, campo: 'alto' }, { item: 2 }, { item: 3, campo: null }] })).toBe(true);
    expect(con({ pendientes: [{ item: 0 }] })).toBe(false);
    expect(con({ pendientes: [{ item: 1, campo: 'color' }] })).toBe(false);
  });

  it('los avisos de precio y flete que piden revisar tienen categoría propia; los informativos siguen en otros', () => {
    const otros = (texto: string) => categoriaEvaluada({ categoria: 'otros', texto });
    expect(otros('Escribiste un precio total para el ítem 1; indica el valor por unidad.')).toBe('precio');
    expect(otros('No apliqué el precio del ítem 1 (MOLCO): no aparece escrito en su línea del pedido.')).toBe('precio');
    expect(otros('El precio del ítem 1 (MOLCO) quedó en $450: revisa si le faltan ceros.')).toBe('precio');
    expect(otros('No apliqué el flete: su valor no aparece escrito en el mensaje.')).toBe('flete');
    expect(otros('El flete quedó en $350: revisa si le faltan ceros.')).toBe('flete');
    expect(otros('No apliqué la cantidad 3 del flete: no aparece escrita en el mensaje.')).toBe('flete');
    expect(otros('Usé el precio que indicaste para el ítem 1: $400.000 sin IVA c/u; el de catálogo es $380.000.')).toBe('otros');
    expect(otros('Tomé $350.000 como valor del flete sin IVA. Si lo incluía, escribe «con IVA incluido».')).toBe('otros');
    expect(categoriaEvaluada({ categoria: 'cifras', texto: 'No apliqué el precio' })).toBe('cifras');
    expect(
      avisosDeRevision([
        { categoria: 'otros', texto: 'Tomé $1 como precio sin IVA del ítem 1.' },
        { categoria: 'otros', texto: 'No apliqué el flete: su valor no aparece escrito en el mensaje.' },
      ]),
    ).toEqual([{ categoria: 'flete', texto: 'No apliqué el flete: su valor no aparece escrito en el mensaje.' }]);
  });

  it('puntúa los avisos esperados (presentes y ausentes) y las preguntas pendientes', () => {
    const caso = casosSchema.parse([
      {
        id: 'x',
        descripcion: 'x',
        mensajes: ['x'],
        esperado: {
          items: [],
          avisos: [{ categoria: 'precio', texto: 'precio total' }, { categoria: 'noRegistre', ausente: true }],
          pendientes: [{ item: 1, campo: 'alto' }, { item: 2 }],
        },
      },
    ])[0];
    const vacio = { items: [], cliente: clienteVacio() };
    const total = { categoria: 'otros', texto: 'Escribiste un precio total para el ítem 1; indica el valor por unidad.' };
    const perfecto = puntuar(caso, {
      ...vacio,
      avisos: [total],
      pendientes: [
        { item: 1, campo: 'alto' },
        { item: 2, campo: 'madera' },
      ],
    });
    expect(perfecto).toMatchObject({ aciertos: 4, total: 4, diferencias: [] });
    const mal = puntuar(caso, {
      ...vacio,
      avisos: [{ categoria: 'noRegistre', texto: 'No registré «x».' }],
      pendientes: [
        { item: 1, campo: 'madera' },
        { item: 3, campo: null },
      ],
    });
    expect(mal.aciertos).toBe(0);
    expect(mal.diferencias).toEqual([
      { item: null, campo: 'aviso', esperado: '[precio] «precio total»', obtenido: '(ninguno)' },
      { item: null, campo: 'aviso', esperado: 'sin [noRegistre]', obtenido: '[noRegistre] No registré «x».' },
      { item: 1, campo: 'pendiente', esperado: 'alto', obtenido: 'madera' },
      { item: 2, campo: 'pendiente', esperado: '(pendiente)', obtenido: '(sin pendiente)' },
      { item: 1, campo: 'pendiente', esperado: '(sin pendiente)', obtenido: 'madera' },
      { item: 3, campo: 'pendiente', esperado: '(sin pendiente)', obtenido: null },
    ]);
    expect(mal.total).toBe(6);
    // Sin avisos ni pendientes obtenidos (otro ejecutor), no se miden.
    expect(puntuar(caso, vacio)).toMatchObject({ aciertos: 0, total: 0, diferencias: [] });
  });
});

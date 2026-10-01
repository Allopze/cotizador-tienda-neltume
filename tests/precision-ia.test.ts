import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anclarCifras, cifrasDelTexto } from '../src/asistente/anclaje';
import { casosSchema, puntuar, resumen } from '../src/asistente/evaluacion';
import { contextoSeguro, problemaSalida, SYSTEM } from '../src/asistente/llm';
import { mapaCatalogo } from '../src/catalogo/mapa';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
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
      input: { items: [{ indice: 0, cambios: { madera: 'LENGA', fuente: 'lenga' } }] },
    });
    q = (await servicio.ejecutar({ tipo: 'chat', id: q.id, actualizada: q.actualizada, mensaje: 'lenga' }))
      .cotizacion;
    expect(q.incompletos).toEqual([]);
    expect(q.solicitudes).toHaveLength(1);
    expect(q.solicitudes[0]).toMatchObject({ madera: 'LENGA', fuente: '3 Molco de 80 por 200 · lenga' });
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
    expect(conError.total).toBe(7 * 2 + 1);
    expect(resumen([perfecto, conError])).toMatchObject({ perfectos: 1, casos: 2 });
  });
});

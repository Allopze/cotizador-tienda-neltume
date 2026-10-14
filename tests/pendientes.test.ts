import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AltaProducto } from '../src/app/alta-producto';
import { PreguntasPendientes } from '../src/app/preguntas-pendientes';
import {
  cambiosRespuesta,
  faltantesItem,
  fueraDeRegla,
  preguntasPendientes,
  type PrefillAlta,
} from '../src/negocio/pendientes';
import type { Rechazo } from '../src/catalogo/resolver';
import type { Catalogo, Familia, SolicitudItem } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { ErrorUsuario, Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

const item = (s: Partial<SolicitudItem>): SolicitudItem => ({
  modelo: 'Huilo Huilo',
  madera: null,
  ancho: 0.8,
  alto: 2.1,
  medida: null,
  cantidad: 3,
  ...s,
});

describe('alta desde las preguntas pendientes', () => {
  const inicial: PrefillAlta = {
    familia: 'MARCO', modelo: 'Marco', madera: 'PINO FINGER ENCHAPADO MARA', medida: '30X90',
    anchoMin: null, anchoMax: null, largo: 2.27,
  };

  it('solo ofrece Agregar al catálogo para pendientes que lo permiten en una cotización editable', () => {
    const renderizar = (rechazo: Rechazo, editable: boolean) => renderToStaticMarkup(createElement(PreguntasPendientes, {
      preguntas: preguntasPendientes({ solicitudes: [item({})], incompletos: [{ indice: 0, rechazo, pregunta: '' }] }),
      editable, asistente: false, guardando: null, responder: async () => true,
    }));
    const rechazos: Rechazo[] = [
      { tipo: 'modelo_desconocido', valor: 'Nuevo', disponibles: [] },
      { tipo: 'madera_desconocida', valor: 'Roble', disponibles: [] },
      { tipo: 'madera_no_disponible', valor: 'LENGA', disponibles: [] },
      { tipo: 'medida_no_disponible', campo: 'alto', valor: 2.27, disponibles: [] },
    ];
    for (const rechazo of rechazos) {
      expect(renderizar(rechazo, true)).toContain('Agregar al catálogo');
      expect(renderizar(rechazo, false)).not.toContain('Agregar al catálogo');
    }
    for (const rechazo of [
      faltan(['madera']),
      { tipo: 'modelo_posible', valor: 'Pillo', sugerido: 'Huilo Huilo', disponibles: [] },
      { tipo: 'medida_implausible', campo: 'alto', valor: 9999, disponibles: [] },
      { tipo: 'producto_ambiguo', valor: 'Huilo Huilo', disponibles: [] },
      { tipo: 'cantidad_invalida', valor: 0, disponibles: [] },
    ] satisfies Rechazo[])
      expect(renderizar(rechazo, true)).not.toContain('Agregar al catálogo');
  });

  it('un modelo posible ofrece «Es un modelo nuevo» y precarga el valor escrito, también sin familia', () => {
    for (const familia of ['PUERTA', undefined] as const) {
      const preguntas = preguntasPendientes({
        solicitudes: [item({ modelo: 'CUNCU', madera: 'Mara', ancho: 82, alto: 200 })],
        incompletos: [{ indice: 0, rechazo: {
          tipo: 'modelo_posible', valor: 'Cunco', sugerido: 'CUNCU', disponibles: ['CUNCU'], familia,
        }, pregunta: '¿Te refieres a Cuncu?' }],
      });
      expect(preguntas[0].alta).toMatchObject({ modelo: 'Cunco', familia: familia ?? null, madera: 'Mara', largo: 2 });
      expect(preguntas[0].alta?.anchoMin).toBe(familia ? 0.82 : null);
      const renderizar = (editable: boolean) => renderToStaticMarkup(createElement(PreguntasPendientes, {
        preguntas, editable, asistente: false, guardando: null, responder: async () => true,
      }));
      expect(renderizar(true)).toContain('Es un modelo nuevo');
      expect(renderizar(true)).not.toContain('Agregar al catálogo');
      expect(renderizar(false)).not.toContain('Es un modelo nuevo');
    }
  });

  it('el formulario abre con los atributos del marco y el precio vacío', () => {
    const h = renderToStaticMarkup(createElement(AltaProducto, { asistente: false, inicial, alGuardar: () => {} }));
    for (const valor of ['Marco', 'PINO FINGER ENCHAPADO MARA', '30X90', '2,27'])
      expect(h).toContain(`value="${valor}"`);
    expect(h).toContain('Marco</');
    expect(h).toMatch(/id="[^"]+-precio"[^>]*value=""/);
  });

  it('las puertas precargan ambos anchos, y el alta de catálogo sigue empezando vacía', () => {
    const h = renderToStaticMarkup(createElement(AltaProducto, {
      asistente: false,
      inicial: { ...inicial, familia: 'PUERTA', modelo: 'Huilo Huilo', madera: 'Roble', medida: null, anchoMin: 0.82, anchoMax: 0.82 },
    }));
    expect(h.match(/value="0,82"/g)).toHaveLength(2);
    expect(h).toContain('Ancho mínimo');
    expect(h).not.toContain('Medida o escuadría');
    const vacio = renderToStaticMarkup(createElement(AltaProducto, { asistente: false }));
    expect(vacio).toContain('Elige una familia');
    expect(vacio).not.toContain('value="2,27"');
    expect(vacio).not.toContain('value="PINO FINGER ENCHAPADO MARA"');
  });
});
const faltan = (campos: string[], disponibles: Record<string, string[]> = {}): Rechazo => ({
  tipo: 'faltan_datos',
  campos,
  disponibles,
});
const MADERAS = { madera: ['PINO OREGON', 'LENGA', 'RAULI'] };

describe('preguntas de los ítems pendientes', () => {
  it.each<Rechazo>([
    { tipo: 'madera_desconocida', valor: 'Roble', disponibles: [], familia: 'PUERTA' },
    { tipo: 'madera_no_disponible', valor: 'LENGA', disponibles: [], familia: 'PUERTA' },
    { tipo: 'medida_no_disponible', campo: 'ancho', valor: 0.82, disponibles: [], familia: 'PUERTA' },
    { tipo: 'medida_no_disponible', campo: 'alto', valor: 2.27, disponibles: [], familia: 'PUERTA' },
  ])('$tipo completa el alta de puerta con la solicitud y convierte centímetros y milímetros', (rechazo) => {
    const [p] = preguntasPendientes({
      solicitudes: [item({ modelo: 'Huilo Huilo', madera: 'Roble', ancho: 82, alto: 2270, medida: 'no aplica' })],
      incompletos: [{ indice: 0, rechazo, pregunta: '' }],
    });
    expect(p.alta).toEqual({
      familia: 'PUERTA', modelo: 'Huilo Huilo', madera: 'Roble', medida: null,
      anchoMin: 0.82, anchoMax: 0.82, largo: 2.27,
    });
  });

  it.each<Familia>(['MARCO', 'PIEZAS_T', 'MOLDURA'])('completa el alta de %s con la escuadría original', (familia) => {
    const [p] = preguntasPendientes({
      solicitudes: [item({ modelo: 'Marco', madera: 'PINO FINGER ENCHAPADO MARA', medida: '30x90', alto: 227 })],
      incompletos: [{ indice: 0, rechazo: { tipo: 'medida_no_disponible', campo: 'medida', valor: '30x90', disponibles: [], familia }, pregunta: '' }],
    });
    expect(p.alta).toEqual({
      familia, modelo: 'Marco', madera: 'PINO FINGER ENCHAPADO MARA', medida: '30x90',
      anchoMin: null, anchoMax: null, largo: 2.27,
    });
  });

  it('un modelo desconocido ofrece el alta sin inferir familia y conserva null en lo ausente', () => {
    const [p] = preguntasPendientes({
      solicitudes: [item({ modelo: 'Nuevo', madera: null, medida: null, ancho: 82, alto: null })],
      incompletos: [{ indice: 0, rechazo: { tipo: 'modelo_desconocido', valor: 'Nuevo', disponibles: [] }, pregunta: '' }],
    });
    expect(p.alta).toEqual({
      familia: null, modelo: 'Nuevo', madera: null, medida: null, anchoMin: null, anchoMax: null, largo: null,
    });
  });

  it('un rechazo antiguo sin familia sigue ofreciendo el alta con los datos disponibles', () => {
    const [p] = preguntasPendientes({
      solicitudes: [item({ madera: 'Roble', medida: '2x5' })],
      incompletos: [{ indice: 0, rechazo: { tipo: 'madera_desconocida', valor: 'Roble', disponibles: [] }, pregunta: '' }],
    });
    expect(p.alta).toEqual({
      familia: null, modelo: 'Huilo Huilo', madera: 'Roble', medida: '2x5', anchoMin: null, anchoMax: null, largo: 2.1,
    });
  });

  it.each<Rechazo>([
    faltan(['madera', 'cantidad']),
    { tipo: 'medida_implausible', campo: 'alto', valor: 9999, disponibles: [] },
    { tipo: 'producto_ambiguo', valor: 'Huilo Huilo', disponibles: [] },
    { tipo: 'cantidad_invalida', valor: 0, disponibles: [] },
  ])('$tipo no ofrece el alta de producto', (rechazo) => {
    const preguntas = preguntasPendientes({
      solicitudes: [item({})],
      incompletos: [{ indice: 0, rechazo, pregunta: '' }],
    });
    expect(preguntas.length).toBeGreaterThan(0);
    expect(preguntas.every((p) => p.alta === null)).toBe(true);
  });

  it('agrupa la misma pregunta de varios ítems en una sola, con sus opciones', () => {
    const preguntas = preguntasPendientes({
      solicitudes: [item({}), item({}), item({ madera: 'LENGA' })],
      incompletos: [
        { indice: 0, rechazo: faltan(['madera'], MADERAS), pregunta: '' },
        { indice: 1, rechazo: faltan(['madera'], MADERAS), pregunta: '' },
      ],
    });
    expect(preguntas).toHaveLength(1);
    expect(preguntas[0]).toMatchObject({
      campo: 'madera',
      indices: [0, 1],
      texto: 'Madera para los ítems 1 y 2',
      alta: null,
    });
    // El valor que ya tiene otro ítem del pedido se sugiere primero, sin aplicarse solo.
    expect(preguntas[0].opciones[0]).toEqual({
      etiqueta: 'Lenga',
      valor: 'LENGA',
      sugerencia: 'Como el ítem 3',
    });
    expect(preguntas[0].opciones.map((o) => o.valor)).toEqual(['LENGA', 'PINO OREGON', 'RAULI']);
  });

  it('la respuesta se aplica a todos los ítems del grupo con una edición directa', () => {
    const [p] = preguntasPendientes({
      solicitudes: [item({}), item({})],
      incompletos: [
        { indice: 0, rechazo: faltan(['madera'], MADERAS), pregunta: '' },
        { indice: 1, rechazo: faltan(['madera'], MADERAS), pregunta: '' },
      ],
    });
    expect(cambiosRespuesta(p, 'LENGA')).toEqual({
      items: [
        { indice: 0, cambios: { madera: 'LENGA' } },
        { indice: 1, cambios: { madera: 'LENGA' } },
      ],
    });
  });

  it('alto con botones en metros, ancho y cantidad como entrada numérica', () => {
    const preguntas = preguntasPendientes({
      solicitudes: [item({ ancho: null, alto: null, cantidad: null, madera: 'LENGA' })],
      incompletos: [
        {
          indice: 0,
          rechazo: faltan(['ancho', 'alto', 'cantidad'], {
            ancho: ['0,60 A 0,65', '1,30 A 1,35'],
            alto: ['2', '2.1'],
            cantidad: ['Entero entre 1 y 10.000'],
          }),
          pregunta: '',
        },
      ],
    });
    const [ancho, alto, cantidad] = preguntas;
    expect(ancho).toMatchObject({
      campo: 'ancho',
      opciones: [],
      entrada: { min: 0.6, max: 1.35, unidad: 'm' },
    });
    expect(alto.opciones).toEqual([
      { etiqueta: '2,00 m', valor: 2 },
      { etiqueta: '2,10 m', valor: 2.1 },
    ]);
    expect(cantidad).toMatchObject({ campo: 'cantidad', entrada: { min: 1, max: 10000, unidad: null } });
    expect(cambiosRespuesta(cantidad, 4)).toEqual({ cantidades: [{ indice: 0, cantidad: 4 }] });
    expect(cambiosRespuesta(alto, 2.1)).toEqual({ items: [{ indice: 0, cambios: { alto: 2.1 } }] });
  });

  it('un modelo dudoso se confirma con un botón y explica el motivo sin la lista', () => {
    const [p] = preguntasPendientes({
      solicitudes: [item({ modelo: 'Pillo', madera: 'PINO OREGON' })],
      incompletos: [
        {
          indice: 0,
          rechazo: {
            tipo: 'modelo_posible',
            valor: 'Pillo',
            sugerido: 'Huilo Huilo',
            disponibles: ['Huilo Huilo'],
          },
          pregunta: '¿Te refieres a Huilo Huilo? Confírmalo para cotizar.',
        },
      ],
    });
    expect(p.opciones).toEqual([{ etiqueta: 'Confirmar Huilo Huilo', valor: 'Huilo Huilo' }]);
    expect(p.detalle).toBe('¿Te refieres a Huilo Huilo? Confírmalo para cotizar.');
  });

  it('una madera que no existe para el modelo muestra el motivo y las maderas posibles', () => {
    const [p] = preguntasPendientes({
      solicitudes: [item({ madera: 'ROBLE' })],
      incompletos: [
        {
          indice: 0,
          rechazo: { tipo: 'madera_desconocida', valor: 'ROBLE', disponibles: ['LENGA', 'MARA'] },
          pregunta: 'No trabajamos “ROBLE” en este catálogo. Maderas disponibles: Lenga, Mara.',
        },
      ],
    });
    expect(p).toMatchObject({
      campo: 'madera',
      detalle: 'No trabajamos “ROBLE” en este catálogo.',
      opciones: [
        { etiqueta: 'Lenga', valor: 'LENGA' },
        { etiqueta: 'Mara', valor: 'MARA' },
      ],
    });
  });

  it('una medida fuera de catálogo con tramo pide un valor dentro del tramo y sugiere el de otro ítem', () => {
    const [p] = preguntasPendientes({
      solicitudes: [item({ madera: 'LENGA', ancho: 0.82 }), item({ madera: 'LENGA', ancho: 1.6 })],
      incompletos: [
        {
          indice: 1,
          rechazo: {
            tipo: 'medida_no_disponible',
            campo: 'ancho',
            valor: 1.6,
            disponibles: [],
            rango: { min: 0.6, max: 1.45 },
          },
          pregunta: 'Huilo Huilo no viene en 1,60 m de ancho. Se cotizan anchos entre 0,60 y 1,45 m.',
        },
      ],
    });
    expect(p.entrada).toMatchObject({ min: 0.6, max: 1.45 });
    expect(p.opciones).toEqual([{ etiqueta: '0,82 m', valor: 0.82, sugerencia: 'Como el ítem 1' }]);
  });

  it('no sugiere la madera de otro ítem si la persona ya dijo una que no se pudo usar', () => {
    const [p] = preguntasPendientes({
      solicitudes: [item({ madera: 'MARA ENCHAPADA' }), item({ modelo: 'Ranco', madera: 'LENGA' })],
      incompletos: [
        {
          indice: 0,
          rechazo: { tipo: 'madera_no_disponible', valor: 'MARA ENCHAPADA', disponibles: ['LENGA', 'MARA'] },
          pregunta: 'Huilo Huilo no viene en Mara Enchapada. Maderas disponibles: Lenga, Mara.',
        },
      ],
    });
    expect(p.opciones).toEqual([
      { etiqueta: 'Lenga', valor: 'LENGA' },
      { etiqueta: 'Mara', valor: 'MARA' },
    ]);
  });

  it('un producto ambiguo no se responde con un control: queda el texto', () => {
    const [p] = preguntasPendientes({
      solicitudes: [item({ madera: 'LENGA' })],
      incompletos: [
        {
          indice: 0,
          rechazo: { tipo: 'producto_ambiguo', valor: 'HUILO HUILO', disponibles: ['A: uno', 'B: otro'] },
          pregunta: 'Hay más de un producto…',
        },
      ],
    });
    expect(p).toMatchObject({
      campo: null,
      opciones: [],
      entrada: null,
      texto: 'Revisa el ítem 1 (Huilo Huilo)',
    });
    expect(cambiosRespuesta(p, 'x')).toEqual({});
  });

  it('resume qué falta en cada ítem', () => {
    const q = {
      incompletos: [{ indice: 1, rechazo: faltan(['madera', 'alto']), pregunta: '' }],
    };
    expect(faltantesItem(q, 0)).toBeNull();
    expect(faltantesItem(q, 1)).toEqual(['madera', 'alto']);
  });
});

// servicio.ts (`recalcular`) deja pendiente con campo «precio» un ítem cuyo precio o descuento no cumple la regla.
describe('ítem pendiente por precio o descuento fuera de regla', () => {
  const PRECIO = 'El precio $40.000 queda fuera del rango permitido (−50 % a 500 % sobre el costo $100.000). Corrígelo o quita el ítem.';
  const DESCUENTO = 'El descuento del ítem 2 no es válido o supera su precio unitario ($155.000). Ajusta o quita el descuento.';
  const q = {
    solicitudes: [
      item({ modelo: 'MOLCO', madera: 'LENGA', precioUnitario: 40_000 }),
      item({ madera: 'MARA', descuento: { tipo: 'monto', valor: 155_001 } }),
    ],
    incompletos: [
      { indice: 0, rechazo: faltan(['precio']), pregunta: PRECIO },
      { indice: 1, rechazo: faltan(['precio']), pregunta: DESCUENTO },
    ],
  };

  it('explica el problema en vez de pedir una cantidad, y cada ítem lleva su propia explicación', () => {
    const preguntas = preguntasPendientes(q);
    expect(preguntas).toEqual([
      expect.objectContaining({
        indices: [0], campo: null, entrada: null, texto: 'Revisa el ítem 1 (Molco)', detalle: PRECIO,
        opciones: [{ etiqueta: 'Quitar el precio fijado a mano', valor: 'precioUnitario' }],
      }),
      expect.objectContaining({
        indices: [1], campo: null, entrada: null, texto: 'Revisa el ítem 2 (Huilo Huilo)', detalle: DESCUENTO,
        opciones: [{ etiqueta: 'Quitar el descuento del ítem', valor: 'descuento' }],
      }),
    ]);
    // La fila no dice «Falta: cantidad»: muestra la explicación.
    expect(faltantesItem(q, 0)).toEqual([]);
    expect(fueraDeRegla(q, 0)).toBe(PRECIO);
    expect(fueraDeRegla(q, 1)).toBe(DESCUENTO);
    expect(fueraDeRegla({ incompletos: [{ indice: 0, rechazo: faltan(['cantidad']), pregunta: '' }] }, 0)).toBeNull();
    expect(fueraDeRegla(q, 2)).toBeNull();
  });

  it('un pedido especial con un descuento mayor que su precio solo ofrece quitar el descuento', () => {
    // Su precio no está fijado a mano sobre el catálogo: es el dato de origen y no se puede quitar.
    const especial = item({
      modelo: 'Puerta doble', precioUnitario: 40_000, descuento: { tipo: 'monto', valor: 50_000 },
      personalizado: { familia: 'PUERTA' },
    });
    const [p] = preguntasPendientes({
      solicitudes: [especial],
      incompletos: [{ indice: 0, rechazo: faltan(['precio']), pregunta: DESCUENTO }],
    });
    expect(p.opciones).toEqual([{ etiqueta: 'Quitar el descuento del ítem', valor: 'descuento' }]);
  });

  it('la tarjeta muestra la explicación y no ofrece un campo de cantidad', () => {
    const html = renderToStaticMarkup(createElement(PreguntasPendientes, {
      preguntas: preguntasPendientes(q), editable: true, asistente: false, guardando: null, responder: async () => true,
    }));
    expect(html).toContain('queda fuera del rango permitido');
    expect(html).toContain('Ajusta o quita el descuento.');
    expect(html).not.toContain('Cantidad');
    expect(html).not.toContain('<input');
    expect(html).toContain('Quitar el precio fijado a mano');
  });

  it('las opciones quitan lo fijado a mano con una edición directa', () => {
    const [precio, descuento] = preguntasPendientes(q);
    expect(cambiosRespuesta(precio, 'precioUnitario')).toEqual({ items: [{ indice: 0, cambios: { precioUnitario: null } }] });
    expect(cambiosRespuesta(descuento, 'descuento')).toEqual({ items: [{ indice: 1, cambios: { descuento: null } }] });
    expect(cambiosRespuesta(precio, 3)).toEqual({});
    // Sin precio ni descuento fijados a mano no hay nada que quitar: queda solo la explicación.
    const [solo] = preguntasPendientes({ solicitudes: [item({})], incompletos: [{ indice: 0, rechazo: faltan(['precio']), pregunta: PRECIO }] });
    expect(solo.opciones).toEqual([]);
  });

  it('con el servidor: el pendiente que deja un precio o un descuento se resuelve con la opción de la tarjeta', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-pendientes-'));
    dirs.push(dir);
    const catalogo: Catalogo = {
      fuente: 'test.xlsx', sha256: 'catalogo-test', fecha: '2026-01-01T00:00:00.000Z',
      productos: [{
        codigo: 'HUI-M-3-A', modelo: 'Huilo Huilo', familia: 'PUERTA', tipo: 'PUERTA SÓLIDA', madera: 'MARA',
        medida: '0,80 A 0,85', anchoMin: 0.8, anchoMax: 0.85, altoMin: 2.3, altoMax: 2.4, largo: 2.35,
        precioNeto: 100_000, descripcion: 'HUILO HUILO MARA 0,80 A 0,85 MT X 2,30 A 2,40 MT', filaOrigen: 7,
      }],
    };
    const cliente = { nombre: null, rut: null, giro: null, telefono: null, direccion: null, comuna: null, proyecto: null };
    const solicitud = item({ madera: 'Mara', ancho: 0.82, alto: 2.35, cantidad: 1 });
    const llm = { interpretar: vi.fn().mockResolvedValue({ name: 'actualizar_cotizacion', input: { items: [solicitud], cliente } }) };
    const servicio = new Servicio(catalogo, llm, new Almacen(dir));
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza Huilo Huilo en Mara' })).cotizacion;
    const editar = async (cambios: object) =>
      (q = (await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, ...cambios })).cotizacion);

    for (const [cambios, valor] of [
      [{ precioUnitario: 40_000 }, 'precioUnitario'],
      [{ descuento: { tipo: 'monto', valor: 155_001 } }, 'descuento'],
    ] as const) {
      // Escrito en el detalle se rechaza; deshacer (o el chat) lo deja pendiente con la tarjeta.
      await expect(editar({ items: [{ indice: 0, cambios }] })).rejects.toBeInstanceOf(ErrorUsuario);
      q = (await servicio.ejecutar({
        tipo: 'restaurar_items', id: q.id, actualizada: q.actualizada, items: [{ ...q.solicitudes[0], ...cambios }],
      })).cotizacion;
      expect(q.montos.lineas).toHaveLength(0);
      const [p] = preguntasPendientes(q);
      expect(p).toMatchObject({ campo: null, entrada: null, detalle: q.incompletos[0].pregunta, opciones: [{ valor }] });
      expect(faltantesItem(q, 0)).toEqual([]);
      expect(fueraDeRegla(q, 0)).toBe(q.incompletos[0].pregunta);
      await editar(cambiosRespuesta(p, valor));
      expect(q.incompletos).toEqual([]);
      expect(q.montos.lineas[0].precioUnitario).toBe(155_000);
    }
  });
});

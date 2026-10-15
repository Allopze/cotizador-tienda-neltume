import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clienteVacio, type Catalogo, type Producto } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

/**
 * El chat con el anclaje encendido (`verificarCifras`), en los dos modos: «avisar» (producción) conserva la
 * lectura de la IA y avisa; «corregir» la enmienda con la frase del mensaje.
 */
const puerta = (codigo: string, modelo: string, madera = 'MARA'): Producto => ({
  codigo, modelo, familia: 'PUERTA', tipo: 'PUERTA SÓLIDA', madera, medida: '0,80 A 0,85',
  anchoMin: 0.8, anchoMax: 0.85, altoMin: 2.3, altoMax: 2.4, largo: 2.35, precioNeto: 100_000,
  descripcion: `${modelo.toUpperCase()} ${madera} 0,80 A 0,85 MT X 2,30 A 2,40 MT`, filaOrigen: 7,
});
const catalogo: Catalogo = {
  fuente: 'test.xlsx', sha256: 'chat', fecha: '2026-01-01T00:00:00.000Z',
  productos: [
    puerta('HUI-M-3-A', 'Huilo Huilo'),
    puerta('HUI-L-3-A', 'Huilo Huilo', 'LENGA'),
    puerta('PAN-M-3-A', 'PANGUIPULLI'),
    // Ranco de 0,70 con dos altos: «2 Ranco de 70» deja pendientes la madera y el alto, con sus opciones.
    ...(['MARA', 'LENGA'] as const).flatMap((madera) =>
      [2, 2.1].map((alto) => ({
        ...puerta(`RAN-${madera[0]}-${alto}`, 'RANCO', madera),
        medida: '0,70 A 0,75', anchoMin: 0.7, anchoMax: 0.75, altoMin: alto, altoMax: alto, largo: alto,
        descripcion: `RANCO ${madera} 0,70 A 0,75 MT X ${alto} MT`,
      })),
    ),
  ],
};
const PEDIDO = 'cotiza 2 pillo de mara 83x236';
const pedido = (modelo: string | null, extra: Record<string, unknown> = {}) => ({
  modelo, madera: 'MARA', ancho: 83, alto: 236, medida: null, cantidad: 2, fuente: '2 pillo de mara 83x236',
  ...extra,
});
const lista = (...items: object[]) => ({ name: 'actualizar_cotizacion', input: { items, cliente: clienteVacio() } });
const editar = (cambios: Record<string, unknown>) => ({
  name: 'modificar_cotizacion',
  input: { items: [{ indice: 0, cambios }] },
});
const PREGUNTA = '¿Te refieres a Huilo Huilo? Confírmalo para cotizar.';
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
  /** Un mensaje del chat sobre la cotización `q` (o una nueva), con la respuesta que da la IA. */
  const chat = async (mensaje: string, respuesta: object, q?: { id: string; actualizada: string }) => {
    llm.interpretar.mockResolvedValueOnce(respuesta);
    return servicio.ejecutar({ tipo: 'chat', mensaje, ...(q ? { id: q.id, actualizada: q.actualizada } : {}) });
  };
  /** «Pillo» queda pendiente con «¿Te refieres a Huilo Huilo?». */
  const pendiente = async () => (await chat(PEDIDO, lista(pedido('Pillo')))).cotizacion;
  return { llm, servicio, chat, pendiente };
}

describe('confirmar por el chat una coincidencia posible', () => {
  for (const modo of MODOS)
    it(`«sí» a «¿Te refieres a Huilo Huilo?» la cotiza, sin avisos (modo ${modo})`, async () => {
      const { chat, pendiente } = await setup(modo);
      const q = await pendiente();
      expect(q.incompletos.map((i) => i.rechazo.tipo)).toEqual(['modelo_posible']);
      const r = await chat('sí', lista(pedido('Huilo Huilo')), q);
      expect(r.avisos).toBeUndefined();
      expect(r.cotizacion.incompletos).toEqual([]);
      expect(r.cotizacion.solicitudes[0]).toMatchObject({ modelo: 'Huilo Huilo', cantidad: 2 });
      expect(r.cotizacion.montos.lineas.map((l) => l.producto.codigo)).toEqual(['HUI-M-3-A']);
    });

  for (const modo of MODOS)
    it(`también editando el ítem, con otra forma del nombre y otra afirmación (modo ${modo})`, async () => {
      const { chat, pendiente } = await setup(modo);
      const q = await pendiente();
      const r = await chat('ok, ese', editar({ modelo: 'HUILO HUILO', fuente: 'ok, ese' }), q);
      expect(r.avisos).toBeUndefined();
      expect(r.cotizacion.incompletos).toEqual([]);
      expect(r.cotizacion.montos.lineas.map((l) => l.producto.codigo)).toEqual(['HUI-M-3-A']);
    });

  it('vale cualquier forma de confirmar, también con un cambio que se respalda solo', async () => {
    const casos: [string, object, string][] = [
      ['sí po', lista(pedido('Huilo Huilo')), 'HUI-M-3-A×2'],
      ['sii', lista(pedido('Huilo Huilo')), 'HUI-M-3-A×2'],
      ['👍', lista(pedido('Huilo Huilo')), 'HUI-M-3-A×2'],
      ['claro que sí', lista(pedido('Huilo Huilo')), 'HUI-M-3-A×2'],
      ['sí, pero que sean 3', lista(pedido('Huilo Huilo', { cantidad: 3 })), 'HUI-M-3-A×3'],
      ['sí, y en lenga', lista(pedido('Huilo Huilo', { madera: 'LENGA' })), 'HUI-L-3-A×2'],
    ];
    for (const [mensaje, respuesta, linea] of casos) {
      const { chat, pendiente } = await setup('avisar');
      const r = await chat(mensaje, respuesta, await pendiente());
      expect(r.avisos, mensaje).toBeUndefined();
      expect(r.cotizacion.montos.lineas.map((l) => `${l.producto.codigo}×${l.cantidad}`), mensaje).toEqual([linea]);
    }
  });

  it('«la segunda» elige esa opción de la pregunta, y no otra', async () => {
    const sinMadera = pedido('Huilo Huilo', { madera: null, fuente: '2 huilo huilo 83x236' });
    for (const [mensaje, madera, codigos] of [
      ['la segunda', 'LENGA', ['HUI-L-3-A']],
      ['la primera opción', 'MARA', ['HUI-M-3-A']],
      ['la primera', 'LENGA', []],
      ['el constructor', 'MARA', []],
    ] as const) {
      const { chat } = await setup('avisar');
      const q = (await chat('cotiza 2 huilo huilo 83x236', lista(sinMadera))).cotizacion;
      expect(q.incompletos[0].pregunta).toBe('¿Qué madera necesitas para Huilo Huilo? Opciones: Mara, Lenga.');
      const r = await chat(mensaje, lista({ ...sinMadera, madera }), q);
      expect(r.cotizacion.montos.lineas.map((l) => l.producto.codigo), mensaje).toEqual(codigos);
    }
  });

  it('la confirmación respalda solo el nombre sugerido: ni otro modelo, ni cifras, ni un «no»', async () => {
    const casos: [string, object, RegExp][] = [
      ['sí', lista(pedido('PANGUIPULLI')), /modelo del ítem 1 como «PANGUIPULLI», pero ese nombre no aparece/],
      ['sí', lista(pedido('Huilo Huilo', { cantidad: 5 })), /la cantidad 5 para el ítem 1 .*esa cifra no aparece/],
      ['no, es otra', lista(pedido('Huilo Huilo')), /como «Huilo Huilo», pero ese nombre no aparece/],
      ['ese no', lista(pedido('Huilo Huilo')), /como «Huilo Huilo», pero ese nombre no aparece/],
      ['sí, pero que sean 3', lista(pedido('Huilo Huilo', { cantidad: 5 })), /la cantidad 5 para el ítem 1 .*esa cifra no aparece/],
    ];
    for (const [mensaje, respuesta, aviso] of casos) {
      const { chat, pendiente } = await setup('avisar');
      const r = await chat(mensaje, respuesta, await pendiente());
      expect(r.avisos, mensaje).toEqual(expect.arrayContaining([expect.stringMatching(aviso)]));
      expect(r.cotizacion.montos.lineas, mensaje).toHaveLength(0);
    }
  });
});

describe('avisos del anclaje', () => {
  it('en «avisar» avisa el ítem cuya frase no está en el mensaje', async () => {
    const { chat } = await setup('avisar');
    const mensaje = 'cotiza 2 huilo huilo de mara 83x236';
    const r = await chat(mensaje, lista(pedido('Huilo Huilo', { fuente: 'dos puertas huilo huilo en mara' })));
    expect(r.avisos).toContain('No pude verificar el ítem 1 contra tu mensaje; revísalo.');
    // La lectura de la IA se conserva: el aviso pide revisarla.
    expect(r.cotizacion.montos.lineas).toHaveLength(1);
  });

  for (const modo of MODOS)
    it(`una edición por el chat cuya frase está en el mensaje no se acusa (modo ${modo})`, async () => {
      const { chat } = await setup(modo);
      const mensaje = 'cotiza 2 huilo huilo de mara 83x236';
      const q = (await chat(mensaje, lista(pedido('Huilo Huilo', { fuente: '2 huilo huilo de mara 83x236' }))))
        .cotizacion;
      const r = await chat('que sean 3', editar({ cantidad: 3, fuente: 'que sean 3' }), q);
      expect(r.avisos).toBeUndefined();
      expect(r.cotizacion.solicitudes[0].cantidad).toBe(3);
    });

  for (const modo of MODOS)
    it(`una edición que conserva la frase del pedido anterior no se acusa (modo ${modo})`, async () => {
      const mensaje = 'cotiza 2 huilo huilo de mara 83x236';
      const casos: [string, Record<string, unknown>, string][] = [
        // Sin fuente: el esquema la deja opcional.
        ['que sean 3', { cantidad: 3 }, 'HUI-M-3-A×3'],
        ['cámbiala a lenga', { madera: 'LENGA' }, 'HUI-L-3-A×2'],
        ['no, es la panguipulli', { modelo: 'PANGUIPULLI', fuente: '2 huilo huilo de mara 83x236' }, 'PAN-M-3-A×2'],
      ];
      for (const [cambio, cambios, linea] of casos) {
        const { chat } = await setup(modo);
        const q = (await chat(mensaje, lista(pedido('Huilo Huilo', { fuente: '2 huilo huilo de mara 83x236' }))))
          .cotizacion;
        const r = await chat(cambio, editar(cambios), q);
        expect(r.avisos, cambio).toBeUndefined();
        expect(r.cotizacion.montos.lineas.map((l) => `${l.producto.codigo}×${l.cantidad}`), cambio).toEqual([linea]);
      }
    });

  it('si la frase acumulada no cabe, se recorta la anterior y no la del cambio', async () => {
    const { chat } = await setup('avisar');
    const relleno = ' para la obra del cliente que está en la calle larga número';
    const mensaje = `cotiza 2 huilo huilo de mara 83x236${relleno.repeat(6)}`;
    const fuente = mensaje.slice(7, 292).replace(/ \S*$/, '');
    let q = (await chat(mensaje, lista(pedido('Huilo Huilo', { fuente })))).cotizacion;
    q = (await chat('que sean 3', editar({ cantidad: 3, fuente: 'que sean 3' }), q)).cotizacion;
    const r = await chat('mejor que sean 4', editar({ cantidad: 4, fuente: 'mejor que sean 4' }), q);
    expect(r.avisos).toBeUndefined();
    expect(r.cotizacion.solicitudes[0].fuente).toMatch(/ · mejor que sean 4$/);
    expect(r.cotizacion.solicitudes[0].fuente!.length).toBeLessThanOrEqual(300);
  });

  for (const modo of MODOS)
    it(`ubica la frase en un mensaje con la negrita de WhatsApp (modo ${modo})`, async () => {
      const { chat } = await setup(modo);
      const mensaje = '*2 huilo huilo lenga 83x236*';
      const r = await chat(mensaje, lista(pedido('Huilo Huilo', { madera: 'MARA', fuente: '2 huilo huilo lenga 83x236' })));
      expect(r.avisos).not.toContain('No pude verificar el ítem 1 contra tu mensaje; revísalo.');
      // «MARA» no está en el mensaje: el anclaje de nombres la deja pendiente y lo avisa una sola vez (no «anoté…»).
      if (modo === 'avisar')
        expect(r.avisos).toEqual([
          'El asistente interpretó la madera del ítem 1 como «MARA», pero ese nombre no aparece en tu mensaje: quedó pendiente para que lo indiques.',
        ]);
      else expect(r.cotizacion.montos.lineas.map((l) => l.producto.codigo)).toEqual(['HUI-L-3-A']);
    });

  for (const modo of MODOS)
    it(`«No registré» cita la línea que falta, no la registrada con otra frase (modo ${modo})`, async () => {
      const { chat } = await setup(modo);
      const mensaje = '2 huilo huilo mara 83x236\n2 huilo huilo lenga 83x236';
      const lenga = pedido('Huilo Huilo', { madera: 'LENGA', fuente: 'dos huilo huilo de lenga 83x236' });
      const r = await chat(mensaje, { name: 'modificar_cotizacion', input: { agregar: [lenga] } });
      expect(r.cotizacion.montos.lineas.map((l) => l.producto.codigo)).toEqual(['HUI-L-3-A']);
      expect(r.avisos).toContain(
        'No registré: «2 huilo huilo mara 83x236». Revisa si falta y escríbelo de nuevo.',
      );
    });
});

describe('texto que guarda el asistente', () => {
  it('con una pregunta pendiente y sin la ayuda de pedido especial no termina en un bloque vacío', async () => {
    const { pendiente } = await setup('avisar');
    expect((await pendiente()).historial.at(-1)).toEqual({ rol: 'asistente', texto: PREGUNTA });
  });
});

describe('precio total de varias unidades', () => {
  const mensaje = 'cotiza 2 huilo huilo de mara 83x236';
  const total = 'Escribiste un precio total para el ítem 1; indica el valor por unidad.';

  it('se avisa si la frase del ítem trae un monto', async () => {
    const { chat } = await setup('avisar');
    const conTotal = `${mensaje} por $400.000 en total`;
    const precio = { valor: null, iva: 'neto' };
    const r = await chat(conTotal, lista(pedido('Huilo Huilo', { fuente: conTotal, precio })));
    expect(r.avisos).toContain(total);
    expect(r.cotizacion.solicitudes[0].precioUnitario ?? null).toBeNull();
  });

  it('las medidas con decimales no son un precio', async () => {
    const conDecimales = 'cotiza 2 huilo huilo de mara 0,83 x 2,36';
    const precio = { valor: null, iva: null };
    const { chat } = await setup('avisar');
    const r = await chat(
      conDecimales,
      lista(pedido('Huilo Huilo', { ancho: 0.83, alto: 2.36, fuente: conDecimales.slice(7), precio })),
    );
    expect(r.avisos ?? []).not.toContain(total);
    expect(r.cotizacion.montos.lineas).toHaveLength(1);
    // Un total escrito en palabras sí se avisa.
    const enPalabras = `${mensaje} a 900 mil las dos`;
    const r2 = await (await setup('avisar')).chat(
      enPalabras,
      lista(pedido('Huilo Huilo', { fuente: enPalabras.slice(7), precio })),
    );
    expect(r2.avisos).toContain(total);
  });

  it('no se avisa si la IA solo rellenó el precio sin que se escribiera uno', async () => {
    const { chat } = await setup('avisar');
    const precio = { valor: null, iva: null };
    const r = await chat(mensaje, lista(pedido('Huilo Huilo', { fuente: '2 huilo huilo de mara 83x236', precio })));
    expect(r.avisos ?? []).not.toContain(total);
    expect(r.cotizacion.montos.lineas).toHaveLength(1);
  });
});

describe('lo que solo dijo el asistente no respalda una cifra (I2, en dos turnos)', () => {
  const ranco = (extra: Record<string, unknown>) => ({
    modelo: 'RANCO', madera: null, ancho: 70, alto: null, medida: null, cantidad: 2, fuente: '2 Ranco de 70', ...extra,
  });
  for (const modo of MODOS)
    it(`«lenga» a la pregunta con opciones no fija el alto que solo estaba en ellas (modo ${modo})`, async () => {
      const { chat } = await setup(modo);
      const q = (await chat('2 Ranco de 70', lista(ranco({})))).cotizacion;
      // La pregunta pendiente trae los altos como opciones: el 2,1 queda escrito en el historial del asistente.
      expect(q.historial.at(-1)!.texto).toMatch(/Opciones: 2, 2,1/);
      const r = await chat('lenga', lista(ranco({ madera: 'LENGA', alto: 2.1, fuente: 'lenga' })), q);
      expect(r.cotizacion.solicitudes[0]).toMatchObject({ madera: 'LENGA', alto: null, cantidad: 2 });
      expect(r.cotizacion.montos.lineas).toHaveLength(0);
      // En «corregir», «lenga» se aplica sin la IA (respuesta directa) y no hay alto que avisar.
      if (modo === 'avisar')
        expect(r.avisos).toContain(
          'El asistente propuso el alto o largo 2,1 m para el ítem 1 (RANCO), pero esa cifra no aparece en tu mensaje: quedó pendiente para que la confirmes.',
        );
    });
});

describe('la pregunta pendiente sobrevive al recorte del historial (I6)', () => {
  it('con avisos largos, la IA recibe la pregunta dentro de los 500 caracteres del turno', async () => {
    const { chat, llm } = await setup('avisar');
    // Dos ítems con cifras y una madera que el mensaje no dice: avisos largos, y «Pillo» queda como pregunta.
    const q = (
      await chat(
        PEDIDO,
        lista(
          pedido('Pillo'),
          pedido('PANGUIPULLI', { madera: 'LENGA', cantidad: 7, ancho: 91, alto: 245, fuente: 'otra panguipulli' }),
        ),
      )
    ).cotizacion;
    const turno = q.historial.at(-1)!.texto;
    expect(turno.length).toBeGreaterThan(500);
    expect(turno.indexOf(PREGUNTA)).toBeGreaterThan(-1);
    await chat('sí', lista(pedido('Huilo Huilo')), q);
    const contexto = llm.interpretar.mock.calls[1][0] as { historial: { rol: string; texto: string }[] };
    const recortado = contexto.historial.at(-1)!;
    expect(recortado.rol).toBe('asistente');
    expect(recortado.texto.length).toBeLessThanOrEqual(500);
    expect(recortado.texto).toContain(PREGUNTA);
  });
});

describe('edición por el chat con la frase parafraseada', () => {
  for (const modo of MODOS)
    it(`avisa «No pude verificar» cuando la frase del cambio no está en el mensaje (modo ${modo})`, async () => {
      const { chat } = await setup(modo);
      const mensaje = 'cotiza 2 huilo huilo de mara 83x236';
      const q = (await chat(mensaje, lista(pedido('Huilo Huilo', { fuente: '2 huilo huilo de mara 83x236' }))))
        .cotizacion;
      const r = await chat('que sean 3', editar({ cantidad: 3, fuente: 'cambiar a tres unidades' }), q);
      expect(r.avisos).toContain('No pude verificar el ítem 1 contra tu mensaje; revísalo.');
    });
});

describe('frases que antes no se ubicaban o daban falsas alarmas', () => {
  for (const modo of MODOS)
    it(`«83x236cm»: la unidad pegada no impide ubicar la frase (modo ${modo})`, async () => {
      const { chat } = await setup(modo);
      const r = await chat(
        'cotiza 2 huilo huilo de mara 83x236cm',
        lista(pedido('Huilo Huilo', { fuente: '2 huilo huilo de mara 83x236' })),
      );
      expect(r.avisos).toBeUndefined();
      expect(r.cotizacion.montos.lineas.map((l) => l.producto.codigo)).toEqual(['HUI-M-3-A']);
    });

  for (const modo of MODOS)
    it(`«una en mara y otra en lenga, ambas de 83x236» no avisa cantidad ni medidas (modo ${modo})`, async () => {
      const { chat } = await setup(modo);
      const mensaje = 'cotiza 2 Huilo Huilo, una en mara y otra en lenga, ambas de 83x236';
      const r = await chat(
        mensaje,
        lista(
          pedido('Huilo Huilo', { cantidad: 1, fuente: '2 Huilo Huilo, una en mara' }),
          pedido('Huilo Huilo', { madera: 'LENGA', cantidad: 1, fuente: 'otra en lenga, ambas de 83x236' }),
        ),
      );
      expect(r.avisos).toBeUndefined();
      expect(r.cotizacion.montos.lineas.map((l) => `${l.producto.codigo}×${l.cantidad}`)).toEqual([
        'HUI-M-3-A×1',
        'HUI-L-3-A×1',
      ]);
    });
});

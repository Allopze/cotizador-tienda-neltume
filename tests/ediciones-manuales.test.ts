import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contextoSeguro, SYSTEM } from '../src/asistente/llm';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import { avisoDescripcionDescartada } from '../src/negocio/items';
import type { Cotizacion } from '../src/negocio/estado';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const puerta = (codigo: string, modelo: string, madera: string): Producto => ({
  codigo, modelo, familia: 'PUERTA', tipo: 'PUERTA PANEL', madera, medida: '0,80 A 0,85', anchoMin: 0.8, anchoMax: 0.85,
  largo: 2, precioNeto: 100_000, descripcion: `${modelo} ${madera}`, filaOrigen: 4,
});
const catalogo: Catalogo = {
  fuente: 'test', sha256: 'test', fecha: '2026-01-01',
  productos: [puerta('MOL-O', 'MOLCO', 'PINO OREGON'), puerta('PAN-O', 'PANGUIPULLI', 'PINO OREGON'), puerta('MOL-L', 'MOLCO', 'LENGA')],
};
const item = (extra: Partial<SolicitudItem> = {}): SolicitudItem => ({
  modelo: 'MOLCO', madera: 'PINO OREGON', ancho: 0.8, alto: 2, medida: null, cantidad: 3, ...extra,
});
const lista = (...items: SolicitudItem[]) => ({
  name: 'actualizar_cotizacion',
  input: { items, cliente: clienteVacio() },
});
const cambiar = (indice: number, cambios: Record<string, unknown>) => ({
  name: 'modificar_cotizacion',
  input: { items: [{ indice, cambios }] },
});
const EDICIONES = { margen: 0.3, descripcion: 'Puerta especial', observaciones: 'Confirmar apertura', tipoMedida: 'vano' } as const;

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

/** Borrador de dos puertas: la primera con margen, descripción, observaciones y tipo de medida; la segunda con precio manual. */
async function preparar(primera: SolicitudItem = item(), segunda: SolicitudItem = item({ modelo: 'PANGUIPULLI', ancho: 0.85 })) {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-ediciones-'));
  dirs.push(dir);
  const llm = { interpretar: vi.fn() };
  const servicio = new Servicio(catalogo, llm, new Almacen(dir));
  llm.interpretar.mockResolvedValueOnce(lista(primera, segunda));
  let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza dos puertas' })).cotizacion;
  q = (
    await servicio.ejecutar({
      tipo: 'editar', id: q.id, actualizada: q.actualizada,
      items: [
        { indice: 0, cambios: { ...EDICIONES } },
        { indice: 1, cambios: { precioUnitario: 150_000, observaciones: 'Entrega en obra' } },
      ],
    })
  ).cotizacion;
  const chat = (desde: Cotizacion, respuesta: unknown) => {
    llm.interpretar.mockResolvedValueOnce(respuesta);
    return servicio.ejecutar({ tipo: 'chat', id: desde.id, actualizada: desde.actualizada, mensaje: 'ajusta el pedido' });
  };
  const modificar = (desde: Cotizacion, respuesta: unknown) => {
    llm.interpretar.mockResolvedValueOnce(respuesta);
    return servicio.ejecutar({ tipo: 'chat', mensaje: 'ajusta el pedido', objetivoId: desde.id, objetivoActualizada: desde.actualizada });
  };
  return { q, llm, servicio, chat, modificar };
}

describe('el chat conserva las ediciones manuales', () => {
  it('con la lista completa y un ítem nuevo, los existentes conservan todo y el nuevo no hereda nada', async () => {
    const { q, chat, llm } = await preparar();
    expect(q.solicitudes[0]).toMatchObject(EDICIONES);
    const r = await chat(q, lista(
      // La IA devuelve null en lo que no cambia, y un alias en vez del nombre canónico.
      item({ madera: 'pino' }),
      item({ modelo: 'PANGUIPULLI', ancho: 0.85 }),
      item({ madera: 'LENGA', cantidad: 2 }),
    ));
    const [a, b, nuevo] = r.cotizacion.solicitudes;
    expect(a).toMatchObject({ ...EDICIONES, madera: 'PINO OREGON' });
    expect(b).toMatchObject({ precioUnitario: 150_000, observaciones: 'Entrega en obra', margen: null });
    expect([nuevo.margen ?? null, nuevo.precioUnitario ?? null, nuevo.tipoMedida ?? null, nuevo.descripcion ?? null, nuevo.observaciones ?? null])
      .toEqual([null, null, null, null, null]);
    const [la, lb, ln] = r.cotizacion.montos.lineas;
    expect([la.margen, la.descripcionDocumento, la.observaciones]).toEqual([0.3, 'Puerta especial', 'Confirmar apertura']);
    expect(lb.precioUnitario).toBe(150_000);
    expect([ln.margenPersonalizado, ln.descripcionDocumento]).toEqual([false, null]);
    expect(r.avisos).toBeUndefined();
    // La IA vio los textos del ítem, nunca margen ni precio.
    const visto = llm.interpretar.mock.calls.at(-1)![0].borrador.items;
    expect(visto[0]).toMatchObject({ tipoMedida: 'vano', descripcion: 'Puerta especial', observaciones: 'Confirmar apertura' });
    expect(JSON.stringify(visto)).not.toMatch(/margen|precio|150000/);
  });

  it('la pareja se busca por identidad aunque la lista cambie de orden', async () => {
    const { q, chat } = await preparar();
    const r = await chat(q, lista(
      item({ madera: 'LENGA' }),
      item({ modelo: 'PANGUIPULLI', ancho: 0.85 }),
      item(),
    ));
    const [nuevo, b, a] = r.cotizacion.solicitudes;
    expect(a).toMatchObject(EDICIONES);
    expect(b).toMatchObject({ precioUnitario: 150_000, observaciones: 'Entrega en obra' });
    expect([nuevo.margen ?? null, nuevo.descripcion ?? null, nuevo.observaciones ?? null]).toEqual([null, null, null]);
  });

  it('un cambio de medidas o de cantidad en la misma posición mantiene margen, precio y textos', async () => {
    const { q, chat } = await preparar();
    const r = await chat(q, lista(item({ ancho: 0.85 }), item({ modelo: 'PANGUIPULLI', ancho: 0.8, cantidad: 5 })));
    const [a, b] = r.cotizacion.solicitudes;
    expect(a).toMatchObject({ ...EDICIONES, ancho: 0.85 });
    expect(b).toMatchObject({ precioUnitario: 150_000, observaciones: 'Entrega en obra', ancho: 0.8, cantidad: 5 });
    expect(r.avisos).toBeUndefined();
  });

  it('completar un dato faltante no es un cambio de producto', async () => {
    const { q, chat } = await preparar(item({ madera: null }));
    expect(q.solicitudes[0]).toMatchObject({ madera: null, descripcion: 'Puerta especial' });
    const r = await chat(q, lista(item({ madera: 'pino' }), item({ modelo: 'PANGUIPULLI', ancho: 0.85 })));
    expect(r.cotizacion.solicitudes[0]).toMatchObject({ ...EDICIONES, madera: 'PINO OREGON' });
    expect(r.avisos).toBeUndefined();
  });

  it('un ítem distinto en el lugar de otro quitado no hereda el precio ni los textos', async () => {
    const { q, chat } = await preparar();
    // Quita el primero y agrega otro modelo y medidas en su posición; el segundo sigue igual.
    const r = await chat(q, lista(item({ modelo: 'PANGUIPULLI', ancho: 0.82 }), item({ modelo: 'PANGUIPULLI', ancho: 0.85 })));
    const [nuevo, b] = r.cotizacion.solicitudes;
    expect([nuevo.margen ?? null, nuevo.precioUnitario ?? null, nuevo.descripcion ?? null, nuevo.observaciones ?? null, nuevo.tipoMedida ?? null])
      .toEqual([null, null, null, null, null]);
    expect(b).toMatchObject({ precioUnitario: 150_000, observaciones: 'Entrega en obra' });
  });
});

describe('un cambio de modelo o madera descarta la descripción de documento', () => {
  it.each([
    ['sin descripción', null],
    ['repitiendo la anterior', 'Puerta especial'],
  ])('lista completa, %s: se descarta con aviso y se conserva lo demás', async (_, descripcion) => {
    const { q, chat } = await preparar();
    const r = await chat(q, lista(item({ modelo: 'PANGUIPULLI', descripcion }), item({ modelo: 'PANGUIPULLI', ancho: 0.85 })));
    expect(r.cotizacion.solicitudes[0]).toMatchObject({
      modelo: 'PANGUIPULLI', descripcion: null, margen: 0.3, observaciones: 'Confirmar apertura', tipoMedida: 'vano',
    });
    expect(r.cotizacion.montos.lineas[0].descripcionDocumento).toBeNull();
    expect(r.avisos).toEqual([avisoDescripcionDescartada(1)]);
    expect(r.cotizacion.historial.at(-1)?.texto).toContain(avisoDescripcionDescartada(1));
  });

  it('lista completa: un cambio de madera también la descarta', async () => {
    const { q, chat } = await preparar();
    const r = await chat(q, lista(item({ madera: 'LENGA' }), item({ modelo: 'PANGUIPULLI', ancho: 0.85 })));
    expect(r.cotizacion.solicitudes[0]).toMatchObject({ madera: 'LENGA', descripcion: null, margen: 0.3 });
    expect(r.avisos).toEqual([avisoDescripcionDescartada(1)]);
  });

  it('lista completa: una descripción nueva pedida en el mismo mensaje se respeta', async () => {
    const { q, chat } = await preparar();
    const r = await chat(q, lista(item({ modelo: 'PANGUIPULLI', descripcion: '  Puerta   Panguipulli enchapada ' }), item({ modelo: 'PANGUIPULLI', ancho: 0.85 })));
    expect(r.cotizacion.solicitudes[0].descripcion).toBe('Puerta Panguipulli enchapada');
    expect(r.avisos).toBeUndefined();
  });

  it('modificación parcial: se descarta con aviso; un cambio de medida o cantidad no', async () => {
    const { q, modificar } = await preparar();
    const medida = await modificar(q, cambiar(0, { ancho: 0.85, cantidad: 4 }));
    expect(medida.cotizacion.solicitudes[0]).toMatchObject({ ...EDICIONES, ancho: 0.85, cantidad: 4 });
    expect(medida.avisos).toBeUndefined();
    const modelo = await modificar(medida.cotizacion, cambiar(0, { modelo: 'PANGUIPULLI' }));
    expect(modelo.cotizacion.solicitudes[0]).toMatchObject({
      modelo: 'PANGUIPULLI', descripcion: null, margen: 0.3, observaciones: 'Confirmar apertura', tipoMedida: 'vano',
    });
    expect(modelo.avisos).toEqual([avisoDescripcionDescartada(1)]);
  });

  it('modificación parcial: el aviso numera el ítem según la lista resultante', async () => {
    const { q, servicio, modificar } = await preparar();
    const conDescripcion = (
      await servicio.ejecutar({
        tipo: 'editar', id: q.id, actualizada: q.actualizada,
        items: [{ indice: 1, cambios: { descripcion: 'Panguipulli especial' } }],
      })
    ).cotizacion;
    const r = await modificar(conDescripcion, {
      name: 'modificar_cotizacion',
      input: { items: [{ indice: 1, cambios: { modelo: 'MOLCO' } }], quitar: [0] },
    });
    expect(r.cotizacion.solicitudes).toMatchObject([{ modelo: 'MOLCO', descripcion: null, precioUnitario: 150_000 }]);
    expect(r.avisos).toEqual([avisoDescripcionDescartada(1)]);
  });

  it('modificación parcial: una descripción nueva en el mismo cambio se respeta', async () => {
    const { q, modificar } = await preparar();
    const r = await modificar(q, cambiar(0, { modelo: 'PANGUIPULLI', descripcion: 'Puerta Panguipulli' }));
    expect(r.cotizacion.solicitudes[0]).toMatchObject({ modelo: 'PANGUIPULLI', descripcion: 'Puerta Panguipulli' });
    expect(r.avisos).toBeUndefined();
  });

  it('edición directa: se descarta con aviso; medidas, cantidad y una corrección de mayúsculas no', async () => {
    const { q, servicio } = await preparar();
    const editar = (desde: Cotizacion, cambios: Record<string, unknown>) =>
      servicio.ejecutar({ tipo: 'editar', id: desde.id, actualizada: desde.actualizada, items: [{ indice: 0, cambios }] });
    let r = await editar(q, { ancho: 0.85 });
    r = await editar(r.cotizacion, { modelo: 'molco' });
    expect(r.cotizacion.solicitudes[0]).toMatchObject({ ...EDICIONES, ancho: 0.85 });
    expect(r.avisos).toBeUndefined();
    r = await editar(r.cotizacion, { modelo: 'PANGUIPULLI' });
    expect(r.cotizacion.solicitudes[0]).toMatchObject({
      modelo: 'PANGUIPULLI', descripcion: null, margen: 0.3, observaciones: 'Confirmar apertura', tipoMedida: 'vano',
    });
    expect(r.avisos).toEqual([avisoDescripcionDescartada(1)]);
  });
});

describe('textos de la IA', () => {
  it('los textos vacíos o en blanco se guardan como null y los demás sin espacios sobrantes', async () => {
    const { servicio, llm } = await preparar();
    llm.interpretar.mockResolvedValueOnce(lista(
      item({ descripcion: '', observaciones: '   ', medida: '' }),
      item({ modelo: 'PANGUIPULLI', ancho: 0.85, descripcion: '  Puerta   lisa ', observaciones: ' Con  cerradura ' }),
    ));
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza dos puertas nuevas' });
    const [a, b] = r.cotizacion.solicitudes;
    expect([a.descripcion, a.observaciones, a.medida]).toEqual([null, null, null]);
    expect([b.descripcion, b.observaciones]).toEqual(['Puerta lisa', 'Con cerradura']);
  });

  it('en una modificación parcial también se normalizan los cambios y los ítems agregados', async () => {
    const { q, modificar } = await preparar();
    const r = await modificar(q, {
      name: 'modificar_cotizacion',
      input: {
        items: [{ indice: 0, cambios: { observaciones: '  ', descripcion: ' Puerta   nueva ' } }],
        agregar: [item({ madera: 'LENGA', descripcion: '', observaciones: ' ' })],
      },
    });
    const [a, , agregado] = r.cotizacion.solicitudes;
    expect([a.observaciones, a.descripcion]).toEqual([null, 'Puerta nueva']);
    expect([agregado.descripcion, agregado.observaciones]).toEqual([null, null]);
  });

  it('un texto vacío de la IA sobre un ítem existente no borra lo escrito', async () => {
    const { q, chat } = await preparar();
    const r = await chat(q, lista(item({ descripcion: '', observaciones: '', tipoMedida: null }), item({ modelo: 'PANGUIPULLI', ancho: 0.85 })));
    expect(r.cotizacion.solicitudes[0]).toMatchObject(EDICIONES);
  });
});

describe('contexto de la IA', () => {
  it('incluye tipo de medida, descripción y observaciones, y excluye margen, precio y origen del modelo', () => {
    const editado: SolicitudItem = {
      ...item(), ...EDICIONES, precioUnitario: 150_000, modeloOriginal: 'Molko', coincidenciaModelo: 'alias',
    };
    const contexto = contextoSeguro('ajusta', [editado, item()], clienteVacio(), ['MOLCO'], ['LENGA']);
    expect(contexto.borrador.items).toEqual([
      { modelo: 'MOLCO', madera: 'PINO OREGON', ancho: 0.8, alto: 2, medida: null, cantidad: 3, tipoMedida: 'vano', descripcion: 'Puerta especial', observaciones: 'Confirmar apertura' },
      { modelo: 'MOLCO', madera: 'PINO OREGON', ancho: 0.8, alto: 2, medida: null, cantidad: 3, tipoMedida: null, descripcion: null, observaciones: null },
    ]);
    expect(JSON.stringify(contexto)).not.toMatch(/margen|precio|150000|Molko|coincidencia/);
  });

  it('el prompt pide conservar esos textos', () => {
    expect(SYSTEM).toMatch(/tipoMedida, descripcion y observaciones[^.]*salvo que el mensaje pida cambiarlos/);
  });
});

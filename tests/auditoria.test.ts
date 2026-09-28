import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Servicio } from '../src/servidor/servicio';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import type { Cotizacion, ResumenCotizacion } from '../src/negocio/estado';
import { conDosDecimales, interpretarCifra, leerPesos, leerPorcentaje } from '../src/negocio/cifras';
import { cotizar, descuentoValido } from '../src/negocio/precios';
import { esFeriado, feriadosDelAnio } from '../src/negocio/feriados';
import { sumarDiasHabiles } from '../src/negocio/vigencia';
import { MAX_OPCIONES, pregunta } from '../src/asistente/preguntas';
import { csvCotizaciones } from '../src/servidor/exportar';
import { resolverReferencia } from '../src/servidor/referencias';
vi.mock('../src/servidor/pdf', () => ({
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const puerta: Producto = {
  codigo: 'MOL-O-3-A',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100000,
  descripcion: 'MOLCO',
  filaOrigen: 4,
};
const catalogo = (): Catalogo => ({
  fuente: 'test',
  sha256: 'test',
  fecha: '2026-01-01',
  productos: [puerta],
});
const molco: SolicitudItem = {
  modelo: 'MOLCO',
  madera: 'PINO OREGON',
  ancho: 0.82,
  alto: 2,
  medida: null,
  cantidad: 3,
};
const actualizar = (items: SolicitudItem[], cliente: object = clienteVacio()) => ({
  name: 'actualizar_cotizacion',
  input: { items, cliente },
});
const responder = (texto: string) => ({ name: 'responder', input: { texto } });
const dirs: string[] = [];

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-auditoria-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const llm = { interpretar: vi.fn().mockResolvedValue(actualizar([molco])) };
  const servicio = new Servicio(catalogo(), llm, almacen, { nombre: 'Paula', email: 'paula@neltume.cl' });
  const conPedido = async () => (await servicio.ejecutar({ tipo: 'chat', mensaje: 'Cotiza' })).cotizacion;
  const emitida = async () => {
    const q = await conPedido();
    return (await servicio.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada })).cotizacion;
  };
  return { almacen, llm, servicio, conPedido, emitida };
}
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

describe('descuento y cifras', () => {
  it('acepta porcentajes con dos decimales aunque el binario no sea exacto', () => {
    for (const d of [0.29, 1.13, 2.3, 4.35, 0.57, 33.33, 12.5]) {
      expect(conDosDecimales(d)).toBe(true);
      expect(descuentoValido(d)).toBe(true);
    }
    expect(descuentoValido(2.345)).toBe(false);
    expect(cotizar([{ producto: puerta, cantidad: 1 }], undefined, { descuento: 2.3 }).descuento).toBe(2875);
  });

  it('un punto en el descuento es decimal, nunca separador de miles', () => {
    expect(leerPorcentaje('2.5')).toBe(2.5);
    expect(leerPorcentaje('2,5 %')).toBe(2.5);
    expect(leerPorcentaje('12.5')).toBe(12.5);
    expect(leerPorcentaje('')).toBe(0);
    expect(leerPorcentaje('1.2.3')).toBeNaN();
  });

  it('los montos se leen igual en el alta y en la edición de productos', () => {
    expect(leerPesos('$15.000')).toBe(15000);
    expect(leerPesos('45,990')).toBe(interpretarCifra('45,990'));
    expect(leerPesos('45,99')).toBe(45.99);
  });

  it('guarda el descuento en centésimas y lo registra en la actividad', async () => {
    const { servicio, almacen, conPedido } = await setup();
    const q = await conPedido();
    const r = await servicio.ejecutar({
      tipo: 'editar',
      id: q.id,
      actualizada: q.actualizada,
      descuento: 2.3,
    });
    expect(r.cotizacion.descuento).toBe(2.3);
    expect(almacen.eventos(q.id).at(-1)).toMatchObject({
      tipo: 'modificada',
      usuario: 'Paula',
      detalle: 'Descuento 0 % → 2,3 %',
    });
  });
});

describe('referencias y borradores', () => {
  it('un número de cotización inexistente no modifica la conversación abierta', async () => {
    const { servicio, llm, almacen, conPedido } = await setup();
    const q = await conPedido();
    llm.interpretar.mockClear();
    await expect(
      servicio.ejecutar({
        tipo: 'chat',
        id: q.id,
        actualizada: q.actualizada,
        mensaje: 'La cotización 999 ahora son 8 puertas',
      }),
    ).rejects.toMatchObject({ codigo: 'no_encontrada', message: expect.stringContaining('N° 999') });
    expect(llm.interpretar).not.toHaveBeenCalled();
    expect(almacen.obtener(q.id)!.actualizada).toBe(q.actualizada);
    expect(resolverReferencia('cotización 999', [])).toEqual({ tipo: 'inexistente', numero: 999 });
  });

  it('un primer mensaje sin pedido responde sin guardar un borrador vacío', async () => {
    const { servicio, llm, almacen } = await setup();
    llm.interpretar.mockResolvedValueOnce(responder('¿Qué necesitas cotizar?'));
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje: 'hola' });
    expect(r.efimera).toBe(true);
    expect(r.cotizacion.historial.map((m) => m.texto)).toEqual(['hola', '¿Qué necesitas cotizar?']);
    llm.interpretar.mockResolvedValueOnce(actualizar([]));
    expect((await servicio.ejecutar({ tipo: 'chat', mensaje: 'gracias' })).efimera).toBe(true);
    expect(almacen.listar().total).toBe(0);
  });

  it('el intercambio previo sin borrador llega a la IA como contexto', async () => {
    const { servicio, llm } = await setup();
    const contexto = [
      { rol: 'usuario' as const, texto: 'se aprobó' },
      { rol: 'asistente' as const, texto: '¿Qué número?' },
    ];
    await servicio.ejecutar({ tipo: 'chat', mensaje: '3 Molco', contexto });
    expect(llm.interpretar.mock.calls[0][0].historial).toEqual(contexto);
  });

  it('reenviar un mensaje ya procesado (tras cancelar) no crea un segundo borrador', async () => {
    const { servicio, almacen } = await setup();
    const nuevoId = randomUUID();
    const q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'Cotiza', nuevoId })).cotizacion;
    expect(q.id).toBe(nuevoId);
    await expect(servicio.ejecutar({ tipo: 'chat', mensaje: 'Cotiza', nuevoId })).rejects.toMatchObject({
      codigo: 'mensaje_procesado',
      detalle: { id: nuevoId },
    });
    expect(almacen.listar().total).toBe(1);
    expect(almacen.eventos(nuevoId).map((e) => e.tipo)).toEqual(['creada']);
  });
});

describe('ciclo de vida', () => {
  it('duplicar conserva el descuento y el flete', async () => {
    const { servicio, conPedido } = await setup();
    const q = await conPedido();
    const editada = (
      await servicio.ejecutar({
        tipo: 'editar',
        id: q.id,
        actualizada: q.actualizada,
        descuento: 10,
        flete: 15000,
      })
    ).cotizacion;
    const copia = (await servicio.ejecutar({ tipo: 'duplicar', id: editada.id })).cotizacion;
    expect(copia.descuento).toBe(10);
    expect(copia.flete).toBe(15000);
    expect(copia.montos.total).toBe(editada.montos.total);
  });

  it('anular una emitida deja su revisión abierta como cotización nueva', async () => {
    const { servicio, almacen, emitida } = await setup();
    const e = await emitida();
    const revision = (
      await servicio.ejecutar({ tipo: 'editar', id: e.id, actualizada: e.actualizada, flete: 5000 })
    ).cotizacion;
    expect(revision.origen).toBe(e.numero);
    const r = await servicio.ejecutar({ tipo: 'anular', id: e.id, actualizada: e.actualizada });
    expect(r.avisos?.[0]).toMatch(/quedó como cotización nueva/);
    const suelta = almacen.obtener(revision.id)!;
    expect(suelta.origen).toBeNull();
    expect(suelta.estado).toBe('borrador');
    expect(almacen.eventos(revision.id).map((x) => x.tipo)).toEqual([
      'revision',
      'modificada',
      'desvinculada',
    ]);
  });

  it('aprobar una anulada explica que está anulada', async () => {
    const { servicio, emitida } = await setup();
    const e = await emitida();
    const anulada = (await servicio.ejecutar({ tipo: 'anular', id: e.id, actualizada: e.actualizada }))
      .cotizacion;
    await expect(
      servicio.ejecutar({ tipo: 'aprobar', id: e.id, actualizada: anulada.actualizada }),
    ).rejects.toThrow(/anulada y no se puede aprobar/);
  });

  it('el listado ordena y filtra por la fecha que muestra (emisión, aprobación o anulación)', async () => {
    const { servicio, almacen, emitida, conPedido } = await setup();
    const vieja = await emitida();
    await conPedido();
    await new Promise((r) => setTimeout(r, 5));
    // La emitida se anula: su fecha de referencia pasa a ser la anulación, la más reciente.
    await servicio.ejecutar({ tipo: 'anular', id: vieja.id, actualizada: vieja.actualizada });
    const [primera] = almacen.listar().cotizaciones;
    expect(primera.id).toBe(vieja.id);
    expect(primera.fecha).toBe(almacen.obtener(vieja.id)!.fechaAnulacion);
  });
});

describe('feriados y vigencia', () => {
  it('conoce los feriados nacionales de 2026', () => {
    expect([...feriadosDelAnio(2026)].sort()).toEqual([
      '2026-01-01',
      '2026-04-03',
      '2026-04-04',
      '2026-05-01',
      '2026-05-21',
      '2026-06-21',
      '2026-06-29',
      '2026-07-16',
      '2026-08-15',
      '2026-09-18',
      '2026-09-19',
      '2026-10-12',
      '2026-10-31',
      '2026-11-01',
      '2026-12-08',
      '2026-12-25',
    ]);
  });

  it('aplica traslados y el solsticio de cada año', () => {
    expect(esFeriado('2025-06-20')).toBe(true); // Pueblos Indígenas 2025
    expect(esFeriado('2024-06-20')).toBe(true);
    expect(esFeriado('2023-06-26')).toBe(true); // San Pedro y San Pablo (jueves 29) → lunes 26
    expect(esFeriado('2023-10-09')).toBe(true); // 12 de octubre (jueves) → lunes 9
    expect(esFeriado('2023-10-27')).toBe(true); // 31 de octubre martes → viernes 27
    expect(esFeriado('2023-01-02')).toBe(true); // 2 de enero lunes
    expect(esFeriado('2028-09-20')).toBe(false);
    expect(esFeriado('2027-09-17')).toBe(false); // viernes: las reglas no lo incluyen; un decreto llega por sincronización
    expect(esFeriado('2029-09-17')).toBe(true); // lunes 17
  });

  it('los días hábiles saltan feriados', () => {
    // Jueves 17 de septiembre de 2026: el siguiente hábil es el lunes 21.
    expect(sumarDiasHabiles('2026-09-17', 1)).toBe('2026-09-21');
  });
});

describe('textos y exportación', () => {
  it('limita las opciones de una pregunta', () => {
    const muchas = Array.from({ length: MAX_OPCIONES + 5 }, (_, i) => `MODELO ${i}`);
    const texto = pregunta({ tipo: 'modelo_desconocido', valor: 'x', disponibles: muchas }, null);
    expect(texto).toContain('y 5 más');
    expect(texto).not.toContain(`Modelo ${MAX_OPCIONES}`);
  });

  it('el CSV escapa separadores y neutraliza fórmulas', () => {
    const fila = {
      numero: 323,
      estado: 'emitida',
      cliente: { ...clienteVacio(), nombre: '=HYPERLINK("x")', proyecto: 'Casa; "Sur"' },
      fecha: '2026-09-28T12:00:00.000Z',
      fechaEmision: null,
      vence: null,
      vencida: false,
      productos: '',
      nota: null,
    } as unknown as ResumenCotizacion;
    const [, linea] = csvCotizaciones([fila]).split('\r\n');
    expect(linea).toContain(`"'=HYPERLINK(""x"")"`);
    expect(linea).toContain('"Casa; ""Sur"""');
  });
});

export type { Cotizacion };

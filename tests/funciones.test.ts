import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Servicio, type Resultado } from '../src/servidor/servicio';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { ErrorIA } from '../src/asistente/errores';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import { resolverItem } from '../src/catalogo/resolver';
import { CORRELATIVO_COTIZACION, type Cotizacion } from '../src/negocio/estado';
import { calcularVence, sumarDiasHabiles } from '../src/negocio/vigencia';
import { normalizarRut } from '../src/negocio/cliente';
import { plantilla } from '../src/servidor/pdf';
vi.mock('../src/servidor/pdf', () => ({
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const producto = (p: Partial<Producto>): Producto => ({
  codigo: 'MOL-O-3-A',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100.4,
  descripcion: 'MOLCO',
  filaOrigen: 4,
  ...p,
});
const catalogoBase = (): Catalogo => ({
  fuente: 'test',
  sha256: 'test',
  fecha: '2026-01-01',
  productos: [
    producto({}),
    producto({
      codigo: 'MAR-O-2X4-B',
      modelo: 'MARCO',
      familia: 'MARCO',
      tipo: null,
      medida: '2X4',
      anchoMin: null,
      anchoMax: null,
      largo: 2.1,
      precioNeto: 200,
      descripcion: 'MARCO',
    }),
  ],
});
const molco: SolicitudItem = {
  modelo: 'MOLCO',
  madera: 'PINO OREGON',
  ancho: 0.82,
  alto: 2,
  medida: null,
  cantidad: 3,
};
const marco: SolicitudItem = {
  modelo: 'MARCO',
  madera: 'PINO OREGON',
  ancho: null,
  alto: 2.1,
  medida: '2x4',
  cantidad: 2,
};
const actualizar = (items: SolicitudItem[], cliente: object = clienteVacio()) => ({
  name: 'actualizar_cotizacion',
  input: { items, cliente },
});
const usuario = { nombre: 'Paula', email: 'paula@neltume.cl' };
const dirs: string[] = [];

async function setup(catalogo = catalogoBase()) {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-funciones-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const llm = { interpretar: vi.fn().mockResolvedValue(actualizar([molco])) };
  const servicio = new Servicio(catalogo, llm, almacen, usuario);
  const conPedido = async (items = [molco], cliente?: object) => {
    llm.interpretar.mockResolvedValueOnce(actualizar(items, cliente));
    return (await servicio.ejecutar({ tipo: 'chat', mensaje: 'Cotiza' })).cotizacion;
  };
  const emitir = async (q: Cotizacion) =>
    servicio.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada });
  const emitida = async (items = [molco], cliente?: object) =>
    (await emitir(await conPedido(items, cliente))).cotizacion;
  return { dir, almacen, llm, servicio, conPedido, emitir, emitida, catalogo };
}
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

describe('C1: cantidades inválidas del modelo', () => {
  it('anula cantidades no enteras o enormes con aviso y la base sigue legible', async () => {
    const { servicio, llm, almacen } = await setup();
    llm.interpretar.mockResolvedValueOnce(
      actualizar([
        { ...molco, cantidad: 2.5 },
        { ...marco, cantidad: 1e20 },
      ]),
    );
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje: 'Cotiza 2,5 Molco' });
    expect(r.cotizacion.solicitudes.map((s) => s.cantidad)).toEqual([null, null]);
    expect(r.avisos?.join(' ')).toMatch(/2,5.*no es válida/);
    expect(r.cotizacion.incompletos).toHaveLength(2);
    expect((await almacen.leer()).cotizaciones).toHaveLength(1);
    expect(almacen.listar().total).toBe(1);
  });

  it('una fila dañada no derriba el resto: se repara o se omite y se registra', async () => {
    const { servicio, almacen, conPedido, dir } = await setup();
    const sana = await conPedido();
    const reparable = await conPedido();
    const rota = await conPedido();
    const db = abrirBaseDatos(join(dir, 'cotizador.sqlite'));
    db.prepare('UPDATE solicitudes SET cantidad = 2.5 WHERE cotizacion_id = ?').run(reparable.id);
    db.prepare('DELETE FROM cotizacion_montos WHERE cotizacion_id = ?').run(rota.id);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const estado = await almacen.leer();
    expect(estado.cotizaciones.map((q) => q.id).sort()).toEqual([sana.id, reparable.id].sort());
    expect(almacen.obtener(reparable.id)!.solicitudes[0].cantidad).toBeNull();
    expect(() => almacen.obtener(rota.id)).toThrow('dañados');
    expect(almacen.listar().total).toBe(3);
    // Las demás cotizaciones siguen operables.
    const r = await servicio.ejecutar({ tipo: 'emitir', id: sana.id, actualizada: sana.actualizada });
    expect(r.cotizacion.numero).toBe(323);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('M1, M2 y B3', () => {
  it('M1: si la IA falla no queda un borrador huérfano', async () => {
    const { servicio, llm, almacen } = await setup();
    llm.interpretar.mockRejectedValueOnce(new ErrorIA('ia_timeout', 'Plazo vencido.', 504));
    await expect(servicio.ejecutar({ tipo: 'chat', mensaje: 'Cotiza' })).rejects.toThrow('Plazo');
    expect((await almacen.leer()).cotizaciones).toHaveLength(0);
  });

  it('M2: quitar, emitir, aprobar y editar exigen la versión vigente (409)', async () => {
    const { servicio, conPedido, emitir } = await setup();
    const q = await conPedido([molco, marco]);
    const vieja = '2020-01-01T00:00:00.000Z';
    for (const accion of [
      { tipo: 'quitar' as const, id: q.id, actualizada: vieja, indice: 0 },
      { tipo: 'emitir' as const, id: q.id, actualizada: vieja },
      { tipo: 'editar' as const, id: q.id, actualizada: vieja, descuento: 5 },
      { tipo: 'eliminar' as const, id: q.id, actualizada: vieja },
    ])
      await expect(servicio.ejecutar(accion)).rejects.toMatchObject({
        status: 409,
        codigo: 'version_obsoleta',
      });
    await expect(
      servicio.ejecutar({ tipo: 'chat', id: q.id, actualizada: vieja, mensaje: 'hola' }),
    ).rejects.toMatchObject({
      status: 409,
    });
    const e = (await emitir(q)).cotizacion;
    await expect(servicio.ejecutar({ tipo: 'aprobar', id: e.id, actualizada: vieja })).rejects.toMatchObject({
      status: 409,
      codigo: 'version_obsoleta',
    });
    await expect(
      servicio.ejecutar({ tipo: 'emitir', id: 'no-existe', actualizada: vieja }),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('B3: responder o no entender sobre una emitida no cambia su versión', async () => {
    const { servicio, llm, emitida } = await setup();
    const e = await emitida();
    llm.interpretar.mockResolvedValueOnce({ name: 'responder', input: { texto: '¿Qué necesitas?' } });
    const r1 = (
      await servicio.ejecutar({ tipo: 'chat', id: e.id, actualizada: e.actualizada, mensaje: 'hola' })
    ).cotizacion;
    llm.interpretar.mockResolvedValueOnce(null);
    const r2 = (
      await servicio.ejecutar({ tipo: 'chat', id: e.id, actualizada: e.actualizada, mensaje: '???' })
    ).cotizacion;
    expect(r1.actualizada).toBe(e.actualizada);
    expect(r2.actualizada).toBe(e.actualizada);
    expect(r2.historial.map((m) => m.texto)).toEqual(
      expect.arrayContaining(['¿Qué necesitas?', 'No entendí, ¿puedes reformularlo?']),
    );
  });
});

describe('M3: emisión con precios vigentes', () => {
  it('recalcula al emitir y avisa los precios que cambiaron', async () => {
    const catalogo = catalogoBase();
    const { servicio, conPedido } = await setup(catalogo);
    const q = await conPedido();
    expect(q.montos.lineas[0].precioUnitario).toBe(126);
    catalogo.productos[0].precioNeto = 200;
    const r = await servicio.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada });
    expect(r.cotizacion.montos.lineas[0].precioUnitario).toBe(250);
    expect(r.avisos?.join(' ')).toMatch(/\$126 a \$250/);
    expect(r.cotizacion.versionCatalogo).toBe('test:2026-01-01');
  });
});

describe('M4: cambios reales y revisiones únicas', () => {
  it('«pino» frente a «PINO OREGON» y 80 frente a 0,8 no crean una revisión', async () => {
    const { servicio, llm, almacen, emitida } = await setup();
    const e = await emitida([{ ...molco, ancho: 0.8 }]);
    llm.interpretar.mockResolvedValueOnce(actualizar([{ ...molco, madera: 'pino', ancho: 80, alto: 200 }]));
    const r = await servicio.ejecutar({
      tipo: 'chat',
      id: e.id,
      actualizada: e.actualizada,
      mensaje: 'igual',
    });
    expect(r.cotizacion.id).toBe(e.id);
    expect(r.cotizacion.historial.at(-1)?.texto).toContain('No hay cambios');
    expect((await almacen.leer()).cotizaciones).toHaveLength(1);
  });

  it('un segundo cambio sobre la emitida reutiliza la revisión abierta', async () => {
    const { servicio, llm, almacen, emitida } = await setup();
    const e = await emitida();
    llm.interpretar.mockResolvedValueOnce(actualizar([{ ...molco, cantidad: 4 }]));
    const r1 = (await servicio.ejecutar({ tipo: 'chat', id: e.id, actualizada: e.actualizada, mensaje: '4' }))
      .cotizacion;
    llm.interpretar.mockResolvedValueOnce(actualizar([{ ...molco, cantidad: 5 }]));
    const r2 = (await servicio.ejecutar({ tipo: 'chat', id: e.id, actualizada: e.actualizada, mensaje: '5' }))
      .cotizacion;
    expect(r2.id).toBe(r1.id);
    expect(r2.solicitudes[0].cantidad).toBe(5);
    // El modelo recibió la revisión, no la emitida.
    expect(llm.interpretar.mock.calls.at(-1)![0].borrador.items[0].cantidad).toBe(4);
    expect((await almacen.leer()).cotizaciones.filter((q) => q.origen === e.numero)).toHaveLength(1);
  });

  it('dos chats concurrentes sobre la misma emitida no crean dos revisiones', async () => {
    const { servicio, llm, almacen, emitida } = await setup();
    const e = await emitida();
    let soltar!: () => void;
    const espera = new Promise<void>((r) => (soltar = r));
    llm.interpretar.mockImplementationOnce(async () => {
      await espera;
      return actualizar([{ ...molco, cantidad: 7 }]);
    });
    llm.interpretar.mockResolvedValueOnce(actualizar([{ ...molco, cantidad: 6 }]));
    const lenta = servicio.ejecutar({ tipo: 'chat', id: e.id, actualizada: e.actualizada, mensaje: '7' });
    await new Promise((r) => setTimeout(r, 50));
    const rapida = await servicio.ejecutar({
      tipo: 'chat',
      id: e.id,
      actualizada: e.actualizada,
      mensaje: '6',
    });
    soltar();
    await expect(lenta).rejects.toMatchObject({
      codigo: 'revision_abierta',
      detalle: { id: rapida.cotizacion.id },
    });
    expect((await almacen.leer()).cotizaciones.filter((q) => q.origen === e.numero)).toHaveLength(1);
  });
});

describe('A2: una sola aprobación por serie', () => {
  it('emitir una revisión reemplaza a la original y aprobar bloquea a las hermanas', async () => {
    const { servicio, llm, almacen, emitida, dir } = await setup();
    const original = await emitida();
    llm.interpretar.mockResolvedValueOnce(actualizar([{ ...molco, cantidad: 4 }]));
    const revision = (
      await servicio.ejecutar({
        tipo: 'chat',
        id: original.id,
        actualizada: original.actualizada,
        mensaje: '4',
      })
    ).cotizacion;
    const emitidaRevision = (
      await servicio.ejecutar({ tipo: 'emitir', id: revision.id, actualizada: revision.actualizada })
    ).cotizacion;
    const o = almacen.obtener(original.id)!;
    expect([o.estado, o.reemplazadaPor]).toEqual(['reemplazada', emitidaRevision.numero]);
    await expect(
      servicio.ejecutar({ tipo: 'aprobar', id: o.id, actualizada: o.actualizada }),
    ).rejects.toThrow('reemplazada');
    await expect(servicio.ejecutar({ tipo: 'chat', id: o.id, mensaje: 'cambia' })).rejects.toMatchObject({
      codigo: 'no_editable',
    });

    // Datos anteriores: dos revisiones emitidas de la misma original, ambas aprobables.
    const db = abrirBaseDatos(join(dir, 'cotizador.sqlite'));
    const otra = {
      ...structuredClone(emitidaRevision),
      id: '00000000-0000-4000-8000-000000000001',
      numero: 999,
      pdf: 'cotizacion-999.pdf',
    };
    await almacen.transaccion((u) => u.guardar(otra));
    db.prepare('UPDATE cotizaciones SET origen_id = ? WHERE id = ?').run(original.id, otra.id);
    const aprobada = await servicio.ejecutar({
      tipo: 'aprobar',
      id: emitidaRevision.id,
      actualizada: emitidaRevision.actualizada,
    });
    expect(aprobada.cotizacion.estado).toBe('aprobada');
    const hermana = almacen.obtener(otra.id)!;
    expect(hermana.estado).toBe('reemplazada');
    await expect(
      servicio.ejecutar({ tipo: 'aprobar', id: hermana.id, actualizada: hermana.actualizada }),
    ).rejects.toThrow();
  });
});

describe('A3: medidas pedidas en las líneas', () => {
  it('guarda ancho, alto y medida pedidos en la cotización y en la nota', async () => {
    const { servicio, emitida } = await setup();
    const e = await emitida([molco, marco]);
    expect(
      e.montos.lineas.map((l) => [l.indice, l.anchoSolicitado, l.altoSolicitado, l.medidaSolicitada]),
    ).toEqual([
      [0, 0.82, 2, null],
      [1, null, 2.1, '2X4'],
    ]);
    const a = (await servicio.ejecutar({ tipo: 'aprobar', id: e.id, actualizada: e.actualizada })).cotizacion;
    expect(a.nota!.montos.lineas[0].anchoSolicitado).toBe(0.82);
    expect(vi.mocked(plantilla).mock.calls.at(-1)![1].montos.lineas[1].medidaSolicitada).toBe('2X4');
  });
});

describe('Nuevas acciones', () => {
  it('autoría, vigencia, despacho y anulación con nota', async () => {
    const { servicio, emitida } = await setup();
    const e = await emitida([molco], { ...clienteVacio(), nombre: 'Juan', giro: 'Construcción' });
    expect(e.creadaPor).toBe('Paula');
    expect(e.emitidaPor).toBe('Paula');
    expect(e.vence).toBe(calcularVence(e.fechaEmision!));
    expect(e.cliente.giro).toBe('Construcción');
    const a = (
      await servicio.ejecutar({
        tipo: 'aprobar',
        id: e.id,
        actualizada: e.actualizada,
        despacho: { direccion: '  Los Carrera #450 ', transporte: 'Camión propio' },
      })
    ).cotizacion;
    expect(a.aprobadaPor).toBe('Paula');
    expect(a.nota!.despacho).toEqual({ direccion: 'Los Carrera #450', transporte: 'Camión propio' });
    expect(vi.mocked(plantilla).mock.calls.at(-1)![1]).toMatchObject({ tipo: 'nota', autor: 'Paula' });
    const anulada = (
      await servicio.ejecutar({
        tipo: 'anular',
        id: a.id,
        actualizada: a.actualizada,
        motivo: 'Cliente desistió',
      })
    ).cotizacion;
    expect([anulada.estado, anulada.anuladaPor, anulada.motivoAnulacion, anulada.nota!.anulada]).toEqual([
      'anulada',
      'Paula',
      'Cliente desistió',
      true,
    ]);
    await expect(
      servicio.ejecutar({ tipo: 'editar', id: a.id, actualizada: anulada.actualizada, descuento: 5 }),
    ).rejects.toMatchObject({ codigo: 'no_editable' });
  });

  it('aprobar una vencida exige confirmarVencida', async () => {
    const { servicio, emitida, dir, almacen } = await setup();
    const e = await emitida();
    abrirBaseDatos(join(dir, 'cotizador.sqlite'))
      .prepare('UPDATE cotizaciones SET vence = ? WHERE id = ?')
      .run('2020-01-10', e.id);
    await expect(
      servicio.ejecutar({ tipo: 'aprobar', id: e.id, actualizada: e.actualizada }),
    ).rejects.toMatchObject({
      status: 409,
      codigo: 'cotizacion_vencida',
    });
    expect(almacen.correlativos().siguienteNota).toBe(1);
    expect(almacen.listar().cotizaciones[0].vencida).toBe(true);
    const r = await servicio.ejecutar({
      tipo: 'aprobar',
      id: e.id,
      actualizada: e.actualizada,
      confirmarVencida: true,
    });
    expect(r.cotizacion.estado).toBe('aprobada');
  });

  it('duplicar copia pedido y cliente; eliminar solo borra borradores sin número', async () => {
    const { servicio, emitida, almacen, conPedido } = await setup();
    const e = await emitida([molco], { ...clienteVacio(), nombre: 'Juan' });
    const d = (await servicio.ejecutar({ tipo: 'duplicar', id: e.id })).cotizacion;
    expect([d.estado, d.numero, d.origen ?? null, d.cliente.nombre]).toEqual([
      'borrador',
      null,
      null,
      'Juan',
    ]);
    expect(d.solicitudes).toEqual(e.solicitudes);
    expect(d.historial).toEqual([{ rol: 'asistente', texto: `Duplicada de N° ${e.numero}.` }]);
    await expect(
      servicio.ejecutar({ tipo: 'eliminar', id: e.id, actualizada: e.actualizada }),
    ).rejects.toMatchObject({
      codigo: 'estado_invalido',
    });
    const b = await conPedido();
    const r = await servicio.ejecutar({ tipo: 'eliminar', id: b.id, actualizada: b.actualizada });
    expect(r.eliminada).toBe(true);
    expect(almacen.obtener(b.id)).toBeNull();
  });

  it('editar aplica descuento y flete solo a la cotización y normaliza el RUT', async () => {
    const { servicio, conPedido, emitir } = await setup();
    const q = await conPedido();
    const r = await servicio.ejecutar({
      tipo: 'editar',
      id: q.id,
      actualizada: q.actualizada,
      descuento: 10,
      flete: 5000,
      cliente: { rut: '12345678-5', giro: '  Constructora ' },
      cantidades: [{ indice: 0, cantidad: 4 }],
    });
    const m = r.cotizacion.montos;
    expect([m.subtotal, m.descuento, m.flete, m.neto]).toEqual([504, 50, 5000, 5454]);
    expect(m.total).toBe(5454 + Math.round(5454 * 0.19));
    expect(r.cotizacion.cliente).toMatchObject({ rut: '12.345.678-5', giro: 'Constructora' });
    expect(r.cambios?.modificados).toHaveLength(1);
    expect(r.cambios?.cliente).toEqual(['rut', 'giro']);
    const invalido = await servicio.ejecutar({
      tipo: 'editar',
      id: q.id,
      actualizada: r.cotizacion.actualizada,
      cliente: { rut: '12345678-9' },
    });
    expect(invalido.cotizacion.cliente.rut).toBe('12345678-9');
    expect(invalido.avisos?.[0]).toMatch(/dígito verificador/);
    const e = (await emitir(invalido.cotizacion)).cotizacion;
    const a = (await servicio.ejecutar({ tipo: 'aprobar', id: e.id, actualizada: e.actualizada })).cotizacion;
    expect(a.nota!.montos).toMatchObject({ descuento: 0, flete: 0, neto: 400, subtotal: 400 });
  });

  it('editar una emitida crea la revisión; sin cambios no crea nada', async () => {
    const { servicio, emitida, almacen } = await setup();
    const e = await emitida();
    const igual = await servicio.ejecutar({
      tipo: 'editar',
      id: e.id,
      actualizada: e.actualizada,
      descuento: 0,
    });
    expect(igual.cotizacion.id).toBe(e.id);
    const r = await servicio.ejecutar({ tipo: 'editar', id: e.id, actualizada: e.actualizada, flete: 1000 });
    expect([r.cotizacion.origen, r.cotizacion.estado, r.cotizacion.flete]).toEqual([
      e.numero,
      'borrador',
      1000,
    ]);
    expect(almacen.obtener(e.id)!.flete).toBe(0);
  });

  it('el chat conserva el giro si el modelo lo omite y resume los ítems quitados', async () => {
    const { servicio, llm, conPedido } = await setup();
    const q = await conPedido([molco, marco], { ...clienteVacio(), giro: 'Ferretería' });
    const { giro: _omitido, ...sinGiro } = { ...clienteVacio(), giro: null };
    void _omitido;
    llm.interpretar.mockResolvedValueOnce(actualizar([molco], sinGiro));
    const r = await servicio.ejecutar({
      tipo: 'chat',
      id: q.id,
      actualizada: q.actualizada,
      mensaje: 'quita el marco',
    });
    expect(r.cotizacion.cliente.giro).toBe('Ferretería');
    expect(r.cambios?.quitados.map((i) => i.indice)).toEqual([1]);
    expect(r.cambios?.quitados[0].descripcion).toContain('MARCO');
  });

  it('la aprobación pedida por chat informa vencimiento y versión', async () => {
    const { servicio, llm, emitida, conPedido } = await setup();
    const e = await emitida();
    const otra = await conPedido();
    llm.interpretar.mockResolvedValueOnce({ name: 'aprobar_cotizacion', input: { numero: e.numero } });
    const r: Resultado = await servicio.ejecutar({
      tipo: 'chat',
      id: otra.id,
      actualizada: otra.actualizada,
      mensaje: 'se aprobó la 323',
    });
    expect(r.confirmar).toEqual({
      id: e.id,
      numero: e.numero,
      actualizada: e.actualizada,
      vence: e.vence,
      vencida: false,
    });
  });
});

describe('Listado y búsqueda', () => {
  it('pagina resúmenes sin historial y busca por N°, cliente, RUT, comuna, proyecto y producto', async () => {
    const { almacen, emitida, conPedido } = await setup();
    await emitida([molco], {
      ...clienteVacio(),
      nombre: 'María José',
      rut: '12.345.678-5',
      comuna: 'Temuco',
    });
    await conPedido([marco], { ...clienteVacio(), nombre: 'Pedro Soto', proyecto: 'Casa Norte' });
    await conPedido([molco], { ...clienteVacio(), nombre: 'Ana' });
    const todo = almacen.listar();
    expect(todo.total).toBe(3);
    expect(todo.cotizaciones[0].cliente.nombre).toBe('Ana');
    expect(Object.keys(todo.cotizaciones[0])).not.toContain('historial');
    const nombres = (q: string, extra = {}) =>
      almacen.listar({ q, ...extra }).cotizaciones.map((c) => c.cliente.nombre);
    expect(nombres('maria jose')).toEqual(['María José']);
    expect(nombres('323')).toEqual(['María José']);
    expect(nombres('12345678')).toEqual(['María José']);
    expect(nombres('temuco')).toEqual(['María José']);
    expect(nombres('casa norte')).toEqual(['Pedro Soto']);
    expect(nombres('marco')).toEqual(['Pedro Soto']);
    expect(nombres('pino oregon molco').sort()).toEqual(['Ana', 'María José']);
    expect(nombres('', { estados: ['emitida'] })).toEqual(['María José']);
    expect(almacen.listar({ porPagina: 2, pagina: 2 }).cotizaciones).toHaveLength(1);
    expect(almacen.listar({ desde: '2099-01-01' }).total).toBe(0);
    const hoy = new Date().toISOString().slice(0, 10);
    expect(almacen.listar({ desde: sumarDiasHabiles(hoy, 0), hasta: sumarDiasHabiles(hoy, 1) }).total).toBe(
      3,
    );
    expect(todo.cotizaciones.find((c) => c.numero === 323)?.productos).toContain('3 × MOLCO');
  });
});

describe('Resolver, correlativo y RUT', () => {
  it('B5: el correlativo inicial sale de una sola constante', async () => {
    const { almacen } = await setup();
    expect(almacen.correlativos()).toEqual({ siguienteCotizacion: CORRELATIVO_COTIZACION, siguienteNota: 1 });
  });

  it('M6: rangos superpuestos piden elegir; B2: medidas implausibles se preguntan', () => {
    const catalogo = catalogoBase();
    catalogo.productos.push(
      producto({ codigo: 'IA-X', anchoMin: 0.84, anchoMax: 0.9, medida: '0,84 A 0,90' }),
    );
    const r = resolverItem(catalogo, { ...molco, ancho: 0.845 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rechazo.tipo).toBe('producto_ambiguo');
    expect(resolverItem(catalogo, { ...molco, ancho: 0.82 }).ok).toBe(true);
    for (const ancho of [5, 8000, 0.1]) {
      const i = resolverItem(catalogo, { ...molco, ancho });
      expect(i.ok ? null : i.rechazo.tipo).toBe('medida_implausible');
    }
    const mm = resolverItem(catalogo, { ...molco, ancho: 820, alto: 2000 });
    expect(mm.ok && [mm.anchoSolicitado, mm.altoSolicitado]).toEqual([0.82, 2]);
  });

  it('normaliza RUT con dígito verificador', () => {
    expect(normalizarRut('12345678-5')).toBe('12.345.678-5');
    expect(normalizarRut('12.345.678-5')).toBe('12.345.678-5');
    expect(normalizarRut('7.654.321-6')).toBe('7.654.321-6');
    expect(normalizarRut('11.111.111-k')).toBeNull();
    expect(normalizarRut('12345678-9')).toBeNull();
    expect(normalizarRut('abc')).toBeNull();
  });
});

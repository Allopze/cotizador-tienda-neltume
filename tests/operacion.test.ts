import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Catalogo, Producto, SolicitudItem } from '../src/catalogo/tipos';
import { clienteVacio } from '../src/catalogo/tipos';
import {
  anticipoMinimo,
  despachoEditable,
  etiquetaComercial,
  etiquetaEvento,
  etiquetaFacturacion,
  etiquetaOperativo,
  pagoAnulable,
  sinTransportista,
  type Cotizacion,
  type EstadoOperativo,
} from '../src/negocio/estado';
import { pesos } from '../src/negocio/precios';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';
import { plantilla } from '../src/servidor/pdf';
import { estadoPago } from '../src/app/formato';

vi.mock('../src/servidor/pdf', () => ({
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const molco: Producto = {
  codigo: 'MOL-O-3-A',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100_000,
  descripcion: 'MOLCO',
  filaOrigen: 4,
};
const catalogo: Catalogo = { fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos: [molco] };
const pedido: SolicitudItem = {
  modelo: 'MOLCO',
  madera: 'PINO OREGON',
  ancho: 0.82,
  alto: 2,
  medida: null,
  cantidad: 2,
};
const usuario = { nombre: 'Paula', email: 'paula@neltume.cl' };
const dirs: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-operacion-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const llm = {
    interpretar: vi.fn().mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { items: [pedido], cliente: { ...clienteVacio(), nombre: 'Ana Soto' } },
    }),
  };
  const servicio = new Servicio(catalogo, llm, almacen, usuario);
  // Cada paso devuelve la cotización vigente: la versión cambia con cada acción.
  let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza MOLCO' })).cotizacion;
  const ir = async (accion: Record<string, unknown>) => {
    q = (await servicio.ejecutar({ ...accion, id: q.id, actualizada: q.actualizada } as never)).cotizacion;
    return q;
  };
  const intentar = (accion: Record<string, unknown>) =>
    servicio.ejecutar({ ...accion, id: q.id, actualizada: q.actualizada } as never);
  const emitida = async () => ir({ tipo: 'emitir' });
  const aprobada = async () => {
    await emitida();
    return ir({ tipo: 'aprobar' });
  };
  const mitad = () => Math.ceil(q.montos.total * 0.5);
  const pagar = (monto: number, fecha = '2026-09-30', observacion?: string) =>
    ir({ tipo: 'pago', monto, fecha, ...(observacion ? { observacion } : {}) });
  /** Los pagos se releen ordenados por fecha e id: con la misma fecha el orden no es el de registro, se busca por monto. */
  const pagoDe = (monto: number) => q.pagos!.find((p) => p.monto === monto)!.id;
  const eventos = () => almacen.eventos(q.id);
  const ultimo = (tipo: string) => eventos().filter((e) => e.tipo === tipo).at(-1);
  /** Aprobada con el 50 % pagado y la nota de pedido generada. */
  const conNota = async () => {
    await aprobada();
    await pagar(mitad());
    return ir({ tipo: 'generar_nota' });
  };
  const operar = (paso: string, extra: Record<string, unknown> = {}) => ir({ tipo: 'operacion', paso, ...extra });
  /** Con nota, saldo pagado, producción terminada y lista para despacho. */
  const listaParaDespacho = async () => {
    await conNota();
    await pagar(q.montos.total - mitad());
    await operar('iniciar_produccion');
    await operar('produccion_terminada');
    return operar('lista_despacho');
  };
  return {
    dir, almacen, servicio, ir, intentar, emitida, aprobada, mitad, pagar, pagoDe, eventos, ultimo, conNota, operar,
    listaParaDespacho, actual: () => q, recargada: () => new Almacen(dir).obtener(q.id)!,
  };
}

describe('pagos: solo después de la aprobación del cliente', () => {
  it('rechaza el pago de una cotización emitida y no toca su estado', async () => {
    const t = await setup();
    await t.emitida();
    await expect(t.intentar({ tipo: 'pago', monto: t.mitad() })).rejects.toThrow(/aprobación del cliente/);
    expect(t.actual().pagos).toEqual([]);
    expect(t.recargada()).toMatchObject({ estadoOperativo: 'sin_pedido', pagos: [] });
    expect(t.eventos().map((e) => e.tipo)).not.toContain('pago_registrado');
  });

  it('rechaza el pago de un borrador y el de una anulada', async () => {
    const t = await setup();
    await expect(t.intentar({ tipo: 'pago', monto: 1000 })).rejects.toThrow(/aprobación del cliente/);
    await t.aprobada();
    await t.ir({ tipo: 'anular' });
    await expect(t.intentar({ tipo: 'pago', monto: 1000 })).rejects.toThrow(/anulada/);
  });

  it('tras aprobar, el 50 % deja el anticipo pagado y menos no cambia el estado', async () => {
    const t = await setup();
    await t.aprobada();
    await t.pagar(t.mitad() - 1);
    expect(t.actual().estadoOperativo).toBe('sin_pedido');
    await t.pagar(1);
    expect(t.actual().estadoOperativo).toBe('anticipo_pagado');
    await expect(t.intentar({ tipo: 'pago', monto: 1, fecha: '2026-02-31' })).rejects.toThrow(/fecha del pago/);
  });

  it('sin fecha el pago queda con la de hoy', async () => {
    const t = await setup();
    await t.aprobada();
    await t.ir({ tipo: 'pago', monto: 1000 });
    expect(t.recargada().pagos![0].fecha.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe('anular un pago', () => {
  it('quita el pago del saldo, vuelve a «sin nota de pedido» y registra monto, fecha y motivo', async () => {
    const t = await setup();
    await t.aprobada();
    await t.pagar(t.mitad(), '2026-09-28');
    expect(t.actual().estadoOperativo).toBe('anticipo_pagado');
    const pago = t.actual().pagos![0];
    await t.ir({ tipo: 'anular_pago', pagoId: pago.id, motivo: '  Monto mal   ingresado ' });
    const q = t.recargada();
    expect(q.pagos).toEqual([]);
    expect(q.estadoOperativo).toBe('sin_pedido');
    const evento = t.ultimo('pago_anulado')!;
    expect(evento.usuario).toBe('Paula');
    expect(evento.detalle).toBe(
      `${pesos(pago.monto)} · 2026-09-28 · Motivo: Monto mal ingresado · ${etiquetaOperativo.anticipo_pagado} → ${etiquetaOperativo.sin_pedido}`,
    );
    // Sin el 50 % la nota de pedido vuelve a estar bloqueada y se puede volver a registrar el pago.
    await expect(t.intentar({ tipo: 'generar_nota' })).rejects.toThrow(/50 %/);
    await t.pagar(t.mitad());
    expect(t.actual()).toMatchObject({ estadoOperativo: 'anticipo_pagado' });
    expect(t.actual().pagos).toHaveLength(1);
  });

  it('un pago parcial anulado no cambia el estado y el motivo es opcional', async () => {
    const t = await setup();
    await t.aprobada();
    await t.pagar(1000);
    await t.pagar(t.mitad());
    await t.ir({ tipo: 'anular_pago', pagoId: t.pagoDe(1000) });
    expect(t.actual()).toMatchObject({ estadoOperativo: 'anticipo_pagado' });
    expect(t.ultimo('pago_anulado')!.detalle).toBe(`${pesos(1000)} · 2026-09-30`);
  });

  it('después de producir, pagada vuelve a saldo pendiente y de nuevo a pagada al repagar', async () => {
    const t = await setup();
    await t.conNota();
    await t.pagar(t.actual().montos.total - t.mitad());
    await t.operar('iniciar_produccion');
    await t.operar('produccion_terminada');
    expect(t.actual().estadoOperativo).toBe('pagada');
    await t.ir({ tipo: 'anular_pago', pagoId: t.pagoDe(t.actual().montos.total - t.mitad()), motivo: 'Transferencia rebotada' });
    expect(t.actual()).toMatchObject({ estadoOperativo: 'saldo_pendiente' });
    expect(t.ultimo('pago_anulado')!.detalle).toContain(
      `${etiquetaOperativo.pagada} → ${etiquetaOperativo.saldo_pendiente}`,
    );
    // Sin el saldo pagado no se puede dejar lista para despacho.
    await expect(t.intentar({ tipo: 'operacion', paso: 'lista_despacho' })).rejects.toThrow(/no está disponible/);
    await t.pagar(t.actual().montos.total - t.mitad());
    expect(t.actual().estadoOperativo).toBe('pagada');
    await t.operar('lista_despacho');
  });

  it('con la nota ya generada, anular el anticipo no deshace el pedido', async () => {
    const t = await setup();
    await t.conNota();
    await t.ir({ tipo: 'anular_pago', pagoId: t.actual().pagos![0].id });
    expect(t.actual()).toMatchObject({ estadoOperativo: 'pedido_generado', pagos: [] });
  });

  it('el detalle conserva la observación original del pago', async () => {
    const t = await setup();
    await t.aprobada();
    await t.pagar(1000, '2026-09-28', 'Transferencia  BCI');
    await t.ir({ tipo: 'anular_pago', pagoId: t.actual().pagos![0].id, motivo: 'Duplicado' });
    expect(t.ultimo('pago_anulado')!.detalle).toBe(`${pesos(1000)} · 2026-09-28 · Transferencia BCI · Motivo: Duplicado`);
  });

  it('anular devuelve el monto al saldo: un pago mayor sigue rechazado y el exacto entra', async () => {
    const t = await setup();
    await t.aprobada();
    const total = t.actual().montos.total;
    await t.pagar(total);
    await expect(t.intentar({ tipo: 'pago', monto: 1 })).rejects.toThrow(/supera el saldo pendiente de \$0/);
    await t.ir({ tipo: 'anular_pago', pagoId: t.actual().pagos![0].id });
    expect(t.actual()).toMatchObject({ pagos: [], estadoOperativo: 'sin_pedido' });
    await expect(t.intentar({ tipo: 'pago', monto: total + 1 })).rejects.toThrow(/supera el saldo pendiente/);
    await t.pagar(total);
    expect(t.recargada().pagos).toHaveLength(1);
    expect(t.actual().estadoOperativo).toBe('anticipo_pagado');
  });

  it('se puede anular en producción: el estado sigue y queda registrado', async () => {
    const t = await setup();
    await t.conNota();
    await t.pagar(1000);
    await t.operar('iniciar_produccion');
    await t.ir({ tipo: 'anular_pago', pagoId: t.pagoDe(1000) });
    expect(t.actual()).toMatchObject({ estadoOperativo: 'en_produccion' });
    expect(t.actual().pagos).toHaveLength(1);
    expect(t.ultimo('pago_anulado')!.detalle).toBe(`${pesos(1000)} · 2026-09-30`);
  });

  it('con saldo pendiente anular un pago mantiene el estado y pagar el saldo lo deja en «pagada»', async () => {
    const t = await setup();
    await t.conNota();
    await t.pagar(1000);
    await t.operar('iniciar_produccion');
    await t.operar('produccion_terminada');
    expect(t.actual().estadoOperativo).toBe('saldo_pendiente');
    await t.ir({ tipo: 'anular_pago', pagoId: t.pagoDe(1000) });
    expect(t.actual().estadoOperativo).toBe('saldo_pendiente');
    expect(t.ultimo('pago_anulado')!.detalle).not.toContain('→');
    // Un pago que no cubre el saldo lo deja igual; el que lo completa pasa a «pagada».
    await t.pagar(1000);
    expect(t.actual().estadoOperativo).toBe('saldo_pendiente');
    await t.pagar(t.actual().montos.total - t.mitad() - 1000);
    expect(t.recargada().estadoOperativo).toBe('pagada');
    await t.operar('lista_despacho');
  });

  it('no se puede desde «lista para despacho» ni en una cotización sin aprobar, y exige un pago existente', async () => {
    const t = await setup();
    await t.emitida();
    await expect(t.intentar({ tipo: 'anular_pago', pagoId: 'x' })).rejects.toThrow(/aprobación del cliente/);
    await t.ir({ tipo: 'aprobar' });
    await expect(t.intentar({ tipo: 'anular_pago', pagoId: 'no-existe' })).rejects.toThrow('No se encontró el pago.');
    await t.pagar(t.mitad());
    const { id } = t.actual().pagos![0];
    await expect(
      t.servicio.ejecutar({ tipo: 'anular_pago', id: t.actual().id, actualizada: '2020-01-01T00:00:00.000Z', pagoId: id }),
    ).rejects.toThrow(/cambió desde que la abriste/);
    await t.ir({ tipo: 'generar_nota' });
    await t.pagar(t.actual().montos.total - t.mitad());
    await t.operar('iniciar_produccion');
    await t.operar('produccion_terminada');
    await t.operar('lista_despacho');
    expect(pagoAnulable(t.actual())).toBe(false);
    await expect(t.intentar({ tipo: 'anular_pago', pagoId: id })).rejects.toThrow(/Lista para despacho/);
    expect(t.recargada().pagos).toHaveLength(2);
  });
});

describe('producción y anticipo', () => {
  it('iniciar y terminar la producción exigen al menos 50 % pagado, también tras anular un pago', async () => {
    const t = await setup();
    await t.conNota();
    await t.ir({ tipo: 'anular_pago', pagoId: t.actual().pagos![0].id });
    expect(t.actual()).toMatchObject({ estadoOperativo: 'pedido_generado', pagos: [] });
    await expect(t.intentar({ tipo: 'operacion', paso: 'iniciar_produccion' })).rejects.toThrow(
      /al menos 50 % pagado/,
    );
    expect(t.recargada().estadoOperativo).toBe('pedido_generado');
    expect(t.eventos().map((e) => e.tipo)).not.toContain('produccion');
    // Menos del anticipo no alcanza; completarlo habilita la producción.
    await t.pagar(t.mitad() - 1);
    await expect(t.intentar({ tipo: 'operacion', paso: 'iniciar_produccion' })).rejects.toThrow(/al menos 50 %/);
    await t.pagar(1);
    await t.operar('iniciar_produccion');
    // Ya en producción, anular el anticipo frena el cierre de la producción hasta volver a registrarlo.
    await t.ir({ tipo: 'anular_pago', pagoId: t.pagoDe(t.mitad() - 1) });
    expect(t.actual()).toMatchObject({ estadoOperativo: 'en_produccion' });
    await expect(t.intentar({ tipo: 'operacion', paso: 'produccion_terminada' })).rejects.toThrow(/al menos 50 %/);
    expect(t.recargada().estadoOperativo).toBe('en_produccion');
    await t.pagar(1);
    await expect(t.intentar({ tipo: 'operacion', paso: 'produccion_terminada' })).rejects.toThrow(/al menos 50 %/);
    await t.pagar(t.mitad() - 2);
    await t.operar('produccion_terminada');
    expect(t.actual().estadoOperativo).toBe('saldo_pendiente');
  });

  it('el umbral es el mismo de la nota de pedido', () => {
    expect(anticipoMinimo(1000)).toBe(500);
    expect(anticipoMinimo(1001)).toBe(501);
  });
});

describe('versiones obsoletas y cotizaciones sin aprobar', () => {
  it('despacho, facturación, operación y pagos rechazan una versión obsoleta', async () => {
    const t = await setup();
    await t.conNota();
    const pagoId = t.actual().pagos![0].id;
    const { id } = t.actual();
    for (const accion of [
      { tipo: 'despacho', despacho: { destino: 'Osorno' } },
      { tipo: 'facturacion', estado: 'pendiente' },
      { tipo: 'operacion', paso: 'iniciar_produccion' },
      { tipo: 'pago', monto: 1000 },
      { tipo: 'anular_pago', pagoId },
    ])
      await expect(
        t.servicio.ejecutar({ ...accion, id, actualizada: '2020-01-01T00:00:00.000Z' } as never),
      ).rejects.toThrow(/cambió desde que la abriste/);
    expect(t.recargada()).toMatchObject({ estadoOperativo: 'pedido_generado' });
    expect(t.recargada().despacho?.destino ?? null).toBeNull();
  });

  it('los pasos de operación exigen la aprobación del cliente', async () => {
    const t = await setup();
    for (const paso of ['iniciar_produccion', 'produccion_terminada', 'lista_despacho', 'despachada', 'completada'])
      await expect(t.intentar({ tipo: 'operacion', paso })).rejects.toThrow(/aprobación del cliente/);
    await t.emitida();
    for (const paso of ['iniciar_produccion', 'lista_despacho', 'despachada'])
      await expect(t.intentar({ tipo: 'operacion', paso, despacho: { transporte: 'Starken' } })).rejects.toThrow(
        /aprobación del cliente/,
      );
    expect(t.recargada().estadoOperativo).toBe('sin_pedido');
    expect(t.recargada().despacho ?? null).toBeNull();
  });
});

describe('despacho después de la aprobación', () => {
  it('los datos logísticos se editan con la cotización aprobada y quedan en la actividad', async () => {
    const t = await setup();
    await t.aprobada();
    expect(despachoEditable(t.actual())).toBe(true);
    await t.ir({
      tipo: 'despacho',
      despacho: { transporte: ' Starken ', destino: 'Osorno', direccion: 'Los  Carrera 450', entregaComprometida: 'Semana 42' },
    });
    expect(t.recargada().despacho).toMatchObject({
      transporte: 'Starken',
      destino: 'Osorno',
      direccion: 'Los Carrera 450',
      entregaComprometida: 'Semana 42',
      valor: 0,
    });
    const evento = t.ultimo('despacho_actualizado')!;
    expect(evento.detalle).toBe(
      'Dirección: — → Los Carrera 450 · Transportista: — → Starken · Entrega comprometida: — → Semana 42 · Destino: — → Osorno',
    );
    // Otro transportista libre («Otro» + texto) y vaciar un campo.
    await t.ir({ tipo: 'despacho', despacho: { transporte: 'Camión de Juan', destino: null } });
    expect(t.actual().despacho).toMatchObject({ transporte: 'Camión de Juan', destino: null, direccion: 'Los Carrera 450' });
    // Sin cambios no se registra nada ni cambia la versión.
    const version = t.actual().actualizada;
    const n = t.eventos().length;
    await t.ir({ tipo: 'despacho', despacho: { transporte: 'Camión de Juan' } });
    expect([t.actual().actualizada, t.eventos().length]).toEqual([version, n]);
  });

  it('el valor del flete queda fijo desde la emisión: cualquier cambio se rechaza', async () => {
    const t = await setup();
    // Flete acordado antes de emitir.
    await t.ir({ tipo: 'editar', flete: 25_000 });
    await t.emitida();
    await t.ir({ tipo: 'aprobar' });
    expect(t.actual().despacho?.valor).toBe(25_000);
    await expect(t.intentar({ tipo: 'despacho', despacho: { valor: 30_000 } })).rejects.toThrow(/quedó fijo al emitir/);
    await expect(t.intentar({ tipo: 'despacho', despacho: { valor: null, destino: 'Osorno' } })).rejects.toThrow(/quedó fijo/);
    expect(t.recargada().despacho).toMatchObject({ valor: 25_000, destino: null });
    // El mismo valor no es un cambio y los demás campos sí se guardan.
    await t.ir({ tipo: 'despacho', despacho: { valor: 25_000, destino: 'Osorno' } });
    expect(t.actual().despacho).toMatchObject({ valor: 25_000, destino: 'Osorno' });
    expect(t.actual().flete).toBe(25_000);
  });

  it('el valor fijo es el flete emitido aunque el despacho guardado quedara con un valor anterior', async () => {
    const t = await setup();
    await t.ir({ tipo: 'editar', despacho: { destino: 'Osorno' } });
    expect(t.actual().despacho?.valor).toBe(0);
    // Cambiar solo el flete no toca el despacho guardado: su valor queda atrasado hasta aprobar.
    await t.ir({ tipo: 'editar', flete: 25_000 });
    expect(t.actual().despacho?.valor).toBe(0);
    await t.emitida();
    await t.ir({ tipo: 'aprobar' });
    expect(t.actual().despacho).toMatchObject({ destino: 'Osorno', valor: 25_000 });
    await expect(t.intentar({ tipo: 'despacho', despacho: { valor: 0 } })).rejects.toThrow(/quedó fijo/);
    await t.ir({ tipo: 'despacho', despacho: { valor: 25_000, transporte: 'Starken' } });
    expect(t.recargada().despacho).toMatchObject({ transporte: 'Starken', valor: 25_000 });
  });

  it('aprobar tampoco admite un valor de despacho distinto del flete emitido', async () => {
    const t = await setup();
    await t.ir({ tipo: 'editar', flete: 25_000 });
    await t.emitida();
    await expect(t.intentar({ tipo: 'aprobar', despacho: { valor: 1, transporte: 'Starken' } })).rejects.toThrow(/quedó fijo/);
    expect(t.recargada().estado).toBe('emitida');
    await t.ir({ tipo: 'aprobar', despacho: { valor: 25_000, transporte: 'Starken' } });
    expect(t.actual()).toMatchObject({ estado: 'aprobada', despacho: { transporte: 'Starken', valor: 25_000 } });
  });

  it('aprobar limpia los datos de despacho y deja el flete como valor', async () => {
    const t = await setup();
    await t.emitida();
    await t.ir({
      tipo: 'aprobar',
      despacho: { direccion: '  Los   Carrera  450 ', transporte: ' Starken ', entregaComprometida: '  Semana 42', destino: '  ' },
    });
    expect(t.recargada().despacho).toEqual({
      direccion: 'Los Carrera 450',
      transporte: 'Starken',
      entregaComprometida: 'Semana 42',
      destino: null,
      valor: 0,
    });
  });

  it('no cambia la nota de pedido ya generada ni regenera su PDF', async () => {
    const t = await setup();
    await t.aprobada();
    await t.ir({ tipo: 'despacho', despacho: { transporte: 'Starken', destino: 'Osorno' } });
    await t.pagar(t.mitad());
    await t.ir({ tipo: 'generar_nota' });
    const nota = structuredClone(t.recargada().nota);
    expect(nota?.despacho).toMatchObject({ transporte: 'Starken' });
    const pdfs = vi.mocked(plantilla).mock.calls.length;
    await t.ir({ tipo: 'despacho', despacho: { transporte: 'Transportes Paredes', destino: 'Puerto Montt' } });
    expect(t.recargada().despacho).toMatchObject({ transporte: 'Transportes Paredes', destino: 'Puerto Montt' });
    expect(t.recargada().nota).toEqual(nota);
    expect(vi.mocked(plantilla).mock.calls.length).toBe(pdfs);
  });

  it('solo se edita con la cotización aprobada y hasta registrar el despacho', async () => {
    const t = await setup();
    await expect(t.intentar({ tipo: 'despacho', despacho: { destino: 'Osorno' } })).rejects.toThrow(/aprobación del cliente/);
    await t.emitida();
    await expect(t.intentar({ tipo: 'despacho', despacho: { destino: 'Osorno' } })).rejects.toThrow(/aprobación del cliente/);
    await t.ir({ tipo: 'aprobar' });
    await t.ir({ tipo: 'despacho', despacho: { transporte: 'Starken' } });
    await t.pagar(t.mitad());
    await t.ir({ tipo: 'generar_nota' });
    await t.pagar(t.actual().montos.total - t.mitad());
    await t.operar('iniciar_produccion');
    await t.operar('produccion_terminada');
    await t.operar('lista_despacho');
    // Lista para despacho todavía admite cambios (p. ej. el destino final).
    await t.ir({ tipo: 'despacho', despacho: { destino: 'Osorno' } });
    await t.operar('despachada');
    expect(despachoEditable(t.actual())).toBe(false);
    await expect(t.intentar({ tipo: 'despacho', despacho: { destino: 'Temuco' } })).rejects.toThrow(/ya está registrado/);
    await t.operar('completada');
    await expect(t.intentar({ tipo: 'despacho', despacho: { destino: 'Temuco' } })).rejects.toThrow(/ya está registrado/);
    expect(t.recargada().despacho?.destino).toBe('Osorno');
  });
});

describe('registrar el despacho', () => {
  it('exige un transportista: vacío o solo «Otro» no sirven', async () => {
    const t = await setup();
    await t.listaParaDespacho();
    await expect(t.intentar({ tipo: 'operacion', paso: 'despachada' })).rejects.toThrow(/transportista/);
    await t.ir({ tipo: 'despacho', despacho: { transporte: 'Otro' } });
    await expect(t.intentar({ tipo: 'operacion', paso: 'despachada' })).rejects.toThrow(/transportista/);
    await expect(
      t.intentar({ tipo: 'operacion', paso: 'despachada', despacho: { transporte: '   ' } }),
    ).rejects.toThrow(/transportista/);
    expect(t.recargada().estadoOperativo).toBe('lista_despacho');
    expect(t.eventos().map((e) => e.tipo)).not.toContain('despachada');
  });

  it('el evento guarda transportista y destino, y el valor no se cambia en el paso', async () => {
    const t = await setup();
    await t.listaParaDespacho();
    await expect(
      t.intentar({ tipo: 'operacion', paso: 'despachada', despacho: { transporte: 'Starken', valor: 99 } }),
    ).rejects.toThrow(/quedó fijo/);
    await t.operar('despachada', { despacho: { transporte: 'Starken', destino: 'Osorno' } });
    expect(t.recargada()).toMatchObject({ estadoOperativo: 'despachada', despacho: { transporte: 'Starken', destino: 'Osorno' } });
    expect(t.ultimo('despachada')!.detalle).toBe(
      'Lista para despacho → Despachada · Transportista: Starken · Destino: Osorno',
    );
  });

  it('si el paso también cambia dirección o entrega, el evento lo registra', async () => {
    const t = await setup();
    await t.listaParaDespacho();
    await t.ir({ tipo: 'despacho', despacho: { transporte: 'Starken', direccion: 'Los Carrera 450' } });
    await t.operar('despachada', {
      despacho: { direccion: ' Calle  Nueva 12 ', entregaComprometida: 'Semana 42', destino: 'Osorno' },
    });
    expect(t.ultimo('despachada')!.detalle).toBe(
      'Lista para despacho → Despachada · Transportista: Starken · Destino: Osorno · Dirección: Los Carrera 450 → Calle Nueva 12 · Entrega comprometida: — → Semana 42',
    );
    expect(t.recargada().despacho).toMatchObject({ direccion: 'Calle Nueva 12', entregaComprometida: 'Semana 42' });
  });

  it('con el transportista ya guardado basta registrar el despacho; sin destino lo dice', async () => {
    const t = await setup();
    await t.listaParaDespacho();
    await t.ir({ tipo: 'despacho', despacho: { transporte: 'Retira el cliente' } });
    await t.operar('despachada');
    expect(t.ultimo('despachada')!.detalle).toBe(
      'Lista para despacho → Despachada · Transportista: Retira el cliente · Destino: sin indicar',
    );
  });
});

describe('anular una cotización', () => {
  it('deja el estado comercial en «rechazada» y detiene la operación', async () => {
    const t = await setup();
    await t.conNota();
    expect(t.actual().estadoComercial).toBe('vendida');
    await t.ir({ tipo: 'anular', motivo: 'El cliente desistió' });
    expect(t.recargada()).toMatchObject({ estado: 'anulada', estadoComercial: 'rechazada' });
    expect(t.recargada().nota?.anulada).toBe(true);
    for (const accion of [
      { tipo: 'operacion', paso: 'iniciar_produccion' },
      { tipo: 'despacho', despacho: { destino: 'Osorno' } },
      { tipo: 'facturacion', estado: 'facturada', tipoDocumento: 'factura' },
      { tipo: 'pago', monto: 1000 },
      { tipo: 'anular_pago', pagoId: t.actual().pagos![0].id },
    ])
      await expect(t.intentar(accion)).rejects.toThrow(/anulada/);
  });

  it('una cotización emitida que se anula también queda «rechazada»', async () => {
    const t = await setup();
    await t.emitida();
    expect(t.actual().estadoComercial).toBe('enviada');
    await t.ir({ tipo: 'anular' });
    expect(t.actual().estadoComercial).toBe('rechazada');
  });

  it('las anuladas antes de fijar el estado comercial se leen como «rechazada»', async () => {
    const t = await setup();
    await t.aprobada();
    await t.ir({ tipo: 'anular' });
    t.almacen.baseDatos().prepare("UPDATE cotizaciones SET estado_comercial = 'aprobada' WHERE id = ?").run(t.actual().id);
    expect(new Almacen(t.dir).obtener(t.actual().id)!.estadoComercial).toBe('rechazada');
    const fila = new Almacen(t.dir).listar({ estados: ['anulada'] }).cotizaciones[0];
    expect(fila.estadoComercial).toBe('rechazada');
  });
});

describe('etiquetas legibles', () => {
  it('cada estado comercial y operativo tiene su etiqueta', () => {
    expect(etiquetaComercial).toEqual({
      pendiente: 'Pendiente',
      enviada: 'Enviada',
      seguimiento: 'En seguimiento',
      aprobada: 'Aprobada',
      rechazada: 'Rechazada / cancelada',
      vendida: 'Vendida',
    });
    expect(etiquetaOperativo).toEqual({
      sin_pedido: 'Sin nota de pedido',
      anticipo_pagado: '50 % pagado',
      pedido_generado: 'Nota de pedido generada',
      en_produccion: 'En producción',
      produccion_terminada: 'Producción terminada',
      saldo_pendiente: 'Saldo pendiente',
      pagada: '100 % pagado',
      lista_despacho: 'Lista para despacho',
      despachada: 'Despachada',
      completada: 'Completada',
    } satisfies Record<EstadoOperativo, string>);
    expect(etiquetaEvento.pago_anulado).toBe('Pago anulado');
    expect(etiquetaEvento.despacho_actualizado).toBe('Despacho actualizado');
  });

  it('la actividad habla en etiquetas, no en identificadores', async () => {
    const t = await setup();
    await t.emitida();
    await t.ir({ tipo: 'comercial', estado: 'seguimiento' });
    expect(t.ultimo('seguimiento')!.detalle).toBe('Estado comercial: En seguimiento');
    await t.ir({ tipo: 'aprobar' });
    await t.pagar(t.mitad());
    await t.ir({ tipo: 'generar_nota' });
    await t.operar('iniciar_produccion');
    expect(t.ultimo('produccion')!.detalle).toBe('Nota de pedido generada → En producción');
    await t.pagar(t.actual().montos.total - t.mitad());
    await t.operar('produccion_terminada');
    expect(t.ultimo('produccion_terminada')!.detalle).toBe('En producción → 100 % pagado');
    await t.operar('lista_despacho');
    expect(t.ultimo('lista_despacho')!.detalle).toBe('100 % pagado → Lista para despacho');
    await t.operar('despachada', { despacho: { transporte: 'Starken' } });
    await t.operar('completada');
    expect(t.ultimo('completada')!.detalle).toBe('Despachada → Completada');
    expect(t.ultimo('despachada')!.detalle).toBe(
      'Lista para despacho → Despachada · Transportista: Starken · Destino: sin indicar',
    );
    // Ningún identificador interno compuesto (sin_pedido, en_produccion…) llega a la actividad.
    const internos = [...Object.keys(etiquetaOperativo), ...Object.keys(etiquetaComercial)].filter((id) => id.includes('_'));
    for (const e of t.eventos()) for (const id of internos) expect(e.detalle ?? '').not.toContain(id);
  });

  it('un transportista válido no puede estar vacío ni ser solo «Otro»', () => {
    for (const vacio of [null, undefined, '', '   ', 'Otro', ' otro ', 'OTRO']) expect(sinTransportista(vacio)).toBe(true);
    for (const valido of ['Starken', 'Otro · Juan', 'Camión de Juan']) expect(sinTransportista(valido)).toBe(false);
  });

  it('el estado de pago del listado solo aparece en emitidas y aprobadas', () => {
    const fila = (estado: Cotizacion['estado'], pagado: number, total = 1000) => ({
      estado,
      pagado,
      total,
      porcentajePagado: total ? (100 * pagado) / total : 0,
    });
    expect(estadoPago(fila('borrador', 0))).toBeNull();
    expect(estadoPago(fila('anulada', 0))).toBeNull();
    expect(estadoPago(fila('emitida', 0))).toBe('Sin pagos');
    expect(estadoPago(fila('aprobada', 0))).toBe('Sin pagos');
    expect(estadoPago(fila('aprobada', 500))).toBe('Pago 50 %');
    expect(estadoPago(fila('aprobada', 999))).toBe('Pago 99 %');
    expect(estadoPago(fila('aprobada', 1))).toBe('Pago 1 %');
    expect(estadoPago(fila('aprobada', 1000))).toBe('Pagada');
  });
});

describe('facturación', () => {
  it('se marca facturada con tipo, número y fecha, y vuelve a pendiente', async () => {
    const t = await setup();
    await t.aprobada();
    expect(etiquetaFacturacion(t.actual().facturacion)).toBe('Pendiente de facturación');
    await t.ir({ tipo: 'facturacion', estado: 'facturada', tipoDocumento: 'factura', identificadorExterno: ' 1234 ', fecha: '2026-09-29' });
    expect(t.recargada().facturacion).toEqual({
      estado: 'facturada',
      tipo: 'factura',
      identificadorExterno: '1234',
      fecha: '2026-09-29T12:00:00.000Z',
    });
    expect(etiquetaFacturacion(t.actual().facturacion)).toBe('Facturada · Factura N° 1234');
    expect(t.ultimo('facturada')!.detalle).toBe('Facturada · Factura N° 1234 · 2026-09-29');
    await t.ir({ tipo: 'facturacion', estado: 'facturada', tipoDocumento: 'boleta' });
    expect(etiquetaFacturacion(t.actual().facturacion)).toBe('Facturada · Boleta');
    await t.ir({ tipo: 'facturacion', estado: 'pendiente' });
    expect(t.recargada().facturacion).toEqual({ estado: 'pendiente', tipo: null, identificadorExterno: null, fecha: null });
    expect(t.ultimo('facturada')!.detalle).toBe('Vuelve a pendiente de facturación');
    // Repetir el mismo estado no agrega actividad.
    const n = t.eventos().length;
    await t.ir({ tipo: 'facturacion', estado: 'pendiente' });
    expect(t.eventos().length).toBe(n);
  });

  it('exige factura o boleta y una fecha válida, y solo aplica a una cotización aprobada', async () => {
    const t = await setup();
    await expect(t.intentar({ tipo: 'facturacion', estado: 'facturada', tipoDocumento: 'factura' })).rejects.toThrow(/aprobación del cliente/);
    await t.emitida();
    await expect(t.intentar({ tipo: 'facturacion', estado: 'facturada', tipoDocumento: 'factura' })).rejects.toThrow(/aprobación del cliente/);
    await t.ir({ tipo: 'aprobar' });
    await expect(t.intentar({ tipo: 'facturacion', estado: 'facturada' })).rejects.toThrow(/factura o una boleta/);
    await expect(
      t.intentar({ tipo: 'facturacion', estado: 'facturada', tipoDocumento: 'factura', fecha: '2026-02-31' }),
    ).rejects.toThrow(/fecha/);
    expect(t.recargada().facturacion?.estado).toBe('pendiente');
  });
});

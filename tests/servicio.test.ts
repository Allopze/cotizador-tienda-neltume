import { ErrorIA } from '../src/asistente/errores';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Servicio } from '../src/servidor/servicio';
import { Almacen } from '../src/servidor/almacen';
import { clienteVacio, type Catalogo, type SolicitudItem } from '../src/catalogo/tipos';
import { generarPdf, plantilla } from '../src/servidor/pdf';
vi.mock('../src/servidor/pdf', () => ({
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));
const dirs: string[] = [];
const catalogo: Catalogo = {
  fuente: 'test',
  sha256: 'test',
  fecha: '2026-01-01',
  productos: [
    {
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
    },
  ],
};
const solicitud: SolicitudItem = {
  modelo: 'MOLCO',
  madera: 'pino',
  ancho: 80,
  alto: 2,
  medida: null,
  cantidad: 3,
};
const actualizar = { name: 'actualizar_cotizacion', input: { items: [solicitud], cliente: clienteVacio() } };
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-test-'));
  dirs.push(dir);
  const almacen = new Almacen(dir),
    llm = { interpretar: vi.fn().mockResolvedValue(actualizar) };
  return { dir, almacen, llm, servicio: new Servicio(catalogo, llm, almacen) };
}
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
describe('Persistencia y flujo del asistente', () => {
  it('correlativo 323, reinicio, PDF inmutable, edición crea borrador, nota sin ajuste y bloqueo', async () => {
    const { dir, servicio, llm } = await setup();
    let q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: '3 Molco' })).cotizacion;
    const emitida = (await servicio.ejecutar({ tipo: 'emitir', id: q.id })).cotizacion;
    expect(emitida.numero).toBe(323);
    expect(emitida.montos.total).toBe(450);
    const alterado = structuredClone(catalogo);
    alterado.productos[0].precioNeto = 999;
    const reiniciado = new Servicio(alterado, llm, new Almacen(dir));
    expect((await reiniciado.ejecutar({ tipo: 'emitir', id: q.id })).archivo).toBe('cotizacion-323.pdf');
    expect(generarPdf).toHaveBeenCalledTimes(1);
    const sinCambios = (await reiniciado.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'igual' })).cotizacion;
    expect(sinCambios.id).toBe(q.id);
    expect(sinCambios.historial.at(-1)?.texto).toContain('No hay cambios');
    llm.interpretar.mockResolvedValueOnce({
      ...actualizar,
      input: { ...actualizar.input, items: [{ ...solicitud, cantidad: 4 }] },
    });
    const copia = (await reiniciado.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'actualiza' })).cotizacion;
    expect(copia.id).not.toBe(q.id);
    expect(copia.numero).toBeNull();
    expect(copia.estado).toBe('borrador');
    expect(copia.montos.total).toBe(
      Math.round(999 * 1.25) * 4 + Math.round(Math.round(999 * 1.25) * 4 * 0.19),
    );
    expect((await reiniciado.ejecutar({ tipo: 'emitir', id: copia.id })).cotizacion.numero).toBe(324);
    const aprobada = (await reiniciado.ejecutar({ tipo: 'aprobar', id: q.id })).cotizacion;
    expect(aprobada.montos.total).toBe(450);
    expect(aprobada.nota?.montos.lineas[0].precioUnitario).toBe(100);
    expect(aprobada.nota?.numero).toBe(1);
    expect(plantilla).toHaveBeenCalledTimes(3);
    await expect(reiniciado.ejecutar({ tipo: 'quitar', id: q.id, indice: 0 })).rejects.toThrow('aprobada');
    await expect(reiniciado.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'cambia' })).rejects.toThrow(
      'aprobada',
    );
    await reiniciado.ejecutar({ tipo: 'aprobar', id: q.id });
    expect(generarPdf).toHaveBeenCalledTimes(3);
    expect((await new Almacen(dir).leer()).siguienteCotizacion).toBe(325);
  });
  it('salida inválida preserva el borrador y agrega la respuesta requerida', async () => {
    const { servicio, llm } = await setup();
    let q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'pedido' })).cotizacion;
    llm.interpretar.mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { items: [], cliente: {}, precio: 123 },
    });
    const nueva = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'algo' })).cotizacion;
    expect(nueva.solicitudes).toEqual(q.solicitudes);
    expect(nueva.montos).toEqual(q.montos);
    expect(nueva.historial.at(-1)?.texto).toBe('No entendí, ¿puedes reformularlo?');
    const contexto = llm.interpretar.mock.calls[0][0];
    expect(JSON.stringify(contexto)).not.toMatch(/precioNeto|montos|lineas/);
  });
  it('los incompletos no suman y no permiten emitir', async () => {
    const { servicio, llm } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    llm.interpretar.mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { ...actualizar.input, items: [solicitud, { ...solicitud, madera: null, cantidad: null }] },
    });
    const r = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'pedido' })).cotizacion;
    expect(r.montos.total).toBe(450);
    expect(r.incompletos).toHaveLength(1);
    expect(r.incompletos[0].pregunta).toMatch(/madera.*\n.*cantidad/);
    await expect(servicio.ejecutar({ tipo: 'emitir', id: q.id })).rejects.toThrow('pendientes');
    const quitada = (await servicio.ejecutar({ tipo: 'quitar', id: q.id, indice: 1 })).cotizacion;
    expect(quitada.incompletos).toHaveLength(0);
  });
  it('reserva durable: un fallo del PDF consume el correlativo y reintentar usa el siguiente', async () => {
    const { servicio, almacen } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'pedido' });
    vi.mocked(generarPdf).mockRejectedValueOnce(new Error('Chromium no disponible'));
    await expect(servicio.ejecutar({ tipo: 'emitir', id: q.id })).rejects.toThrow('Chromium');
    expect((await almacen.leer()).siguienteCotizacion).toBe(324);
    expect((await servicio.ejecutar({ tipo: 'emitir', id: q.id })).cotizacion.numero).toBe(324);
  });
  it('serializa escritores concurrentes y no reinicia un archivo dañado', async () => {
    const { dir, almacen } = await setup();
    const reservas = await Promise.all(
      Array.from({ length: 5 }, () => new Almacen(dir).transaccion(async (e) => e.siguienteCotizacion++)),
    );
    expect(reservas.sort()).toEqual([323, 324, 325, 326, 327]);
    expect((await almacen.leer()).siguienteCotizacion).toBe(328);
    await writeFile(join(dir, 'estado.json'), '{inválido');
    await expect(almacen.leer()).rejects.toThrow('no se reiniciaron');
  });
});

it('preserva el error tipado del proveedor y el borrador cuando la IA falla', async () => {
  const { servicio, llm, almacen } = await setup();
  const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
  const antes = await almacen.leer();
  const error = new ErrorIA('ia_limite', 'Modelo temporalmente no disponible.', 503);
  llm.interpretar.mockRejectedValueOnce(error);
  await expect(servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'cotiza' })).rejects.toBe(error);
  expect(await almacen.leer()).toEqual(antes);
});

describe('Aprobación, concurrencia y conflictos', () => {
  async function emitida() {
    const ctx = await setup();
    const q = (await ctx.servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    await ctx.servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'pedido' });
    await ctx.servicio.ejecutar({ tipo: 'emitir', id: q.id });
    return { ...ctx, q };
  }
  it('no aprueba un borrador sin PDF ni consume correlativos', async () => {
    const { servicio, almacen } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'pedido' });
    await expect(servicio.ejecutar({ tipo: 'aprobar', id: q.id })).rejects.toThrow('PDF');
    const estado = await almacen.leer();
    expect([estado.siguienteCotizacion, estado.siguienteNota]).toEqual([323, 1]);
  });
  it('la aprobación pedida por chat solo propone confirmar; no genera la nota', async () => {
    const { servicio, llm, almacen, q } = await emitida();
    const otra = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    llm.interpretar.mockResolvedValueOnce({ name: 'aprobar_cotizacion', input: { numero: 323 } });
    const r = await servicio.ejecutar({ tipo: 'chat', id: otra.id, mensaje: 'se aprobó la 323' });
    expect(r.confirmar).toEqual({ id: q.id, numero: 323 });
    expect(r.archivo).toBeUndefined();
    expect(r.cotizacion.historial.at(-1)?.texto).toContain('¿Confirmas');
    const estado = await almacen.leer();
    expect(estado.siguienteNota).toBe(1);
    expect(estado.cotizaciones.find((c) => c.id === q.id)?.estado).toBe('emitida');
    llm.interpretar.mockResolvedValueOnce({ name: 'aprobar_cotizacion', input: { numero: 999 } });
    const inexistente = await servicio.ejecutar({ tipo: 'chat', id: otra.id, mensaje: 'aprueba la 999' });
    expect(inexistente.cotizacion.historial.at(-1)?.texto).toContain('No existe la cotización N° 999');
  });
  it('consulta a la IA sin retener el bloqueo y envía el historial reciente', async () => {
    const { servicio, llm, almacen, dir } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'pedido' });
    let otraTransaccionMs = Infinity;
    llm.interpretar.mockImplementationOnce(async () => {
      const t0 = Date.now();
      await new Almacen(dir).transaccion(async () => null);
      otraTransaccionMs = Date.now() - t0;
      return actualizar;
    });
    await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'otra vez' });
    expect(otraTransaccionMs).toBeLessThan(1000);
    const contexto = llm.interpretar.mock.calls.at(-1)![0];
    expect(contexto.historial.map((m: { texto: string }) => m.texto)).toContain('pedido');
    expect((await almacen.leer()).cotizaciones[0].historial.length).toBe(4);
  });
  it('rechaza aplicar la respuesta si la cotización cambió durante la consulta', async () => {
    const { servicio, llm, almacen } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    llm.interpretar.mockImplementationOnce(async () => {
      await almacen.transaccion(async (e) => {
        e.cotizaciones[0].actualizada = new Date(Date.now() + 1000).toISOString();
      });
      return actualizar;
    });
    await expect(servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'pedido' })).rejects.toThrow('cambió');
    expect((await almacen.leer()).cotizaciones[0].solicitudes).toEqual([]);
  });
  it('filtra montos del texto libre sin bloquear palabras comunes', async () => {
    const { servicio, llm } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    llm.interpretar.mockResolvedValueOnce({
      name: 'responder',
      input: { texto: '¿Cuál es el total de puertas?' },
    });
    const ok = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'hola' })).cotizacion;
    expect(ok.historial.at(-1)?.texto).toBe('¿Cuál es el total de puertas?');
    llm.interpretar.mockResolvedValueOnce({ name: 'responder', input: { texto: 'Cuesta $ 120.000' } });
    const filtrado = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'precio' })).cotizacion;
    expect(filtrado.historial.at(-1)?.texto).toContain('Los montos se muestran en la cotización');
  });
  it('guarda la fecha de emisión y crea el bloqueo dentro del directorio de datos', async () => {
    const { q, almacen, dir } = await emitida();
    const guardada = (await almacen.leer()).cotizaciones.find((c) => c.id === q.id)!;
    expect(guardada.fechaEmision).toBeTruthy();
    expect(vi.mocked(plantilla).mock.calls.at(-1)?.[4]).toBe(guardada.fechaEmision);
    const lock = almacen.transaccion(async () => {
      await expect(access(join(dir, '.estado.lock'))).resolves.toBeUndefined();
    });
    await lock;
    await expect(access(`${dir}.lock`)).rejects.toThrow();
  });
  it('rechaza un estado con estructura inválida sin reiniciar contadores', async () => {
    const { dir, almacen } = await setup();
    await writeFile(join(dir, 'estado.json'), JSON.stringify({ siguienteCotizacion: 'x', cotizaciones: [] }));
    await expect(almacen.leer()).rejects.toThrow('no se reiniciaron');
  });
});

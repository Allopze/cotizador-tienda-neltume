import { ErrorIA } from '../src/asistente/errores';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Servicio } from '../src/servidor/servicio';
import type { Cotizacion } from '../src/negocio/estado';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
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
const modificarCantidad = (cantidad: number) => ({
  name: 'modificar_cotizacion',
  input: { items: [{ indice: 0, cambios: { cantidad } }] },
});
const clienteMaria = {
  ...clienteVacio(),
  nombre: 'María José',
  comuna: 'Temuco',
  proyecto: 'Casa Norte',
};
const emitir = (s: Servicio, q: Cotizacion) =>
  s.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada });
const aprobar = (s: Servicio, q: Cotizacion) =>
  s.ejecutar({ tipo: 'aprobar', id: q.id, actualizada: q.actualizada });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-test-'));
  dirs.push(dir);
  const almacen = new Almacen(dir),
    llm = { interpretar: vi.fn().mockResolvedValue(actualizar) };
  return { dir, almacen, llm, servicio: new Servicio(catalogo, llm, almacen) };
}
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});
describe('Persistencia y flujo del asistente', () => {
  it('correlativo 323, reinicio, PDF inmutable, edición crea borrador, nota sin ajuste y bloqueo', async () => {
    const { dir, servicio, llm } = await setup();
    let q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    q = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: '3 Molco' })).cotizacion;
    const emitida = (await emitir(servicio, q)).cotizacion;
    expect(emitida.numero).toBe(323);
    expect(emitida.montos.total).toBe(664);
    const alterado = structuredClone(catalogo);
    alterado.productos[0].precioNeto = 999;
    const reiniciado = new Servicio(alterado, llm, new Almacen(dir));
    // Reintentar la emisión es idempotente aunque la versión enviada ya no sea la actual.
    expect((await emitir(reiniciado, q)).archivo).toBe('cotizacion-323.pdf');
    expect(generarPdf).toHaveBeenCalledTimes(1);
    const sinCambios = (await reiniciado.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'igual' })).cotizacion;
    expect(sinCambios.id).toBe(q.id);
    expect(sinCambios.historial.at(-1)?.texto).toContain('No hay cambios');
    // B3: el historial de una emitida no cambia su versión.
    expect(sinCambios.actualizada).toBe(emitida.actualizada);
    llm.interpretar.mockResolvedValueOnce({
      ...actualizar,
      input: { ...actualizar.input, items: [{ ...solicitud, cantidad: 4 }] },
    });
    const copia = (await reiniciado.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'actualiza' })).cotizacion;
    expect(copia.id).not.toBe(q.id);
    expect(copia.numero).toBeNull();
    expect(copia.estado).toBe('borrador');
    expect(copia.montos.total).toBe(
      Math.round(999 * 1.85) * 4 + Math.round(Math.round(999 * 1.85) * 4 * 0.19),
    );
    const revision = (await emitir(reiniciado, copia)).cotizacion;
    expect(revision.numero).toBe(324);
    // A2: la original quedó reemplazada y ya no se puede aprobar.
    const original = new Almacen(dir).obtener(q.id)!;
    expect(original.estado).toBe('reemplazada');
    expect(original.reemplazadaPor).toBe(324);
    await expect(aprobar(reiniciado, original)).rejects.toThrow('reemplazada');
    let aprobada = (await aprobar(reiniciado, revision)).cotizacion;
    expect(aprobada.montos.total).toBe(copia.montos.total);
    expect(aprobada.nota).toBeNull();
    const mitad = Math.ceil(aprobada.montos.total * 0.5);
    aprobada = (
      await reiniciado.ejecutar({
        tipo: 'pago',
        id: aprobada.id,
        actualizada: aprobada.actualizada,
        monto: mitad,
      })
    ).cotizacion;
    aprobada = (
      await reiniciado.ejecutar({ tipo: 'generar_nota', id: aprobada.id, actualizada: aprobada.actualizada })
    ).cotizacion;
    expect(aprobada.nota?.montos.lineas[0].precioUnitario).toBe(999);
    expect(aprobada.nota?.numero).toBe(1);
    expect(plantilla).toHaveBeenCalledTimes(3);
    await expect(
      reiniciado.ejecutar({ tipo: 'quitar', id: aprobada.id, actualizada: aprobada.actualizada, indice: 0 }),
    ).rejects.toThrow('aprobada');
    await expect(reiniciado.ejecutar({ tipo: 'chat', id: aprobada.id, mensaje: 'cambia' })).rejects.toThrow(
      'aprobada',
    );
    await aprobar(reiniciado, aprobada);
    expect(generarPdf).toHaveBeenCalledTimes(3);
    expect(new Almacen(dir).correlativos().siguienteCotizacion).toBe(325);
  });
  it('encuentra una cotización anterior sin crear un borrador y aplica solo el cambio pedido', async () => {
    const { servicio, llm, almacen } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    llm.interpretar.mockResolvedValueOnce({
      name: 'actualizar_cotizacion',
      input: { items: [solicitud], cliente: clienteMaria },
    });
    const lista = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: '3 Huilo Huilo' })).cotizacion;
    const emitida = (await emitir(servicio, lista)).cotizacion;
    llm.interpretar.mockResolvedValueOnce(modificarCantidad(8));

    const resultado = await servicio.ejecutar({
      tipo: 'chat',
      mensaje: 'La cotización de Maria Jose ahora debe ser de 8 puertas y no de 3',
    });

    expect(resultado.cotizacion.id).not.toBe(emitida.id);
    expect(resultado.cotizacion.origen).toBe(323);
    expect(resultado.cotizacion.solicitudes).toMatchObject([
      { ...solicitud, madera: 'PINO OREGON', modelo: 'MOLCO', cantidad: 8 },
    ]);
    expect(resultado.cotizacion.cliente).toEqual(clienteMaria);
    expect(resultado.cotizacion.montos.total).toBe(1771);
    expect(emitida.solicitudes).toMatchObject([{ ...solicitud, madera: 'PINO OREGON', modelo: 'MOLCO' }]);
    expect(emitida.pdf).toBe('cotizacion-323.pdf');
    const estado = await almacen.leer();
    expect(estado.cotizaciones).toHaveLength(2);
    expect(llm.interpretar.mock.calls.at(-1)?.[0].modo).toBe('modificacion_anterior');
    expect(JSON.stringify(llm.interpretar.mock.calls.at(-1)?.[0])).not.toMatch(/montos|precioNeto|lineas/);
  });

  it('conserva otros ítems y los campos no mencionados al aplicar un parche', async () => {
    const { servicio, llm } = await setup();
    const borrador = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    const segundo = { ...solicitud, cantidad: 5, ancho: 0.85 };
    llm.interpretar.mockResolvedValueOnce({
      name: 'actualizar_cotizacion',
      input: { items: [solicitud, segundo], cliente: clienteMaria },
    });
    await servicio.ejecutar({ tipo: 'chat', id: borrador.id, mensaje: 'pedido para María José' });
    llm.interpretar.mockResolvedValueOnce(modificarCantidad(8));
    const resultado = await servicio.ejecutar({
      tipo: 'chat',
      mensaje: 'La cotización de María José ahora debe ser de 8 y no de 3 puertas',
    });
    expect(resultado.cotizacion.solicitudes).toMatchObject([
      { ...solicitud, madera: 'PINO OREGON', modelo: 'MOLCO', cantidad: 8 },
      { ...segundo, madera: 'PINO OREGON', modelo: 'MOLCO' },
    ]);
    expect(resultado.cotizacion.cliente).toEqual(clienteMaria);
  });

  it('pide elegir si hay varias cotizaciones y aplica el mensaje original solo a la seleccionada', async () => {
    const { servicio, llm, almacen } = await setup();
    async function crearEmitida() {
      const borrador = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
      llm.interpretar.mockResolvedValueOnce({
        name: 'actualizar_cotizacion',
        input: { items: [solicitud], cliente: clienteMaria },
      });
      const lista = (await servicio.ejecutar({ tipo: 'chat', id: borrador.id, mensaje: '3 Huilo Huilo' }))
        .cotizacion;
      return (await emitir(servicio, lista)).cotizacion;
    }
    const primera = await crearEmitida();
    const segunda = await crearEmitida();
    const mensaje = 'La cotización de María José ahora debe ser de 8 puertas y no de 3';

    const opciones = await servicio.ejecutar({ tipo: 'chat', mensaje });
    expect(opciones.seleccion?.map((o) => o.numero)).toEqual([324, 323]);
    expect(opciones.cotizacion.id).toBe(opciones.seleccion?.[0].id);
    expect(llm.interpretar).toHaveBeenCalledTimes(2);
    expect((await almacen.leer()).cotizaciones).toHaveLength(2);

    llm.interpretar.mockResolvedValueOnce(modificarCantidad(8));
    const objetivo = opciones.seleccion![0];
    const aplicado = await servicio.ejecutar({
      tipo: 'chat',
      mensaje,
      objetivoId: objetivo.id,
      objetivoActualizada: objetivo.actualizada,
    });

    expect(aplicado.cotizacion.origen).toBe(segunda.numero);
    expect(aplicado.cotizacion.solicitudes[0].cantidad).toBe(8);
    const guardadas = (await almacen.leer()).cotizaciones;
    expect(guardadas.find((q) => q.id === primera.id)?.solicitudes[0].cantidad).toBe(3);
    expect(guardadas.find((q) => q.id === segunda.id)?.solicitudes[0].cantidad).toBe(3);
    expect(guardadas).toHaveLength(3);
  });

  it('rechaza la selección obsoleta y no altera la cotización', async () => {
    const { servicio, llm, almacen } = await setup();
    const borrador = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    llm.interpretar.mockResolvedValueOnce({
      name: 'actualizar_cotizacion',
      input: { items: [solicitud], cliente: clienteMaria },
    });
    const lista = (await servicio.ejecutar({ tipo: 'chat', id: borrador.id, mensaje: '3 Huilo Huilo' }))
      .cotizacion;
    const emitida = (await emitir(servicio, lista)).cotizacion;
    const opcion = { id: emitida.id, actualizada: emitida.actualizada };
    llm.interpretar.mockImplementationOnce(async () => {
      await almacen.transaccion(async (u) => {
        const q = u.obtener(emitida.id)!;
        q.actualizada = '2026-06-01T00:00:00.000Z';
        u.guardar(q);
      });
      return modificarCantidad(8);
    });
    await expect(
      servicio.ejecutar({
        tipo: 'chat',
        mensaje: 'La cotización de María José ahora debe ser de 8 y no de 3 puertas',
        objetivoId: opcion.id,
        objetivoActualizada: opcion.actualizada,
      }),
    ).rejects.toThrow('cambió');
    expect(
      (await almacen.leer()).cotizaciones.find((q) => q.id === emitida.id)?.solicitudes[0].cantidad,
    ).toBe(3);
  });

  it('mantiene bloqueada una cotización aprobada aunque se la mencione por número', async () => {
    const { servicio, llm } = await setup();
    const borrador = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    llm.interpretar.mockResolvedValueOnce({
      name: 'actualizar_cotizacion',
      input: { items: [solicitud], cliente: clienteMaria },
    });
    const lista = (await servicio.ejecutar({ tipo: 'chat', id: borrador.id, mensaje: '3 Huilo Huilo' }))
      .cotizacion;
    await aprobar(servicio, (await emitir(servicio, lista)).cotizacion);
    llm.interpretar.mockClear();
    await expect(
      servicio.ejecutar({
        tipo: 'chat',
        mensaje: 'Modifica la cotización N° 323: ahora son 8 puertas',
      }),
    ).rejects.toThrow('aprobada');
    expect(llm.interpretar).not.toHaveBeenCalled();
  });

  it('sin una referencia encontrada crea solo la cotización nueva para el mensaje', async () => {
    const { servicio, llm, almacen } = await setup();
    const resultado = await servicio.ejecutar({ tipo: 'chat', mensaje: 'Cotiza 3 Molco' });
    expect(resultado.cotizacion.solicitudes).toMatchObject([
      { ...solicitud, madera: 'PINO OREGON', modelo: 'MOLCO' },
    ]);
    expect((await almacen.leer()).cotizaciones).toHaveLength(1);
    expect(llm.interpretar.mock.calls[0][0].modo).toBe('cotizacion_nueva');
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
    expect(nueva.solicitudes).toMatchObject(q.solicitudes);
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
    expect(r.montos.total).toBe(664);
    expect(r.incompletos).toHaveLength(1);
    expect(r.incompletos[0].pregunta).toMatch(/madera.*\n.*cantidad/);
    await expect(emitir(servicio, r)).rejects.toThrow('pendientes');
    const quitada = (
      await servicio.ejecutar({ tipo: 'quitar', id: q.id, actualizada: r.actualizada, indice: 1 })
    ).cotizacion;
    expect(quitada.incompletos).toHaveLength(0);
  });
  it('reserva durable: un fallo del PDF consume el correlativo y reintentar usa el siguiente', async () => {
    const { servicio, almacen } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    const lista = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'pedido' })).cotizacion;
    vi.mocked(generarPdf).mockRejectedValueOnce(new Error('Chromium no disponible'));
    await expect(emitir(servicio, lista)).rejects.toThrow('Chromium');
    expect((await almacen.leer()).siguienteCotizacion).toBe(324);
    // El fallo no dejó la cotización a medio emitir: la misma versión sigue siendo válida.
    expect(almacen.obtener(q.id)!.actualizada).toBe(lista.actualizada);
    expect((await emitir(servicio, lista)).cotizacion.numero).toBe(324);
  });
  it('serializa escritores concurrentes y no reinicia un archivo dañado', async () => {
    const { dir, almacen } = await setup();
    const reservas = await Promise.all(
      Array.from({ length: 5 }, () => new Almacen(dir).transaccion(async (u) => u.reservarCotizacion())),
    );
    expect(reservas.sort()).toEqual([323, 324, 325, 326, 327]);
    expect((await almacen.leer()).siguienteCotizacion).toBe(328);
    const archivoDb = join(dir, 'cotizador.sqlite');
    cerrarAlmacen(archivoDb);
    await writeFile(archivoDb, '{inválido');
    await expect(new Almacen(dir).leer()).rejects.toThrow();
  });

  it('permite elegir un número solo por encima del último usado o reservado', async () => {
    const { almacen } = await setup();
    await expect(almacen.transaccion(async (u) => u.reservarCotizacion(322))).rejects.toThrow('mayor que el último');
    await expect(almacen.transaccion(async (u) => u.reservarCotizacion(500))).resolves.toBe(500);
    await expect(almacen.transaccion(async (u) => u.reservarCotizacion(500))).rejects.toThrow('mayor que el último');
    await expect(almacen.transaccion(async (u) => u.reservarCotizacion())).resolves.toBe(501);
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
    const inicial = (await ctx.servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    const lista = (await ctx.servicio.ejecutar({ tipo: 'chat', id: inicial.id, mensaje: 'pedido' }))
      .cotizacion;
    const q = (await emitir(ctx.servicio, lista)).cotizacion;
    return { ...ctx, q };
  }
  it('no aprueba un borrador sin PDF ni consume correlativos', async () => {
    const { servicio, almacen } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    const lista = (await servicio.ejecutar({ tipo: 'chat', id: q.id, mensaje: 'pedido' })).cotizacion;
    await expect(aprobar(servicio, lista)).rejects.toThrow('PDF');
    const estado = await almacen.leer();
    expect([estado.siguienteCotizacion, estado.siguienteNota]).toEqual([323, 1]);
  });
  it('la aprobación pedida por chat solo propone confirmar; no genera la nota', async () => {
    const { servicio, llm, almacen, q } = await emitida();
    const otra = (await servicio.ejecutar({ tipo: 'nueva' })).cotizacion;
    llm.interpretar.mockResolvedValueOnce({ name: 'aprobar_cotizacion', input: { numero: 323 } });
    const r = await servicio.ejecutar({
      tipo: 'chat',
      id: otra.id,
      mensaje: 'Se aprobó la cotización N° 323, haz la nota de pedido',
    });
    expect(r.confirmar).toEqual({
      id: q.id,
      numero: 323,
      actualizada: q.actualizada,
      vence: q.vence,
      vencida: false,
    });
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
      await almacen.transaccion(async (u) => {
        const guardada = u.obtener(q.id)!;
        guardada.actualizada = new Date(Date.now() + 1000).toISOString();
        u.guardar(guardada);
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
    expect(vi.mocked(plantilla).mock.calls.at(-1)?.[1].fecha).toBe(guardada.fechaEmision);
    expect(vi.mocked(plantilla).mock.calls.at(-1)?.[1].vence).toBe(guardada.vence);
    const lock = almacen.transaccion(async () => {
      await expect(access(join(dir, '.estado.lock'))).resolves.toBeUndefined();
    });
    await lock;
    await expect(access(`${dir}.lock`)).rejects.toThrow();
  });
  it('rechaza un estado con estructura inválida sin reiniciar contadores', async () => {
    const { dir, almacen } = await setup();
    await writeFile(join(dir, 'estado.json'), JSON.stringify({ siguienteCotizacion: 'x', cotizaciones: [] }));
    await expect(almacen.leer()).rejects.toThrow('migrar:sqlite');
  });
});

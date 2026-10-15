import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import { fechaLocal, sumarDiasHabiles } from '../src/negocio/vigencia';
import { Almacen, cerrarAlmacen, ErrorOcupado } from '../src/servidor/almacen';
import { generarPdf } from '../src/servidor/pdf';
import { guardarCatalogo, RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { Servicio } from '../src/servidor/servicio';

// Fase 6 (servidor): pares de acciones con el número ya reservado, el bloqueo ocupado o comprometido, dos chats con
// el mismo nuevoId, emitir de noche en Chile y reimportar retirando un producto que usan los borradores.

// La plantilla es la real (para ver la fecha impresa); Chromium no se abre.
vi.mock('../src/servidor/pdf', async (original) => ({
  ...(await original<typeof import('../src/servidor/pdf')>()),
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
}));

const producto = (codigo: string, modelo: string): Producto => ({
  codigo,
  modelo,
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100_000,
  descripcion: `${modelo} PINO OREGON 0,80 A 0,85 MT X 2 MT`,
  filaOrigen: 4,
});
const molco = producto('MOL-O-3-A', 'MOLCO');
const llaima = producto('LLAI-O-3-A', 'LLAIMA');
const catalogo: Catalogo = { fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos: [molco, llaima] };
const pedido = (modelo: string): SolicitudItem => ({
  modelo,
  madera: 'PINO OREGON',
  ancho: 0.82,
  alto: 2,
  medida: null,
  cantidad: 2,
  tipoMedida: 'hoja',
});

const dirs: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

async function setup({ items = [pedido('MOLCO')] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-fase6-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  guardarCatalogo(almacen.baseDatos(), catalogo);
  const llm = {
    interpretar: vi.fn().mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { items, cliente: { ...clienteVacio(), nombre: 'Ana Soto' } },
    }),
  };
  const servicio = new Servicio(new RepositorioCatalogoSqlite(almacen.baseDatos()), llm, almacen, {
    nombre: 'Paula',
    email: 'paula@neltume.cl',
  });
  let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza' })).cotizacion;
  const ejecutar = (accion: Record<string, unknown>, version = q.actualizada) =>
    servicio.ejecutar({ ...accion, id: q.id, actualizada: version } as never);
  const ir = async (accion: Record<string, unknown>) => {
    const r = await ejecutar(accion);
    q = r.cotizacion;
    return r;
  };
  return {
    dir,
    almacen,
    servicio,
    llm,
    ejecutar,
    ir,
    actual: () => q,
    recargada: () => new Almacen(dir).obtener(q.id)!,
    marcas: () => almacen.baseDatos().prepare('SELECT * FROM emisiones_en_curso').all(),
    pdfs: async () => (await readdir(join(dir, 'pdf')).catch(() => [] as string[])).filter((f) => f.endsWith('.pdf')),
  };
}

/**
 * generarPdf espera a que la prueba lo suelte: mientras tanto el número ya está reservado y la marca «en emisión»
 * tomada. Devuelve cuándo empezó a generarse y la función que lo suelta.
 */
function pdfDemorado() {
  let soltar!: () => void;
  let empezo!: () => void;
  const empezado = new Promise<void>((r) => (empezo = r));
  const listo = new Promise<void>((r) => (soltar = r));
  vi.mocked(generarPdf).mockImplementationOnce(async () => {
    empezo();
    await listo;
  });
  return { empezado, soltar: () => soltar() };
}

describe('Pares de acciones con el número ya reservado', () => {
  it('editar mientras se genera el PDF: la edición gana, emitir responde 409 con un salto y sin PDF huérfano', async () => {
    const t = await setup();
    const antes = t.almacen.correlativos();
    const version = t.actual().actualizada;
    const pdf = pdfDemorado();
    const emision = t.ejecutar({ tipo: 'emitir' }, version);
    await pdf.empezado;
    // El número ya se reservó: el correlativo avanzó antes de terminar el PDF.
    expect(t.almacen.correlativos().siguienteCotizacion).toBe(antes.siguienteCotizacion + 1);
    await t.ir({ tipo: 'editar', cantidades: [{ indice: 0, cantidad: 5 }] });
    pdf.soltar();
    await expect(emision).rejects.toMatchObject({ status: 409 });
    expect(t.recargada()).toMatchObject({ estado: 'borrador', numero: null, pdf: null, solicitudes: [{ cantidad: 5 }] });
    // Queda un salto (nunca un número repetido), sin marca ni archivo a medio confirmar.
    expect(t.almacen.correlativos().siguienteCotizacion).toBe(antes.siguienteCotizacion + 1);
    expect(t.marcas()).toEqual([]);
    expect(await t.pdfs()).toEqual([]);
    // La siguiente emisión usa el número que sigue, no el reservado.
    await t.ir({ tipo: 'emitir' });
    expect(t.actual().numero).toBe(antes.siguienteCotizacion + 1);
  });

  it('eliminar el borrador mientras se genera su PDF: la emisión falla sin resucitarlo', async () => {
    const t = await setup();
    const pdf = pdfDemorado();
    const emision = t.ejecutar({ tipo: 'emitir' });
    await pdf.empezado;
    await t.ejecutar({ tipo: 'eliminar' });
    pdf.soltar();
    await expect(emision).rejects.toMatchObject({ status: 404 });
    expect(t.almacen.obtener(t.actual().id)).toBeNull();
    expect(t.marcas()).toEqual([]);
    expect(await t.pdfs()).toEqual([]);
  });

  it('pagar mientras se genera la nota de pedido: el pago queda y la nota responde 409 sin número', async () => {
    const t = await setup();
    await t.ir({ tipo: 'emitir' });
    await t.ir({ tipo: 'aprobar' });
    const anticipo = Math.ceil(t.actual().montos.total / 2);
    await t.ir({ tipo: 'pago', monto: anticipo });
    const antes = t.almacen.correlativos();
    const pdf = pdfDemorado();
    const nota = t.ejecutar({ tipo: 'generar_nota' });
    await pdf.empezado;
    await t.ir({ tipo: 'pago', monto: 1000 });
    pdf.soltar();
    await expect(nota).rejects.toMatchObject({ status: 409 });
    const q = t.recargada();
    expect(q.nota).toBeNull();
    expect(q.pagos?.map((p) => p.monto)).toEqual([anticipo, 1000]);
    expect(t.almacen.correlativos().siguienteNota).toBe(antes.siguienteNota + 1);
    expect(t.marcas()).toEqual([]);
    expect(await t.pdfs()).toEqual([]);
  });

  it('anular mientras se genera la nota de pedido: queda anulada y sin nota', async () => {
    const t = await setup();
    await t.ir({ tipo: 'emitir' });
    await t.ir({ tipo: 'aprobar' });
    await t.ir({ tipo: 'pago', monto: Math.ceil(t.actual().montos.total / 2) });
    const pdf = pdfDemorado();
    const nota = t.ejecutar({ tipo: 'generar_nota' });
    await pdf.empezado;
    await t.ir({ tipo: 'anular', motivo: 'El cliente desistió' });
    pdf.soltar();
    await expect(nota).rejects.toMatchObject({ status: 409 });
    expect(t.recargada()).toMatchObject({ estado: 'anulada', nota: null, motivoAnulacion: 'El cliente desistió' });
    expect(t.marcas()).toEqual([]);
  });
});

describe('Bloqueo del almacén', () => {
  it('con el bloqueo tomado por otro proceso (ELOCKED) responde ErrorOcupado 409 sin escribir', async () => {
    const t = await setup();
    vi.spyOn(lockfile, 'lock').mockRejectedValueOnce(Object.assign(new Error('Lock file is already being held'), { code: 'ELOCKED' }));
    const intento = t.ejecutar({ tipo: 'editar', cantidades: [{ indice: 0, cantidad: 7 }] });
    await expect(intento).rejects.toBeInstanceOf(ErrorOcupado);
    await expect(intento).rejects.toMatchObject({ status: 409, codigo: 'ocupado' });
    expect(t.recargada().solicitudes[0].cantidad).toBe(2);
  });

  it('si el bloqueo se compromete a mitad de la transacción, no confirma y responde ErrorOcupado', async () => {
    const t = await setup();
    const real = lockfile.lock;
    let comprometer!: (error: Error) => void;
    vi.spyOn(lockfile, 'lock').mockImplementationOnce(async (ruta, opciones) => {
      comprometer = opciones!.onCompromised!;
      return real(ruta, opciones);
    });
    const intento = t.almacen.transaccion((u) => {
      const q = u.obtener(t.actual().id)!;
      q.solicitudes[0].cantidad = 9;
      q.actualizada = new Date(Date.parse(q.actualizada) + 1).toISOString();
      u.guardar(q);
      comprometer(new Error('Unable to update lock within the stale threshold'));
    });
    await expect(intento).rejects.toBeInstanceOf(ErrorOcupado);
    expect(t.recargada().solicitudes[0].cantidad).toBe(2);
    // El bloqueo se liberó: la siguiente operación pasa.
    await t.ir({ tipo: 'editar', cantidades: [{ indice: 0, cantidad: 3 }] });
    expect(t.recargada().solicitudes[0].cantidad).toBe(3);
  });
});

describe('Chat', () => {
  it('dos chats en paralelo con el mismo nuevoId crean un solo borrador; el otro responde «mensaje procesado»', async () => {
    const t = await setup();
    const total = t.almacen.listar().total;
    const nuevoId = randomUUID();
    const dos = await Promise.allSettled([
      t.servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza 2 Molco', nuevoId }),
      t.servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza 2 Molco', nuevoId }),
    ]);
    const ok = dos.filter((r) => r.status === 'fulfilled');
    const fallidas = dos.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(fallidas).toHaveLength(1);
    expect(fallidas[0].reason).toMatchObject({ codigo: 'mensaje_procesado', detalle: { id: nuevoId } });
    expect(t.almacen.listar().total).toBe(total + 1);
    expect(t.almacen.eventos(nuevoId).map((e) => e.tipo)).toEqual(['creada']);
  });
});

describe('Emitir de noche en Chile (21:00–23:59)', () => {
  // Miércoles 14 de octubre de 2026: en Chile (UTC−3) las 21:00 y las 23:59 ya son jueves 15 en UTC.
  it.each([
    ['21:00', '2026-10-15T00:00:00.000Z'],
    ['23:59', '2026-10-15T02:59:00.000Z'],
  ])('a las %s la fecha, la vigencia y el PDF son del miércoles 14, no del jueves UTC', async (_hora, instante) => {
    const t = await setup();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instante));
    await t.ir({ tipo: 'emitir' });
    const q = t.recargada();
    expect(q.fechaEmision).toBe(instante);
    expect(fechaLocal(q.fechaEmision!)).toBe('2026-10-14');
    // La vigencia cuenta desde el miércoles en Chile.
    expect(q.vence).toBe(sumarDiasHabiles('2026-10-14', q.reglas?.vigenciaDiasHabiles ?? 10));
    expect(q.vence).not.toBe(sumarDiasHabiles('2026-10-15', q.reglas?.vigenciaDiasHabiles ?? 10));
    const html = vi.mocked(generarPdf).mock.calls[0][2];
    expect(html).toContain('14-10-2026');
    expect(html).not.toContain('15-10-2026');
    expect(q.estado).toBe('emitida');
  });
});

describe('Reimportar retirando un producto que usan los borradores', () => {
  it('el borrador sigue operable: reordenar funciona y emitir pide completar sin gastar un número', async () => {
    const t = await setup({ items: [pedido('MOLCO'), pedido('LLAIMA')] });
    expect(t.actual().montos.lineas).toHaveLength(2);
    // La planilla nueva ya no trae MOLCO (con forzar: la reducción es de 50 %).
    await t.almacen.guardarCatalogo({ ...catalogo, sha256: 'sin-molco', fecha: '2026-02-01', productos: [llaima] }, undefined, { forzar: true });
    const r = await t.ir({ tipo: 'reordenar', desde: 1, hasta: 0 });
    expect(r.cotizacion.solicitudes.map((s) => s.modelo)).toEqual(['LLAIMA', 'MOLCO']);
    // MOLCO queda pendiente (se ve en la pantalla); LLAIMA se sigue cotizando.
    expect(r.cotizacion.incompletos.length).toBeGreaterThan(0);
    expect(r.cotizacion.montos.lineas.map((l) => l.producto.codigo)).toEqual(['LLAI-O-3-A']);
    const antes = t.almacen.correlativos();
    await expect(t.ejecutar({ tipo: 'emitir' })).rejects.toMatchObject({ status: 400, codigo: 'incompleta' });
    expect(t.almacen.correlativos()).toEqual(antes);
    // Quitado el ítem retirado, se emite.
    await t.ir({ tipo: 'quitar', indice: 1 });
    await t.ir({ tipo: 'emitir' });
    expect(t.recargada()).toMatchObject({ estado: 'emitida', numero: antes.siguienteCotizacion });
  });
});

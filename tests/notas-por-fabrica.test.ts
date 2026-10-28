import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Catalogo, Producto, SolicitudItem } from '../src/catalogo/tipos';
import { clienteVacio } from '../src/catalogo/tipos';
import { CORRELATIVOS_NOTA, retrocesoOperativo, type Cotizacion } from '../src/negocio/estado';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { VERSION_ESQUEMA } from '../src/servidor/base-datos';
import { Servicio } from '../src/servidor/servicio';
import { generarPdf, plantilla } from '../src/servidor/pdf';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  // Como la plantilla real: el número se imprime con «N.º», que es lo que renumera la copia (auditoría BUG-016).
  plantilla: vi.fn(async (_q: unknown, doc: { tipo: string; numero: number }) => `<html><h1>N.º ${doc.numero}</h1>${doc.tipo}</html>`),
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
const cozcoz: Producto = {
  ...molco,
  codigo: 'COZC-PP-080-220',
  modelo: 'COZ COZ',
  madera: 'PREPINTADA',
  precioNeto: 50_000,
  descripcion: 'COZ COZ PREPINTADA',
  filaOrigen: 5,
};
const catalogo: Catalogo = { fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos: [molco, cozcoz] };
const pedidoMolco: SolicitudItem = { modelo: 'MOLCO', madera: 'PINO OREGON', ancho: 0.82, alto: 2, medida: null, cantidad: 2, tipoMedida: 'hoja' };
const pedidoCozcoz: SolicitudItem = { ...pedidoMolco, modelo: 'COZ COZ', madera: 'PREPINTADA', cantidad: 3 };
const admin = { nombre: 'Paula', email: 'paula@neltume.cl', admin: true };
const dirs: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

async function setup(usuario: { nombre: string; email: string; admin?: boolean } = admin) {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-fabricas-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  vi.setSystemTime('2026-09-01T15:00:00.000Z');
  const llm = {
    interpretar: vi.fn().mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { items: [pedidoMolco, pedidoCozcoz], cliente: { ...clienteVacio(), nombre: 'Ana Soto' } },
    }),
  };
  const servicio = new Servicio(catalogo, llm, almacen, usuario);
  let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza MOLCO y COZ COZ' })).cotizacion;
  const ir = async (accion: Record<string, unknown>) => {
    q = (await servicio.ejecutar({ ...accion, id: q.id, actualizada: q.actualizada } as never)).cotizacion;
    if (accion.tipo === 'aprobar') vi.setSystemTime('2026-10-01T15:00:00.000Z');
    return q;
  };
  const intentar = (accion: Record<string, unknown>) =>
    servicio.ejecutar({ ...accion, id: q.id, actualizada: q.actualizada } as never);
  const chat = async (mensaje: string, respuesta: unknown) => {
    llm.interpretar.mockResolvedValueOnce(respuesta);
    const r = await servicio.ejecutar({ tipo: 'chat', id: q.id, actualizada: q.actualizada, mensaje });
    q = r.cotizacion;
    return r;
  };
  const aprobada = async () => {
    await ir({ tipo: 'emitir' });
    await ir({ tipo: 'aprobar' });
    return ir({ tipo: 'pago', monto: Math.ceil(q.montos.total / 2), fecha: '2026-09-30' });
  };
  /** Aprobada con el anticipo, Molco a Panguipulli y Coz Coz a Santiago, y sus dos notas generadas. */
  const conNotas = async () => {
    await aprobada();
    return ir({
      tipo: 'generar_nota',
      asignaciones: [
        { indice: 0, fabrica: 'panguipulli' },
        { indice: 1, fabrica: 'santiago' },
      ],
    });
  };
  return { dir, almacen, servicio, llm, ir, intentar, chat, aprobada, conNotas, actual: () => q, recargada: () => almacen.obtener(q.id)! };
}

const nota = (q: Cotizacion, fabrica: string) => q.notas.find((n) => n.fabrica === fabrica)!;

describe('Notas de pedido por fábrica', () => {
  it('una cotización genera una nota por fábrica, cada una con sus líneas y su correlativo', async () => {
    const t = await setup();
    const q = await t.conNotas();
    expect(q.notas.map((n) => [n.fabrica, n.numero, n.pdf])).toEqual([
      ['panguipulli', CORRELATIVOS_NOTA.panguipulli, `nota-pedido-panguipulli-${CORRELATIVOS_NOTA.panguipulli}.pdf`],
      ['santiago', CORRELATIVOS_NOTA.santiago, `nota-pedido-santiago-${CORRELATIVOS_NOTA.santiago}.pdf`],
    ]);
    // Cada nota lleva solo los ítems de su fábrica, a precio de fábrica.
    expect(nota(q, 'panguipulli').montos.lineas.map((l) => [l.indice, l.cantidad, l.precioUnitario])).toEqual([[0, 2, 100_000]]);
    expect(nota(q, 'santiago').montos.lineas.map((l) => [l.indice, l.cantidad, l.precioUnitario])).toEqual([[1, 3, 50_000]]);
    expect(q.solicitudes.map((s) => s.fabrica)).toEqual(['panguipulli', 'santiago']);
    expect(q.estadoOperativo).toBe('pedido_generado');
    expect(t.almacen.correlativosNota()).toEqual({
      panguipulli: CORRELATIVOS_NOTA.panguipulli + 1,
      santiago: CORRELATIVOS_NOTA.santiago + 1,
    });
    // Se recargan iguales y el listado tiene una sola fila con las dos notas.
    expect(t.recargada().notas).toMatchObject(q.notas.map(({ despacho: _despacho, ...n }) => n));
    const filas = t.almacen.listar({}).cotizaciones.filter((c) => c.id === q.id);
    expect(filas).toHaveLength(1);
    expect(filas[0].notas.map((n) => n.numero)).toEqual([CORRELATIVOS_NOTA.panguipulli, CORRELATIVOS_NOTA.santiago]);
    expect(t.almacen.eventos(q.id).filter((e) => e.tipo === 'nota_generada')).toHaveLength(2);
    // Repetir no genera otras.
    expect((await t.ir({ tipo: 'generar_nota' })).notas).toHaveLength(2);
  });

  it('sin fábrica en algún ítem no se genera ninguna nota ni se gasta un número', async () => {
    const t = await setup();
    await t.aprobada();
    const antes = t.almacen.correlativosNota();
    await expect(
      t.intentar({ tipo: 'generar_nota', asignaciones: [{ indice: 0, fabrica: 'panguipulli' }] }),
    ).rejects.toMatchObject({ codigo: 'fabrica_sin_asignar' });
    expect(t.recargada().notas).toEqual([]);
    expect(t.almacen.correlativosNota()).toEqual(antes);
    expect(generarPdf).not.toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^nota-pedido/), expect.anything());
    // «fabrica» manda a esa fábrica los ítems que siguen sin asignar.
    const q = await t.ir({ tipo: 'generar_nota', fabrica: 'santiago' });
    expect(q.notas.map((n) => n.fabrica)).toEqual(['santiago']);
    expect(q.notas[0].montos.lineas).toHaveLength(2);
  });

  it('asignar fábricas en una emitida no crea revisión ni cambia el PDF; después de generar las notas, no se cambia', async () => {
    const t = await setup();
    const emitida = await t.ir({ tipo: 'emitir' });
    const pdf = emitida.pdf;
    const q = await t.ir({ tipo: 'asignar_fabricas', asignaciones: [{ indice: 1, fabrica: 'santiago' }] });
    expect(q).toMatchObject({ id: emitida.id, estado: 'emitida', pdf, numero: emitida.numero });
    expect(q.solicitudes.map((s) => s.fabrica ?? null)).toEqual([null, 'santiago']);
    expect(t.almacen.eventos(q.id).at(-1)).toMatchObject({ tipo: 'fabricas', detalle: expect.stringContaining('Santiago') });
    await t.ir({ tipo: 'aprobar' });
    await t.ir({ tipo: 'pago', monto: Math.ceil(q.montos.total / 2), fecha: '2026-09-30' });
    await t.ir({ tipo: 'generar_nota', asignaciones: [{ indice: 0, fabrica: 'panguipulli' }] });
    await expect(
      t.intentar({ tipo: 'asignar_fabricas', asignaciones: [{ indice: 0, fabrica: 'santiago' }] }),
    ).rejects.toMatchObject({ codigo: 'no_editable' });
  });

  it('cada fábrica inicia y termina su producción; el pedido sigue cuando terminan todas', async () => {
    const t = await setup();
    await t.conNotas();
    let q = await t.ir({ tipo: 'operacion', paso: 'iniciar_produccion', fabrica: 'panguipulli' });
    expect(q.estadoOperativo).toBe('en_produccion');
    expect(nota(q, 'panguipulli').inicioProduccion).toBeTruthy();
    expect(nota(q, 'santiago').inicioProduccion).toBeNull();
    // Santiago no ha empezado: no puede terminar.
    await expect(t.intentar({ tipo: 'operacion', paso: 'produccion_terminada', fabrica: 'santiago' })).rejects.toMatchObject({
      codigo: 'estado_invalido',
    });
    vi.setSystemTime('2026-10-02T15:00:00.000Z');
    q = await t.ir({ tipo: 'operacion', paso: 'iniciar_produccion', fabrica: 'santiago' });
    vi.setSystemTime('2026-10-03T15:00:00.000Z');
    q = await t.ir({ tipo: 'operacion', paso: 'produccion_terminada', fabrica: 'panguipulli' });
    expect(q.estadoOperativo).toBe('en_produccion');
    // Volver al paso anterior deshace el último paso registrado: el término de Panguipulli.
    expect(retrocesoOperativo(q)).toMatchObject({
      desde: 'Producción terminada en Panguipulli',
      hasta: 'En producción en Panguipulli',
      destino: 'en_produccion',
    });
    q = await t.ir({ tipo: 'retroceder_operacion', motivo: 'Se marcó antes de tiempo' });
    expect(nota(q, 'panguipulli').terminoProduccion).toBeNull();
    expect(t.almacen.eventos(q.id).at(-1)?.detalle).toContain('Producción terminada en Panguipulli');
    vi.setSystemTime('2026-10-04T15:00:00.000Z');
    // Sin fábrica, el paso va a todas las que estén en producción.
    q = await t.ir({ tipo: 'operacion', paso: 'produccion_terminada' });
    expect(q.notas.every((n) => n.terminoProduccion)).toBe(true);
    expect(q.estadoOperativo).toBe('saldo_pendiente');
    expect(t.recargada().notas.map((n) => [n.inicioProduccion, n.terminoProduccion])).toEqual(
      q.notas.map((n) => [n.inicioProduccion, n.terminoProduccion]),
    );
  });

  it('anular la cotización anula todas sus notas', async () => {
    const t = await setup();
    await t.conNotas();
    const q = await t.ir({ tipo: 'anular', motivo: 'Desistió' });
    expect(q.notas.map((n) => n.anulada)).toEqual([true, true]);
    expect(q.historial.at(-1)?.texto).toContain('las notas de pedido');
  });
});

describe('Cambio de número desde el documento', () => {
  it('la cotización cambia de número, vuelve a generar su PDF y los de sus notas, y la serie sigue desde ahí', async () => {
    const t = await setup();
    const antes = await t.conNotas();
    vi.mocked(plantilla).mockClear();
    const q = await t.ir({ tipo: 'cambiar_numero', documento: 'cotizacion', numero: 340 });
    expect(q.numero).toBe(340);
    expect(q.pdf).toBe('cotizacion-340.pdf');
    // Las notas conservan su número, con un PDF nuevo (el anterior no se sobrescribe).
    expect(q.notas.map((n) => [n.numero, n.pdf])).toEqual([
      [CORRELATIVOS_NOTA.panguipulli, `nota-pedido-panguipulli-${CORRELATIVOS_NOTA.panguipulli}-2.pdf`],
      [CORRELATIVOS_NOTA.santiago, `nota-pedido-santiago-${CORRELATIVOS_NOTA.santiago}-2.pdf`],
    ]);
    // Se reimprime desde el documento emitido cambiando solo el número (auditoría BUG-016): el HTML nuevo lleva el
    // número nuevo y conserva todo lo demás del emitido.
    const htmlDe = (archivo: string) =>
      (t.almacen.baseDatos().prepare('SELECT html FROM documentos_snapshot WHERE archivo = ?').get(archivo) as {
        html: string;
      }).html;
    expect(htmlDe(q.pdf!)).toContain('N.º 340');
    expect(htmlDe(q.pdf!)).not.toContain(`N.º ${antes.numero}`);
    for (const nota of q.notas) {
      expect(htmlDe(nota.pdf)).toContain(`N.º ${nota.numero}`);
    }
    const snapshots = (t.almacen.baseDatos().prepare('SELECT archivo FROM documentos_snapshot WHERE cotizacion_id = ? ORDER BY archivo').all(q.id) as { archivo: string }[]).map((f) => f.archivo);
    expect(snapshots).toEqual([q.pdf, ...q.notas.map((n) => n.pdf)].sort());
    expect(snapshots).not.toContain(antes.pdf);
    expect(t.almacen.porDocumento('cotizacion-340.pdf')?.id).toBe(q.id);
    expect(t.almacen.numeracion()).toMatchObject({ ultimo: 340, siguiente: 341 });
    expect(t.almacen.eventos(q.id).at(-1)).toMatchObject({ tipo: 'numero_cambiado', detalle: `Cotización N° ${antes.numero} → N° 340` });
  });

  it('rechaza un número usado o fuera de rango, y uno libre menor que el último no mueve la serie', async () => {
    const t = await setup();
    const q = await t.ir({ tipo: 'emitir' });
    // Otra cotización emitida ocupa el número siguiente.
    const otra = (await t.servicio.ejecutar({ tipo: 'duplicar', id: q.id })).cotizacion;
    const otraEmitida = (await t.servicio.ejecutar({ tipo: 'emitir', id: otra.id, actualizada: otra.actualizada })).cotizacion;
    await expect(t.intentar({ tipo: 'cambiar_numero', documento: 'cotizacion', numero: otraEmitida.numero })).rejects.toMatchObject({
      codigo: 'numero_usado',
    });
    await expect(t.intentar({ tipo: 'cambiar_numero', documento: 'cotizacion', numero: 99_999 })).rejects.toMatchObject({
      codigo: 'numero_invalido',
    });
    const libre = await t.ir({ tipo: 'cambiar_numero', documento: 'cotizacion', numero: 100 });
    expect(libre.numero).toBe(100);
    expect(t.almacen.numeracion().ultimo).toBe(otraEmitida.numero);
  });

  it('una nota cambia de número dentro de su fábrica', async () => {
    const t = await setup();
    await t.conNotas();
    const q = await t.ir({ tipo: 'cambiar_numero', documento: 'nota', fabrica: 'santiago', numero: 61 });
    expect(nota(q, 'santiago')).toMatchObject({ numero: 61, pdf: 'nota-pedido-santiago-61.pdf' });
    expect(nota(q, 'panguipulli').numero).toBe(CORRELATIVOS_NOTA.panguipulli);
    expect(t.almacen.correlativosNota().santiago).toBe(62);
    expect(t.almacen.porDocumento('nota-pedido-santiago-61.pdf')?.id).toBe(q.id);
    // El número es único dentro de la fábrica, no entre fábricas.
    await expect(
      t.intentar({ tipo: 'cambiar_numero', documento: 'nota', fabrica: 'panguipulli', numero: 61 }),
    ).resolves.toBeTruthy();
  });

  it('solo una cuenta administradora cambia números', async () => {
    const t = await setup({ nombre: 'Paulette', email: 'paulette@neltume.cl' });
    await t.ir({ tipo: 'emitir' });
    await expect(t.intentar({ tipo: 'cambiar_numero', documento: 'cotizacion', numero: 400 })).rejects.toMatchObject({
      codigo: 'sin_permiso',
    });
  });
});

describe('La IA reparte fábricas y cambia números', () => {
  it('asigna solo las fábricas que el mensaje nombra, también en una aprobada', async () => {
    const t = await setup();
    await t.aprobada();
    const asignar = (asignaciones: unknown) => ({ name: 'asignar_fabricas', input: { asignaciones } });
    // La IA dedujo la fábrica: el mensaje no la nombra, así que no se asigna y se pregunta.
    let r = await t.chat('reparte las fábricas', asignar([{ indice: 1, modelo: 'COZ COZ', fabrica: 'santiago' }]));
    expect(r.cotizacion.solicitudes.map((s) => s.fabrica ?? null)).toEqual([null, null]);
    expect(r.cotizacion.historial.at(-1)?.texto).toContain('¿A qué fábrica va cada ítem?');
    r = await t.chat(
      'las Coz Coz a Santiago y las Molco a Panguipulli',
      // Como Qwen en la evaluación: asigna en el orden del mensaje, pero el modelo que repite dice qué ítem es.
      asignar([
        { indice: 0, modelo: 'Coz Coz', fabrica: 'santiago' },
        { indice: 1, modelo: 'MOLCO', fabrica: 'panguipulli' },
      ]),
    );
    expect(r.cotizacion).toMatchObject({ estado: 'aprobada' });
    expect(r.cotizacion.solicitudes.map((s) => s.fabrica)).toEqual(['panguipulli', 'santiago']);
    expect(r.cotizacion.historial.at(-1)?.texto).toContain('Fábricas asignadas');
    // Un cambio de otro tipo sobre una aprobada no se aplica.
    r = await t.chat('que las Molco sean 5', {
      name: 'modificar_cotizacion',
      input: { items: [{ indice: 0, cambios: { cantidad: 5 } }] },
    });
    expect(r.cotizacion.solicitudes[0].cantidad).toBe(2);
    expect(r.cotizacion.historial.at(-1)?.texto).toContain('aprobada y no se puede editar');
  });

  it('un modificar_cotizacion que solo cambia fábricas en una emitida no abre una revisión', async () => {
    const t = await setup();
    const emitida = await t.ir({ tipo: 'emitir' });
    const r = await t.chat('todo a Santiago', {
      name: 'modificar_cotizacion',
      input: {
        items: [
          { indice: 0, cambios: { fabrica: 'santiago' } },
          { indice: 1, cambios: { fabrica: 'santiago' } },
        ],
      },
    });
    expect(r.cotizacion).toMatchObject({ id: emitida.id, estado: 'emitida', numero: emitida.numero });
    expect(r.cotizacion.solicitudes.map((s) => s.fabrica)).toEqual(['santiago', 'santiago']);
  });

  it('propone el cambio de número para confirmarlo, solo con los números escritos', async () => {
    const t = await setup();
    const q = await t.conNotas();
    const cambiar = (input: unknown) => ({ name: 'cambiar_numero', input });
    // El número nuevo no está en el mensaje: no se propone.
    let r = await t.chat('cambia el número de la nota de Santiago', cambiar({ documento: 'nota', fabrica: 'santiago', actual: null, numero: 61 }));
    expect(r.confirmarNumero).toBeUndefined();
    // Como el modelo real: completa `actual` con el número de hoy, que el mensaje no dice.
    r = await t.chat(
      'la nota de Santiago debe ser la 61',
      cambiar({ documento: 'nota', fabrica: 'santiago', actual: CORRELATIVOS_NOTA.santiago, numero: 61 }),
    );
    expect(r.confirmarNumero).toEqual({
      id: q.id,
      actualizada: r.cotizacion.actualizada,
      documento: 'nota',
      fabrica: 'santiago',
      actual: CORRELATIVOS_NOTA.santiago,
      numero: 61,
    });
    // Nada cambió hasta confirmarlo.
    expect(nota(t.recargada(), 'santiago').numero).toBe(CORRELATIVOS_NOTA.santiago);
    const confirmada = (await t.servicio.ejecutar({ tipo: 'cambiar_numero', ...r.confirmarNumero! })).cotizacion;
    expect(nota(confirmada, 'santiago').numero).toBe(61);
  });
});

describe('Migración v25', () => {
  it('lleva la nota única de v24 a las notas por fábrica, con su producción y la fábrica de sus ítems', async () => {
    const t = await setup();
    await t.aprobada();
    const q = await t.ir({ tipo: 'generar_nota', fabrica: 'panguipulli' });
    const db = t.almacen.baseDatos();
    // La base como la dejaba v24: una nota por cotización, sin producción por nota ni fábrica en ítems y líneas.
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE notas_v24 AS SELECT cotizacion_id, fabrica, numero, pdf, fecha, neto, iva, total, despacho_direccion,
        despacho_transporte, anulada, despacho_entrega, observaciones, despacho_destino, despacho_valor FROM notas_pedido;
      DROP TABLE notas_pedido;
      CREATE TABLE notas_pedido (
        cotizacion_id TEXT PRIMARY KEY REFERENCES cotizaciones(id) ON DELETE CASCADE,
        fabrica TEXT, numero INTEGER NOT NULL, pdf TEXT NOT NULL, fecha TEXT NOT NULL, neto INTEGER NOT NULL,
        iva INTEGER NOT NULL, total INTEGER NOT NULL, despacho_direccion TEXT, despacho_transporte TEXT,
        anulada INTEGER NOT NULL DEFAULT 0, despacho_entrega TEXT, observaciones TEXT, despacho_destino TEXT,
        despacho_valor INTEGER, UNIQUE (fabrica, numero)
      );
      INSERT INTO notas_pedido SELECT * FROM notas_v24;
      DROP TABLE notas_v24;
      ALTER TABLE nota_lineas DROP COLUMN fabrica;
      ALTER TABLE solicitudes DROP COLUMN fabrica;
      PRAGMA user_version = 24;
    `);
    db.pragma('foreign_keys = ON');
    db.prepare("UPDATE cotizaciones SET estado_operativo = 'pagada' WHERE id = ?").run(q.id);
    db.prepare("INSERT INTO eventos (cotizacion_id, fecha, usuario, tipo, detalle) VALUES (?, '2026-10-05T12:00:00.000Z', null, 'produccion', null)").run(q.id);
    db.prepare("INSERT INTO eventos (cotizacion_id, fecha, usuario, tipo, detalle) VALUES (?, '2026-10-09T12:00:00.000Z', null, 'produccion_terminada', null)").run(q.id);
    cerrarAlmacen(join(t.dir, 'cotizador.sqlite'));
    const migrada = new Almacen(t.dir).obtener(q.id)!;
    expect(new Almacen(t.dir).baseDatos().pragma('user_version', { simple: true })).toBe(VERSION_ESQUEMA);
    expect(migrada.notas).toHaveLength(1);
    expect(migrada.notas[0]).toMatchObject({
      fabrica: 'panguipulli',
      numero: q.notas[0].numero,
      inicioProduccion: '2026-10-05T12:00:00.000Z',
      terminoProduccion: '2026-10-09T12:00:00.000Z',
    });
    expect(migrada.notas[0].montos.lineas).toHaveLength(2);
    expect(migrada.solicitudes.map((s) => s.fabrica)).toEqual(['panguipulli', 'panguipulli']);
    // Desde «pagada», volver atrás deshace el término de producción.
    expect(retrocesoOperativo(migrada)).toMatchObject({ destino: 'en_produccion', nota: { campo: 'terminoProduccion' } });
  });
});

describe('Corregir el pedido después de generar las notas (editar_pedido)', () => {
  it('cambia la cotización y solo la nota de la fábrica del ítem, con el mismo número y PDF nuevos', async () => {
    const t = await setup();
    const antes = await t.conNotas();
    const [pangui, santiago] = [nota(antes, 'panguipulli'), nota(antes, 'santiago')];
    const r = await t.servicio.ejecutar({
      tipo: 'editar_pedido',
      id: antes.id,
      actualizada: antes.actualizada,
      items: [{ indice: 0, cambios: { cantidad: 4, observaciones: 'Bisagras reforzadas' } }],
    });
    const q = r.cotizacion;
    // La cotización del cliente cambia: cantidad, total y PDF (nuevo archivo, mismo número).
    expect(q.solicitudes[0]).toMatchObject({ cantidad: 4, observaciones: 'Bisagras reforzadas' });
    expect(q.montos.total).toBeGreaterThan(antes.montos.total);
    expect([q.estado, q.numero]).toEqual(['aprobada', antes.numero]);
    expect(q.pdf).not.toBe(antes.pdf);
    // La nota de Panguipulli se rehace con el mismo número y el costo nuevo; la de Santiago no se toca.
    const nueva = nota(q, 'panguipulli');
    expect([nueva.numero, nueva.montos.lineas.map((l) => [l.indice, l.cantidad])]).toEqual([pangui.numero, [[0, 4]]]);
    expect(nueva.pdf).not.toBe(pangui.pdf);
    // El despacho se recarga con sus campos nulos explícitos: se compara el resto.
    expect(nota(q, 'santiago')).toMatchObject({ ...santiago, despacho: expect.anything() });
    expect(vi.mocked(generarPdf)).toHaveBeenCalledWith(expect.any(String), q.pdf, expect.any(String));
    expect(vi.mocked(generarPdf)).toHaveBeenCalledWith(expect.any(String), nueva.pdf, expect.any(String));
    // Queda en el registro y se recarga igual.
    expect(t.almacen.eventos(q.id).some((e) => e.tipo === 'modificada' && /Pedido corregido: ítem 1 \(cantidad, observación\)/.test(e.detalle ?? ''))).toBe(true);
    expect(t.recargada().notas.map((n) => [n.numero, n.pdf])).toEqual(q.notas.map((n) => [n.numero, n.pdf]));
  });

  it('no se puede una vez que la fábrica del ítem empezó a producir; la otra fábrica sí se corrige', async () => {
    const t = await setup();
    await t.conNotas();
    await t.ir({ tipo: 'operacion', paso: 'iniciar_produccion', fabrica: 'panguipulli' });
    await expect(t.intentar({ tipo: 'editar_pedido', items: [{ indice: 0, cambios: { cantidad: 3 } }] })).rejects.toMatchObject({
      codigo: 'estado_invalido',
      message: expect.stringMatching(/Panguipulli ya empezó a producir/),
    });
    const q = await t.ir({ tipo: 'editar_pedido', items: [{ indice: 1, cambios: { descripcion: 'Puerta Coz Coz para baño' } }] });
    expect(q.solicitudes[1].descripcion).toBe('Puerta Coz Coz para baño');
  });

  it('sin cambios no regenera nada, y una cotización sin notas no se corrige así', async () => {
    const t = await setup();
    const antes = await t.conNotas();
    vi.mocked(generarPdf).mockClear();
    const q = await t.ir({ tipo: 'editar_pedido', items: [{ indice: 0, cambios: { cantidad: 2 } }] });
    expect(q.actualizada).toBe(antes.actualizada);
    expect(vi.mocked(generarPdf)).not.toHaveBeenCalled();
    const otra = await setup();
    await otra.aprobada();
    await expect(otra.intentar({ tipo: 'editar_pedido', items: [{ indice: 0, cambios: { cantidad: 3 } }] })).rejects.toMatchObject({
      codigo: 'estado_invalido',
    });
  });
});

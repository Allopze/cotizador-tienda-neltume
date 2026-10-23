import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import { CORRELATIVOS_NOTA, type Cotizacion, type Fabrica } from '../src/negocio/estado';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { generarPdf, plantilla } from '../src/servidor/pdf';
import { Servicio } from '../src/servidor/servicio';

// Plan de trabajo, fase 3 (docs/revision-2026-10-11.md §4): estados de la cotización (3.1, 3.2, 3.3, 3.6),
// número manual (3.4, la parte de rol está en plan-rutas.test.ts), regenerar un PDF (3.5), nota de pedido y
// detalles de S6 (3.9), y el control de versión de la unidad de trabajo (S6).

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
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
  tipoMedida: 'hoja',
};
const SIN_ANULAR = 'No se puede anular una cotización despachada, completada o facturada.';
const DESVINCULADA = 'La revisión en borrador quedó como cotización nueva.';

const dirs: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

type Ref = Pick<Cotizacion, 'id' | 'actualizada'>;
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-plan-fase3-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const llm = {
    interpretar: vi.fn().mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { items: [pedido], cliente: { ...clienteVacio(), nombre: 'Ana Soto' } },
    }),
  };
  const servicio = new Servicio(catalogo, llm, almacen, { nombre: 'Paula', email: 'paula@neltume.cl' });
  const crear = async () => (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza MOLCO' })).cotizacion;
  const sobre = (q: Ref, extra: Record<string, unknown>) =>
    servicio.ejecutar({ ...extra, id: q.id, actualizada: q.actualizada } as never);
  const ir = async (q: Ref, extra: Record<string, unknown>) => (await sobre(q, extra)).cotizacion;
  const leer = (id: string) => almacen.obtener(id)!;
  const eventos = (id: string) => almacen.eventos(id);
  const emitida = async () => ir(await crear(), { tipo: 'emitir' });
  const aprobada = async () => ir(await emitida(), { tipo: 'aprobar' });
  const mitad = (q: Cotizacion) => Math.ceil(q.montos.total / 2);
  const pagar = (q: Cotizacion, monto: number) => ir(q, { tipo: 'pago', monto });
  /** Aprobada con el 50 % pagado y la nota de pedido generada. */
  const conNota = async (q?: Cotizacion, fabrica: Fabrica = 'panguipulli') => {
    let c = q ?? (await aprobada());
    if (c.estado === 'borrador') c = await ir(await ir(c, { tipo: 'emitir' }), { tipo: 'aprobar' });
    c = await pagar(c, mitad(c));
    return ir(c, { tipo: 'generar_nota', fabrica });
  };
  const operar = (q: Ref, paso: string, extra: Record<string, unknown> = {}) =>
    ir(q, { tipo: 'operacion', paso, ...extra });
  /** Con nota, todo pagado, producción terminada y lista para despacho. */
  const listaParaDespacho = async () => {
    let q = await conNota();
    q = await pagar(q, q.montos.total - mitad(q));
    q = await operar(q, 'iniciar_produccion');
    q = await operar(q, 'produccion_terminada');
    return operar(q, 'lista_despacho');
  };
  const despachada = async () =>
    operar(await listaParaDespacho(), 'despachada', { despacho: { transporte: 'Starken' } });
  return {
    dir,
    almacen,
    servicio,
    crear,
    sobre,
    ir,
    leer,
    eventos,
    emitida,
    aprobada,
    mitad,
    pagar,
    conNota,
    operar,
    listaParaDespacho,
    despachada,
  };
}

describe('3.1 · rechazar una emitida la anula como «Anular»', () => {
  it('desvincula la revisión abierta, registra la anulación y la revisión se emite como cotización nueva', async () => {
    const t = await setup();
    const original = await t.emitida();
    const revision = await t.ir(original, { tipo: 'editar', cantidades: [{ indice: 0, cantidad: 3 }] });
    expect([revision.estado, revision.origen]).toEqual(['borrador', original.numero]);

    const r = await t.sobre(t.leer(original.id), { tipo: 'comercial', estado: 'rechazada' });
    expect(r.cotizacion).toMatchObject({
      estado: 'anulada',
      estadoComercial: 'rechazada',
      anuladaPor: 'Paula',
      motivoAnulacion: 'Rechazada por cliente',
    });
    expect(r.cotizacion.fechaAnulacion).toBeTruthy();
    expect(r.avisos).toEqual([expect.stringContaining('quedó como cotización nueva')]);
    // En la actividad queda como anulación, no como un cambio de seguimiento.
    expect(t.eventos(original.id).at(-1)).toMatchObject({
      tipo: 'anulada',
      usuario: 'Paula',
      detalle: 'Rechazada por cliente',
    });
    expect(t.eventos(original.id).map((e) => e.tipo)).not.toContain('seguimiento');
    expect(t.leer(original.id).historial.at(-1)?.texto).toBe(
      'Cotización N° 323 anulada. Motivo: Rechazada por cliente.',
    );

    const desvinculada = t.leer(revision.id);
    expect(desvinculada).toMatchObject({ estado: 'borrador', origen: null });
    expect(t.eventos(revision.id).at(-1)).toMatchObject({ tipo: 'desvinculada', detalle: 'N° 323 anulada' });
    // Al emitirla no se presenta como «Revisión de la N° 323» ni reemplaza a la anulada.
    const nueva = await t.ir(desvinculada, { tipo: 'emitir' });
    expect(nueva).toMatchObject({ numero: 324, origen: null, estado: 'emitida' });
    expect(vi.mocked(plantilla).mock.calls.at(-1)![0].origen).toBeNull();
    expect(t.leer(original.id)).toMatchObject({ estado: 'anulada', reemplazadaPor: null });
  });
});

describe('3.2 · aprobar con una revisión en borrador', () => {
  it('la desvincula con un aviso y la revisión se puede emitir como cotización nueva', async () => {
    const t = await setup();
    const original = await t.emitida();
    const revision = await t.ir(original, { tipo: 'editar', cantidades: [{ indice: 0, cantidad: 3 }] });
    const r = await t.sobre(t.leer(original.id), { tipo: 'aprobar' });
    expect(r.cotizacion.estado).toBe('aprobada');
    expect(r.avisos).toEqual([DESVINCULADA]);

    const desvinculada = t.leer(revision.id);
    expect(desvinculada).toMatchObject({ estado: 'borrador', origen: null });
    expect(desvinculada.historial.at(-1)).toEqual({ rol: 'asistente', texto: DESVINCULADA });
    expect(t.eventos(revision.id).at(-1)).toMatchObject({ tipo: 'desvinculada', usuario: 'Paula' });
    // Antes quedaba como borrador zombi que fallaba al emitir con «serie aprobada».
    const nueva = await t.ir(desvinculada, { tipo: 'emitir' });
    expect(nueva).toMatchObject({ numero: 324, origen: null, estado: 'emitida' });
    expect(t.leer(original.id)).toMatchObject({ estado: 'aprobada', reemplazadaPor: null });

    // Sin revisión abierta no hay aviso.
    const sola = await t.sobre(await t.emitida(), { tipo: 'aprobar' });
    expect(sola.avisos).toBeUndefined();
  });
});

describe('3.3 · anular después del despacho o de facturar', () => {
  const rechazo = { name: 'ErrorConflicto', status: 409, codigo: 'estado_invalido', message: SIN_ANULAR };

  it('una despachada o completada responde 409 y no cambia nada', async () => {
    const t = await setup();
    let q = await t.despachada();
    await expect(t.sobre(q, { tipo: 'anular', motivo: 'El cliente desistió' })).rejects.toMatchObject(
      rechazo,
    );
    expect(t.leer(q.id)).toMatchObject({
      estado: 'aprobada',
      estadoOperativo: 'despachada',
      anuladaPor: null,
    });
    q = await t.operar(q, 'completada');
    await expect(t.sobre(q, { tipo: 'anular' })).rejects.toMatchObject(rechazo);
    expect(t.leer(q.id)).toMatchObject({ estado: 'aprobada', estadoOperativo: 'completada' });
    expect(t.leer(q.id).notas[0]?.anulada).toBe(false);
    expect(t.eventos(q.id).map((e) => e.tipo)).not.toContain('anulada');
  });

  it('una facturada responde 409; al volver a pendiente de facturación se puede anular', async () => {
    const t = await setup();
    let q = await t.aprobada();
    q = await t.ir(q, {
      tipo: 'facturacion',
      estado: 'facturada',
      tipoDocumento: 'factura',
      identificadorExterno: '1234',
    });
    await expect(t.sobre(q, { tipo: 'anular' })).rejects.toMatchObject(rechazo);
    expect(t.leer(q.id).estado).toBe('aprobada');
    q = await t.ir(q, { tipo: 'facturacion', estado: 'pendiente' });
    expect((await t.ir(q, { tipo: 'anular' })).estado).toBe('anulada');
  });
});

describe('3.4 · número manual acotado', () => {
  it('un salto mayor a 1000 sobre el último se rechaza sin tocar el correlativo', async () => {
    const t = await setup();
    const reservar = (numero?: number) => t.almacen.transaccion((u) => u.reservarCotizacion(numero));
    // Último usado: 322.
    await expect(reservar(1323)).rejects.toMatchObject({ status: 409, codigo: 'numero_invalido' });
    expect(t.almacen.correlativos().siguienteCotizacion).toBe(323);
    await expect(reservar(1322)).resolves.toBe(1322);
    // El tope se mide desde el último ya reservado.
    await expect(reservar(2323)).rejects.toMatchObject({ codigo: 'numero_invalido' });
    await expect(reservar()).resolves.toBe(1323);

    // Por el servicio: el borrador sigue intacto y sin número.
    const q = await t.crear();
    await expect(t.sobre(q, { tipo: 'emitir', numero: 99_999 })).rejects.toMatchObject({
      codigo: 'numero_invalido',
    });
    expect(t.leer(q.id)).toMatchObject({ estado: 'borrador', numero: null, pdf: null });
    expect(t.almacen.correlativos().siguienteCotizacion).toBe(1324);
  });
});

describe('3.5 · regenerar un PDF perdido', () => {
  beforeEach(() => {
    // Como Chromium: escribe el archivo con el HTML recibido.
    vi.mocked(generarPdf).mockImplementation(async (directorio: string, archivo: string, html: string) => {
      await mkdir(join(directorio, 'pdf'), { recursive: true });
      await writeFile(join(directorio, 'pdf', archivo), html);
    });
  });
  afterEach(() => {
    vi.mocked(generarPdf).mockImplementation(async () => {});
    vi.mocked(plantilla).mockImplementation(async () => '<html/>');
  });

  it('con el archivo borrado lo recupera desde el snapshot; si el archivo existe no hace nada', async () => {
    const t = await setup();
    const ORIGINAL = '<html>Cotización N° 323 tal como se emitió</html>';
    vi.mocked(plantilla).mockResolvedValueOnce(ORIGINAL);
    const q = await t.emitida();
    const ruta = join(t.dir, 'pdf', 'cotizacion-323.pdf');
    expect(await readFile(ruta, 'utf8')).toBe(ORIGINAL);
    // Después cambian los datos de la empresa: la plantilla de hoy ya no daría el mismo documento.
    vi.mocked(plantilla).mockResolvedValue('<html>datos de hoy</html>');

    const generados = vi.mocked(generarPdf).mock.calls.length;
    const presente = await t.sobre(q, { tipo: 'regenerar_pdf', documento: 'cotizacion' });
    expect(presente).toMatchObject({ archivo: 'cotizacion-323.pdf', avisos: [] });
    expect(vi.mocked(generarPdf).mock.calls.length).toBe(generados);
    expect(t.eventos(q.id).map((e) => e.detalle)).not.toContain('PDF regenerado');

    await rm(ruta);
    const plantillas = vi.mocked(plantilla).mock.calls.length;
    const r = await t.sobre(q, { tipo: 'regenerar_pdf', documento: 'cotizacion' });
    expect(r).toMatchObject({ archivo: 'cotizacion-323.pdf', avisos: [] });
    expect(await readFile(ruta, 'utf8')).toBe(ORIGINAL);
    expect(vi.mocked(plantilla).mock.calls.length).toBe(plantillas);
    expect(t.eventos(q.id).at(-1)).toMatchObject({
      tipo: 'modificada',
      usuario: 'Paula',
      detalle: 'PDF regenerado',
    });
    expect(t.leer(q.id)).toMatchObject({ estado: 'emitida', numero: 323, pdf: 'cotizacion-323.pdf' });
    expect(t.almacen.correlativos().siguienteCotizacion).toBe(324);
  });

  it('también la nota de pedido; sin snapshot (documento anterior) usa los importes guardados y lo avisa', async () => {
    const t = await setup();
    let q = await t.aprobada();
    q = await t.pagar(q, t.mitad(q));
    vi.mocked(plantilla).mockResolvedValueOnce('<html>Nota N° 1 original</html>');
    q = await t.ir(q, { tipo: 'generar_nota', fabrica: 'panguipulli' });
    const nota = join(t.dir, 'pdf', `nota-pedido-panguipulli-${CORRELATIVOS_NOTA.panguipulli}.pdf`);
    await rm(nota);
    await t.ir(q, { tipo: 'regenerar_pdf', documento: 'nota' });
    expect(await readFile(nota, 'utf8')).toBe('<html>Nota N° 1 original</html>');

    // Un PDF emitido antes de guardar snapshots se rearma con el snapshot de montos de la cotización.
    t.almacen.baseDatos().prepare('DELETE FROM documentos_snapshot').run();
    await rm(join(t.dir, 'pdf', 'cotizacion-323.pdf'), { force: true });
    vi.mocked(plantilla).mockResolvedValueOnce('<html>rearmada</html>');
    const r = await t.sobre(t.leer(q.id), { tipo: 'regenerar_pdf', documento: 'cotizacion' });
    expect(r.avisos).toEqual([
      'Documento antiguo recuperado con sus importes originales y los datos de empresa actuales.',
    ]);
    const [cotizacion, documento] = vi.mocked(plantilla).mock.calls.at(-1)!;
    expect(cotizacion.id).toBe(q.id);
    expect(documento).toMatchObject({ tipo: 'cotizacion', numero: 323, montos: q.montos, vence: q.vence });
    expect(await readFile(join(t.dir, 'pdf', 'cotizacion-323.pdf'), 'utf8')).toBe('<html>rearmada</html>');
  });

  it('un borrador no tiene documento que recuperar', async () => {
    const t = await setup();
    await expect(
      t.sobre(await t.crear(), { tipo: 'regenerar_pdf', documento: 'cotizacion' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Todavía no hay un documento emitido que recuperar.',
    });
    expect(generarPdf).not.toHaveBeenCalled();
  });
});

describe('3.6 · caminos de vuelta', () => {
  const soloSin = {
    status: 409,
    codigo: 'estado_invalido',
    message: 'Solo puedes quitar la aprobación sin nota, pagos ni factura.',
  };

  it('desaprobar vuelve a emitida y se puede volver a aprobar', async () => {
    const t = await setup();
    const q = await t.aprobada();
    const r = await t.ir(q, { tipo: 'desaprobar' });
    expect(r).toMatchObject({
      estado: 'emitida',
      estadoComercial: 'enviada',
      aprobadaPor: null,
      numero: 323,
      pdf: 'cotizacion-323.pdf',
    });
    expect(t.leer(q.id)).toMatchObject({ estado: 'emitida', estadoComercial: 'enviada', aprobadaPor: null });
    expect(t.eventos(q.id).at(-1)).toMatchObject({
      tipo: 'modificada',
      usuario: 'Paula',
      detalle: 'Aprobación retirada',
    });
    expect((await t.ir(r, { tipo: 'aprobar' })).estado).toBe('aprobada');
    // Una emitida no tiene aprobación que quitar.
    await expect(t.sobre(await t.emitida(), { tipo: 'desaprobar' })).rejects.toMatchObject({
      codigo: 'estado_invalido',
    });
  });

  it('desaprobar se rechaza con pagos, con nota de pedido o con factura', async () => {
    const t = await setup();
    const conPago = await t.pagar(await t.aprobada(), 1000);
    await expect(t.sobre(conPago, { tipo: 'desaprobar' })).rejects.toMatchObject(soloSin);
    expect(t.leer(conPago.id).estado).toBe('aprobada');
    // La nota sin pagos: el anticipo se anuló después de generarla.
    let conNota = await t.conNota();
    conNota = await t.ir(conNota, { tipo: 'anular_pago', pagoId: conNota.pagos![0].id });
    expect(conNota).toMatchObject({ pagos: [], estadoOperativo: 'pedido_generado' });
    await expect(t.sobre(conNota, { tipo: 'desaprobar' })).rejects.toMatchObject(soloSin);
    const facturada = await t.ir(await t.aprobada(), {
      tipo: 'facturacion',
      estado: 'facturada',
      tipoDocumento: 'boleta',
    });
    await expect(t.sobre(facturada, { tipo: 'desaprobar' })).rejects.toMatchObject(soloSin);
    for (const q of [conPago, conNota, facturada]) expect(t.leer(q.id).estado).toBe('aprobada');
    expect(t.eventos(facturada.id).map((e) => e.detalle)).not.toContain('Aprobación retirada');
  });

  it('retroceder_operacion baja un paso con motivo hasta la nota de pedido', async () => {
    const t = await setup();
    let q = await t.operar(await t.despachada(), 'completada');
    await expect(t.sobre(q, { tipo: 'retroceder_operacion', motivo: '   ' })).rejects.toMatchObject({
      status: 400,
      message: 'Indica el motivo del retroceso.',
    });
    expect(t.leer(q.id).estadoOperativo).toBe('completada');
    const pasos: string[] = [];
    for (const motivo of [
      'Se marcó por error',
      'El camión no salió',
      'Falta revisar',
      'Volvió a taller',
      'Pedido en pausa',
    ]) {
      q = await t.ir(q, { tipo: 'retroceder_operacion', motivo });
      pasos.push(q.estadoOperativo!);
      expect(t.eventos(q.id).at(-1)).toMatchObject({
        tipo: 'modificada',
        usuario: 'Paula',
        detalle: `Paso operativo anterior: ${motivo}`,
      });
    }
    expect(pasos).toEqual(['despachada', 'lista_despacho', 'pagada', 'en_produccion', 'pedido_generado']);
    expect(t.leer(q.id).estadoOperativo).toBe('pedido_generado');
    await expect(t.sobre(q, { tipo: 'retroceder_operacion', motivo: 'Otra vez' })).rejects.toMatchObject({
      status: 409,
      message: 'No hay un paso operativo anterior disponible.',
    });
    // Desde en producción se puede volver a avanzar.
    q = await t.operar(q, 'iniciar_produccion');
    expect(q.estadoOperativo).toBe('en_produccion');
  });

  it('al volver de «lista para despacho» el estado se recalcula por lo pagado', async () => {
    const t = await setup();
    const q = await t.listaParaDespacho();
    expect(q.pagos).toHaveLength(2);
    // Lo pagado ya no cubre el total (un pago quitado de la base por quien administra).
    t.almacen.baseDatos().prepare('DELETE FROM pagos WHERE id = ?').run(q.pagos![1].id);
    const r = await t.ir(t.leer(q.id), { tipo: 'retroceder_operacion', motivo: 'Pago rebotado' });
    expect(r.estadoOperativo).toBe('saldo_pendiente');
    expect(t.leer(q.id).estadoOperativo).toBe('saldo_pendiente');
  });

  it('retroceder exige una cotización aprobada', async () => {
    const t = await setup();
    await expect(
      t.sobre(await t.emitida(), { tipo: 'retroceder_operacion', motivo: 'x' }),
    ).rejects.toMatchObject({
      codigo: 'estado_invalido',
    });
  });
});

describe('3.9 · nota de pedido', () => {
  it('reservarNota toma el mayor entre el contador y MAX(numero)+1', async () => {
    const t = await setup();
    const primera = CORRELATIVOS_NOTA.panguipulli;
    expect((await t.conNota()).notas[0]?.numero).toBe(primera);
    // Un respaldo viejo restaurado deja el contador atrás de las notas guardadas.
    t.almacen.baseDatos().prepare("UPDATE correlativos_nota SET siguiente = 1 WHERE fabrica = 'panguipulli'").run();
    const segunda = await t.conNota();
    expect(segunda.notas[0]?.numero).toBe(primera + 1);
    expect(t.almacen.correlativosNota().panguipulli).toBe(primera + 2);
    // Con el contador adelante (una nota que falló tras reservar), manda el contador.
    t.almacen.baseDatos().prepare('UPDATE correlativos_nota SET siguiente = ? WHERE fabrica = ?').run(primera + 10, 'panguipulli');
    await expect(t.almacen.transaccion((u) => u.reservarNota('panguipulli'))).resolves.toBe(primera + 10);
    expect(t.almacen.correlativosNota()).toEqual({ panguipulli: primera + 11, santiago: CORRELATIVOS_NOTA.santiago });
  });

  it('el destino y el valor del despacho de la nota se guardan en la base y se leen', async () => {
    const t = await setup();
    let q = await t.ir(await t.crear(), { tipo: 'editar', flete: 25_000 });
    q = await t.ir(q, { tipo: 'emitir' });
    q = await t.ir(q, { tipo: 'aprobar', despacho: { transporte: 'Starken', destino: 'Osorno' } });
    q = await t.conNota(q);
    const fila = t.almacen
      .baseDatos()
      .prepare('SELECT despacho_destino, despacho_valor FROM notas_pedido WHERE cotizacion_id = ?')
      .get(q.id);
    expect(fila).toEqual({ despacho_destino: 'Osorno', despacho_valor: 25_000 });
    expect(new Almacen(t.dir).obtener(q.id)!.notas[0].despacho).toMatchObject({
      transporte: 'Starken',
      destino: 'Osorno',
      valor: 25_000,
    });
    // Cambiar después el despacho de la cotización no toca la nota.
    q = await t.ir(q, { tipo: 'despacho', despacho: { destino: 'Temuco' } });
    expect(new Almacen(t.dir).obtener(q.id)!.notas[0].despacho).toMatchObject({
      destino: 'Osorno',
      valor: 25_000,
    });
  });

  it('editar con despacho {} no crea evento ni revisión', async () => {
    const t = await setup();
    const borrador = await t.crear();
    const n = t.eventos(borrador.id).length;
    const r = await t.ir(borrador, { tipo: 'editar', despacho: {} });
    expect(r).toMatchObject({ despacho: null, actualizada: borrador.actualizada });
    expect(t.eventos(borrador.id)).toHaveLength(n);

    const emitida = await t.ir(borrador, { tipo: 'emitir' });
    const eventos = t.eventos(emitida.id).length;
    const total = t.almacen.listar().total;
    const misma = await t.ir(emitida, { tipo: 'editar', despacho: {} });
    expect(misma).toMatchObject({ id: emitida.id, estado: 'emitida', actualizada: emitida.actualizada });
    expect(t.almacen.listar().total).toBe(total);
    expect(t.almacen.revisionAbierta(emitida)).toBeNull();
    expect(t.eventos(emitida.id)).toHaveLength(eventos);
  });
});

describe('S6 · control de versión de la unidad de trabajo', () => {
  it('si otra escritura cambia la versión entre la lectura y la confirmación, confirmar aborta con conflicto', async () => {
    const t = await setup();
    const q = await t.crear();
    const db = t.almacen.baseDatos();
    const otra = new Date(Date.parse(q.actualizada) + 60_000).toISOString();
    await expect(
      t.almacen.transaccion((u) => {
        const c = u.obtener(q.id)!;
        // Otra escritura que no pasó por el bloqueo (por ejemplo, con el bloqueo perdido).
        db.prepare('UPDATE cotizaciones SET actualizada = ? WHERE id = ?').run(otra, q.id);
        c.observaciones = 'Escrito sobre una versión vieja';
        u.guardar(c);
        u.registrarEvento(c.id, 'modificada', 'Paula', 'No debe quedar');
      }),
    ).rejects.toMatchObject({
      name: 'ErrorConflicto',
      status: 409,
      message: 'La cotización cambió durante la operación. Recarga y vuelve a intentar.',
    });
    expect(t.leer(q.id)).toMatchObject({ actualizada: otra, observaciones: null });
    expect(t.eventos(q.id).map((e) => e.detalle)).not.toContain('No debe quedar');

    // Sin otra escritura entremedio, la misma operación se confirma.
    await t.almacen.transaccion((u) => {
      const c = u.obtener(q.id)!;
      c.observaciones = 'Escrito sobre la versión vigente';
      u.guardar(c);
    });
    expect(t.leer(q.id).observaciones).toBe('Escrito sobre la versión vigente');
  });
});

describe('3.10 · notas de pedido por fábrica', () => {
  it('cada fábrica numera sus notas por separado, desde el número que se le fije', async () => {
    const t = await setup();
    t.almacen.fijarCorrelativoNota('panguipulli', 577);
    t.almacen.fijarCorrelativoNota('santiago', 59);
    const a = await t.conNota(undefined, 'panguipulli');
    const b = await t.conNota(undefined, 'santiago');
    const c = await t.conNota(undefined, 'panguipulli');
    expect([a.notas[0], b.notas[0], c.notas[0]]).toMatchObject([
      { numero: 577, fabrica: 'panguipulli', pdf: 'nota-pedido-panguipulli-577.pdf' },
      { numero: 59, fabrica: 'santiago', pdf: 'nota-pedido-santiago-59.pdf' },
      { numero: 578, fabrica: 'panguipulli' },
    ]);
    expect(t.almacen.correlativosNota()).toEqual({ panguipulli: 579, santiago: 60 });
    // Se guarda y se lee: la cotización y el listado del historial.
    expect(t.leer(b.id).notas[0]?.fabrica).toBe('santiago');
    expect(t.almacen.listar({}).cotizaciones.find((q) => q.id === b.id)?.notas[0]).toMatchObject({ numero: 59, fabrica: 'santiago' });
    expect(t.eventos(b.id).find((e) => e.tipo === 'nota_generada')?.detalle).toBe('Nota de pedido N° 59 · Santiago · precio fábrica');
    expect(vi.mocked(plantilla).mock.calls.map((c) => c[1]).filter((d) => d.tipo === 'nota')).toMatchObject([
      { numero: 577, fabrica: 'panguipulli' },
      { numero: 59, fabrica: 'santiago' },
      { numero: 578, fabrica: 'panguipulli' },
    ]);
  });

  it('el correlativo no puede bajar al último número usado por esa fábrica', async () => {
    const t = await setup();
    t.almacen.fijarCorrelativoNota('santiago', 59);
    await t.conNota(undefined, 'santiago');
    expect(() => t.almacen.fijarCorrelativoNota('santiago', 59)).toThrow(/mayor que el último usado \(59\)/);
    expect(() => t.almacen.fijarCorrelativoNota('santiago', 0)).toThrow();
    // La otra fábrica no tiene notas: puede partir donde sea, también en un número que ya usa Santiago.
    t.almacen.fijarCorrelativoNota('panguipulli', 59);
    expect((await t.conNota(undefined, 'panguipulli')).notas[0]?.numero).toBe(59);
  });

  it('una nota anterior a las fábricas queda sin fábrica y se le asigna sin chocar con las nuevas', async () => {
    const t = await setup();
    const antigua = await t.conNota();
    const db = t.almacen.baseDatos();
    db.prepare("UPDATE notas_pedido SET fabrica = NULL, numero = 900, pdf = 'nota-pedido-900.pdf' WHERE cotizacion_id = ?").run(antigua.id);
    expect(t.leer(antigua.id).notas[0]).not.toHaveProperty('fabrica');
    expect(t.almacen.notasSinFabrica()).toMatchObject([{ numero: 900, cliente: 'Ana Soto' }]);
    // Las notas sin fábrica siguen sin repetir número entre ellas.
    const otra = await t.conNota();
    expect(() =>
      db.prepare('UPDATE notas_pedido SET fabrica = NULL, numero = 900 WHERE cotizacion_id = ?').run(otra.id),
    ).toThrow(/UNIQUE/);

    t.almacen.fijarCorrelativoNota('santiago', 900);
    await t.conNota(undefined, 'santiago');
    expect(() => t.almacen.asignarFabricaNota(900, 'santiago')).toThrow('Santiago ya tiene una nota de pedido N° 900.');
    expect(() => t.almacen.asignarFabricaNota(901, 'panguipulli')).toThrow('No hay una nota de pedido N° 901 sin fábrica');
    const version = t.leer(antigua.id).actualizada;
    t.almacen.asignarFabricaNota(900, 'panguipulli');
    expect(t.leer(antigua.id).notas[0]).toMatchObject({ numero: 900, fabrica: 'panguipulli', pdf: 'nota-pedido-900.pdf' });
    expect(t.leer(antigua.id).actualizada > version).toBe(true);
    expect(t.eventos(antigua.id).at(-1)?.detalle).toBe('Nota de pedido N° 900 asignada a Panguipulli');
    expect(t.almacen.notasSinFabrica()).toEqual([]);
    // El correlativo de Panguipulli pasa por encima de la nota asignada.
    t.almacen.baseDatos().prepare("UPDATE correlativos_nota SET siguiente = 1 WHERE fabrica = 'panguipulli'").run();
    expect(t.almacen.correlativosNota().panguipulli).toBe(901);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import { etiquetaOperativo, puedeAnular, rangoFechaOperacion, type Cotizacion } from '../src/negocio/estado';
import { bajoElCosto, precioEnRango, rangoPrecio } from '../src/negocio/limites';
import { cotizar } from '../src/negocio/precios';
import { Almacen, cerrarAlmacen, EMISION_VIGENTE_MS } from '../src/servidor/almacen';
import { abrirBaseDatos, cerrarBaseDatos, VERSION_ESQUEMA } from '../src/servidor/base-datos';
import { cotizacionSchema } from '../src/servidor/persistencia-esquemas';
import { generarPdf } from '../src/servidor/pdf';
import { guardarCatalogo, RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { Servicio } from '../src/servidor/servicio';

// Fase 1 del plan sobre docs/verificacion-pendiente.md: doble emisión (#1), venta bajo el costo (#2), restaurar un
// borrador (#3), anular (#4, #16), fechas de pagos y facturas (#12, #42), importar mientras se emite (#15) y avisos
// de las ediciones directas en la actividad (#17).

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
const dirs: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

/** Servicio sobre una base propia; con `catalogoVivo`, el catálogo es el de la base (como en la aplicación). */
async function setup({ catalogoVivo = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-fase1-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  if (catalogoVivo) guardarCatalogo(almacen.baseDatos(), catalogo);
  const llm = {
    interpretar: vi.fn().mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { items: [pedido], cliente: { ...clienteVacio(), nombre: 'Ana Soto' } },
    }),
  };
  const fuente = catalogoVivo ? new RepositorioCatalogoSqlite(almacen.baseDatos()) : catalogo;
  const servicio = new Servicio(fuente, llm, almacen, { nombre: 'Paula', email: 'paula@neltume.cl' });
  let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza MOLCO' })).cotizacion;
  const ejecutar = (accion: Record<string, unknown>) =>
    servicio.ejecutar({ ...accion, id: q.id, actualizada: q.actualizada } as never);
  const ir = async (accion: Record<string, unknown>) => {
    const r = await ejecutar(accion);
    q = r.cotizacion;
    return r;
  };
  const anticipo = () => Math.ceil(q.montos.total / 2);
  return {
    dir,
    almacen,
    servicio,
    ejecutar,
    ir,
    anticipo,
    actual: () => q,
    recargada: () => new Almacen(dir).obtener(q.id)!,
    eventos: () => almacen.eventos(q.id),
    marcas: () => almacen.baseDatos().prepare('SELECT * FROM emisiones_en_curso').all(),
  };
}

/** generarPdf tarda hasta que la prueba lo suelta: las dos emisiones se cruzan mientras se genera el PDF. */
function pdfDemorado() {
  let soltar!: () => void;
  const listo = new Promise<void>((r) => (soltar = r));
  vi.mocked(generarPdf).mockImplementationOnce(() => listo);
  return () => soltar();
}

/** 'ok' o 'error' según cómo termine la primera de las promesas en terminar. */
const primeraEnTerminar = (promesas: Promise<unknown>[]) =>
  Promise.race(promesas.map((p) => p.then(() => 'ok', () => 'error')));

describe('#1 · doble emisión', () => {
  it('dos «emitir» simultáneos: uno emite, el otro responde 409 sin gastar un número', async () => {
    const t = await setup();
    const antes = t.almacen.correlativos();
    const soltar = pdfDemorado();
    const dos = [t.ejecutar({ tipo: 'emitir' }), t.ejecutar({ tipo: 'emitir' })];
    // La segunda choca con la marca mientras la primera sigue generando el PDF: es la primera en terminar.
    expect(await primeraEnTerminar(dos)).toBe('error');
    expect(t.marcas()).toHaveLength(1);
    soltar();
    const resultados = await Promise.allSettled(dos);
    const ok = resultados.filter((r) => r.status === 'fulfilled');
    const fallidas = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(fallidas).toHaveLength(1);
    expect(fallidas[0].reason).toMatchObject({ status: 409, message: expect.stringMatching(/^Ya se está generando el PDF de esta cotización/) });
    expect(t.almacen.correlativos()).toEqual({ ...antes, siguienteCotizacion: antes.siguienteCotizacion + 1 });
    expect(t.recargada()).toMatchObject({ estado: 'emitida', numero: antes.siguienteCotizacion });
    expect(vi.mocked(generarPdf)).toHaveBeenCalledTimes(1);
    expect(t.marcas()).toEqual([]);
  });

  it('dos «generar_nota» simultáneos: una nota, un 409 y el correlativo de notas +1', async () => {
    const t = await setup();
    await t.ir({ tipo: 'emitir' });
    await t.ir({ tipo: 'aprobar' });
    await t.ir({ tipo: 'pago', monto: t.anticipo() });
    const antes = t.almacen.correlativosNota();
    const soltar = pdfDemorado();
    const dos = [t.ejecutar({ tipo: 'generar_nota', fabrica: 'panguipulli' }), t.ejecutar({ tipo: 'generar_nota', fabrica: 'panguipulli' })];
    expect(await primeraEnTerminar(dos)).toBe('error');
    expect(t.marcas()).toHaveLength(1);
    soltar();
    const resultados = await Promise.allSettled(dos);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const fallida = resultados.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
    expect(fallida.reason).toMatchObject({ status: 409, message: expect.stringMatching(/^Ya se está generando la nota de pedido/) });
    expect(t.almacen.correlativosNota()).toEqual({ ...antes, panguipulli: antes.panguipulli + 1 });
    expect(t.recargada().notas[0]).toMatchObject({ numero: antes.panguipulli, fabrica: 'panguipulli' });
    expect(t.marcas()).toEqual([]);
  });

  it('la marca se libera si el PDF falla: el reintento emite (con un salto, nunca un número repetido)', async () => {
    const t = await setup();
    const antes = t.almacen.correlativos().siguienteCotizacion;
    vi.mocked(generarPdf).mockRejectedValueOnce(new Error('Chromium se cayó'));
    await expect(t.ejecutar({ tipo: 'emitir' })).rejects.toThrow('Chromium se cayó');
    expect(t.marcas()).toEqual([]);
    await t.ir({ tipo: 'emitir' });
    expect(t.actual().numero).toBe(antes + 1);
  });

  it('una marca de otra emisión en curso detiene la emisión; una vencida (un corte) no', async () => {
    const t = await setup();
    const db = t.almacen.baseDatos();
    const marcar = (vence: number) =>
      db
        .prepare("INSERT OR REPLACE INTO emisiones_en_curso (cotizacion_id, documento, ficha, vence) VALUES (?, 'cotizacion', 'otra', ?)")
        .run(t.actual().id, new Date(vence).toISOString());
    const antes = t.almacen.correlativos();
    marcar(Date.now() + EMISION_VIGENTE_MS);
    await expect(t.ejecutar({ tipo: 'emitir' })).rejects.toMatchObject({ status: 409, codigo: 'ocupado' });
    expect(t.almacen.correlativos()).toEqual(antes);
    marcar(Date.now() - 1);
    await t.ir({ tipo: 'emitir' });
    expect(t.actual()).toMatchObject({ estado: 'emitida', numero: antes.siguienteCotizacion });
    expect(t.marcas()).toEqual([]);
  });
});

describe('#2 y #17 · venta bajo el costo y avisos de una edición directa', () => {
  it('el rango de precio es uno solo para el cálculo y la validación', () => {
    expect(rangoPrecio(100_000)).toEqual({ min: 50_000, max: 600_000 });
    expect([49_999, 50_000, 600_000, 600_001].map((p) => precioEnRango(p, 100_000))).toEqual([false, true, true, false]);
    expect([bajoElCosto(99_999, 100_000), bajoElCosto(100_000, 100_000)]).toEqual([true, false]);
    // cotizar acepta el borde inferior y rechaza lo que queda fuera, como la validación de los ítems.
    expect(cotizar([{ producto: molco, cantidad: 1, precioUnitario: 50_000 }]).lineas[0].precioUnitario).toBe(50_000);
    expect(() => cotizar([{ producto: molco, cantidad: 1, precioUnitario: 49_999 }])).toThrow();
  });

  it('un precio escrito bajo el costo se cotiza con un aviso que queda en la actividad', async () => {
    const t = await setup();
    const r = await t.ir({ tipo: 'editar', items: [{ indice: 0, cambios: { precioUnitario: 80_000 } }] });
    const aviso = 'El precio de MOL-O-3-A queda bajo el costo de fábrica ($100.000).';
    expect(r.avisos).toContain(aviso);
    expect(t.actual().incompletos).toEqual([]);
    expect(t.actual().montos.lineas[0].precioUnitario).toBe(80_000);
    expect(t.eventos().at(-1)).toMatchObject({ tipo: 'modificada', detalle: expect.stringContaining(`Aviso: ${aviso}`) });
    // Mientras no cambien el precio ni el costo, no se repite.
    const otra = await t.ir({ tipo: 'editar', cantidades: [{ indice: 0, cantidad: 3 }] });
    expect(otra.avisos ?? []).not.toContain(aviso);
    // Sobre el costo no hay aviso; bajo −50 % el ítem queda pendiente, como antes.
    expect((await t.ir({ tipo: 'editar', items: [{ indice: 0, cambios: { precioUnitario: 100_000 } }] })).avisos ?? []).toEqual([]);
  });

  it('una ganancia negativa también avisa, y la siguiente medida queda en la actividad', async () => {
    const t = await setup();
    const r = await t.ir({ tipo: 'editar', items: [{ indice: 0, cambios: { margen: -0.1 } }] });
    expect(r.avisos).toContain('El precio de MOL-O-3-A queda bajo el costo de fábrica ($100.000).');
    // Un ancho entre escalones se cotiza con la siguiente medida: el aviso también se registra.
    const ancho = await t.ir({ tipo: 'editar', items: [{ indice: 0, cambios: { ancho: 0.78 } }] });
    const medida = (ancho.avisos ?? []).find((a) => a.includes('siguiente medida'));
    expect(medida).toBeDefined();
    expect(t.eventos().at(-1)!.detalle).toContain(`Aviso: ${medida}`);
  });
});

describe('#3 · restaurar un borrador de la papelera', () => {
  it('conserva el destino y el valor del despacho, y vuelve con su actividad', async () => {
    const t = await setup();
    await t.ir({ tipo: 'editar', despacho: { destino: 'Osorno', transporte: 'Camión propio', valor: 25_000 } });
    expect(t.actual().despacho).toMatchObject({ destino: 'Osorno', valor: 25_000 });
    const antes = t.eventos();
    expect(antes.length).toBeGreaterThan(0);
    await t.ir({ tipo: 'eliminar' });
    expect(t.almacen.eventos(t.actual().id)).toEqual([]);
    const [enPapelera] = t.almacen.papelera();
    const r = await t.servicio.ejecutar({ tipo: 'restaurar_borrador', id: enPapelera.id, actualizada: enPapelera.actualizada } as never);
    expect(r.cotizacion.despacho).toMatchObject({ destino: 'Osorno', valor: 25_000, transporte: 'Camión propio' });
    expect(new Almacen(t.dir).obtener(enPapelera.id)!.despacho).toMatchObject({ destino: 'Osorno', valor: 25_000 });
    const despues = t.almacen.eventos(enPapelera.id);
    expect(despues.slice(0, antes.length)).toEqual(antes);
    expect(despues.at(-1)).toMatchObject({ tipo: 'modificada', detalle: 'Borrador restaurado de la papelera' });
  });
});

describe('#4 y #16 · anular', () => {
  const base = { numero: 330, pagos: [], facturacion: undefined, reemplazadaPor: null } as const;
  it('puedeAnular: solo emitidas y aprobadas sin despacho ni factura, con el motivo para la pantalla', () => {
    const q = (cambios: Partial<Cotizacion>) => ({ ...base, estado: 'aprobada', estadoOperativo: 'sin_pedido', ...cambios }) as Cotizacion;
    expect(puedeAnular(q({ estado: 'emitida' }))).toEqual({ ok: true, pagado: 0 });
    expect(puedeAnular(q({ estadoOperativo: 'en_produccion', pagos: [{ id: 'a', fecha: '', monto: 1000, observacion: null, usuario: null }, { id: 'b', fecha: '', monto: 500, observacion: null, usuario: null }] }))).toEqual({ ok: true, pagado: 1500 });
    expect(puedeAnular(q({ estadoOperativo: 'lista_despacho' }))).toMatchObject({ ok: true });
    for (const cambios of [
      { estadoOperativo: 'despachada' },
      { estadoOperativo: 'completada' },
      { facturacion: { estado: 'facturada', tipo: 'boleta', identificadorExterno: null, fecha: null } },
    ] as Partial<Cotizacion>[])
      expect(puedeAnular(q(cambios))).toEqual({ ok: false, motivo: 'No se puede anular una cotización despachada, completada o facturada.' });
    expect(puedeAnular(q({ estado: 'borrador', numero: null }))).toEqual({ ok: false, motivo: 'Un borrador no se anula: elimínalo.' });
    expect(puedeAnular(q({ estado: 'reemplazada' }))).toEqual({ ok: false, motivo: 'La cotización N° 330 fue reemplazada y ya no está vigente.' });
    expect(puedeAnular(q({ estado: 'anulada' }))).toMatchObject({ ok: false });
  });

  it('el servidor aplica la misma regla y el evento registra lo pagado', async () => {
    const t = await setup();
    await t.ir({ tipo: 'emitir' });
    await t.ir({ tipo: 'aprobar' });
    await t.ir({ tipo: 'pago', monto: 30_000 });
    await t.ir({ tipo: 'anular', motivo: 'Cliente desistió' });
    expect(t.eventos().at(-1)).toMatchObject({
      tipo: 'anulada',
      detalle: 'Cliente desistió · Pagos registrados: $30.000 (anular no los devuelve)',
    });
    expect(t.actual().historial.at(-1)!.texto).toContain('Pagos registrados: $30.000');

    const f = await setup();
    await f.ir({ tipo: 'emitir' });
    await f.ir({ tipo: 'aprobar' });
    await f.ir({ tipo: 'facturacion', estado: 'facturada', tipoDocumento: 'boleta' });
    await expect(f.ejecutar({ tipo: 'anular', motivo: 'x' })).rejects.toMatchObject({
      status: 409,
      message: (puedeAnular(f.actual()) as { motivo: string }).motivo,
    });
  });
});

describe('#12 y #42 · fechas de pagos y facturas en hora de Chile', () => {
  // 02:30 UTC del 13 de octubre: en Chile son las 23:30 del 12 (horario de verano, UTC−3).
  const AHORA = '2026-10-13T02:30:00Z';

  it('sin fecha usan el día de Chile a mediodía; no aceptan días futuros ni anteriores a la aprobación', async () => {
    vi.setSystemTime(AHORA);
    const t = await setup();
    await t.ir({ tipo: 'emitir' });
    await t.ir({ tipo: 'aprobar' });
    expect(t.recargada().fechaAprobacion).toBe('2026-10-13T02:30:00.000Z');
    expect(rangoFechaOperacion(t.actual().fechaAprobacion)).toEqual({ min: '2026-10-12', max: '2026-10-12' });

    await t.ir({ tipo: 'pago', monto: 1000 });
    expect(t.recargada().pagos![0].fecha).toBe('2026-10-12T12:00:00.000Z');
    expect(t.eventos().at(-1)!.detalle).toBe('$1.000 · 2026-10-12');
    await expect(t.ejecutar({ tipo: 'pago', monto: 1000, fecha: '2026-10-13' })).rejects.toThrow(
      'La fecha del pago no puede ser posterior a hoy (12-10-2026).',
    );
    await expect(t.ejecutar({ tipo: 'pago', monto: 1000, fecha: '2026-10-11' })).rejects.toThrow(
      'La fecha del pago no puede ser anterior a la aprobación (12-10-2026).',
    );
    await t.ir({ tipo: 'pago', monto: 1000, fecha: '2026-10-12' });

    await t.ir({ tipo: 'facturacion', estado: 'facturada', tipoDocumento: 'factura', identificadorExterno: '77' });
    expect(t.recargada().facturacion!.fecha).toBe('2026-10-12T12:00:00.000Z');
    await t.ir({ tipo: 'facturacion', estado: 'pendiente' });
    await expect(
      t.ejecutar({ tipo: 'facturacion', estado: 'facturada', tipoDocumento: 'factura', fecha: '2026-10-13' }),
    ).rejects.toThrow('La fecha de la factura no puede ser posterior a hoy (12-10-2026).');
    await expect(
      t.ejecutar({ tipo: 'facturacion', estado: 'facturada', tipoDocumento: 'factura', fecha: '2026-10-01' }),
    ).rejects.toThrow('La fecha de la factura no puede ser anterior a la aprobación (12-10-2026).');
  });

  it('una aprobación anterior a v23 usa la fecha de su evento y la guarda', async () => {
    vi.setSystemTime('2026-10-05T15:00:00Z');
    const t = await setup();
    await t.ir({ tipo: 'emitir' });
    await t.ir({ tipo: 'aprobar' });
    // Como una base anterior: la columna vacía.
    t.almacen.baseDatos().prepare('UPDATE cotizaciones SET fecha_aprobacion = NULL').run();
    const sinFecha = t.recargada();
    expect(sinFecha.fechaAprobacion).toBeUndefined();
    vi.setSystemTime(AHORA);
    const ejecutar = (accion: Record<string, unknown>) =>
      t.servicio.ejecutar({ ...accion, id: sinFecha.id, actualizada: sinFecha.actualizada } as never);
    await expect(ejecutar({ tipo: 'pago', monto: 1000, fecha: '2026-10-04' })).rejects.toThrow(/anterior a la aprobación \(05-10-2026\)/);
    await ejecutar({ tipo: 'pago', monto: 1000, fecha: '2026-10-05' });
    expect(t.recargada().fechaAprobacion).toBe('2026-10-05T15:00:00.000Z');
  });

  it('la migración v23 completa la fecha de aprobación con el evento y se puede repetir', async () => {
    vi.setSystemTime('2026-10-05T15:00:00Z');
    const t = await setup();
    await t.ir({ tipo: 'emitir' });
    await t.ir({ tipo: 'aprobar' });
    const ruta = join(t.dir, 'cotizador.sqlite');
    const db = abrirBaseDatos(ruta);
    db.exec('DROP TABLE emisiones_en_curso; ALTER TABLE cotizaciones DROP COLUMN fecha_aprobacion; PRAGMA user_version = 22;');
    cerrarBaseDatos(ruta);
    expect(abrirBaseDatos(ruta).pragma('user_version', { simple: true })).toBe(VERSION_ESQUEMA);
    expect(new Almacen(t.dir).obtener(t.actual().id)!.fechaAprobacion).toBe('2026-10-05T15:00:00.000Z');
    abrirBaseDatos(ruta).pragma('user_version = 22');
    cerrarBaseDatos(ruta);
    expect(abrirBaseDatos(ruta).pragma('user_version', { simple: true })).toBe(VERSION_ESQUEMA);
  });

  it('quitar la aprobación borra su fecha', async () => {
    const t = await setup();
    await t.ir({ tipo: 'emitir' });
    await t.ir({ tipo: 'aprobar' });
    await t.ir({ tipo: 'desaprobar' });
    expect(t.recargada().fechaAprobacion).toBeUndefined();
  });
});

describe('#15 · importar el catálogo mientras se emite', () => {
  const nuevo: Catalogo = {
    ...catalogo,
    sha256: 'otra-planilla',
    fecha: '2026-02-01',
    productos: [{ ...molco, precioNeto: 120_000 }],
  };

  it('la emisión guarda la versión del catálogo con que calculó sus montos, no la que quedó al confirmar', async () => {
    const t = await setup({ catalogoVivo: true });
    const repo = new RepositorioCatalogoSqlite(t.almacen.baseDatos());
    const conQueSeCalculo = repo.version;
    vi.mocked(generarPdf).mockImplementationOnce(async () => {
      await t.almacen.guardarCatalogo(nuevo);
    });
    await t.ir({ tipo: 'emitir' });
    expect(repo.version).not.toBe(conQueSeCalculo);
    expect(t.recargada()).toMatchObject({ versionCatalogo: conQueSeCalculo, montos: { lineas: [{ precioFabrica: 100_000 }] } });
  });

  it('guardarCatalogo espera el bloqueo del almacén', async () => {
    const t = await setup({ catalogoVivo: true });
    const repo = new RepositorioCatalogoSqlite(t.almacen.baseDatos());
    const antes = repo.version;
    let soltar: (() => void) | undefined;
    const ocupado = t.almacen.transaccion(() => new Promise<void>((r) => (soltar = r)));
    await vi.waitFor(() => expect(soltar).toBeDefined());
    let listo = false;
    const importacion = t.almacen.guardarCatalogo(nuevo).then(() => (listo = true));
    await new Promise((r) => setTimeout(r, 400));
    expect(listo).toBe(false);
    expect(repo.version).toBe(antes);
    soltar!();
    await ocupado;
    await importacion;
    expect(repo.version).not.toBe(antes);
  });

  it('con la versión esperada, una segunda confirmación de la misma vista previa no guarda', async () => {
    const t = await setup({ catalogoVivo: true });
    const repo = new RepositorioCatalogoSqlite(t.almacen.baseDatos());
    const vista = repo.version!;
    await t.almacen.guardarCatalogo(nuevo, undefined, { versionEsperada: vista });
    const despues = repo.version;
    await expect(
      t.almacen.guardarCatalogo({ ...nuevo, sha256: 'tercera' }, undefined, { versionEsperada: vista }),
    ).rejects.toMatchObject({ name: 'ErrorCatalogoCambiado' });
    expect(repo.version).toBe(despues);
  });
});

describe('#39 · el estado «produccion_terminada» ya no existe', () => {
  it('un dato guardado con él se lee como «en_produccion», en la ficha, el listado y el esquema', async () => {
    const t = await setup();
    await t.ir({ tipo: 'emitir' });
    await t.ir({ tipo: 'aprobar' });
    await t.ir({ tipo: 'pago', monto: t.anticipo() });
    await t.ir({ tipo: 'generar_nota', fabrica: 'panguipulli' });
    t.almacen
      .baseDatos()
      .prepare("UPDATE cotizaciones SET estado_operativo = 'produccion_terminada' WHERE id = ?")
      .run(t.actual().id);
    const recargada = t.recargada();
    expect(recargada.estadoOperativo).toBe('en_produccion');
    expect(new Almacen(t.dir).listar().cotizaciones.find((c) => c.id === recargada.id)!.estadoOperativo).toBe('en_produccion');
    expect(cotizacionSchema.parse({ ...recargada, estadoOperativo: 'produccion_terminada' }).estadoOperativo).toBe('en_produccion');
    expect(etiquetaOperativo).not.toHaveProperty('produccion_terminada');
    // Desde ahí sigue el flujo normal: el paso «Producción terminada» lo deja pagado o con saldo pendiente.
    await t.ir({ tipo: 'operacion', paso: 'produccion_terminada' });
    expect(['saldo_pendiente', 'pagada']).toContain(t.actual().estadoOperativo);
  });
});

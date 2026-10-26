import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Catalogo, Producto, ReferenciaItem, SolicitudItem } from '../src/catalogo/tipos';
import { fusionarItems } from '../src/negocio/items';
import { CODIGO_PERSONALIZADO, MAX_BYTES_REFERENCIA } from '../src/negocio/personalizados';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { guardarReferencia, leerReferencia, tipoDelContenido } from '../src/servidor/archivos-referencia';
import { Servicio, type ProductoPersonalizado } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));
const puerta: Producto = {
  codigo: 'MOL-O',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100000,
  descripcion: 'Puerta Molco',
  filaOrigen: 4,
};
const catalogo: Catalogo = { fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos: [puerta] };

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_2 = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);
const PDF = new TextEncoder().encode('%PDF-1.4\n% croquis\n');

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});
async function preparar() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-referencias-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const llm = {
    interpretar: vi.fn(() => {
      throw new Error('Las referencias y los productos personalizados no pasan por la IA.');
    }),
  };
  return { dir, almacen, servicio: new Servicio(catalogo, llm, almacen) };
}
const personalizado = (extra: Partial<ProductoPersonalizado> = {}): ProductoPersonalizado => ({
  nombre: 'Puerta según diseño cliente',
  familia: 'PUERTA',
  madera: 'Roble',
  descripcion: 'Puerta sólida de roble según fotografía adjunta.',
  ancho: 0.8,
  alto: 2.1,
  tipoMedida: 'hoja',
  cantidad: 2,
  precioUnitario: 345000,
  ...extra,
});
/** Cotización con un ítem de catálogo (0) y uno personalizado (1) con una foto adjunta. */
async function conDosItems() {
  const ctx = await preparar();
  const foto = await guardarReferencia(ctx.dir, PNG, 'foto-whatsapp.png');
  const { cotizacion: q0 } = await ctx.servicio.ejecutar({ tipo: 'agregar_producto', codigo: puerta.codigo, cantidad: 1, tipoMedida: 'hoja' });
  const { cotizacion: q } = await ctx.servicio.ejecutar({
    tipo: 'agregar_personalizado',
    id: q0.id,
    actualizada: q0.actualizada,
    item: personalizado({ referencias: [foto] }),
  });
  return { ...ctx, q, foto };
}
const editar = (servicio: Servicio, q: { id: string; actualizada: string }, items: { indice: number; cambios: Record<string, unknown> }[]) =>
  servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, items });

describe('archivos de referencia', () => {
  it('identifica el formato por el contenido y guarda cada archivo una sola vez', async () => {
    const { dir } = await preparar();
    expect(tipoDelContenido(PNG)).toBe('image/png');
    expect(tipoDelContenido(PDF)).toBe('application/pdf');
    expect(tipoDelContenido(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    const webp = new TextEncoder().encode('RIFF....WEBPVP8 ');
    expect(tipoDelContenido(webp)).toBe('image/webp');
    const a = await guardarReferencia(dir, PNG, 'C:\\fotos\\modelo.png');
    const b = await guardarReferencia(dir, PNG, 'copia.png');
    expect(a).toMatchObject({ nombre: 'modelo.png', tipo: 'image/png', tamano: PNG.length });
    expect(a.archivo).toMatch(/^[0-9a-f]{64}\.png$/);
    expect(b.archivo).toBe(a.archivo);
    expect(await readdir(join(dir, 'referencias'))).toEqual([a.archivo]);
    expect(await leerReferencia(dir, a.archivo)).toEqual(Buffer.from(PNG));
    expect(await leerReferencia(dir, '../cotizador.sqlite')).toBeNull();
  });
  it('rechaza formatos no admitidos, archivos vacíos y los que superan el máximo', async () => {
    const { dir } = await preparar();
    await expect(guardarReferencia(dir, new TextEncoder().encode('<html>'), 'falso.png')).rejects.toThrow(/Formato no admitido/);
    await expect(guardarReferencia(dir, new Uint8Array(), 'vacio.pdf')).rejects.toThrow(/vacío/);
    const grande = new Uint8Array(MAX_BYTES_REFERENCIA + 1);
    grande.set(PNG);
    await expect(guardarReferencia(dir, grande, 'grande.png')).rejects.toThrow(/10 MB/);
  });
});

describe('producto personalizado', () => {
  it('se cotiza con el precio escrito, sin catálogo ni margen, y no crea un producto en el catálogo', async () => {
    const { servicio, almacen } = await preparar();
    const { cotizacion: q } = await servicio.ejecutar({ tipo: 'agregar_personalizado', item: personalizado() });
    expect(q.incompletos).toEqual([]);
    expect(q.solicitudes[0]).toMatchObject({ modelo: 'Puerta según diseño cliente', personalizado: { familia: 'PUERTA' } });
    const linea = q.montos.lineas[0];
    expect(linea.producto).toMatchObject({ codigo: CODIGO_PERSONALIZADO, familia: 'PUERTA', madera: 'Roble' });
    expect(linea.precioUnitario).toBe(345000);
    expect(linea.total).toBe(690000);
    expect(linea.descripcionDocumento).toBe('Puerta sólida de roble según fotografía adjunta.');
    expect(catalogo.productos).toHaveLength(1);
    // Se conserva al volver a abrir la cotización.
    expect(almacen.obtener(q.id)?.solicitudes[0].personalizado).toEqual({ familia: 'PUERTA' });
  });
  it('exige nombre, madera y precio; no admite margen ni quitar el precio', async () => {
    const { servicio } = await preparar();
    await expect(
      servicio.ejecutar({ tipo: 'agregar_personalizado', item: personalizado({ madera: '  ' }) }),
    ).rejects.toThrow(/nombre, la madera/);
    await expect(
      servicio.ejecutar({ tipo: 'agregar_personalizado', item: personalizado({ ancho: 25 }) }),
    ).rejects.toThrow(/Indica un ancho entre 0,3 y 3 m/);
    const { cotizacion: q } = await servicio.ejecutar({ tipo: 'agregar_personalizado', item: personalizado() });
    await expect(editar(servicio, q, [{ indice: 0, cambios: { margen: 0.3 } }])).rejects.toThrow(/no usa ganancia/);
    await expect(editar(servicio, q, [{ indice: 0, cambios: { precioUnitario: null } }])).rejects.toThrow(/precio unitario/);
    await expect(editar(servicio, q, [{ indice: 0, cambios: { modelo: '' } }])).rejects.toThrow(/nombre/);
    const { cotizacion: cambiada } = await editar(servicio, q, [{ indice: 0, cambios: { precioUnitario: 300000, modelo: 'Toscana especial' } }]);
    expect(cambiada.montos.lineas[0]).toMatchObject({ precioUnitario: 300000, total: 600000 });
  });
});

describe('referencias del cliente por ítem', () => {
  it('quedan solo en su ítem y se conservan al volver a abrir la cotización', async () => {
    const { dir, q, foto } = await conDosItems();
    expect(q.solicitudes[0].referencias).toBeUndefined();
    expect(q.solicitudes[1].referencias).toEqual([foto]);
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    const reabierta = new Almacen(dir).obtener(q.id)!;
    expect(reabierta.solicitudes[0].referencias).toBeUndefined();
    expect(reabierta.solicitudes[1].referencias).toEqual([foto]);
  });
  it('se agregan, reemplazan y eliminan sin mezclarse con otro ítem', async () => {
    const { dir, servicio, q, foto } = await conDosItems();
    const plano = await guardarReferencia(dir, PDF, 'croquis-medidas.pdf');
    const { cotizacion: q1 } = await editar(servicio, q, [{ indice: 1, cambios: { referencias: [foto, plano] } }]);
    expect(q1.solicitudes[1].referencias?.map((r) => r.nombre)).toEqual(['foto-whatsapp.png', 'croquis-medidas.pdf']);
    expect(q1.solicitudes[0].referencias).toBeUndefined();
    const nueva = await guardarReferencia(dir, PNG_2, 'referencia-frontal.png');
    const { cotizacion: q2 } = await editar(servicio, q1, [{ indice: 1, cambios: { referencias: [nueva, plano] } }]);
    expect(q2.solicitudes[1].referencias?.map((r) => r.nombre)).toEqual(['referencia-frontal.png', 'croquis-medidas.pdf']);
    const { cotizacion: q3 } = await editar(servicio, q2, [{ indice: 1, cambios: { referencias: [] } }]);
    expect(q3.solicitudes[1].referencias).toBeUndefined();
    const eventos = new Almacen(dir).eventos(q.id).map((e) => e.detalle ?? '');
    expect(eventos.some((d) => d.includes('referencia agregada: croquis-medidas.pdf'))).toBe(true);
  });
  it('se mantienen al cambiar cantidad, precio, medidas o descripción, y al reordenar', async () => {
    const { servicio, q, foto } = await conDosItems();
    const { cotizacion: q1 } = await servicio.ejecutar({
      tipo: 'editar',
      id: q.id,
      actualizada: q.actualizada,
      cantidades: [{ indice: 1, cantidad: 5 }],
      items: [{ indice: 1, cambios: { precioUnitario: 310000, ancho: 0.9, descripcion: 'Otra descripción' } }],
    });
    expect(q1.solicitudes[1].referencias).toEqual([foto]);
    const { cotizacion: q2 } = await servicio.ejecutar({ tipo: 'reordenar', id: q1.id, actualizada: q1.actualizada, desde: 1, hasta: 0 });
    expect(q2.solicitudes[0].referencias).toEqual([foto]);
    expect(q2.solicitudes[1].referencias).toBeUndefined();
    const { cotizacion: q3 } = await servicio.ejecutar({ tipo: 'quitar', id: q2.id, actualizada: q2.actualizada, indice: 1 });
    expect(q3.solicitudes).toHaveLength(1);
    expect(q3.solicitudes[0].referencias).toEqual([foto]);
  });
  it('acompañan al ítem en duplicados, revisiones y al deshacer', async () => {
    const { servicio, q, foto } = await conDosItems();
    const { cotizacion: copia } = await servicio.ejecutar({ tipo: 'duplicar', id: q.id });
    expect(copia.id).not.toBe(q.id);
    expect(copia.solicitudes[1]).toMatchObject({ referencias: [foto], personalizado: { familia: 'PUERTA' } });
    const { cotizacion: emitida } = await servicio.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada });
    expect(emitida.estado).toBe('emitida');
    const { cotizacion: revision } = await editar(servicio, emitida, [{ indice: 1, cambios: { observaciones: 'Confirmar tirador' } }]);
    expect(revision.origen).toBe(emitida.numero);
    expect(revision.solicitudes[1].referencias).toEqual([foto]);
    const antes = structuredClone(revision.solicitudes);
    const { cotizacion: sinFoto } = await editar(servicio, revision, [{ indice: 1, cambios: { referencias: [] } }]);
    const { cotizacion: deshecha } = await servicio.ejecutar({
      tipo: 'restaurar_items',
      id: sinFoto.id,
      actualizada: sinFoto.actualizada,
      items: antes,
    });
    expect(deshecha.solicitudes[1].referencias).toEqual([foto]);
  });
  it('solo admite archivos subidos a este servidor', async () => {
    const { servicio, q } = await conDosItems();
    const inventada: ReferenciaItem = {
      archivo: `${'a'.repeat(64)}.png`,
      nombre: 'x.png',
      tipo: 'image/png',
      tamano: 10,
      fecha: new Date().toISOString(),
    };
    await expect(editar(servicio, q, [{ indice: 0, cambios: { referencias: [inventada] } }])).rejects.toThrow(/No se encontró/);
  });
  it('la IA conserva las referencias y el producto personalizado del mismo ítem', () => {
    const foto = { archivo: `${'b'.repeat(64)}.jpg`, nombre: 'f.jpg', tipo: 'image/jpeg', tamano: 3, fecha: '2026-10-06T00:00:00.000Z' } as const;
    const base: SolicitudItem = { modelo: 'Puerta japonesa', madera: 'Roble', ancho: 0.8, alto: 2.1, medida: null, cantidad: 2 };
    const previos: SolicitudItem[] = [{ ...base, precioUnitario: 300000, personalizado: { familia: 'PUERTA' }, referencias: [foto] }];
    const { items } = fusionarItems(previos, [{ ...base, cantidad: 4 }], () => ({ modelo: '', madera: 'roble' }));
    expect(items[0]).toMatchObject({ cantidad: 4, precioUnitario: 300000, personalizado: { familia: 'PUERTA' }, referencias: [foto] });
  });
});

describe('limpieza de referencias sin uso', () => {
  it('borra solo los archivos que ningún ítem usa y que superan el plazo de gracia', async () => {
    const { referenciasHuerfanas, eliminarReferencias, GRACIA_HUERFANAS_MS } = await import('../src/servidor/archivos-referencia');
    const { dir, almacen, servicio, q, foto } = await conDosItems();
    const plano = await guardarReferencia(dir, PDF, 'plano.pdf');
    const despues = Date.now() + GRACIA_HUERFANAS_MS + 1000;
    // Recién subido y sin ítem: todavía dentro del plazo de gracia.
    expect(await referenciasHuerfanas(dir, almacen.archivosReferencia())).toEqual([]);
    expect((await referenciasHuerfanas(dir, almacen.archivosReferencia(), despues)).map((r) => r.archivo)).toEqual([plano.archivo]);
    // Quitada de su ítem, la foto también queda sin uso; un duplicado la habría conservado.
    await editar(servicio, q, [{ indice: 1, cambios: { referencias: [] } }]);
    const huerfanas = await referenciasHuerfanas(dir, almacen.archivosReferencia(), despues);
    expect(huerfanas.map((r) => r.archivo).sort()).toEqual([foto.archivo, plano.archivo].sort());
    // Si alguien la vuelve a usar antes de borrar, se respeta.
    const eliminadas = await eliminarReferencias(dir, huerfanas.map((r) => r.archivo), new Set([foto.archivo]));
    expect(eliminadas).toBe(1);
    expect(await readdir(join(dir, 'referencias'))).toEqual([foto.archivo]);
  });
  it('conserva las imágenes que muestra un documento emitido o una orden de trabajo en cola', async () => {
    const { referenciasHuerfanas, GRACIA_HUERFANAS_MS } = await import('../src/servidor/archivos-referencia');
    const { dir, almacen, servicio, q, foto } = await conDosItems();
    const otra = await guardarReferencia(dir, PNG_2, 'otra.png');
    const db = almacen.baseDatos();
    db.prepare('INSERT INTO documentos_snapshot (archivo, cotizacion_id, html) VALUES (?, ?, ?)').run(
      'cotizacion-1.pdf',
      q.id,
      `<img class="ref" src="neltume-referencia:${foto.archivo}" alt="">`,
    );
    await editar(servicio, q, [{ indice: 1, cambios: { referencias: [] } }]);
    const despues = Date.now() + GRACIA_HUERFANAS_MS + 1000;
    // La foto ya no está en el ítem, pero el documento emitido la imprime al regenerarse.
    expect((await referenciasHuerfanas(dir, almacen.archivosReferencia(), despues)).map((r) => r.archivo)).toEqual([otra.archivo]);
    db.prepare(
      `INSERT INTO integracion_envios (cotizacion_id, fabrica, revision, evento, evento_id, clave_idempotencia, contenido, html_produccion, estado, proximo_intento, creado)
       VALUES (?, 'panguipulli', 1, 'order.ready', 'e1', 'c1', '{}', ?, 'pendiente', '2026-10-26T00:00:00.000Z', '2026-10-26T00:00:00.000Z')`,
    ).run(q.id, `<img class="ref" src="neltume-referencia:${otra.archivo}" alt="">`);
    expect(await referenciasHuerfanas(dir, almacen.archivosReferencia(), despues)).toEqual([]);
  });
  it('conserva los archivos que usa una cotización duplicada', async () => {
    const { referenciasHuerfanas, GRACIA_HUERFANAS_MS } = await import('../src/servidor/archivos-referencia');
    const { dir, almacen, servicio, q } = await conDosItems();
    const { cotizacion: copia } = await servicio.ejecutar({ tipo: 'duplicar', id: q.id });
    await editar(servicio, q, [{ indice: 1, cambios: { referencias: [] } }]);
    expect(copia.solicitudes[1].referencias).toHaveLength(1);
    expect(await referenciasHuerfanas(dir, almacen.archivosReferencia(), Date.now() + GRACIA_HUERFANAS_MS + 1000)).toEqual([]);
  });
});

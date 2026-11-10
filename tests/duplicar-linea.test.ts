// Duplicar una línea y editar la copia; avisos de recotización al mover, quitar o sumar ítems; reintento del
// primer producto (auditoría 2026-11: N-05, N-12, N-27).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Catalogo, Producto } from '../src/catalogo/tipos';
import type { Cotizacion } from '../src/negocio/estado';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const ranco = (codigo: string, anchoMin: number, anchoMax: number, precioNeto: number): Producto => ({
  codigo,
  modelo: 'RANCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: `${anchoMin} A ${anchoMax}`,
  anchoMin,
  anchoMax,
  largo: 2.2,
  precioNeto,
  descripcion: 'RANCO',
  filaOrigen: 1,
});
const base: Catalogo = {
  fuente: 'test',
  sha256: 'a',
  fecha: '2026-01-01',
  productos: [ranco('RAN-O-3-C', 0.8, 0.85, 100_000), ranco('RAN-O-5-C', 0.95, 1.05, 120_000)],
};
const masCaro: Catalogo = { ...base, sha256: 'b', productos: base.productos.map((p) => ({ ...p, precioNeto: p.precioNeto + 10_000 })) };

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-duplicar-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const llm = { interpretar: vi.fn() };
  const servicio = (c: Catalogo = base) => new Servicio(c, llm, almacen);
  let q: Cotizacion | undefined;
  const ir = async (accion: Record<string, unknown>, c: Catalogo = base) => {
    const r = await servicio(c).ejecutar({ ...accion, ...(q ? { id: q.id, actualizada: q.actualizada } : {}) } as never);
    q = r.cotizacion;
    return r;
  };
  return { ir, almacen, actual: () => q! };
}

describe('Duplicar línea', () => {
  it('copia todo debajo, con identidad propia; editar la copia no toca el original', async () => {
    const t = await setup();
    await t.ir({ tipo: 'agregar_producto', codigo: 'RAN-O-3-C', cantidad: 1, ancho: 0.85, alto: 2.2, tipoMedida: 'hoja' });
    await t.ir({ tipo: 'agregar_producto', codigo: 'RAN-O-5-C', cantidad: 1, ancho: 1, alto: 2.2, tipoMedida: 'hoja' });
    await t.ir({ tipo: 'editar', items: [{ indice: 0, cambios: { observaciones: 'Bisagras bronce', precioUnitario: 200_000 } }] });
    const { cotizacion: q } = await t.ir({ tipo: 'duplicar_item', indice: 0 });
    expect(q.solicitudes.map((s) => s.ancho)).toEqual([0.85, 0.85, 1]);
    const [original, copia] = q.solicitudes;
    expect(copia).toMatchObject({ observaciones: 'Bisagras bronce', precioUnitario: 200_000, tipoMedida: 'hoja' });
    expect(copia.id).toBeTruthy();
    expect(copia.id).not.toBe(original.id);
    expect(q.montos.lineas[1].precioUnitario).toBe(200_000);
    // La copia pasa a ser «Ranco vidriada» con otro precio; el original queda igual.
    const { cotizacion: q2 } = await t.ir({ tipo: 'editar', items: [{ indice: 1, cambios: { descripcion: 'Ranco vidriada', precioUnitario: 230_000 } }] });
    expect(q2.solicitudes[0]).toMatchObject({ observaciones: 'Bisagras bronce', precioUnitario: 200_000 });
    expect(q2.solicitudes[0].descripcion ?? null).toBeNull();
    expect(q2.solicitudes[1]).toMatchObject({ descripcion: 'Ranco vidriada', precioUnitario: 230_000 });
    expect(t.almacen.obtener(q2.id)!.solicitudes).toHaveLength(3);
  });

  it('convertir la copia en especial conserva su precio y permite renombrarla sin quedar pendiente (N-19)', async () => {
    const t = await setup();
    await t.ir({ tipo: 'agregar_producto', codigo: 'RAN-O-3-C', cantidad: 1, ancho: 0.85, alto: 2.2, tipoMedida: 'hoja' });
    const { cotizacion: q } = await t.ir({ tipo: 'duplicar_item', indice: 0 });
    const linea = q.montos.lineas[1];
    await t.ir({
      tipo: 'editar',
      items: [{ indice: 1, cambios: { personalizado: { familia: 'PUERTA' }, precioUnitario: linea.precioUnitario, costoFabrica: linea.producto.precioNeto } }],
    });
    const { cotizacion: q2 } = await t.ir({ tipo: 'editar', items: [{ indice: 1, cambios: { modelo: 'Ranco vidriada' } }] });
    expect(q2.incompletos).toEqual([]);
    expect(q2.solicitudes[1]).toMatchObject({ modelo: 'Ranco vidriada', personalizado: { familia: 'PUERTA' } });
    expect(q2.montos.lineas[1].precioUnitario).toBe(linea.precioUnitario);
    expect(q2.montos.lineas[0].precioUnitario).toBe(q.montos.lineas[0].precioUnitario);
  });

  it('rechaza un índice que no existe', async () => {
    const t = await setup();
    await t.ir({ tipo: 'agregar_producto', codigo: 'RAN-O-3-C', cantidad: 1 });
    await expect(t.ir({ tipo: 'duplicar_item', indice: 5 })).rejects.toThrow('No se encontró el ítem');
  });
});

describe('Recotización al mover, quitar o sumar ítems (N-12)', () => {
  for (const [nombre, accion] of [
    ['quitar', { tipo: 'quitar', indice: 1 }],
    ['reordenar', { tipo: 'reordenar', desde: 1, hasta: 0 }],
    ['duplicar_item', { tipo: 'duplicar_item', indice: 1 }],
    ['agregar_producto', { tipo: 'agregar_producto', codigo: 'RAN-O-5-C', cantidad: 1 }],
  ] as const) {
    it(`${nombre}: avisa el precio que cambió por el catálogo vigente`, async () => {
      const t = await setup();
      await t.ir({ tipo: 'agregar_producto', codigo: 'RAN-O-3-C', cantidad: 1 });
      await t.ir({ tipo: 'agregar_producto', codigo: 'RAN-O-5-C', cantidad: 1 });
      const r = await t.ir(accion, masCaro);
      expect(r.avisos).toContainEqual(expect.stringMatching(/RAN-O-3-C cambió de \$\d/));
    });
  }
});

describe('Primer producto con reintento (N-27)', () => {
  it('el mismo nuevoId no crea un segundo borrador', async () => {
    const t = await setup();
    const nuevoId = randomUUID();
    const servicio = new Servicio(base, { interpretar: vi.fn() }, t.almacen);
    const accion = { tipo: 'agregar_producto', codigo: 'RAN-O-3-C', cantidad: 1, nuevoId } as const;
    const [a, b] = await Promise.all([servicio.ejecutar(accion), servicio.ejecutar(accion)]);
    expect(a.cotizacion.id).toBe(nuevoId);
    expect(b.cotizacion.id).toBe(nuevoId);
    expect((await t.almacen.leer()).cotizaciones).toHaveLength(1);
    expect(t.almacen.obtener(nuevoId)!.solicitudes).toHaveLength(1);
  });
});

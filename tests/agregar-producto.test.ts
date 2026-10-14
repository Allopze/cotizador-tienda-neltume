import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Catalogo, Producto } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';

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
const marco: Producto = {
  ...puerta,
  codigo: 'MAR-O',
  modelo: 'MARCO',
  familia: 'MARCO',
  medida: '2X4',
  anchoMin: null,
  anchoMax: null,
  largo: 2.1,
};
const catalogo: Catalogo = {
  fuente: 'test',
  sha256: 'test',
  fecha: '2026-01-01',
  productos: [puerta, marco],
};
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});
async function preparar() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-agregar-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const llm = {
    interpretar: vi.fn(() => {
      throw new Error('La selección del catálogo no debe llamar a la IA.');
    }),
  };
  return { servicio: new Servicio(catalogo, llm, almacen), almacen, llm };
}
describe('agregar un producto del catálogo', () => {
  it('inicia un borrador sin IA y calcula el precio en el servidor', async () => {
    const { servicio, llm, almacen } = await preparar();
    const { cotizacion: q, cambios } = await servicio.ejecutar({
      tipo: 'agregar_producto',
      codigo: puerta.codigo,
      cantidad: 3,
      ancho: 0.82,
      alto: 2,
      tipoMedida: 'vano',
    });
    expect(q.solicitudes[0]).toMatchObject({ cantidad: 3, ancho: 0.82, alto: 2, tipoMedida: 'vano' });
    expect(q.montos.lineas[0].producto.codigo).toBe(puerta.codigo);
    expect(q.montos.total).toBeGreaterThan(puerta.precioNeto * 3);
    expect(q.incompletos).toEqual([]);
    expect(cambios?.agregados).toHaveLength(1);
    expect(almacen.obtener(q.id)?.montos).toEqual(q.montos);
    expect(llm.interpretar).not.toHaveBeenCalled();
  });
  it('exige confirmar hoja o vano en una puerta con medidas antes de emitir', async () => {
    const { servicio } = await preparar();
    let q = (await servicio.ejecutar({
      tipo: 'agregar_producto',
      codigo: puerta.codigo,
      cantidad: 1,
      ancho: 0.82,
      alto: 2,
    })).cotizacion;
    await expect(servicio.ejecutar({
      tipo: 'emitir',
      id: q.id,
      actualizada: q.actualizada,
    })).rejects.toMatchObject({ codigo: 'medida_sin_tipo' });
    q = (await servicio.ejecutar({
      tipo: 'editar',
      id: q.id,
      actualizada: q.actualizada,
      items: [{ indice: 0, cambios: { tipoMedida: 'hoja' } }],
    })).cotizacion;
    expect(q.montos.lineas[0].tipoMedida).toBe('hoja');
    const emitida = (await servicio.ejecutar({
      tipo: 'emitir',
      id: q.id,
      actualizada: q.actualizada,
    })).cotizacion;
    expect(emitida.estado).toBe('emitida');
  });
  it('agrega accesorios y conserva los productos anteriores', async () => {
    const { servicio } = await preparar();
    const { cotizacion: q } = await servicio.ejecutar({
      tipo: 'agregar_producto',
      codigo: puerta.codigo,
      cantidad: 1,
    });
    const { cotizacion: siguiente } = await servicio.ejecutar({
      tipo: 'agregar_producto',
      id: q.id,
      actualizada: q.actualizada,
      codigo: marco.codigo,
      cantidad: 2,
    });
    expect(siguiente.solicitudes).toHaveLength(2);
    expect(siguiente.montos.lineas[1]).toMatchObject({ producto: { codigo: marco.codigo }, cantidad: 2 });
  });
  it('rechaza versiones obsoletas y no agrega dos veces el producto', async () => {
    const { servicio, almacen } = await preparar();
    const { cotizacion: q } = await servicio.ejecutar({
      tipo: 'agregar_producto',
      codigo: puerta.codigo,
      cantidad: 1,
    });
    const accion = {
      tipo: 'agregar_producto' as const,
      id: q.id,
      actualizada: q.actualizada,
      codigo: marco.codigo,
      cantidad: 1,
    };
    await servicio.ejecutar(accion);
    await expect(servicio.ejecutar(accion)).rejects.toMatchObject({ codigo: 'version_obsoleta' });
    expect(almacen.obtener(q.id)?.solicitudes).toHaveLength(2);
  });
  it('crea una revisión y conserva el PDF de una cotización emitida', async () => {
    const { servicio, almacen } = await preparar();
    const { cotizacion: q } = await servicio.ejecutar({
      tipo: 'agregar_producto',
      codigo: puerta.codigo,
      cantidad: 1,
    });
    const { cotizacion: emitida } = await servicio.ejecutar({
      tipo: 'emitir',
      id: q.id,
      actualizada: q.actualizada,
    });
    const { cotizacion: revision } = await servicio.ejecutar({
      tipo: 'agregar_producto',
      id: emitida.id,
      actualizada: emitida.actualizada,
      codigo: marco.codigo,
      cantidad: 1,
    });
    expect(revision).toMatchObject({ estado: 'borrador', origen: emitida.numero, pdf: null });
    expect(revision.id).not.toBe(emitida.id);
    expect(almacen.obtener(emitida.id)).toMatchObject({
      estado: 'emitida',
      pdf: emitida.pdf,
      solicitudes: emitida.solicitudes,
    });
  });
  it('rechaza referencias inexistentes y medidas que elegirían otro producto sin crear borradores', async () => {
    const { servicio, almacen } = await preparar();
    await expect(
      servicio.ejecutar({ tipo: 'agregar_producto', codigo: 'NO-EXISTE', cantidad: 1 }),
    ).rejects.toThrow('ya no está disponible');
    await expect(
      servicio.ejecutar({ tipo: 'agregar_producto', codigo: puerta.codigo, cantidad: 1, ancho: 0.7 }),
    ).rejects.toThrow('Las medidas no corresponden');
    await expect(
      servicio.ejecutar({ tipo: 'agregar_producto', codigo: puerta.codigo, cantidad: 0 }),
    ).rejects.toThrow('La cantidad');
    expect(almacen.listar().total).toBe(0);
  });
  it('no permite agregar productos a una cotización aprobada', async () => {
    const { servicio, almacen } = await preparar();
    const { cotizacion: q } = await servicio.ejecutar({
      tipo: 'agregar_producto',
      codigo: puerta.codigo,
      cantidad: 1,
    });
    await almacen.transaccion((u) => {
      const bloqueada = u.obtener(q.id)!;
      bloqueada.estado = 'aprobada';
      u.guardar(bloqueada);
    });
    await expect(
      servicio.ejecutar({
        tipo: 'agregar_producto',
        id: q.id,
        actualizada: q.actualizada,
        codigo: marco.codigo,
        cantidad: 1,
      }),
    ).rejects.toMatchObject({ codigo: 'no_editable' });
    expect(almacen.obtener(q.id)?.solicitudes).toHaveLength(1);
  });
});

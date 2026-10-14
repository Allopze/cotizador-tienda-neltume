import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Catalogo, Producto } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';
import { avisoVano } from '../src/negocio/medidas';

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

describe('aviso de vano justo sobre el inicio de su tramo', () => {
  const angosta: Producto = { ...puerta, codigo: 'MOL-O-70', medida: '0,70 A 0,75', anchoMin: 0.7, anchoMax: 0.75 };
  async function conTramos() {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-vano-'));
    dirs.push(dir);
    const llm = { interpretar: vi.fn() };
    return new Servicio({ ...catalogo, productos: [angosta, puerta, marco] }, llm, new Almacen(dir));
  }
  const agregar = (servicio: Servicio, ancho: number, tipoMedida: 'vano' | 'hoja' | 'no_especificado') =>
    servicio.ejecutar({ tipo: 'agregar_producto', codigo: puerta.codigo, cantidad: 1, ancho, alto: 2, tipoMedida });

  it('un vano de 0,82 m se cobra en 0,80–0,85 y avisa que la hoja podría ser del tramo 0,70–0,75', async () => {
    const servicio = await conTramos();
    const r = await agregar(servicio, 0.82, 'vano');
    // No bloquea ni cambia el precio: se cotiza con el ancho pedido.
    expect(r.cotizacion.incompletos).toEqual([]);
    expect(r.cotizacion.montos.lineas[0].producto.codigo).toBe('MOL-O');
    expect(r.avisos).toEqual([
      'Revisa el ítem 1 (MOLCO): el vano de 0,82 m se cobra en el tramo 0,80–0,85 m y queda a menos de 5 cm de su inicio. La hoja es más angosta que el vano: si la medida es del hueco, la puerta podría ser del tramo 0,70–0,75 m.',
    ]);
    // Un cambio que no toca ese ítem no repite el aviso.
    const q = r.cotizacion;
    const otra = await servicio.ejecutar({ tipo: 'agregar_producto', id: q.id, actualizada: q.actualizada, codigo: marco.codigo, cantidad: 1 });
    expect(otra.avisos ?? []).not.toContainEqual(expect.stringContaining('vano'));
  });

  it('no avisa con una hoja, lejos del inicio del tramo o sin tramo anterior', async () => {
    const servicio = await conTramos();
    expect((await agregar(servicio, 0.82, 'hoja')).avisos ?? []).toEqual([]);
    expect((await agregar(servicio, 0.82, 'no_especificado')).avisos ?? []).toEqual([]);
    expect((await agregar(servicio, 0.85, 'vano')).avisos ?? []).toEqual([]);
    const soloUno = await preparar();
    expect((await agregar(soloUno.servicio, 0.82, 'vano')).avisos ?? []).toEqual([]);
  });
});

describe('avisoVano', () => {
  const linea = (anchoSolicitado: number) => ({ indice: 0, producto: puerta, anchoSolicitado, tipoMedida: 'vano' as const });
  it('también avisa un vano entre dos tramos que se cobra con la siguiente medida', () => {
    expect(avisoVano(linea(0.77), { min: 0.7, max: 0.75 })).toContain('el vano de 0,77 m se cobra en el tramo 0,80–0,85 m');
    expect(avisoVano(linea(0.849), { min: 0.7, max: 0.75 })).toContain("0,849 m");
    expect(avisoVano(linea(0.85), { min: 0.7, max: 0.75 })).toBeNull();
    expect(avisoVano(linea(0.82), null)).toBeNull();
    expect(avisoVano({ ...linea(0.82), producto: marco }, { min: 0.7, max: 0.75 })).toBeNull();
  });
});

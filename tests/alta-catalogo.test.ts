import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { guardarCatalogo, RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import {
  buscarPrecios,
  extraerPrecioNeto,
  interpretarCifra,
  ServicioAltaCatalogo,
} from '../src/servidor/alta-catalogo';
import { resolverItem } from '../src/catalogo/resolver';
import type { Catalogo, Producto } from '../src/catalogo/tipos';

const producto = (p: Partial<Producto> = {}): Producto => ({
  codigo: 'MOL-O-3-A',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100000,
  descripcion: 'MOLCO PINO OREGON 0,80 A 0,85 MT X 2 MT',
  filaOrigen: 4,
  ...p,
});
const catalogo = (): Catalogo => ({
  fuente: 'test.xlsx',
  sha256: 'sha',
  fecha: '2026-01-01T00:00:00.000Z',
  productos: [
    producto(),
    producto({
      codigo: 'MOL-O-3-B',
      medida: '0,90 A 0,95',
      anchoMin: 0.9,
      anchoMax: 0.95,
      precioNeto: 110000,
    }),
  ],
});

describe('extraerPrecioNeto', () => {
  it.each([
    ['precio neto $45.990', 45990],
    ['precio 45,990', 45990],
    ['precio 45,99', 45.99],
    ['precio 1.234.567', 1234567],
    ['precio 1.234,5', 1234.5],
    ['cuesta 1.5 mil', 1500],
    ['vale 3 mil quinientos', 3500],
    ['precio: tres mil quinientos cincuenta', 3550],
    ['precio 3 mil 500', 3500],
    ['sale 45k', 45000],
    ['precio 1,2 millones', 1200000],
    ['$45.990 + IVA', 45990],
    ['precio 45.990 más IVA', 45990],
    ['precio 45.990 neto', 45990],
    ['El precio es de $12.000, alto 2 m', 12000],
  ])('%s → %d', (texto, esperado) => expect(extraerPrecioNeto(texto)).toBe(esperado));

  it('convierte a neto los precios con IVA incluido o brutos y lo informa', () => {
    for (const texto of ['precio $119.000 IVA incluido', 'precio 119.000 con IVA', 'precio bruto 119.000']) {
      const [p] = buscarPrecios(texto);
      expect(p).toMatchObject({ neto: 100000, indicado: 119000, bruto: true });
    }
    expect(buscarPrecios('precio 45.990 + IVA')[0].bruto).toBe(false);
  });

  it('ignora cifras sin marcador de precio o pegadas a medidas', () => {
    for (const texto of [
      'Molco de 0,80 a 0,85 en pino',
      'precio 2x4 de 2,1',
      'vale, agrega otra',
      'precio por confirmar',
    ])
      expect(extraerPrecioNeto(texto)).toBeNull();
  });

  it('interpreta separadores chilenos', () => {
    expect(interpretarCifra('45,990')).toBe(45990);
    expect(interpretarCifra('45.990')).toBe(45990);
    expect(interpretarCifra('1.5')).toBe(1.5);
    expect(interpretarCifra('1,234.5')).toBe(1234.5);
  });
});

const dirs: string[] = [];
let db: Database.Database;
async function repo() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-alta-'));
  dirs.push(dir);
  db = abrirBaseDatos(join(dir, 'cotizador.sqlite'), { cachear: false });
  guardarCatalogo(db, catalogo());
  return new RepositorioCatalogoSqlite(db);
}
afterEach(async () => {
  if (db?.open) db.close();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('agregarProductoManual y mantención', () => {
  it('rechaza versiones obsoletas, duplicados y rangos superpuestos; registra autor', async () => {
    const r = await repo();
    const nuevo = producto({ codigo: 'IA-1', medida: '0,70 A 0,75', anchoMin: 0.7, anchoMax: 0.75 });
    expect(() => r.agregarProductoManual(nuevo, 'otra-version')).toThrow(/catálogo cambió/);
    r.agregarProductoManual(nuevo, r.version!, undefined, 'Paula');
    expect(() => r.agregarProductoManual({ ...nuevo, codigo: 'IA-2' }, r.version!)).toThrow(/Ya existe/);
    const superpuesto = producto({ codigo: 'IA-3', medida: '0,84 A 0,88', anchoMin: 0.84, anchoMax: 0.88 });
    expect(() => r.agregarProductoManual(superpuesto, r.version!)).toThrow(/superpone con MOL-O-3-A/);
    // Otro alto no se superpone.
    r.agregarProductoManual({ ...superpuesto, largo: 2.2 }, r.version!);
    expect(r.listarManuales().map((p) => [p.codigo, p.creadaPor])).toEqual([
      ['IA-3', null],
      ['IA-1', 'Paula'],
    ]);
  });

  it('edita y elimina solo productos manuales; un borrador que lo usaba queda pendiente', async () => {
    const r = await repo();
    const nuevo = producto({ codigo: 'IA-1', medida: '0,70 A 0,75', anchoMin: 0.7, anchoMax: 0.75 });
    r.agregarProductoManual(nuevo, r.version!);
    const version = r.version;
    expect(r.editarManual('IA-1', { precioNeto: 90000, descripcion: 'Molco angosta' })).toMatchObject({
      precioNeto: 90000,
      descripcion: 'Molco angosta',
    });
    expect(r.version).not.toBe(version);
    expect(r.editarProducto('MOL-O-3-A', { precioNeto: 101000, tipo: 'PUERTA ESPECIAL' })).toMatchObject({
      precioNeto: 101000,
      tipo: 'PUERTA ESPECIAL',
    });
    expect(r.listarAdministrables('MOL-O-3-A').productos[0]).toMatchObject({ fuente: 'planilla', precioNeto: 101000 });
    expect(() => r.editarManual('MOL-O-3-A', { precioNeto: 1 })).toThrow(/agregados en la aplicación/);
    expect(() => r.editarManual('NO-EXISTE', { precioNeto: 1 })).toThrow(/No se encontró/);
    const pedido = { modelo: 'MOLCO', madera: 'pino', ancho: 0.72, alto: 2, medida: null, cantidad: 1 };
    expect(resolverItem(r, pedido).ok).toBe(true);
    r.eliminarManual('IA-1');
    const tras = resolverItem(r, pedido);
    expect(tras.ok ? null : tras.rechazo.tipo).toBe('medida_no_disponible');
    expect(r.metadata?.cantidadProductos).toBe(2);
  });
});

describe('ServicioAltaCatalogo', () => {
  const atributos = {
    modelo: 'MOLCO',
    familia: 'PUERTA',
    madera: 'PINO OREGON',
    tipo: null,
    medida: null,
    anchoMin: 0.6,
    anchoMax: 0.65,
    largo: 2,
  };
  const llm = () => ({
    interpretar: vi.fn(),
    interpretarProducto: vi.fn().mockResolvedValue({ name: 'proponer_producto', input: atributos }),
  });

  it('convierte bruto a neto con aviso, advierte precios atípicos y oculta el precio al modelo', async () => {
    const r = await repo();
    const ia = llm();
    const alta = new ServicioAltaCatalogo(db, r, ia);
    const res = await alta.mensaje(
      undefined,
      'Molco pino 60 a 65 de 2 m, precio $1.190.000 IVA incluido',
      'u1',
    );
    expect(res.propuesta?.precioNeto).toBe(1000000);
    expect(res.avisos.join(' ')).toMatch(/Convertí el precio con IVA/);
    expect(res.avisos.join(' ')).toMatch(/muy lejos de la mediana/);
    expect(JSON.stringify(ia.interpretarProducto.mock.calls[0][0])).not.toMatch(/1\.190\.000|1190000/);
  });

  it('rechaza en la propuesta un rango que se cruza con otro del mismo modelo', async () => {
    const r = await repo();
    const ia = llm();
    ia.interpretarProducto.mockResolvedValue({
      name: 'proponer_producto',
      input: { ...atributos, anchoMin: 0.84, anchoMax: 0.9 },
    });
    const res = await new ServicioAltaCatalogo(db, r, ia).mensaje(
      undefined,
      'Molco 84 a 90, precio 100.000',
      'u1',
    );
    expect(res.propuesta).toBeNull();
    expect(res.pregunta).toMatch(/superpone/);
  });

  it('la propuesta pendiente pertenece a quien la inició', async () => {
    const r = await repo();
    const alta = new ServicioAltaCatalogo(db, r, llm());
    const res = await alta.mensaje(undefined, 'Molco 60 a 65, precio 95.000', 'u1');
    expect(res.propuesta).not.toBeNull();
    expect(() => alta.confirmar(res.id, 'u2')).toThrow(/expiró o ya fue confirmada/);
    await expect(alta.mensaje(res.id, 'otro dato', 'u2')).rejects.toThrow(/expiró/);
    alta.cancelar(res.id, 'u2');
    expect(alta.confirmar(res.id, 'u1', 'Paula').codigo).toMatch(/^IA-/);
    expect(r.listarManuales()[0].creadaPor).toBe('Paula');
  });

  it('devuelve lo interpretado para volcarlo en el formulario', async () => {
    const r = await repo();
    const res = await new ServicioAltaCatalogo(db, r, llm()).mensaje(
      undefined,
      'Molco 60 a 65, precio 95.000',
      'u1',
    );
    expect(res.borrador).toMatchObject({ ...atributos, precioNeto: 95000 });
  });
});

describe('ServicioAltaCatalogo.proponerManual', () => {
  const datos = {
    modelo: 'Molco',
    familia: 'PUERTA' as const,
    madera: 'pino oregon',
    tipo: null,
    medida: null,
    anchoMin: 0.6,
    anchoMax: 0.65,
    largo: 2,
    precioNeto: 95000,
  };
  // El alta manual no usa el asistente: el LLM de prueba falla si se lo llama.
  const sinAsistente = () => ({
    interpretar: vi.fn(),
    interpretarProducto: vi.fn().mockRejectedValue(new Error('no')),
  });

  it('genera la misma propuesta revisable que el alta asistida, sin llamar al asistente', async () => {
    const r = await repo();
    const ia = sinAsistente();
    const alta = new ServicioAltaCatalogo(db, r, ia);
    const res = alta.proponerManual(undefined, datos, 'u1');
    expect(res.propuesta).toMatchObject({ modelo: 'MOLCO', madera: 'PINO OREGON', medida: '0,60 A 0,65' });
    expect(ia.interpretarProducto).not.toHaveBeenCalled();
    expect(alta.confirmar(res.id, 'u1', 'Paula').codigo).toMatch(/^IA-/);
  });

  it('aplica las mismas validaciones: faltantes, duplicados y rangos superpuestos', async () => {
    const r = await repo();
    const alta = new ServicioAltaCatalogo(db, r, sinAsistente());
    expect(() => alta.proponerManual(undefined, { ...datos, precioNeto: null }, 'u1')).toThrow(/precio neto/);
    expect(() => alta.proponerManual(undefined, { ...datos, anchoMin: 0.84, anchoMax: 0.9 }, 'u1')).toThrow(
      /superpone/,
    );
    expect(() => alta.proponerManual(undefined, { ...datos, anchoMin: 0.8, anchoMax: 0.85 }, 'u1')).toThrow(
      /Ya existe/,
    );
  });

  it('corrige a mano la propuesta del asistente en la misma conversación', async () => {
    const r = await repo();
    const alta = new ServicioAltaCatalogo(db, r, {
      interpretar: vi.fn(),
      interpretarProducto: vi.fn().mockResolvedValue({
        name: 'proponer_producto',
        input: {
          modelo: 'MOLCO',
          familia: 'PUERTA',
          madera: 'pino oregon',
          tipo: null,
          medida: null,
          anchoMin: 0.6,
          anchoMax: 0.65,
          largo: 2,
        },
      }),
    });
    const asistida = await alta.mensaje(undefined, 'Molco 60 a 65, precio 95.000', 'u1');
    const manual = alta.proponerManual(asistida.id, { ...datos, precioNeto: 97000 }, 'u1');
    expect(manual.id).toBe(asistida.id);
    expect(alta.confirmar(manual.id, 'u1').precioNeto).toBe(97000);
  });
});

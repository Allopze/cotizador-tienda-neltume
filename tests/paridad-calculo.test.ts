// Huecos de `npm run paridad:excel`: lo que la planilla no calcula (márgenes por categoría, otro IVA y
// descuentos) se compara con valores sacados a mano, y la cotización con el catálogo guardado en SQLite
// (dos planillas y un producto manual juntos) se compara con la del catálogo recién importado.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importarPlanilla } from '../src/catalogo/planilla';
import { resolverItem, type CatalogoConsultable } from '../src/catalogo/resolver';
import type { Producto, SolicitudItem } from '../src/catalogo/tipos';
import { cotizar, MARGENES_INICIALES, REGLAS, type ItemPrecio } from '../src/negocio/precios';
import { abrirBaseDatos, cerrarBaseDatos } from '../src/servidor/base-datos';
import { analizarPlanilla } from '../src/servidor/importacion-catalogo';
import { guardarCatalogo, RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { escribirXlsx, planillaEnchapadas, planillaPrincipal, type Hojas } from './fixture-xlsx';

const limpiezas: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const limpiar of limpiezas.splice(0)) await limpiar();
});
async function importar(hojas: Hojas) {
  const { ruta, limpiar } = await escribirXlsx(hojas);
  limpiezas.push(limpiar);
  return importarPlanilla(ruta);
}
/** Los productos de las dos planillas sintéticas, por código. */
async function productosSinteticos() {
  const principal = await importar(planillaPrincipal());
  const enchapadas = await importar(planillaEnchapadas());
  const porCodigo = new Map(
    [...principal.catalogo.productos, ...enchapadas.catalogo.productos].map((p) => [p.codigo, p]),
  );
  return (codigo: string) => {
    const p = porCodigo.get(codigo);
    if (!p) throw new Error(`falta ${codigo} en las planillas sintéticas`);
    return p;
  };
}

describe('márgenes por categoría y otro IVA, contra valores sacados a mano', () => {
  // unitario = round(neto × (1 + margen de la categoría)); total de línea = cantidad × unitario.
  const LINEAS: [codigo: string, cantidad: number, margen: number, unitario: number, total: number][] = [
    ['LANC-L-070-A', 2, 0.55, 155_000, 310_000], // 100.000 × 1,55; Lenga sólida
    ['LANC-R-090-A', 1, 0.55, 232_500, 232_500], // 150.000 × 1,55; Raulí sólida
    ['HUIL-PP-070-220', 3, 1.4, 85_106, 255_318], // 35.461 × 2,4 = 85.106,4; prepintada
    ['HUIL-EM-085-240', 1, 0.75, 178_533, 178_533], // 102.019 × 1,75 = 178.533,25; enchapada en Mara
    ['MARC-PF-30X70-220', 4, 1, 22_380, 89_520], // 11.190 × 2; marco finger desnudo
    ['MARC-FE-30X70-250', 2, 0.75, 67_447, 134_894], // 38.541 × 1,75 = 67.446,75; marco finger enchapado
  ];
  const SUBTOTAL = 1_200_765;
  const FLETE = 15_000;
  const NETO = 1_215_765;

  it.each([
    // 1.215.765 × 0,10 = 121.576,5 → 121.577 (medio peso hacia arriba).
    ['10 %', 0.1, 121_577],
    ['0 % (exento)', 0, 0],
    // 1.215.765 × 0,19 = 230.995,35 → 230.995.
    ['19 %', 0.19, 230_995],
  ])('IVA %s', async (_nombre, iva, ivaEsperado) => {
    const producto = await productosSinteticos();
    const items: ItemPrecio[] = LINEAS.map(([codigo, cantidad]) => ({ producto: producto(codigo), cantidad }));
    const m = cotizar(items, { ...REGLAS, iva, margenes: MARGENES_INICIALES }, { flete: FLETE });
    expect(m.lineas.map((l) => [l.producto.codigo, l.cantidad, l.margen, l.precioUnitario, l.total])).toEqual(LINEAS);
    expect(m.lineas.every((l) => !l.margenPersonalizado)).toBe(true);
    expect({ subtotal: m.subtotal, descuento: m.descuento, flete: m.flete, neto: m.neto, iva: m.iva, total: m.total }).toEqual({
      subtotal: SUBTOTAL,
      descuento: 0,
      flete: FLETE,
      neto: NETO,
      iva: ivaEsperado,
      total: NETO + ivaEsperado,
    });
  });

  it('un IVA fuera de 0–100 % no se cotiza', async () => {
    const producto = await productosSinteticos();
    const items = [{ producto: producto('LANC-L-070-A'), cantidad: 1 }];
    for (const iva of [-0.01, 1.01, Number.NaN])
      expect(() => cotizar(items, { ...REGLAS, iva, margenes: MARGENES_INICIALES })).toThrow('iva_invalido');
  });
});

describe('descuentos, contra valores sacados a mano (la planilla no los tiene)', () => {
  const producto = (codigo: string, precioNeto: number): Producto => ({
    codigo,
    modelo: 'LANCO',
    familia: 'PUERTA',
    tipo: 'PUERTA',
    madera: 'LENGA',
    medida: '0,80',
    anchoMin: 0.8,
    anchoMax: 0.8,
    largo: 2,
    precioNeto,
    descripcion: codigo,
    filaOrigen: 4,
  });

  it('descuento por ítem (porcentaje y monto), descuento general, flete e IVA en una misma cotización', () => {
    const items: ItemPrecio[] = [
      // 100.000 × 1,25 = 125.000; 15 % = 18.750 por unidad → 106.250 × 3 = 318.750.
      { producto: producto('A', 100_000), cantidad: 3, margen: 0.25, descuento: { tipo: 'porcentaje', valor: 15 } },
      // 33.333 × 1,5 = 49.999,5 → 50.000; $1.234 por unidad → 48.766 × 2 = 97.532.
      { producto: producto('B', 33_333), cantidad: 2, margen: 0.5, descuento: { tipo: 'monto', valor: 1_234 } },
      // Un monto mayor que el precio (20.000) se limita al precio: la línea queda en 0, nunca negativa.
      { producto: producto('C', 20_000), cantidad: 1, margen: 0, descuento: { tipo: 'monto', valor: 25_000 } },
      // 77.777 × 1,1 = 85.554,7 → 85.555; 12,5 % = 10.694,375 → 10.694 → 74.861 × 7 = 524.027.
      { producto: producto('D', 77_777), cantidad: 7, margen: 0.1, descuento: { tipo: 'porcentaje', valor: 12.5 } },
      // Medio peso exacto: 30 × 25 % = 7,5 → 8 → 22.
      { producto: producto('E', 30), cantidad: 1, margen: 0, descuento: { tipo: 'porcentaje', valor: 25 } },
    ];
    // Subtotal 940.331; general 7,35 % = 69.114,33 → 69.114; neto 940.331 − 69.114 + 12.000 = 883.217;
    // IVA 883.217 × 0,19 = 167.811,23 → 167.811; total 1.051.028.
    const m = cotizar(items, REGLAS, { descuento: 7.35, flete: 12_000 });
    expect(m.lineas.map((l) => [l.precioUnitario, l.descuentoUnitario ?? 0, l.total])).toEqual([
      [125_000, 18_750, 318_750],
      [50_000, 1_234, 97_532],
      [20_000, 20_000, 0],
      [85_555, 10_694, 524_027],
      [30, 8, 22],
    ]);
    expect({ subtotal: m.subtotal, descuento: m.descuento, neto: m.neto, iva: m.iva, total: m.total }).toEqual({
      subtotal: 940_331,
      descuento: 69_114,
      neto: 883_217,
      iva: 167_811,
      total: 1_051_028,
    });
  });

  it('el flete no recibe el descuento general y el descuento máximo es 50 %', () => {
    const items: ItemPrecio[] = [{ producto: producto('A', 80_000), cantidad: 1, margen: 0 }];
    // 80.000 − 50 % = 40.000; + flete 10.000 = 50.000; IVA 9.500; total 59.500.
    expect(cotizar(items, REGLAS, { descuento: 50, flete: 10_000 })).toMatchObject({
      subtotal: 80_000,
      descuento: 40_000,
      neto: 50_000,
      iva: 9_500,
      total: 59_500,
    });
    expect(() => cotizar(items, REGLAS, { descuento: 50.01 })).toThrow('descuento_invalido');
  });
});

describe('paridad contra el catálogo guardado', () => {
  async function base() {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-paridad-'));
    const ruta = join(dir, 'cotizador.sqlite');
    limpiezas.push(async () => {
      cerrarBaseDatos(ruta);
      await rm(dir, { recursive: true, force: true });
    });
    return abrirBaseDatos(ruta);
  }
  /** Lo que hace la ruta de importación: analiza contra lo guardado y guarda. */
  async function aplicar(db: ReturnType<typeof abrirBaseDatos>, hojas: Hojas) {
    const { ruta, limpiar } = await escribirXlsx(hojas);
    limpiezas.push(limpiar);
    const { importado } = await analizarPlanilla(ruta, 'planilla.xlsx', new RepositorioCatalogoSqlite(db));
    guardarCatalogo(db, importado.catalogo, importado.configuracion);
    return importado;
  }
  /** Lo que pediría una persona para obtener justo este producto. */
  const solicitud = (p: Producto, cantidad: number): Partial<SolicitudItem> => ({
    modelo: p.modelo,
    madera: p.madera,
    ancho: p.familia === 'PUERTA' ? p.anchoMin : null,
    alto: p.altoMax ?? p.largo,
    medida: p.familia === 'PUERTA' ? null : p.medida,
    cantidad,
  });

  it('dos planillas y un producto manual cotizan igual desde SQLite que desde lo recién importado', async () => {
    const db = await base();
    const principal = await aplicar(db, planillaPrincipal());
    const enchapadas = await aplicar(db, planillaEnchapadas());
    const manual: Producto = {
      codigo: 'MAN-1',
      modelo: 'Manual',
      familia: 'PUERTA',
      tipo: 'PUERTA SÓLIDA',
      madera: 'LENGA',
      medida: '0,80 A 0,85',
      anchoMin: 0.8,
      anchoMax: 0.85,
      largo: 2.4,
      precioNeto: 99_999,
      descripcion: 'MANUAL LENGA 0,8 A 0,85 MT X 2,4 MT',
      filaOrigen: 0,
    };
    const repo = new RepositorioCatalogoSqlite(db);
    repo.agregarProductoManual(manual, repo.version!);

    const guardado = new RepositorioCatalogoSqlite(db);
    const productos = [...principal.catalogo.productos, ...enchapadas.catalogo.productos, manual];
    expect(guardado.todos()).toHaveLength(productos.length);
    const enMemoria: CatalogoConsultable = { ...principal.catalogo, productos };

    // Cada producto, pedido por sus atributos, se resuelve a sí mismo en los dos catálogos.
    const items = (catalogo: CatalogoConsultable) =>
      productos.map((p, i): ItemPrecio => {
        const r = resolverItem(catalogo, solicitud(p, i + 1));
        if (!r.ok) throw new Error(`${p.codigo}: ${r.rechazo.tipo}`);
        expect(r.producto.codigo).toBe(p.codigo);
        return { ...r, cantidad: i + 1 };
      });
    const desdeSqlite = items(guardado);
    const desdeMemoria = items(enMemoria);
    for (const [i, item] of desdeSqlite.entries())
      expect(item.producto, item.producto.codigo).toMatchObject({ ...productos[i], filaOrigen: expect.any(Number) });

    const reglas = { ...REGLAS, margenes: MARGENES_INICIALES };
    const extras = { flete: 8_000, descuento: 3.5 };
    const a = cotizar(desdeSqlite, reglas, extras);
    const b = cotizar(desdeMemoria, reglas, extras);
    expect(a).toEqual(b);
    // Y cada línea es neto × (1 + margen de su categoría), redondeado.
    for (const l of a.lineas) expect(l.precioUnitario).toBe(Math.round(l.producto.precioNeto * (1 + l.margen!)));
    expect(a.lineas.find((l) => l.producto.codigo === 'MAN-1')).toMatchObject({ margen: 0.55, precioUnitario: 154_998 });
  });
});

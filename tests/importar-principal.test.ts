import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { importarPlanilla } from '../src/catalogo/planilla';
import { escribirXlsx, planillaPrincipal, xlsxBytes, type Celdas, type FilaPrecio, type Hojas } from './fixture-xlsx';
import { MAX_FILAS_INVALIDAS, MAX_PROPORCION_INVALIDAS } from '../src/catalogo/importar';

const limpiezas: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const limpiar of limpiezas.splice(0)) await limpiar();
});
async function importar(hojas: Hojas) {
  const { ruta, limpiar } = await escribirXlsx(hojas);
  limpiezas.push(limpiar);
  return importarPlanilla(ruta);
}

describe('planilla principal', () => {
  it('lee los anchos en centímetros («70 A 80») como metros', async () => {
    const r = await importar(planillaPrincipal());
    expect(r.origen).toBe('principal');
    expect(r.catalogo.productos.map((p) => [p.codigo, p.anchoMin, p.anchoMax])).toEqual([
      ['LANC-L-070-A', 0.7, 0.8],
      ['LANC-L-070-B', 0.7, 0.8],
      ['LANC-R-090-A', 0.9, 0.9],
    ]);
  });

  it('un código corregido conserva los anchos en metros aunque la medida venga en centímetros', async () => {
    const r = await importar(
      planillaPrincipal([['LANC-L-070-X', 'LANCO', 'PUERTA', '70 A 80', 2, 'LENGA', 100000]]),
    );
    expect(r.incidencias).toEqual([
      expect.objectContaining({ accion: 'correccion', detalle: 'Código LANC-L-070-X → LANC-L-070-A' }),
    ]);
    expect(r.catalogo.productos).toEqual([
      expect.objectContaining({ codigo: 'LANC-L-070-A', anchoMin: 0.7, anchoMax: 0.8 }),
    ]);
  });
});

/** La planilla con estas celdas de Precio reemplazadas (errores, fórmulas, vacíos). */
function conCeldas(hojas: Hojas, celdas: Celdas, quitar: string[] = []): Hojas {
  const precio = { ...hojas.Precio, ...celdas };
  for (const ref of quitar) delete precio[ref];
  return { ...hojas, Precio: precio };
}
const DATOS_INVALIDOS = 'Datos incompletos o precio neto/IVA inconsistente.';
const excluidas = (r: Awaited<ReturnType<typeof importar>>) =>
  r.incidencias.filter((i) => i.accion === 'exclusion' && i.detalle === DATOS_INVALIDOS).map((i) => i.fila);

describe('planilla principal · bordes de las celdas', () => {
  // Las filas de planillaPrincipal() empiezan en la 4: LANC-L-070-A (4), LANC-L-070-B (5), LANC-R-090-A (6).
  it.each([
    ['P con #N/A', { P5: { error: '#N/A' } }, []],
    ['P vacía', {}, ['P5']],
    ['P como texto', { P5: 'consultar' }, []],
    ['P con fórmula sin valor guardado', { P5: { formula: 'O5*1.19' } }, []],
    ['O con #N/A', { O5: { error: '#N/A' } }, []],
    ['O con fórmula sin valor guardado', { O5: { formula: 'P5/1.19' } }, []],
  ] as [string, Celdas, string[]][])('%s: la fila se excluye como dato incompleto y el resto se importa', async (_caso, celdas, quitar) => {
    const r = await importar(conCeldas(planillaPrincipal(), celdas, quitar));
    expect(excluidas(r)).toEqual([5]);
    expect(r.catalogo.productos.map((p) => p.codigo)).toEqual(['LANC-L-070-A', 'LANC-R-090-A']);
  });

  it('una fórmula con su valor guardado se lee como ese valor', async () => {
    const r = await importar(
      conCeldas(planillaPrincipal(), { O5: { formula: 'P5/1.19', valor: 120000 }, P5: { formula: 'O5*1.19', valor: 142800 } }),
    );
    expect(excluidas(r)).toEqual([]);
    expect(r.catalogo.productos.find((p) => p.codigo === 'LANC-L-070-B')?.precioNeto).toBe(120000);
  });
});

/** `n` filas válidas y distintas (8 por modelo: 2 maderas × 2 medidas × 2 largos) con sus tablas de códigos. */
function planillaGrande(n: number): Hojas {
  const filas: FilaPrecio[] = [];
  const categorias: Celdas = { G4: 'LENGA', G5: 'RAULI', R4: '70 A 80', S4: '070', R5: '0,90', S5: '090', U4: 2, V4: 'A', U5: 2.4, V5: 'B' };
  for (let m = 0; filas.length < n; m++) {
    const modelo = `MODELO${m}`;
    const abrev = `M${m}`;
    Object.assign(categorias, { [`O${4 + m}`]: modelo, [`P${4 + m}`]: abrev });
    for (const [madera, letraMadera] of [['LENGA', 'L'], ['RAULI', 'R']])
      for (const [medida, seg] of [['70 A 80', '070'], ['0,90', '090']])
        for (const [largo, letra] of [[2, 'A'], [2.4, 'B']] as const)
          if (filas.length < n) filas.push([`${abrev}-${letraMadera}-${seg}-${letra}`, modelo, 'PUERTA', medida, largo, madera, 100000 + filas.length]);
  }
  const hojas = planillaPrincipal(filas);
  return { ...hojas, Categorias: categorias };
}
/** La planilla grande con las primeras `k` filas con el precio con IVA en #N/A. */
const conInvalidas = (n: number, k: number) =>
  conCeldas(planillaGrande(n), Object.fromEntries(Array.from({ length: k }, (_, i) => [`P${4 + i}`, { error: '#N/A' }])));

describe(`planilla principal · tolerancia de ${MAX_FILAS_INVALIDAS} filas o ${MAX_PROPORCION_INVALIDAS * 100} %`, () => {
  it.each([
    [100, 5, true],
    [100, 6, false],
    [1000, 10, true],
    [1000, 11, false],
  ])('%i filas con %i inválidas: ¿se importa? %s', async (n, k, acepta) => {
    const hojas = conInvalidas(n, k);
    if (acepta) {
      const r = await importar(hojas);
      expect(excluidas(r)).toHaveLength(k);
      expect(r.catalogo.productos).toHaveLength(n - k);
    } else await expect(importar(hojas)).rejects.toThrow(new RegExp(`^${k} de ${n} filas de Precio tienen datos incompletos`));
  });
});

describe('planilla principal · Strict Open XML', () => {
  // Armado sin Excel: el libro sintético con los espacios de nombres de ISO/IEC 29500 Strict (purl.oclc.org) y
  // conformance="strict". Excel además escribe las fechas en ISO 8601, pero Precio no tiene fechas.
  it('se importa igual que el mismo libro en formato transicional', async () => {
    const transicional = await importar(planillaPrincipal());
    const partes = unzipSync(xlsxBytes(planillaPrincipal()));
    const strict: Record<string, Uint8Array> = {};
    for (const [nombre, bytes] of Object.entries(partes))
      strict[nombre] = strToU8(
        strFromU8(bytes)
          .replaceAll('http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'http://purl.oclc.org/ooxml/spreadsheetml/main')
          .replaceAll('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships')
          .replace('<workbook ', '<workbook conformance="strict" '),
      );
    expect(strFromU8(strict['xl/workbook.xml'])).toContain('purl.oclc.org/ooxml/spreadsheetml/main');
    const dir = await mkdtemp(join(tmpdir(), 'neltume-strict-'));
    limpiezas.push(() => rm(dir, { recursive: true, force: true }));
    const ruta = join(dir, 'strict.xlsx');
    await writeFile(ruta, zipSync(strict));
    const r = await importarPlanilla(ruta);
    expect(r.catalogo.productos).toEqual(transicional.catalogo.productos);
    expect(r.incidencias).toEqual(transicional.incidencias);
  });
});

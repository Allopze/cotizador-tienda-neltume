import { afterEach, describe, expect, it } from 'vitest';
import { importarPlanilla } from '../src/catalogo/planilla';
import { escribirXlsx, planillaPrincipal, type Hojas } from './fixture-xlsx';

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

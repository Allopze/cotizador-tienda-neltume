import { describe, expect, it } from 'vitest';
import { estimarUnidad } from '../src/negocio/peso-estimado';
import { metros } from '../src/catalogo/resolver';

describe('Unidades físicas del catálogo', () => {
  it.each([['30X70', 6.30], ['30X90', 8.01]] as const)('estima el set %s en milímetros', (medida, kg) => {
    const unidad = estimarUnidad({ familia: 'MARCO', tipo: 'SET DE MARCO', madera: 'PINO FINGER', medida }, { anchoCm: 0, largoCm: 220 });
    expect(unidad.kg).toBeCloseTo(kg, 2);
    expect(unidad.kg).toBeLessThan(20);
  });
  it('distingue los límites de puertas y accesorios', () => {
    expect(metros(3.6, 'MOLDURA')).toBe(3.6);
    expect(metros(360, 'MOLDURA')).toBe(3.6);
    expect(metros(3600, 'MOLDURA')).toBe(3.6);
    expect(metros(3.6, 'PUERTA')).toBeNull();
    expect(metros(6.1, 'MARCO')).toBeNull();
  });
});

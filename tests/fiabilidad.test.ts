import { describe, expect, it } from 'vitest';
import { estimarUnidad } from '../src/negocio/peso-estimado';
import { metros } from '../src/catalogo/resolver';

describe('Unidades físicas del catálogo', () => {
  // D1: el plan pedía entre 8 y 15 kg, pero esa cifra era una estimación a ojo. La geometría da menos: un set
  // de 30 × 70 mm son dos jambas de 2,31 m (220 cm + 5 %) y un dintel de 1 m = 5,62 m de pino finger
  // (500 kg/m³) → 0,03 × 0,07 × 5,62 × 500 = 5,90 kg de madera, más ~0,4 kg de film y zuncho. Antes del arreglo
  // daba 3.088,75 kg (la sección leída en pulgadas); lo que importa es que quede en el orden de un set real.
  it.each([
    ['30X70', 0.03 * 0.07, 6.3],
    ['30X90', 0.03 * 0.09, 8.01],
  ] as const)('estima el set %s en milímetros, como su volumen de madera más el embalaje', (medida, seccionM2, kg) => {
    const unidad = estimarUnidad({ familia: 'MARCO', tipo: 'SET DE MARCO', madera: 'PINO FINGER', medida }, { anchoCm: 0, largoCm: 220 });
    const madera = seccionM2 * (2 * 2.2 * 1.05 + 1) * 500;
    expect(unidad.kg).toBeCloseTo(kg, 2);
    // El embalaje suma menos de 1 kg: el resto es madera calculada a mano.
    expect(unidad.kg - madera).toBeGreaterThan(0.2);
    expect(unidad.kg - madera).toBeLessThan(1);
    // Del orden de un set real (5–15 kg), nunca toneladas.
    expect(unidad.kg).toBeGreaterThan(5);
    expect(unidad.kg).toBeLessThan(15);
  });
  it('distingue los límites de puertas y accesorios', () => {
    expect(metros(3.6, 'MOLDURA')).toBe(3.6);
    expect(metros(360, 'MOLDURA')).toBe(3.6);
    expect(metros(3600, 'MOLDURA')).toBe(3.6);
    expect(metros(3.6, 'PUERTA')).toBeNull();
    expect(metros(6.1, 'MARCO')).toBeNull();
  });
});

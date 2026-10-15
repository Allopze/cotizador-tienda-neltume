import { describe, expect, it } from 'vitest';
import { estimarUnidad } from '../src/negocio/peso-estimado';
import { metros } from '../src/catalogo/resolver';

describe('Unidades físicas del catálogo', () => {
  // D1: el plan (docs/revision-2026-10-11.md) pedía entre 8 y 15 kg, pero esa cifra era una estimación a ojo y no
  // sale de la geometría. Un set de 30 × 70 mm son dos jambas de 2,31 m (220 cm + 5 %) y un dintel de 1 m = 5,62 m de
  // pino finger (500 kg/m³) → 0,03 × 0,07 × 5,62 × 500 = 5,90 kg de madera, más el film y el zuncho. El código está
  // bien y el rango del plan no: la prueba no fija la cifra que da el código, la deriva de las medidas y la contrasta
  // con un kit 2X4 en pulgadas. Antes del arreglo daba 3.088,75 kg (la sección leída en pulgadas).
  const set = (medida: string) =>
    estimarUnidad({ familia: 'MARCO', tipo: 'SET DE MARCO', madera: 'PINO FINGER', medida }, { anchoCm: 0, largoCm: 220 });
  /** Madera de un kit de 220 cm: dos jambas con 5 % de sobrelargo y un dintel de 1 m, a 500 kg/m³. */
  const madera = (seccionM2: number) => seccionM2 * (2 * 2.2 * 1.05 + 1) * 500;

  it.each([
    ['30X70', 0.03 * 0.07],
    ['30X90', 0.03 * 0.09],
  ] as const)('estima el set %s en milímetros: su madera más un embalaje de menos de 1 kg', (medida, seccionM2) => {
    const embalaje = set(medida).kg - madera(seccionM2);
    expect(embalaje).toBeGreaterThan(0.2);
    expect(embalaje).toBeLessThan(1);
  });

  it('los sets crecen con su sección en mm y pesan la mitad que un kit 2X4 de pino', () => {
    // De 30X70 a 30X90 solo cambia la madera: 0,03 × 0,02 × 5,62 m × 500 kg/m³ = 1,69 kg.
    expect(set('30X90').kg - set('30X70').kg).toBeCloseTo(madera(0.03 * 0.09) - madera(0.03 * 0.07), 1);
    // Un 2X4 cepillado mide 4,57 × 9,14 cm (41,8 cm²); el set de 30 × 70 mm, 21 cm²: la mitad de madera.
    const kit = estimarUnidad({ familia: 'MARCO', tipo: 'MARCO', madera: 'PINO', medida: '2X4' }, { anchoCm: 0, largoCm: 220 });
    expect(set('30X70').kg / kit.kg).toBeGreaterThan(0.4);
    expect(set('30X70').kg / kit.kg).toBeLessThan(0.6);
    // Del orden de un set real, nunca toneladas.
    expect(set('30X70').kg).toBeGreaterThan(5);
    expect(set('30X90').kg).toBeLessThan(15);
  });
  it('distingue los límites de puertas y accesorios', () => {
    expect(metros(3.6, 'MOLDURA')).toBe(3.6);
    expect(metros(360, 'MOLDURA')).toBe(3.6);
    expect(metros(3600, 'MOLDURA')).toBe(3.6);
    expect(metros(3.6, 'PUERTA')).toBeNull();
    expect(metros(6.1, 'MARCO')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { errorMargenTexto } from '../src/negocio/cifras';
import { anticipoMinimo } from '../src/negocio/estado';
import {
  AJUSTE_MAX,
  AJUSTE_MIN,
  ANTICIPO_MINIMO,
  MARGEN_MAX,
  MARGEN_MIN,
  RANGO_MARGEN,
} from '../src/negocio/limites';
import { margenValido } from '../src/negocio/precios';
import {
  configuracionNegocioPredeterminada,
  configuracionNegocioSchema,
} from '../src/servidor/configuracion-negocio';

describe('límites comerciales en un solo lugar', () => {
  it('el cálculo y la pantalla aceptan el margen justo en el límite y rechazan lo que pasa de él', () => {
    expect(margenValido(MARGEN_MIN)).toBe(true);
    expect(margenValido(MARGEN_MAX)).toBe(true);
    expect(margenValido(MARGEN_MIN - 0.01)).toBe(false);
    expect(margenValido(MARGEN_MAX + 0.01)).toBe(false);
    expect(errorMargenTexto(String(MARGEN_MAX * 100))).toBeNull();
    expect(errorMargenTexto(String(MARGEN_MAX * 100 + 1))).toBe('El margen debe estar entre -50 y 500 %.');
    expect(RANGO_MARGEN).toBe('−50 % a 500 %');
  });

  it('la configuración del negocio usa los mismos límites para márgenes y ajuste', () => {
    const base = configuracionNegocioPredeterminada();
    const con = (reglas: Partial<typeof base.reglas>) =>
      configuracionNegocioSchema.safeParse({ ...base, reglas: { ...base.reglas, ...reglas } }).success;
    expect(con({ margenes: { ...base.reglas.margenes, otros: MARGEN_MAX } })).toBe(true);
    expect(con({ margenes: { ...base.reglas.margenes, otros: MARGEN_MAX + 0.01 } })).toBe(false);
    expect(con({ ajuste: AJUSTE_MIN })).toBe(true);
    expect(con({ ajuste: AJUSTE_MAX })).toBe(true);
    expect(con({ ajuste: AJUSTE_MAX + 0.01 })).toBe(false);
  });

  it('el anticipo mínimo es la parte fijada del total, redondeada hacia arriba', () => {
    expect(ANTICIPO_MINIMO).toBe(0.5);
    expect(anticipoMinimo(1001)).toBe(501);
  });
});

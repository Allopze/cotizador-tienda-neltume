import { describe, expect, it } from 'vitest';
import {
  coincideBusquedaCatalogo,
  terminosBusquedaCatalogo,
  textoBusquedaCatalogo,
} from '../src/servidor/busqueda';

const molco = textoBusquedaCatalogo([
  'MOL-O-3-A',
  'MOLCO',
  'PINO OREGON',
  'PUERTA BLOQUE',
  '0,80 A 0,85',
  'MOLCO PINO OREGON 0,8 A 0,85 MT X 2 MT',
]);
const busca = (q: string, texto = molco) => coincideBusquedaCatalogo(texto, terminosBusquedaCatalogo(q));

describe('búsqueda del catálogo', () => {
  it('encuentra la medida escrita con coma, punto, ceros o en centímetros', () => {
    // El ejemplo del buscador de Consultar tiene que encontrar algo.
    for (const q of ['Molco oregón 0,80', 'molco 0.80', 'molco 0,8', 'molco oregon 80', 'molco 0,80 a 0,85', 'molco 80 85'])
      expect(busca(q), q).toBe(true);
  });

  it('compara los números enteros: 0,8 no encuentra 0,85 ni 0,85 encuentra 0,8 a 0,9', () => {
    const otra = textoBusquedaCatalogo(['MOL-O-4-A', 'MOLCO', 'PINO OREGON', 'MOLCO PINO OREGON 0,9 A 0,95 MT X 2 MT']);
    expect(busca('molco 0,8', otra)).toBe(false);
    expect(busca('molco 0,85', otra)).toBe(false);
    expect(busca('molco 0,9', otra)).toBe(true);
  });

  it('lee el alto en centímetros y conserva el entero', () => {
    expect(busca('molco 200')).toBe(true);
    expect(busca('molco 2')).toBe(true);
    expect(busca('molco 210')).toBe(false);
  });

  it('sigue encontrando códigos y fragmentos de texto', () => {
    expect(busca('MOL-O-3-A')).toBe(true);
    expect(busca('mol-o-4-a')).toBe(false);
    expect(busca('molc oreg')).toBe(true);
    expect(busca('')).toBe(true);
  });

  it('no lee en centímetros los números chicos ni los de escuadría', () => {
    expect(terminosBusquedaCatalogo('3')).toEqual([['3']]);
    expect(terminosBusquedaCatalogo('2x4')).toEqual([['2x4']]);
    expect(terminosBusquedaCatalogo('80')).toEqual([['80', '0d8']]);
  });
});

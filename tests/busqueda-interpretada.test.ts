// Búsqueda del catálogo con las reglas del asistente (auditoría 2026-11, N-07).
import { describe, expect, it } from 'vitest';
import type { Catalogo, Producto } from '../src/catalogo/tipos';
import { filtrarCatalogo, interpretarBusqueda } from '../src/catalogo/busqueda';
import { coincideBusquedaCatalogo, terminosBusquedaCatalogo, textoBusquedaCatalogo } from '../src/servidor/busqueda';

const puerta = (modelo: string, madera: string, abrev: string, letra: string, anchoMin: number, anchoMax: number, largo: number): Producto => ({
  codigo: `${abrev}-${letra}-${Math.round(anchoMax * 100)}-${Math.round(largo * 100)}`,
  modelo,
  familia: 'PUERTA',
  tipo: anchoMin >= 1.1 ? 'PUERTA ESPECIAL' : 'PUERTA PANEL',
  madera,
  medida: `${anchoMin} A ${anchoMax}`,
  anchoMin,
  anchoMax,
  largo,
  precioNeto: 100_000,
  descripcion: `${modelo} ${madera}`,
  filaOrigen: 1,
});
const tramos: [number, number][] = [
  [0.6, 0.65],
  [0.7, 0.75],
  [0.8, 0.85],
  [0.9, 1.05],
];
const productos: Producto[] = [
  ...['RANCO', 'HUILO HUILO', 'COZ COZ'].flatMap((modelo) =>
    ['PINO OREGON', 'MARA'].flatMap((madera) =>
      tramos.flatMap(([a, b]) => [2, 2.2].map((alto) => puerta(modelo, madera, modelo.slice(0, 3), madera[0], a, b, alto))),
    ),
  ),
  {
    codigo: 'MAR-O-2X4-B',
    modelo: 'MARCO',
    familia: 'MARCO',
    tipo: 'SET DE MARCO',
    madera: 'PINO OREGON',
    medida: '2X4',
    anchoMin: null,
    anchoMax: null,
    largo: 2.1,
    precioNeto: 30_000,
    descripcion: 'MARCO PINO OREGON 2X4',
    filaOrigen: 2,
  },
];
const catalogo: Catalogo = { fuente: 'test', sha256: 't', fecha: '2026-01-01', productos };
const porTexto = (p: Producto, libres: string[]) =>
  coincideBusquedaCatalogo(
    textoBusquedaCatalogo([p.codigo, p.modelo, p.madera, p.tipo, p.medida, p.descripcion]),
    terminosBusquedaCatalogo(libres.join(' ')),
  );
const buscar = (q: string) => {
  const b = interpretarBusqueda(q, catalogo);
  return { b, r: filtrarCatalogo(productos, b, porTexto) };
};

describe('búsqueda interpretada del catálogo', () => {
  it('entiende alias y plurales de modelo, como el asistente', () => {
    expect(buscar('willow').b.modelo).toBe('HUILO HUILO');
    expect(buscar('coscos').b.modelo).toBe('COZ COZ');
    expect(buscar('rancos').b.modelo).toBe('RANCO');
    expect(buscar('willow').r.every((p) => p.modelo === 'HUILO HUILO')).toBe(true);
  });

  it('sugiere el modelo ante un error de una letra', () => {
    const { b, r } = buscar('ranko');
    expect(b.sugerencia).toBe('RANCO');
    expect(r).toHaveLength(0); // la API vuelve a buscar con la sugerencia y lo dice
  });

  it('una medida dentro del tramo encuentra ese tramo', () => {
    const { r } = buscar('ranco oregon 0,82 2,2');
    expect(r.map((p) => [p.anchoMin, p.anchoMax, p.largo])).toEqual([[0.8, 0.85, 2.2]]);
    expect(buscar('ranco 85x220').r.every((p) => p.anchoMin === 0.8 && p.largo === 2.2)).toBe(true);
  });

  it('«1,00 2,20» no confunde el 1 con el código y trae la puerta de 1,00 m', () => {
    const { r } = buscar('ranco pino oregon 1,00 2,20');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ anchoMin: 0.9, anchoMax: 1.05, largo: 2.2 });
  });

  it('«un metro» y «de 100» son medidas; «puertas» filtra el tipo de producto', () => {
    expect(buscar('pino oregón 1 metro').r.every((p) => p.anchoMax === 1.05 && p.madera === 'PINO OREGON')).toBe(true);
    expect(buscar('puerta de 100').r.every((p) => p.familia === 'PUERTA' && p.anchoMax === 1.05)).toBe(true);
    expect(buscar('puertas').b.familia).toBe('PUERTA');
  });

  it('la sección de un marco se lee en cualquier orden', () => {
    expect(buscar('marco 4x2').r.map((p) => p.codigo)).toEqual(['MAR-O-2X4-B']);
    expect(buscar('marco 2x4').r.map((p) => p.codigo)).toEqual(['MAR-O-2X4-B']);
  });

  it('una medida entre dos tramos usa el siguiente, como al cotizar', () => {
    const { r } = buscar('ranco mara 0,87 2,00');
    expect(r.map((p) => [p.anchoMin, p.largo])).toEqual([[0.9, 2]]);
  });

  it('lo que no se interpreta se sigue buscando como texto (códigos, tipos)', () => {
    expect(buscar('RAN-P-85-220').r.map((p) => p.codigo)).toContain('RAN-P-85-220');
  });
});

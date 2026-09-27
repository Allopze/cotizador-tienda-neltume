import { describe, expect, it } from 'vitest';
import { clienteVacio, type SolicitudItem } from '../src/catalogo/tipos';
import type { Cotizacion } from '../src/negocio/estado';
import { resolverReferencia } from '../src/servidor/referencias';

const puerta: SolicitudItem = {
  modelo: 'HUILO HUILO',
  madera: 'PINO OREGON',
  ancho: 0.8,
  alto: 2.1,
  medida: null,
  cantidad: 3,
};

function cotizacion(id: string, numero: number, nombre = 'María José', cantidad = 3): Cotizacion {
  const fecha = `2026-01-${String(numero - 322).padStart(2, '0')}T12:00:00.000Z`;
  return {
    id,
    numero,
    estado: 'emitida',
    cliente: { ...clienteVacio(), nombre, comuna: 'Temuco', proyecto: 'Casa Norte' },
    solicitudes: [{ ...puerta, cantidad }],
    montos: { lineas: [], neto: 0, iva: 0, total: 0 },
    incompletos: [],
    historial: [],
    creada: fecha,
    actualizada: fecha,
    fechaEmision: fecha,
    pdf: `cotizacion-${numero}.pdf`,
    nota: null,
  };
}

describe('Resolución de referencias a cotizaciones', () => {
  it('busca nombres sin depender de tildes ni mayúsculas', () => {
    const q = cotizacion('maria-1', 323);
    const resultado = resolverReferencia(
      'La cotizacion de MARIA JOSE ahora debe ser de 8 puertas y no de 3',
      [q],
    );
    expect(resultado).toEqual({ tipo: 'unica', cotizacion: q });
  });

  it('prioriza el número explícito de cotización', () => {
    const maria = cotizacion('maria-1', 323);
    const jose = cotizacion('jose-1', 324, 'José Pérez');
    expect(resolverReferencia('Modifica la cotización N° 324 de María José', [maria, jose])).toEqual({
      tipo: 'unica',
      cotizacion: jose,
    });
  });

  it('usa la cantidad anterior para separar cotizaciones del mismo cliente', () => {
    const tres = cotizacion('maria-3', 323, 'María José', 3);
    const cuatro = cotizacion('maria-4', 324, 'María José', 4);
    expect(
      resolverReferencia('La cotización de María José ahora debe ser de 8 y no de 3 puertas', [tres, cuatro]),
    ).toEqual({ tipo: 'unica', cotizacion: tres });
  });

  it('devuelve opciones si la referencia todavía es ambigua', () => {
    const a = cotizacion('maria-1', 323);
    const b = cotizacion('maria-2', 324);
    const resultado = resolverReferencia('La cotización de María José debe cambiar', [a, b]);
    expect(resultado.tipo).toBe('multiples');
    if (resultado.tipo === 'multiples') {
      expect(resultado.opciones.map((q) => q.numero)).toEqual([324, 323]);
      expect(JSON.stringify(resultado.opciones)).not.toMatch(/montos|precio|total/);
    }
  });

  it('no confunde una solicitud nueva con una referencia anterior', () => {
    const q = cotizacion('maria-1', 323);
    expect(resolverReferencia('Cotiza 3 Huilo Huilo para María José, Temuco', [q])).toEqual({
      tipo: 'ninguna',
    });
  });
});

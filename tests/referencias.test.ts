import { describe, expect, it } from 'vitest';
import { clienteVacio, type SolicitudItem } from '../src/catalogo/tipos';
import type { Cotizacion } from '../src/negocio/estado';
import { numeroExplicito, resolverReferencia } from '../src/servidor/referencias';
import { montosVacios } from '../src/negocio/precios';

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
    montos: montosVacios(),
    incompletos: [],
    historial: [],
    creada: fecha,
    actualizada: fecha,
    fechaEmision: fecha,
    pdf: `cotizacion-${numero}.pdf`,
    vence: null,
    descuento: 0,
    flete: 0,
    creadaPor: null,
    emitidaPor: null,
    aprobadaPor: null,
    anuladaPor: null,
    fechaAnulacion: null,
    motivoAnulacion: null,
    reemplazadaPor: null,
    versionCatalogo: null,
    notas: [],
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

  it('A1: no confunde un número de dirección con una cotización', () => {
    for (const texto of [
      'Despacho a Los Carrera #450, Temuco',
      'Dirección: Pasaje 3 N° 450',
      'Avenida Alemania nro 450, casa la 450',
      'Calle la 450',
    ])
      expect(numeroExplicito(texto)).toBeNull();
    for (const [texto, numero] of [
      ['cotización 450', 450],
      ['Revisa la cotización N° 450 por favor', 450],
      ['nro de cotización 451', 451],
      ['número de la cotización 452', 452],
      ['cambia la 453: son 4 puertas', 453],
      ['cotizacion #454', 454],
    ] as const)
      expect(numeroExplicito(texto)).toBe(numero);
    const q = cotizacion('maria-450', 450);
    expect(resolverReferencia('La de María José, despacho a Los Carrera #450', [q]).tipo).toBe('unica');
    expect(resolverReferencia('Agrega 2 puertas, despacho en Pasaje 3 N° 450', [q])).toEqual({
      tipo: 'ninguna',
    });
  });

  it('A1: prefiere la conversación activa entre varias coincidencias y omite reemplazadas', () => {
    const a = cotizacion('maria-1', 323);
    const b = cotizacion('maria-2', 324);
    expect(resolverReferencia('La cotización de María José debe cambiar', [a, b], 'maria-1')).toEqual({
      tipo: 'unica',
      cotizacion: a,
    });
    const reemplazada = { ...b, estado: 'reemplazada' as const };
    expect(resolverReferencia('La cotización de María José debe cambiar', [a, reemplazada])).toEqual({
      tipo: 'unica',
      cotizacion: a,
    });
    // Por número explícito sí se alcanza, para informar que fue reemplazada.
    expect(resolverReferencia('cotización 324', [a, reemplazada])).toEqual({
      tipo: 'unica',
      cotizacion: reemplazada,
    });
  });
});

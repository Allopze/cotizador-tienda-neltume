import { describe, expect, it } from 'vitest';
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { clienteVacio } from '../src/catalogo/tipos';
import { facturacionPendiente } from '../src/negocio/estado';
import { FormAprobacion, estadoInicialAprobacion } from '../src/app/dialogos-cotizacion';

const cliente = {
  ...clienteVacio(),
  nombre: 'Constructora Lingue',
  rut: '76.543.210-3',
  giro: 'Construcción de obras',
  direccion: 'Camino Real 120',
  comuna: 'Pucón',
};

describe('A3 · selector de facturación en diálogo de aprobación', () => {
  it('parte en «Aún no sabe» y precarga el receptor desde los datos del cliente de la cotización', () => {
    const inicial = estadoInicialAprobacion({ cliente, facturacion: facturacionPendiente() });
    expect(inicial).toEqual({
      documento: 'sin_definir',
      teniaPrevio: false,
      receptor: {
        razonSocial: 'Constructora Lingue',
        rut: '76.543.210-3',
        giro: 'Construcción de obras',
        direccion: 'Camino Real 120',
        comuna: 'Pucón',
        correo: '',
      },
    });

    const html = renderToStaticMarkup(
      createElement(FormAprobacion, {
        datos: { numero: 325, despacho: null, vence: null, vencida: false, cliente, facturacion: null },
        cancelar: createRef<HTMLButtonElement>(),
        responder: () => {},
      }),
    );
    expect(html).toContain('Aún no sabe');
    expect(html).toContain('Boleta');
    expect(html).toContain('Factura');
    expect(html).toContain('Registrar aprobación');
  });

  it('tras deshacer aprobación, conserva documento y receptor de facturación por sobre los datos del cliente', () => {
    const facturacionGuardada = {
      estado: 'pendiente' as const,
      documento: 'factura' as const,
      receptor: {
        razonSocial: 'Otra Razón Social SpA',
        rut: '12.345.678-5',
        giro: 'Servicios de ingeniería',
        direccion: 'Av. Providencia 500',
        comuna: 'Providencia',
        correo: 'dte@otra.cl',
      },
      tipo: null,
      identificadorExterno: null,
      fecha: null,
    };
    const inicial = estadoInicialAprobacion({ cliente, facturacion: facturacionGuardada });
    expect(inicial).toEqual({
      documento: 'factura',
      teniaPrevio: true,
      receptor: {
        razonSocial: 'Otra Razón Social SpA',
        rut: '12.345.678-5',
        giro: 'Servicios de ingeniería',
        direccion: 'Av. Providencia 500',
        comuna: 'Providencia',
        correo: 'dte@otra.cl',
      },
    });

    const html = renderToStaticMarkup(
      createElement(FormAprobacion, {
        datos: {
          numero: 325,
          despacho: null,
          vence: null,
          vencida: false,
          cliente,
          facturacion: facturacionGuardada,
        },
        cancelar: createRef<HTMLButtonElement>(),
        responder: () => {},
      }),
    );
    expect(html).toContain('Otra Razón Social SpA');
    expect(html).toContain('12.345.678-5');
    expect(html).toContain('dte@otra.cl');
  });
});

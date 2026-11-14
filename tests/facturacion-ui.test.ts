import { describe, expect, it, vi } from 'vitest';
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { clienteVacio } from '../src/catalogo/tipos';
import type { ClienteRegistrado } from '../src/negocio/cliente-registro';
import { facturacionPendiente, type Cotizacion } from '../src/negocio/estado';
import { montosVacios, REGLAS } from '../src/negocio/precios';
import { buscarRegistroPorRut, combinarReceptorConRegistro } from '../src/app/clientes/cliente-registro-api';
import { FormAprobacion, estadoInicialAprobacion } from '../src/app/dialogos-cotizacion';
import { FacturacionOperacion } from '../src/app/facturacion-operacion';
import { SeguimientoOperacion } from '../src/app/seguimiento-operacion';
import { parametros } from '../src/app/historial';

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

function cotizacionAprobada(extra: Partial<Cotizacion> = {}): Cotizacion {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    numero: 325,
    estado: 'aprobada',
    cliente,
    solicitudes: [],
    montos: montosVacios(),
    incompletos: [],
    historial: [],
    creada: '2026-10-01T12:00:00.000Z',
    actualizada: '2026-10-01T12:00:00.000Z',
    pdf: 'cotizacion-325.pdf',
    fechaEmision: '2026-10-01T12:00:00.000Z',
    vence: '2026-10-16',
    descuento: 0,
    flete: 0,
    reglas: REGLAS,
    creadaPor: 'Paula',
    emitidaPor: 'Paula',
    aprobadaPor: 'Paula',
    fechaAprobacion: '2026-10-01T12:00:00.000Z',
    anuladaPor: null,
    fechaAnulacion: null,
    motivoAnulacion: null,
    reemplazadaPor: null,
    versionCatalogo: 'test:2026-01-01',
    notas: [],
    facturacion: facturacionPendiente(),
    ...extra,
  };
}

const renderOperacion = (actual: Cotizacion) =>
  renderToStaticMarkup(
    createElement(FacturacionOperacion, {
      actual,
      ocupado: false,
      rangoFecha: { min: '2026-10-01', max: '2026-10-15' },
      explicarFecha: () => {},
      flujo: async () => true,
      confirmar: async () => true,
    }),
  );

describe('A4 · bloque de facturación en seguimiento de operación', () => {
  it('cotización aprobada pre-v30 (sin receptor) muestra «Faltan datos para facturar» y deshabilita Marcar como facturada', () => {
    const preV30 = cotizacionAprobada({
      cliente: { ...clienteVacio(), nombre: 'Cliente Antiguo' },
      facturacion: {
        estado: 'pendiente',
        documento: null,
        receptor: null,
        tipo: null,
        identificadorExterno: null,
        fecha: null,
      },
    });
    const html = renderOperacion(preV30);
    expect(html).toContain('Faltan datos para facturar');
    expect(html).toContain('razón social');
    expect(html).toContain('RUT válido');
    expect(html).toContain('giro');
    expect(html).toContain('dirección');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Marcar como facturada<\/button>/);
  });

  it('con factura y receptor completo guardado habilita Marcar como facturada y ofrece Copiar datos para facturar', () => {
    const lista = cotizacionAprobada({
      facturacion: {
        estado: 'pendiente',
        documento: 'factura',
        receptor: {
          razonSocial: 'Constructora Lingue SpA',
          rut: '76.543.210-3',
          giro: 'Construcción de obras',
          direccion: 'Camino Real 120',
          comuna: 'Pucón',
          correo: 'dte@lingue.cl',
        },
        tipo: null,
        identificadorExterno: null,
        fecha: null,
      },
    });
    const html = renderOperacion(lista);
    expect(html).not.toContain('Faltan datos para facturar');
    expect(html).toContain('Copiar datos para facturar');
    expect(html).toMatch(/<button type="submit" class="button secondary">Marcar como facturada<\/button>/);
  });

  it('cuando ya está facturada con receptor lo muestra en solo lectura con botón Copiar; sin receptor (pre-v30) no falla', () => {
    const facturadaConReceptor = cotizacionAprobada({
      facturacion: {
        estado: 'facturada',
        documento: 'factura',
        receptor: {
          razonSocial: 'Constructora Lingue SpA',
          rut: '76.543.210-3',
          giro: 'Construcción de obras',
          direccion: 'Camino Real 120',
          comuna: null,
          correo: null,
        },
        tipo: 'factura',
        identificadorExterno: '9001',
        fecha: '2026-10-05T12:00:00.000Z',
      },
    });
    const htmlCon = renderOperacion(facturadaConReceptor);
    expect(htmlCon).toContain('Facturada · Factura N° 9001');
    expect(htmlCon).toContain('Constructora Lingue SpA');
    expect(htmlCon).toContain('76.543.210-3');
    expect(htmlCon).toContain('Copiar datos para facturar');
    expect(htmlCon).toContain('Volver a pendiente');

    const preV30Facturada = cotizacionAprobada({
      facturacion: {
        estado: 'facturada',
        documento: null,
        receptor: null,
        tipo: 'factura',
        identificadorExterno: '123',
        fecha: '2026-09-01T12:00:00.000Z',
      },
    });
    const htmlLegada = renderOperacion(preV30Facturada);
    expect(htmlLegada).toContain('Facturada · Factura N° 123');
    expect(htmlLegada).toContain('Volver a pendiente');
    expect(htmlLegada).not.toContain('Copiar datos para facturar');
  });
});

describe('A5 · resumen de estado y filtro Por facturar en historial', () => {
  it('SeguimientoOperacion muestra el documento y receptor elegidos y parametros() arma porFacturar=true', () => {
    const q = cotizacionAprobada({
      facturacion: {
        estado: 'pendiente',
        documento: 'factura',
        receptor: {
          razonSocial: 'Constructora Lingue SpA',
          rut: '76.543.210-3',
          giro: 'Construcción de obras',
          direccion: 'Camino Real 120',
          comuna: null,
          correo: null,
        },
        tipo: null,
        identificadorExterno: null,
        fecha: null,
      },
    });
    const html = renderToStaticMarkup(
      createElement(SeguimientoOperacion, {
        actual: q,
        ocupado: false,
        flujo: async () => true,
        anularPago: async () => true,
      }),
    );
    expect(html).toContain('Documento:');
    expect(html).toContain('Factura a Constructora Lingue SpA (76.543.210-3)');

    const qs = parametros({
      q: '',
      estado: 'por_facturar',
      desde: '',
      hasta: '',
      comercial: '',
      operativo: '',
      vendedora: '',
    });
    expect(qs.get('porFacturar')).toBe('true');
  });
});

describe('B3 · precarga automática estricta por RUT (Ajuste #2)', () => {
  it('no consulta ni precarga desde el registro cuando la cotización no tiene RUT', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(await buscarRegistroPorRut(null)).toBeNull();
    expect(await buscarRegistroPorRut('')).toBeNull();
    expect(await buscarRegistroPorRut('   ')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('combina receptor y correo desde la ficha registrada encontrada por RUT', () => {
    const registroBase: ClienteRegistrado = {
      id: '11111111-1111-4111-8111-111111111111',
      nombre: 'Constructora Lingue',
      rut: '76.543.210-3',
      giro: 'Construcción de obras',
      telefono: '+56 9 5555 1111',
      direccion: 'Av. Alemania 450',
      comuna: 'Temuco',
      correo: 'contacto@lingue.cl',
      notas: null,
      documentoHabitual: 'factura',
      receptorFacturacion: null,
      creado: '2026-11-13T10:00:00.000Z',
      actualizado: '2026-11-13T10:00:00.000Z',
      creadoPor: 'ana@neltume.test',
      actualizadoPor: 'ana@neltume.test',
    };

    // Sin receptor específico: usa los datos del cliente y hereda el correo de la ficha.
    expect(combinarReceptorConRegistro(cliente, registroBase)).toEqual({
      razonSocial: 'Constructora Lingue',
      rut: '76.543.210-3',
      giro: 'Construcción de obras',
      direccion: 'Camino Real 120',
      comuna: 'Pucón',
      correo: 'contacto@lingue.cl',
    });

    // Con receptor configurado en la ficha: prioriza el receptor y hereda correo general si falta.
    expect(
      combinarReceptorConRegistro(cliente, {
        ...registroBase,
        receptorFacturacion: {
          razonSocial: 'Holding Sur SpA',
          rut: '99.111.222-3',
          giro: 'Inversiones',
          direccion: 'Providencia 100',
          comuna: null,
          correo: null,
        },
      }),
    ).toEqual({
      razonSocial: 'Holding Sur SpA',
      rut: '99.111.222-3',
      giro: 'Inversiones',
      direccion: 'Providencia 100',
      comuna: null,
      correo: 'contacto@lingue.cl',
    });
  });
});

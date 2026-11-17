// Paridad con la app de Android: corre las reglas de presentación de la web sobre una tabla de entradas y compara
// el resultado con android/nucleo/src/test/resources/vectores/vectores.json. Las pruebas Kotlin del núcleo
// (`./gradlew :nucleo:test` en android/) verifican las mismas entradas con las funciones portadas. Si una regla cambia
// aquí, esta prueba falla hasta regenerar los vectores; entonces falla Kotlin hasta portar el cambio.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  autoria,
  decimalCampo,
  estadoPago,
  fechaCorta,
  fechaLarga,
  leerMedida,
  medidaProducto,
  mesAnio,
  nombreProducto,
  numeroCotizacion,
  pct,
  plural,
  resumenCambios,
  resumenTexto,
  sinMedida,
  validez,
} from '@/app/formato';
import { describirProducto, medidaReferencia, metrosTexto } from '@/catalogo/escalones';
import type { Producto } from '@/catalogo/tipos';
import {
  errorMargenTexto,
  interpretarCifra,
  leerPesos,
  leerPorcentaje,
  leerPorcentajeConSigno,
} from '@/negocio/cifras';
import { normalizarRut } from '@/negocio/cliente';
import { errorTramos, textoTramo } from '@/negocio/descuento-cantidad';
import {
  descripcionFlete,
  etiquetaEvento,
  etiquetaFacturacion,
  puedeAnular,
  retrocesoOperativo,
  type Cotizacion,
} from '@/negocio/estado';
import { etiquetaDocumentoFacturacion, faltanDatosFactura, textoCopiarFactura } from '@/negocio/facturacion';
import { dimensionesEnMilimetros } from '@/negocio/medidas';
import { avancePedido } from '@/negocio/pasos';
import { preguntasPendientes } from '@/negocio/pendientes';
import { tamanoReferencia } from '@/negocio/personalizados';
import { pesos, porcentaje, porcentajeIva } from '@/negocio/precios';
import { fechaLocal } from '@/negocio/vigencia';

const ARCHIVO = join(
  dirname(new URL(import.meta.url).pathname),
  '../android/nucleo/src/test/resources/vectores/vectores.json',
);

/** NaN no existe en JSON: viaja como el texto «NaN». */
const valor = (x: unknown): unknown =>
  typeof x === 'number' && Number.isNaN(x) ? 'NaN' : x === undefined ? null : x;
const casos = <A extends unknown[]>(f: (...a: A) => unknown, entradas: A[]) =>
  entradas.map((entrada) => ({ entrada, salida: valor(f(...entrada)) }));

const producto = (p: Partial<Producto>): Producto => ({
  codigo: 'HUIL-O-3',
  modelo: 'HUILO HUILO',
  familia: 'PUERTA',
  tipo: null,
  madera: 'PINO OREGON',
  medida: '0,8 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  altoMin: null,
  altoMax: null,
  largo: 2.1,
  precioNeto: 120000,
  descripcion: 'HUILO HUILO PINO OREGON 0,8 A 0,85 MT X 2,1 MT',
  filaOrigen: 10,
  ...p,
});

const PRODUCTOS: Producto[] = [
  producto({}),
  producto({ codigo: 'RANC-1', modelo: 'RANCO', madera: 'RAULI', medida: '90 A 95', anchoMin: 0.9, anchoMax: 0.95, altoMin: 2.0, altoMax: 2.4, largo: 2.4 }),
  producto({ codigo: 'MAR-2X4', modelo: 'MARCO', familia: 'MARCO', madera: 'PINO OREGON', medida: '2X4', anchoMin: null, anchoMax: null, largo: 2.1 }),
  producto({ codigo: 'MAR-2X4-3', modelo: 'MARCO', familia: 'MARCO', madera: 'LENGA', medida: '2X4', anchoMin: null, anchoMax: null, largo: 3.6 }),
  producto({ codigo: 'SET-30X70', modelo: 'MARCO', familia: 'MARCO', tipo: 'SET DE MARCO', madera: 'PINO FINGER', medida: '30X70', anchoMin: null, anchoMax: null, largo: 2.1 }),
  producto({ codigo: 'MOL-1', modelo: 'GUARDAPOLVO', familia: 'MOLDURA', madera: 'PINO OREGON', medida: '1X4', anchoMin: null, anchoMax: null, largo: 3.2 }),
  producto({ codigo: 'PT-1', modelo: 'PIEZA T', familia: 'PIEZAS_T', madera: 'MARA', medida: '1X2', anchoMin: null, anchoMax: null, largo: 2.4 }),
];

const cotizacion = (q: Partial<Cotizacion>): Cotizacion => ({
  id: '00000000-0000-4000-8000-000000000001',
  numero: 323,
  estado: 'emitida',
  cliente: { nombre: 'Juan Pérez', rut: '12.345.678-5', giro: null, telefono: '+56 9 1234 5678', direccion: null, comuna: 'Temuco', proyecto: 'Casa Lago' },
  solicitudes: [],
  montos: { lineas: [], subtotal: 0, descuentoPorcentaje: 0, descuento: 0, flete: 0, neto: 0, iva: 0, total: 0 },
  incompletos: [],
  historial: [],
  creada: '2026-10-01T12:00:00.000Z',
  actualizada: '2026-10-01T12:00:00.000Z',
  pdf: 'cotizacion-323.pdf',
  vence: '2026-10-15',
  descuento: 0,
  flete: 0,
  creadaPor: 'Paula',
  emitidaPor: 'Paula',
  aprobadaPor: null,
  anuladaPor: null,
  fechaAnulacion: null,
  motivoAnulacion: null,
  reemplazadaPor: null,
  versionCatalogo: null,
  notas: [],
  ...q,
});

const linea = (p: Producto, extra: Record<string, unknown> = {}) => ({
  producto: p,
  cantidad: 3,
  precioUnitario: 222000,
  precioFabrica: p.precioNeto,
  margen: 0.85,
  total: 666000,
  indice: 0,
  anchoSolicitado: 0.8,
  altoSolicitado: 2.1,
  medidaSolicitada: null,
  tipoMedida: 'hoja' as const,
  ...extra,
});

const COMPLETA = cotizacion({
  montos: {
    lineas: [
      linea(PRODUCTOS[0]),
      linea(PRODUCTOS[2], {
        cantidad: 2,
        precioUnitario: 45000,
        total: 81000,
        indice: 1,
        anchoSolicitado: null,
        altoSolicitado: 2.1,
        medidaSolicitada: '2X4',
        descuentoItem: { tipo: 'porcentaje', valor: 10 },
        descuentoUnitario: 4500,
      }),
    ],
    subtotal: 747000,
    descuentoPorcentaje: 5,
    descuento: 37350,
    flete: 30000,
    neto: 739650,
    iva: 140534,
    total: 880184,
  },
  descuento: 5,
  descuentoManual: true,
  flete: 30000,
  fleteCantidad: 2,
  despacho: { direccion: 'Calle 1', transporte: 'Starken', destino: 'Temuco' },
  observaciones: 'Entregar en obra',
  incompletos: [],
  reglas: { ajuste: 0.25, iva: 0.19, vigenciaDiasHabiles: 10, descuentoMaximo: 50 },
});

const APROBADA = cotizacion({
  estado: 'aprobada',
  montos: { ...COMPLETA.montos },
  estadoOperativo: 'en_produccion',
  pagos: [{ id: 'p1', fecha: '2026-10-02', monto: 500000, observacion: null, usuario: 'Paula' }],
  notas: [
    {
      numero: 577,
      fabrica: 'panguipulli',
      pdf: 'nota-pedido-panguipulli-577.pdf',
      montos: COMPLETA.montos,
      fecha: '2026-10-03T12:00:00.000Z',
      despacho: { direccion: null, transporte: null },
      anulada: false,
      inicioProduccion: '2026-10-04T12:00:00.000Z',
    },
    {
      numero: 59,
      fabrica: 'santiago',
      pdf: 'nota-pedido-santiago-59.pdf',
      montos: COMPLETA.montos,
      fecha: '2026-10-03T12:00:00.000Z',
      despacho: { direccion: null, transporte: null },
      anulada: false,
      inicioProduccion: '2026-10-05T12:00:00.000Z',
      terminoProduccion: '2026-10-06T12:00:00.000Z',
    },
  ],
});

function vectores() {
  return {
    pesos: casos(pesos, [[0], [5], [999], [1000], [1500], [9999], [10000], [1547768], [-1500], [100000000]]),
    porcentaje: casos(porcentaje, [[0], [19], [2.5], [12.345], [0.005], [50], [33.333], [1000.5]]),
    porcentajeIva: casos(porcentajeIva, [[0.19], [0.1], [0.195]]),
    pct: casos(pct, [[19], [2.5], [0]]),
    metrosTexto: casos(metrosTexto, [[0.8], [0.835], [2.1], [2.4], [0.8355], [3], [0.80049], [1234.5]]),
    decimalCampo: casos(decimalCampo, [[0.8], [2.1], [1234.5], [0.12345], [3]]),
    fechaCorta: casos(fechaCorta, FECHAS.map((f) => [f])),
    fechaLarga: casos(fechaLarga, FECHAS.map((f) => [f])),
    mesAnio: casos(mesAnio, FECHAS.map((f) => [f])),
    fechaLocal: casos(fechaLocal, FECHAS.map((f) => [f])),
    interpretarCifra: casos(interpretarCifra, CIFRAS.map((c) => [c])),
    leerPesos: casos(leerPesos, [['$15.000'], ['15.000'], [''], ['$ 1.234.567'], ['45,990'], ['12,5'], ['abc']]),
    leerPorcentaje: casos(leerPorcentaje, [['2,5'], ['2.5'], ['2,5 %'], [''], ['10'], ['1.000'], ['x']]),
    leerPorcentajeConSigno: casos(leerPorcentajeConSigno, [['-10'], ['−10,5 %'], ['-'], ['%'], ['15']]),
    errorMargenTexto: casos(errorMargenTexto, [['42'], ['-60'], ['501'], ['2,345'], ['abc'], ['-50'], ['500']]),
    leerMedida: casos(leerMedida, MEDIDAS),
    normalizarRut: casos(normalizarRut, RUTS.map((r) => [r])),
    nombreProducto: casos(nombreProducto, NOMBRES.map((n) => [n])),
    sinMedida: casos(sinMedida, NOMBRES.map((n) => [nombreProducto(n)])),
    medidaProducto: casos(medidaProducto, PRODUCTOS.map((p) => [p])),
    describirProducto: casos(describirProducto, [
      ...PRODUCTOS.map((p) => [p] as [Producto]),
      ...PRODUCTOS.map((p) => [p, { ancho: 0.8, alto: 2.15 }] as [Producto, { ancho: number; alto: number }]),
      [PRODUCTOS[2], { alto: 3.6 }] as [Producto, { alto: number }],
    ]),
    medidaReferencia: casos(medidaReferencia, PRODUCTOS.map((p) => [p])),
    dimensionesEnMilimetros: casos(dimensionesEnMilimetros, [
      [0.8, 2.1, 'hoja'],
      [0.8, 2.1, 'vano'],
      [0.8, null, null],
      [null, 3.6, undefined],
      [null, null, 'hoja'],
      [0.8355, 2.0999, 'no_especificado'],
    ]),
    plural: casos(plural, [[1, 'ítem'], [2, 'ítem'], [0, 'registro'], [3, 'ítem pendiente', 'ítems pendientes']]),
    numeroCotizacion: casos(numeroCotizacion, [[323], [null], [0]]),
    estadoPago: casos(estadoPago, [
      [{ estado: 'emitida', pagado: 0, total: 1000, porcentajePagado: 0 }],
      [{ estado: 'aprobada', pagado: 500, total: 1000, porcentajePagado: 50 }],
      [{ estado: 'aprobada', pagado: 1000, total: 1000, porcentajePagado: 100 }],
      [{ estado: 'aprobada', pagado: 999, total: 1000, porcentajePagado: 99.9 }],
      [{ estado: 'aprobada', pagado: 1, total: 1000, porcentajePagado: 0.1 }],
      [{ estado: 'borrador', pagado: 0, total: 1000, porcentajePagado: 0 }],
    ]),
    autoria: casos(autoria, [
      [{ creadaPor: 'Ana', emitidaPor: 'Ana', aprobadaPor: 'Luis', anuladaPor: null }],
      [{ creadaPor: 'Ana', emitidaPor: 'Luis', aprobadaPor: 'Ana', anuladaPor: 'Ana' }],
      [{ creadaPor: null, emitidaPor: null, aprobadaPor: null, anuladaPor: null }],
      [{ creadaPor: 'Ana', emitidaPor: 'Ana', aprobadaPor: 'Ana', anuladaPor: null }],
    ]),
    resumenCambios: casos(resumenCambios, [
      [{
        agregados: [{ indice: 0, descripcion: 'HUILO HUILO PINO OREGON 0,80 MT X 2,10 MT' }],
        quitados: [{ indice: 1, descripcion: 'MARCO LENGA 2X4 PULG KIT' }],
        modificados: [{ antes: { indice: 2, descripcion: 'A' }, despues: { indice: 2, descripcion: 'RANCO RAULÍ 0,90 MT X 2,40 MT' } }],
        cliente: ['nombre', 'rut', 'comuna'],
      }],
      [{ agregados: [], quitados: [], modificados: [], cliente: ['telefono'] }],
      [undefined],
    ]),
    avancePedido: casos(avancePedido, [
      [{ estado: 'borrador', operacion: 'sin_pedido', notas: 0, pagado: 0, total: 0, facturada: false }],
      [{ estado: 'emitida', operacion: 'sin_pedido', notas: 0, pagado: 0, total: 1000, facturada: false }],
      [{ estado: 'aprobada', operacion: 'sin_pedido', notas: 0, pagado: 500, total: 1000, facturada: false }],
      [{ estado: 'aprobada', operacion: 'pagada', notas: 2, pagado: 1000, total: 1000, facturada: false }],
      [{ estado: 'aprobada', operacion: 'completada', notas: 1, pagado: 1000, total: 1000, facturada: true }],
      [{ estado: 'anulada', operacion: 'sin_pedido', notas: 0, pagado: 0, total: 1000, facturada: false }],
    ]),
    puedeAnular: casos(puedeAnular, [
      [cotizacion({ estado: 'borrador', numero: null })],
      [cotizacion({ estado: 'anulada' })],
      [cotizacion({ estado: 'reemplazada' })],
      [cotizacion({ estado: 'aprobada', estadoOperativo: 'despachada' })],
      [cotizacion({ estado: 'aprobada', facturacion: { estado: 'facturada', documento: null, receptor: null, tipo: 'boleta', identificadorExterno: '1', fecha: null } })],
      [APROBADA],
      [COMPLETA],
    ]),
    retrocesoOperativo: casos(retrocesoOperativo, [
      [APROBADA],
      [{ ...APROBADA, estadoOperativo: 'lista_despacho' as const }],
      [{ ...APROBADA, estadoOperativo: 'pedido_generado' as const, notas: [] }],
      [{ ...APROBADA, notas: [APROBADA.notas[0]] }],
      [COMPLETA],
    ]),
    descripcionFlete: casos(descripcionFlete, [
      [COMPLETA],
      [{ ...COMPLETA, despacho: { direccion: null, transporte: 'Otro' } }],
      [{ ...COMPLETA, fleteDescripcion: 'Flete especial' }],
      [{ ...COMPLETA, despacho: null }],
    ]),
    etiquetaFacturacion: casos(etiquetaFacturacion, [
      [undefined],
      [{ estado: 'facturada', documento: null, receptor: null, tipo: 'boleta', identificadorExterno: '45', fecha: null }],
      [{ estado: 'facturada', documento: null, receptor: null, tipo: 'factura', identificadorExterno: null, fecha: null }],
    ]),
    etiquetaEvento: Object.entries(etiquetaEvento).map(([k, v]) => ({ entrada: [k], salida: v })),
    textoCopiarFactura: casos(textoCopiarFactura, RECEPTORES.map((r) => [r])),
    faltanDatosFactura: casos(faltanDatosFactura, RECEPTORES.map((r) => [r])),
    etiquetaDocumentoFacturacion: casos(etiquetaDocumentoFacturacion, [
      [{ estado: 'pendiente', documento: 'boleta' }],
      [{ estado: 'pendiente', documento: 'factura', receptor: RECEPTORES[0] }],
      [{ estado: 'pendiente', documento: 'factura', receptor: null }],
      [{ estado: 'facturada', tipo: 'factura', receptor: null }],
      [{}],
    ]),
    textoTramo: casos(textoTramo, [[{ desdePuertas: 10, porcentaje: 5 }], [{ desdePuertas: 20, porcentaje: 7.5 }]]),
    errorTramos: casos(errorTramos, [
      [[{ desdePuertas: 10, porcentaje: 5 }], 50],
      [[{ desdePuertas: 1, porcentaje: 5 }], 50],
      [[{ desdePuertas: 10, porcentaje: 0 }], 50],
      [[{ desdePuertas: 10, porcentaje: 60 }], 50],
      [[{ desdePuertas: 10, porcentaje: 2.345 }], 50],
      [[{ desdePuertas: 10, porcentaje: 5 }, { desdePuertas: 10, porcentaje: 6 }], 50],
    ]),
    tamanoReferencia: casos(tamanoReferencia, [[100], [1024], [350000], [1048576], [2500000], [10485760]]),
    validez: casos(validez, [[COMPLETA], [{ ...COMPLETA, vence: null }], [null]]),
    preguntasPendientes: casos(preguntasPendientes, [[PENDIENTES as unknown as Pick<Cotizacion, 'solicitudes' | 'incompletos'>]]),
    resumenTexto: casos(resumenTexto, [[COMPLETA], [cotizacion({ cliente: { nombre: null, rut: null, giro: null, telefono: null, direccion: null, comuna: null, proyecto: null }, numero: null, incompletos: [{ indice: 0, rechazo: { tipo: 'cantidad_invalida', valor: null, disponibles: [] }, pregunta: '' }] })]]),
  };
}

const solicitud = (s: Record<string, unknown>) => ({
  modelo: null, madera: null, ancho: null, alto: null, medida: null, cantidad: 1, ...s,
});
const PENDIENTES = {
  solicitudes: [
    solicitud({ modelo: 'HUILO HUILO', madera: 'PINO OREGON', ancho: 0.8, alto: 2.1 }),
    solicitud({ modelo: 'HUILO HUILO', madera: null, ancho: 0.8, alto: 2.1 }),
    solicitud({ modelo: 'MARCO', madera: 'PINO OREGON', medida: null, alto: 2.1 }),
    solicitud({ modelo: 'HUILO HUILO', madera: null, ancho: 0.8, alto: 2.1 }),
    solicitud({ modelo: 'RANKO', madera: 'RAULI' }),
    solicitud({ modelo: 'MOLCO', madera: 'PINO OREGON', ancho: 1.6, alto: 2.1 }),
    solicitud({ modelo: 'MARCO', madera: 'LENGA', medida: '2X4', alto: 7 }),
    solicitud({ modelo: 'HUILO HUILO', madera: 'PINO OREGON', ancho: 2.1, alto: 0.8 }),
    solicitud({ modelo: 'HUILO HUILO', madera: 'PINO OREGON', ancho: 0.8, alto: 2.1, precioUnitario: 1000, descuento: { tipo: 'porcentaje', valor: 90 } }),
    solicitud({ modelo: 'XYZ', madera: 'PINO OREGON', cantidad: 0 }),
    solicitud({ modelo: 'MARCO', madera: 'PINO OREGON', medida: '2X4', alto: 2.25 }),
    solicitud({ modelo: 'CALAFQUEN', madera: 'PINO OREGON', ancho: null, alto: 2.1 }),
  ],
  incompletos: [
    { indice: 1, pregunta: '¿Qué madera necesitas para Huilo Huilo? Opciones: Pino Oregon, Lenga, Rauli.', rechazo: { tipo: 'faltan_datos', campos: ['madera'], disponibles: { madera: ['PINO OREGON', 'LENGA', 'RAULI'] } } },
    { indice: 3, pregunta: '¿Qué madera necesitas para Huilo Huilo? Opciones: Pino Oregon, Lenga, Rauli.', rechazo: { tipo: 'faltan_datos', campos: ['madera'], disponibles: { madera: ['PINO OREGON', 'LENGA', 'RAULI'] } } },
    { indice: 2, pregunta: '¿Qué sección o escuadría necesitas para Marco? Opciones: 2X4, 2X5.', rechazo: { tipo: 'faltan_datos', campos: ['medida', 'cantidad'], disponibles: { medida: ['2X4', '2X5'] } } },
    { indice: 4, pregunta: '¿Te refieres a Ranco? Confírmalo para cotizar.', rechazo: { tipo: 'modelo_posible', valor: 'RANKO', sugerido: 'RANCO', disponibles: [], familia: 'PUERTA' } },
    { indice: 5, pregunta: 'Molco no viene en 1,60 m de ancho. Se cotizan anchos entre 0,60 y 1,00 m.', rechazo: { tipo: 'medida_no_disponible', familia: 'PUERTA', campo: 'ancho', valor: 1.6, disponibles: ['0,6 A 0,65', '0,9 A 1'], rango: { min: 0.6, max: 1 } } },
    { indice: 6, pregunta: 'No entendí la medida 7 de alto o largo para Marco.', rechazo: { tipo: 'medida_implausible', campo: 'alto', valor: 7, disponibles: ['0,3 a 6 m'], familia: 'MARCO' } },
    { indice: 7, pregunta: 'Huilo Huilo quedó con 2,10 m de ancho…', rechazo: { tipo: 'medidas_invertidas', ancho: 2.1, alto: 0.8, disponibles: [], familia: 'PUERTA' } },
    { indice: 8, pregunta: 'El precio $1.000 queda fuera del rango.', rechazo: { tipo: 'faltan_datos', campos: ['precio'], disponibles: {} } },
    { indice: 9, pregunta: 'No encontré el modelo “XYZ” en puertas sólidas. Modelos disponibles: Huilo Huilo, Ranco.', rechazo: { tipo: 'modelo_desconocido', valor: 'XYZ', disponibles: ['HUILO HUILO', 'RANCO'] } },
    { indice: 10, pregunta: 'Marco no viene en 2,25 m de alto o largo. Opciones disponibles: 2,1, 2,4.', rechazo: { tipo: 'medida_no_disponible', familia: 'MARCO', campo: 'alto', valor: 2.25, disponibles: ['2.1', '2.4'] } },
    { indice: 11, pregunta: '¿Qué ancho necesitas para Calafquen? Opciones: 0,8 A 0,85, 0,9 A 0,95.', rechazo: { tipo: 'faltan_datos', campos: ['ancho'], disponibles: { ancho: ['0,8 A 0,85', '0,9 A 0,95'] } } },
  ],
};

const FECHAS = [
  '2026-01-12',
  '2026-09-12T03:00:00.000Z',
  '2026-12-31T23:30:00.000Z',
  '2026-06-01T04:30:00Z',
  '2026-04-05T02:59:00.000Z',
  '2026-11-17T15:45:12.345Z',
];
const CIFRAS = ['45,990', '45,99', '1.5', '350.00', '1490.00', '1.234.567', '1.234,5', '1,234.5', 'abc', '', '12 345', '1,2,3', '15000', '0,5'];
const MEDIDAS: [string, string, 'ancho' | 'alto'][] = [
  ['80', 'PUERTA', 'ancho'],
  ['0,80', 'PUERTA', 'ancho'],
  ['0.80', 'PUERTA', 'ancho'],
  ['80 cm', 'PUERTA', 'ancho'],
  ['800 mm', 'PUERTA', 'ancho'],
  ['2100 mm', 'PUERTA', 'alto'],
  ['2.100 mm', 'PUERTA', 'alto'],
  ['2,1', 'PUERTA', 'alto'],
  ['210 cms', 'PUERTA', 'alto'],
  ['3,6 m', 'MARCO', 'alto'],
  ['360', 'MARCO', 'alto'],
  ['3600 mm', 'MOLDURA', 'alto'],
  ['4', 'PUERTA', 'alto'],
  ['4', 'MARCO', 'alto'],
  ['abc', 'PUERTA', 'alto'],
  ['', 'PUERTA', 'alto'],
  ['1 metro', 'PUERTA', 'alto'],
  ['2,10 mts.', 'PUERTA', 'alto'],
  ['0,2', 'PUERTA', 'ancho'],
  ['2 pulgadas', 'PUERTA', 'alto'],
  ['500', 'PUERTA', 'ancho'],
];
const RUTS = ['12345678-5', '12.345.678-5', '123456785', '1-9', '11.111.111-1', '12345678-K', '7.123.456-k', '0012345678-5', 'abc', '76.086.428-5', '9.999.999-3'];
const NOMBRES = [
  'HUILO HUILO PINO OREGON 0,80 A 0,85 MT X 2,1 MT',
  'MARCO RAULI 2X4 PULG KIT',
  '3 × HUILO HUILO PINO OREGON 0,8 A 0,85 MT X 2,1 MT, MARCO PINO OREGON 2X4 PULG KIT (sin cantidad)',
  'Puerta especial a mano',
  'MOLDURA DE PINO EN 3 MT',
  'RANCO RAULI 0,90 A 0,95 MT X 2 A 2,4 MT',
  'PIEZA T DEL SUR CON LENGA',
];
const RECEPTORES = [
  { razonSocial: 'Constructora Sur SpA', rut: '76086428-5', giro: 'Construcción', direccion: 'Av. 1', comuna: 'Temuco', correo: 'a@b.cl' },
  { razonSocial: ' ', rut: '1-2', giro: null, direccion: 'x', comuna: null, correo: null },
  null,
];

describe('vectores de paridad con la app de Android', () => {
  it('coinciden con android/nucleo/src/test/resources/vectores/vectores.json', () => {
    const generado = `${JSON.stringify(vectores(), null, 1)}\n`;
    if (process.env.ACTUALIZAR_VECTORES === '1') {
      mkdirSync(dirname(ARCHIVO), { recursive: true });
      writeFileSync(ARCHIVO, generado);
    }
    let guardado = '';
    try {
      guardado = readFileSync(ARCHIVO, 'utf8');
    } catch {
      guardado = '';
    }
    expect(
      guardado === generado,
      'Cambió una regla que también usa la app de Android. Corre `ACTUALIZAR_VECTORES=1 npx vitest run tests/vectores-movil.test.ts` y luego `./gradlew :nucleo:test` en android/ para portar el cambio.',
    ).toBe(true);
  });
});

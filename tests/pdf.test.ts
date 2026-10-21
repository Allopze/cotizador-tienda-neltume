import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clienteVacio, type Producto } from '../src/catalogo/tipos';
import { anticipoMinimo, type Cotizacion } from '../src/negocio/estado';
import { cotizar, descripcionLinea, montosVacios, REGLAS, type ReglasComerciales } from '../src/negocio/precios';
import { cerrarBaseDatos } from '../src/servidor/base-datos';
import { Almacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';
import { productoPersonalizado } from '../src/negocio/personalizados';

const navegador = vi.hoisted(() => ({
  demora: 0,
  cerrado: 0,
  /** newPage nunca responde, como un Chromium colgado. */
  colgar: false,
  /** Mensaje con que falla la impresión. */
  falla: null as string | null,
  /** Se espera antes de abrir cada página. */
  alAbrir: null as (() => Promise<void>) | null,
}));
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(async () => ({
      on: () => {},
      newPage: async () => {
        await navegador.alAbrir?.();
        if (navegador.colgar) await new Promise(() => {});
        return {
          close: async () => {},
          setDefaultTimeout: () => {},
          route: async () => {},
          setContent: async () => {},
          pdf: async ({ path }: { path: string }) => {
            await new Promise((r) => setTimeout(r, navegador.demora));
            if (navegador.falla) throw new Error(navegador.falla);
            const { writeFile: escribir } = await import('node:fs/promises');
            await escribir(path, '%PDF-1.4');
          },
        };
      },
      close: async () => {
        navegador.cerrado++;
      },
    })),
  },
}));
const { descripcionLegible, generarPdf, medidaPedida, plantilla, prepararPdf } =
  await import('../src/servidor/pdf');

const puerta: Producto = {
  codigo: 'MOL-O-3-A',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100000,
  descripcion: 'MOLCO PINO OREGON 0,80 A 0,85 MT X 2 MT',
  filaOrigen: 4,
};
const cotizacion = (): Cotizacion => ({
  id: 'x',
  numero: 325,
  estado: 'emitida',
  cliente: { ...clienteVacio(), nombre: 'Juan', rut: '12.345.678-5', giro: 'Constructora' },
  solicitudes: [],
  montos: montosVacios(),
  incompletos: [],
  historial: [],
  creada: '2026-09-28T12:00:00.000Z',
  actualizada: '2026-09-28T12:00:00.000Z',
  pdf: null,
  fechaEmision: '2026-09-28T12:00:00.000Z',
  origen: 323,
  vence: '2026-10-12',
  descuento: 10,
  flete: 15000,
  creadaPor: 'Paula',
  emitidaPor: 'Paula',
  aprobadaPor: null,
  anuladaPor: null,
  fechaAnulacion: null,
  motivoAnulacion: null,
  reemplazadaPor: null,
  versionCatalogo: null,
  nota: null,
});
const dirs: string[] = [];
afterEach(async () => {
  Object.assign(navegador, { demora: 0, colgar: false, falla: null, alAbrir: null });
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) {
    cerrarBaseDatos(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

/** Texto visible de la plantilla: sin estilos ni etiquetas, con un salto por cada <br>. */
const textoVisible = (html: string) =>
  html
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<br>/g, '\n')
    .replace(/<[^>]+>/g, ' ');
const veces = (texto: string, parte: string) => texto.split(parte).length - 1;

async function aislarBaseDatos() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-pdf-db-'));
  dirs.push(dir);
  vi.stubEnv('NELTUME_DB_PATH', join(dir, 'cotizador.sqlite'));
}

describe('Plantillas', () => {
  it('la cotización muestra revisión, vigencia exacta, autor, medidas pedidas, descuento y flete', async () => {
    await aislarBaseDatos();
    const montos = cotizar(
      [{ producto: puerta, cantidad: 2, anchoSolicitado: 0.82, altoSolicitado: 2, tipoMedida: 'vano' }],
      undefined,
      { descuento: 10, flete: 15000 },
    );
    const html = await plantilla(cotizacion(), {
      tipo: 'cotizacion',
      numero: 325,
      montos,
      fecha: '2026-09-28T12:00:00.000Z',
      vence: '2026-10-12',
      autor: 'Paula',
    });
    expect(html).toContain('Revisión de la cotización:</b> N° 323');
    expect(html).toContain('válida hasta el 12-10-2026');
    expect(html).toContain('Emitida por:</b> Paula');
    // El ítem se nombra con la medida pedida; el rango del catálogo solo define el precio. El vano no se repite aparte.
    expect(html).toContain('Molco Pino Oregon 0,82 m × 2,00 m</td>');
    expect(html).not.toContain('Medida solicitada');
    expect(html).not.toContain('0,80 a 0,85');
    expect(html).toMatch(/DESCUENTO 10 %.*−\$25\.000/);
    expect(html).toContain('FLETE');
    // El flete es una línea del detalle y el subtotal la incluye; el descuento es solo de los productos.
    expect(html).toMatch(/<td class="codigo">FLETE<\/td><td>Flete \/ despacho<\/td><td class="num">1<\/td><td class="num">\$15\.000<\/td><td class="num">\$15\.000/);
    expect(html).toMatch(/SUBTOTAL<\/span><b>\$265\.000/);
    expect(html).toContain('SOBRE PRODUCTOS');
    expect(html).not.toContain('Flete por despacho</td>');
    // El flete ya está en el detalle: no se pide consultar el valor del despacho.
    expect(html).not.toContain('Consultar valor despacho');
  });

  it('el descuento especial de un ítem muestra precio original, descuento, precio final y el ahorro en el resumen', async () => {
    await aislarBaseDatos();
    const otra = { ...puerta, codigo: 'MOL-R-3-A', madera: 'RAULI', descripcion: 'MOLCO RAULI 0,80 A 0,85 MT X 2 MT' };
    const montos = cotizar(
      [
        { producto: puerta, cantidad: 2, descuento: { tipo: 'porcentaje', valor: 15 } },
        { producto: otra, cantidad: 1 },
      ],
      undefined,
      { descuento: 10 },
    );
    const html = await plantilla(cotizacion(), {
      tipo: 'cotizacion', numero: 325, montos, fecha: '2026-09-28T12:00:00.000Z',
    });
    const [conDescuento, sinDescuento] = html.split('<tr><td>').slice(1).map(textoVisible);
    // Unitario $125.000 → −$18.750 → $106.250; la línea de 2 pasa de $250.000 a $212.500.
    expect(conDescuento).toMatch(/\$125\.000\s+\$106\.250/);
    expect(conDescuento).toMatch(/\$250\.000\s+\$212\.500/);
    expect(conDescuento).toContain('Descuento especial 15 %: −$18.750 c/u · Ahorro $37.500');
    expect(html).toContain('<s class="original">$125.000</s>');
    // La otra línea sigue a su precio, sin tachar ni rótulos de descuento.
    expect(sinDescuento).not.toMatch(/Descuento especial/);
    expect(veces(html, '<s class="original">')).toBe(2);
    const totales = textoVisible(html.split('<div class="totales">')[1]);
    expect(totales).toMatch(/SUBTOTAL ORIGINAL\s+\$375\.000/);
    expect(totales).toMatch(/AHORRO DESC\. ESPECIALES\s+−\$37\.500/);
    expect(totales).toMatch(/SUBTOTAL\s+\$337\.500/);
    expect(totales).toMatch(/DESCUENTO 10 %\s+−\$33\.750/);
    // Sin descuentos especiales, el resumen queda como siempre.
    const sin = await plantilla(cotizacion(), {
      tipo: 'cotizacion', numero: 325, montos: cotizar([{ producto: puerta, cantidad: 1 }]), fecha: '2026-09-28T12:00:00.000Z',
    });
    expect(sin).not.toMatch(/SUBTOTAL ORIGINAL|AHORRO|class="original"/);
  });

  it('el PDF mantiene el orden de las líneas que recibió la cotización', async () => {
    await aislarBaseDatos();
    const montos = cotizar([
      { producto: puerta, cantidad: 1, descripcionDocumento: 'Producto C' },
      { producto: puerta, cantidad: 1, descripcionDocumento: 'Producto A' },
      { producto: puerta, cantidad: 1, descripcionDocumento: 'Producto B' },
    ]);
    const html = await plantilla(cotizacion(), {
      tipo: 'cotizacion', numero: 325, montos, fecha: '2026-09-28T12:00:00.000Z',
    });
    const posiciones = ['Producto C', 'Producto A', 'Producto B'].map((nombre) => html.indexOf(nombre));
    expect(posiciones.every((p) => p >= 0)).toBe(true);
    expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b));
  });

  it('el descuento se rotula «por cantidad» solo si lo aplicó un tramo, y el cliente nunca ve márgenes', async () => {
    await aislarBaseDatos();
    const reglas = { ...REGLAS, descuentosPorCantidad: [{ desdePuertas: 10, porcentaje: 5 }] };
    const montos = cotizar([{ producto: puerta, cantidad: 10 }], reglas, { descuento: 5 });
    const pdf = async (q: Partial<Cotizacion>, reglasDocumento: ReglasComerciales = reglas) =>
      textoVisible(
        await plantilla(
          { ...cotizacion(), descuento: 5, reglas: reglasDocumento, ...q },
          {
            tipo: 'cotizacion', numero: 325, montos, fecha: '2026-09-28T12:00:00.000Z', vence: '2026-10-12',
            reglas: reglasDocumento,
          },
        ),
      );
    const automatico = await pdf({ descuentoManual: false });
    expect(automatico).toMatch(/DESC\. POR CANTIDAD 5 %\s+−\$/);
    expect(automatico).not.toContain('DESCUENTO POR CANTIDAD');
    const manual = await pdf({ descuentoManual: true });
    expect(manual).toMatch(/DESCUENTO 5 %\s+−\$/);
    expect(manual).not.toContain('POR CANTIDAD');
    // Sin tramos en las reglas (cotizaciones anteriores) sigue igual.
    const anterior = await pdf({ descuentoManual: false }, REGLAS);
    expect(anterior).toMatch(/DESCUENTO 5 %\s+−\$/);
    for (const texto of [automatico, manual, anterior]) expect(texto).not.toMatch(/margen/i);
  });

  it('un transportista «Otro» guardado antes no se imprime', async () => {
    await aislarBaseDatos();
    const montos = cotizar([{ producto: puerta, cantidad: 1 }], { ajuste: 0, iva: 0.19 });
    const html = await plantilla(cotizacion(), {
      tipo: 'nota',
      numero: 8,
      montos,
      fecha: '2026-09-28T12:00:00.000Z',
      autor: 'Paulette',
      despacho: { direccion: 'Los Carrera #450', transporte: ' otro ' },
    });
    expect(html).toContain('Dirección de despacho:</b> Los Carrera #450');
    expect(html).not.toMatch(/Medio de transporte:<\/b>\s*otro/i);
  });

  it('la nota imprime giro, despacho, transporte y quién aprobó', async () => {
    await aislarBaseDatos();
    const montos = cotizar([{ producto: puerta, cantidad: 1, anchoSolicitado: 0.83, altoSolicitado: 2, tipoMedida: 'hoja' }], {
      ajuste: 0,
      iva: 0.19,
    });
    const html = await plantilla(cotizacion(), {
      tipo: 'nota',
      numero: 7,
      montos,
      fecha: '2026-09-28T12:00:00.000Z',
      autor: 'Paulette',
      despacho: { direccion: 'Los Carrera #450', transporte: 'Camión' },
    });
    expect(html).toContain('Giro:</b> Constructora');
    expect(html).toContain('Dirección de despacho:</b> Los Carrera #450');
    expect(html).toContain('Medio de transporte:</b> Camión');
    expect(html).toContain('Aprobada por:</b> Paulette');
    expect(html).toContain('Molco Pino Oregon 0,83 m × 2,00 m<br><small>Medida solicitada: 830 × 2000 mm (Hoja)');
    // Fábrica ve además la referencia de catálogo (el rango que se cobra).
    expect(html).toContain('Referencia de catálogo: MOL-O-3-A');
    expect(html).not.toContain('DESCUENTO');
    expect(html).toContain('Ref. cotización:</b> N° 325');
    expect(html).toContain('Recibido por fábrica');
    expect(html).not.toContain('GRACIAS');
  });

  it('el nombre del ítem lleva la medida pedida y el producto (y su precio) sigue siendo el del rango', () => {
    const [l] = cotizar([{ producto: puerta, cantidad: 1, anchoSolicitado: 0.82, altoSolicitado: 2 }]).lineas;
    expect(descripcionLinea(l)).toBe('MOLCO PINO OREGON 0,82 MT X 2,00 MT');
    expect([l.producto.codigo, l.precioUnitario]).toEqual(['MOL-O-3-A', Math.round(100000 * 1.25)]);
    const moldura: Producto = { ...puerta, familia: 'MOLDURA', medida: '2X2', altoMin: 2.4, altoMax: 3.2, largo: 3.2 };
    const [m] = cotizar([{ producto: moldura, cantidad: 1, medidaSolicitada: '2X2', altoSolicitado: 2.75 }]).lineas;
    expect(descripcionLinea(m)).toBe('MOLCO PINO OREGON 2X2 CM X 2,75 MT');
    // Escrita por la persona, manda; sin medidas pedidas (registros antiguos), la del catálogo.
    expect(descripcionLinea({ ...l, descripcionDocumento: 'Puerta principal' })).toBe('Puerta principal');
    expect(descripcionLinea({ ...l, anchoSolicitado: null, altoSolicitado: null })).toBe(puerta.descripcion);
  });

  it('la cotización al cliente muestra la descripción y la medida pedida, sin datos internos ni «No especificado»', async () => {
    await aislarBaseDatos();
    const moldura: Producto = {
      ...puerta,
      codigo: 'MOLD-P-2',
      familia: 'MOLDURA',
      modelo: 'MEDIA CAÑA',
      tipo: null,
      madera: 'PINO',
      medida: '2X2',
      anchoMin: null,
      anchoMax: null,
      largo: 3,
      descripcion: 'MEDIA CAÑA PINO 2X2 CM X 3 MT',
    };
    const montos = cotizar(
      [
        // Sin tipo de medida: la puerta no lleva observación automática.
        { producto: puerta, cantidad: 1, anchoSolicitado: 0.835, altoSolicitado: 2 },
        { producto: puerta, cantidad: 1, anchoSolicitado: 0.835, altoSolicitado: 2, tipoMedida: 'vano', descripcionDocumento: 'Puerta con cerradura', observaciones: 'Abre hacia adentro' },
        { producto: moldura, cantidad: 4 },
      ],
      undefined,
    );
    const html = await plantilla(cotizacion(), { tipo: 'cotizacion', numero: 326, montos, fecha: '2026-09-28T12:00:00.000Z' });
    const texto = textoVisible(html);
    const [sinTipo, , sinMedida] = html.split('<tr><td>').slice(1).map(textoVisible);
    // Con descripción escrita, la medida se informa aparte, sin decir que es de vano.
    expect(texto).toContain('Medida solicitada: 835 × 2000 mm');
    expect(texto).not.toContain('(Vano)');
    expect(texto).toContain('Puerta con cerradura');
    expect(texto).toContain('Observación: Abre hacia adentro');
    // Sin descripción escrita, el nombre es el producto con la medida pedida, no el rango del catálogo.
    expect(veces(texto, 'Molco Pino Oregon 0,835 m × 2,00 m')).toBe(1);
    expect(texto).not.toContain('0,80 a 0,85');
    expect(sinTipo).not.toContain('Medida solicitada');
    expect(sinTipo).not.toContain('edida de');
    expect(sinMedida).not.toContain('Medida solicitada');
    expect(texto).not.toContain('No especificado');
    expect(texto).not.toContain('Tipo de medida');
    expect(texto).not.toContain('Rectificar');
    expect(texto).not.toContain('Referencia de catálogo');
    expect(texto).not.toContain('0,80–0,85');
    // El código solo aparece en su columna, nunca dentro de la descripción.
    expect(veces(texto, 'MOL-O-3-A')).toBe(2);
    expect(veces(texto, 'MOLD-P-2')).toBe(1);
  });

  it('el vano es un dato para fábrica: la cotización no lo nombra y la nota de pedido sí', async () => {
    await aislarBaseDatos();
    const montos = cotizar(
      [
        { producto: puerta, cantidad: 1, anchoSolicitado: 0.82, altoSolicitado: 2, tipoMedida: 'vano' },
        { producto: puerta, cantidad: 1, anchoSolicitado: 0.835, altoSolicitado: 2, tipoMedida: 'vano', descripcionDocumento: 'Puerta con cerradura' },
      ],
      undefined,
    );
    const fecha = '2026-09-28T12:00:00.000Z';
    const paraCliente = textoVisible(await plantilla(cotizacion(), { tipo: 'cotizacion', numero: 327, montos, fecha }));
    expect(paraCliente).not.toMatch(/vano/i);
    expect(veces(paraCliente, 'Medida solicitada')).toBe(1);
    expect(paraCliente).toContain('Medida solicitada: 835 × 2000 mm');
    const paraFabrica = textoVisible(await plantilla(cotizacion(), { tipo: 'nota', numero: 9, montos, fecha }));
    expect(paraFabrica).toContain('Medida solicitada: 820 × 2000 mm (Vano)');
    expect(paraFabrica).toContain('Medida solicitada: 835 × 2000 mm (Vano)');
  });

  it('la nota para fábrica suma la referencia de catálogo y la medida exacta, nunca el margen', async () => {
    await aislarBaseDatos();
    const montos = cotizar(
      [{ producto: puerta, cantidad: 1, anchoSolicitado: 0.835, altoSolicitado: 2, tipoMedida: 'hoja', descripcionDocumento: 'Puerta con cerradura' }],
      { ajuste: 0, iva: 0.19 },
    );
    const html = await plantilla(cotizacion(), { tipo: 'nota', numero: 8, montos, fecha: '2026-09-28T12:00:00.000Z' });
    const texto = textoVisible(html);
    expect(texto).toContain('Puerta con cerradura');
    expect(texto).toContain('Medida solicitada: 835 × 2000 mm (Hoja)');
    expect(texto).toContain('Referencia de catálogo: MOL-O-3-A · 0,80–0,85 × 2,00 m');
    expect(texto).not.toMatch(/margen|No especificado/i);
  });

  it('la nota de un producto personalizado nombra las referencias del cliente en vez del catálogo', async () => {
    const q = cotizacion();
    const { producto } = productoPersonalizado(
      { modelo: 'Puerta japonesa', madera: 'Roble', ancho: 0.8, alto: 2.1, medida: null, cantidad: 1, precioUnitario: 300000 },
      'PUERTA',
    ) as Extract<ReturnType<typeof productoPersonalizado>, { ok: true }>;
    q.solicitudes = [
      {
        modelo: 'Puerta japonesa', madera: 'Roble', ancho: 0.8, alto: 2.1, medida: null, cantidad: 1,
        personalizado: { familia: 'PUERTA' },
        referencias: [{ archivo: `${'c'.repeat(64)}.pdf`, nombre: 'croquis.pdf', tipo: 'application/pdf', tamano: 10, fecha: '2026-10-06T00:00:00.000Z' }],
      },
    ];
    const montos = cotizar([{ producto, cantidad: 1, indice: 0, anchoSolicitado: 0.8, altoSolicitado: 2.1 }], { ajuste: 0, iva: 0.19 });
    const texto = textoVisible(await plantilla(q, { tipo: 'nota', numero: 9, montos, fecha: '2026-09-28T12:00:00.000Z' }));
    expect(texto).toContain('Producto personalizado, fuera de catálogo · Referencias del cliente: croquis.pdf');
    expect(texto).not.toContain('Referencia de catálogo');
  });

  it('en la nota, un pedido especial sin costo de fábrica va «Por definir», en su lugar, y no suma', async () => {
    await aislarBaseDatos();
    const q = cotizacion();
    const { producto: especial } = productoPersonalizado(
      { modelo: 'Puerta japonesa', madera: 'Roble', ancho: 1.9, alto: 2.2, medida: null, cantidad: 1, precioUnitario: 450000 },
      'PUERTA',
    ) as Extract<ReturnType<typeof productoPersonalizado>, { ok: true }>;
    q.solicitudes = [
      {
        modelo: 'Puerta japonesa', madera: 'Roble', ancho: 1.9, alto: 2.2, medida: null, cantidad: 1,
        precioUnitario: 450000, personalizado: { familia: 'PUERTA' },
      },
      { modelo: 'MOLCO', madera: 'PINO OREGON', ancho: 0.8, alto: 2, medida: null, cantidad: 2 },
    ];
    q.montos = cotizar([
      { producto: especial, cantidad: 1, indice: 0, anchoSolicitado: 1.9, altoSolicitado: 2.2 },
      { producto: puerta, cantidad: 2, indice: 1 },
    ]);
    // La nota valoriza solo la Molco, a costo de fábrica.
    const montos = cotizar([{ producto: puerta, cantidad: 2, indice: 1 }], { ajuste: 0, iva: 0.19 });
    const html = await plantilla(q, { tipo: 'nota', numero: 9, montos, fecha: '2026-09-28T12:00:00.000Z' });
    const [primera, segunda] = html.split('<tr><td>').slice(1).map(textoVisible);
    expect(primera).toMatch(/Puerta japonesa[\s\S]*Por definir\s+Por definir/i);
    expect(segunda).toContain('Molco');
    const texto = textoVisible(html);
    expect(texto).toContain('Las líneas «Por definir» son pedidos especiales sin costo de fábrica');
    expect(texto).not.toContain('$450.000');
    expect(texto).toMatch(/TOTAL\s+\$238\.000/);
  });

  it('las descripciones en mayúsculas se muestran legibles y las escuadrías llevan unidad', () => {
    expect(descripcionLegible('HUILO HUILO PINO OREGON 0,80 A 0,85 MT X 2,1 MT')).toBe(
      'Huilo Huilo Pino Oregon 0,80 a 0,85 m × 2,1 m',
    );
    expect(descripcionLegible('MARCO PINO OREGON 2X4 PULG KIT')).toBe('Marco Pino Oregon 2x4 pulg. kit');
    expect(descripcionLegible('Puerta especial de raulí')).toBe('Puerta especial de raulí');
    const marco: Producto = { ...puerta, codigo: 'MAR-O-2X4-B', familia: 'MARCO', medida: '2X4', largo: 2.1 };
    const [linea] = cotizar([
      { producto: marco, cantidad: 1, medidaSolicitada: '2X4', altoSolicitado: 2.1 },
    ]).lineas;
    expect(medidaPedida(linea!)).toBe('2x4 pulg. × 2,10 m');
  });

  it('las condiciones comerciales configuradas se imprimen y la aceptación se omite si está anulada', async () => {
    await aislarBaseDatos();
    vi.stubEnv('NELTUME_CONDICIONES_PAGO', '50 % anticipo');
    const montos = cotizar([{ producto: puerta, cantidad: 1 }]);
    const doc = { tipo: 'cotizacion' as const, numero: 330, montos, fecha: '2026-09-28T12:00:00.000Z' };
    const html = await plantilla(cotizacion(), doc);
    expect(html).toContain('<p>50 % anticipo</p>');
    // Sin flete, el despacho se consulta aparte.
    expect(html).toContain('Consultar valor despacho.');
    expect(html).not.toContain('Plazo de entrega');
    expect(html).toContain('Aceptación del cliente');
    const anulada = await plantilla(cotizacion(), {
      ...doc,
      anulada: { fecha: null, motivo: null, por: null },
    });
    expect(anulada).not.toContain('Aceptación del cliente');
    vi.unstubAllEnvs();
  });
});

describe('generarPdf', () => {
  it('escribe con permisos privados y nunca sobrescribe un documento', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-pdf-'));
    dirs.push(dir);
    await generarPdf(dir, 'cotizacion-1.pdf', '<html/>');
    expect((await stat(join(dir, 'pdf'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, 'pdf', 'cotizacion-1.pdf'))).mode & 0o777).toBe(0o600);
    await writeFile(join(dir, 'pdf', 'cotizacion-2.pdf'), 'original');
    await expect(generarPdf(dir, 'cotizacion-2.pdf', '<html/>')).rejects.toMatchObject({
      codigo: 'pdf_no_disponible',
    });
    expect((await readdir(join(dir, 'pdf'))).sort()).toEqual(['cotizacion-1.pdf', 'cotizacion-2.pdf']);
  });

  it('corta la generación al vencer el plazo total y cierra el navegador', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-pdf-'));
    dirs.push(dir);
    navegador.demora = 500;
    const cerrados = navegador.cerrado;
    await expect(generarPdf(dir, 'cotizacion-3.pdf', '<html/>', 50)).rejects.toMatchObject({
      codigo: 'pdf_no_disponible',
      tecnico: expect.stringContaining('50 ms'),
    });
    expect(navegador.cerrado).toBe(cerrados + 1);
    await new Promise((r) => setTimeout(r, 600));
    expect(await readdir(join(dir, 'pdf'))).toEqual([]);
  });
});

describe('prepararPdf', () => {
  it('corta la apertura de página de un Chromium colgado al vencer el plazo y lo descarta', async () => {
    navegador.colgar = true;
    const cerrados = navegador.cerrado;
    await expect(prepararPdf(50)).rejects.toMatchObject({
      codigo: 'pdf_no_disponible',
      status: 503,
      tecnico: expect.stringContaining('50 ms'),
    });
    expect(navegador.cerrado).toBe(cerrados + 1);
  });

  it('generarPdf conserva la causa del fallo en el registro técnico, sin el registro de llamadas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-pdf-'));
    dirs.push(dir);
    navegador.falla = 'page.pdf: Target page, context or browser has been closed\nCall log:\n  - Juan Pérez';
    await expect(generarPdf(dir, 'cotizacion-5.pdf', '<html/>')).rejects.toMatchObject({
      codigo: 'pdf_no_disponible',
      tecnico:
        'Falló la generación de cotizacion-5.pdf: page.pdf: Target page, context or browser has been closed',
    });
  });
});

describe('PDF fuera del bloqueo del almacén', () => {
  async function preparar() {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-pdf-bloqueo-'));
    dirs.push(dir);
    const almacen = new Almacen(dir);
    const pedido = {
      modelo: 'MOLCO',
      madera: 'PINO OREGON',
      ancho: 0.82,
      alto: 2,
      medida: null,
      cantidad: 2,
      tipoMedida: 'hoja',
    };
    const llm = {
      interpretar: vi.fn().mockResolvedValue({
        name: 'actualizar_cotizacion',
        input: { items: [pedido], cliente: { ...clienteVacio(), nombre: 'Ana Soto' } },
      }),
    };
    const catalogo = { fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos: [puerta] };
    const servicio = new Servicio(catalogo, llm, almacen, { nombre: 'Paula', email: 'paula@neltume.cl' });
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza MOLCO' })).cotizacion;
    const intentar = (accion: Record<string, unknown>) =>
      servicio.ejecutar({ ...accion, id: q.id, actualizada: q.actualizada } as never);
    const ir = async (accion: Record<string, unknown>) => (q = (await intentar(accion)).cotizacion);
    const bloqueado = () => existsSync(join(dir, '.estado.lock'));
    // La sonda detecta el bloqueo cuando está tomado.
    await almacen.transaccion(() => expect(bloqueado()).toBe(true));
    const regenerados = () => almacen.eventos(q.id).filter((e) => e.detalle === 'PDF regenerado').length;
    return { dir, almacen, intentar, ir, bloqueado, regenerados, actual: () => q };
  }

  it('emitir, generar la nota y regenerar un PDF abren Chromium con el almacén libre', async () => {
    const t = await preparar();
    const conBloqueo: boolean[] = [];
    navegador.alAbrir = async () => {
      conBloqueo.push(t.bloqueado());
    };
    await t.ir({ tipo: 'emitir' });
    await t.ir({ tipo: 'aprobar' });
    await t.ir({ tipo: 'pago', monto: anticipoMinimo(t.actual().montos.total) });
    await t.ir({ tipo: 'generar_nota', fabrica: 'panguipulli' });
    const archivo = join(t.dir, 'pdf', t.actual().pdf!);
    await rm(archivo);
    await expect(t.intentar({ tipo: 'regenerar_pdf', documento: 'cotizacion' })).resolves.toMatchObject({
      archivo: t.actual().pdf,
    });
    expect(existsSync(archivo)).toBe(true);
    expect(t.regenerados()).toBe(1);
    expect(conBloqueo.length).toBeGreaterThanOrEqual(5);
    expect(conBloqueo).not.toContain(true);
  });

  it('si la cotización cambia mientras se comprueba Chromium, emitir responde 409 sin gastar el número', async () => {
    const t = await preparar();
    const antes = t.almacen.correlativos();
    // Otra persona guarda mientras Chromium arranca: con el bloqueo tomado, esto quedaría esperando.
    navegador.alAbrir = async () => {
      navegador.alAbrir = null;
      await t.ir({ tipo: 'comentario', texto: 'Llamar el lunes' });
    };
    await expect(t.intentar({ tipo: 'emitir' })).rejects.toMatchObject({
      status: 409,
      codigo: 'version_obsoleta',
    });
    expect(t.almacen.correlativos()).toEqual(antes);
    await t.ir({ tipo: 'emitir' });
    expect(t.actual().numero).toBe(antes.siguienteCotizacion);
  });

  it('si la cotización cambia mientras se regenera, conserva el PDF recuperado y registra el evento', async () => {
    // Antes respondía 409 y borraba el PDF recién recuperado, aunque otra recuperación simultánea ya lo hubiera
    // entregado (esa encuentra el archivo y lo devuelve sin imprimir). Es el documento emitido, impreso desde su
    // snapshot: un comentario entretanto no lo invalida, así que queda y el evento se registra con la versión actual.
    const t = await preparar();
    await t.ir({ tipo: 'emitir' });
    const archivo = join(t.dir, 'pdf', t.actual().pdf!);
    await rm(archivo);
    navegador.alAbrir = async () => {
      navegador.alAbrir = null;
      await t.ir({ tipo: 'comentario', texto: 'Pidió otra copia' });
    };
    const r = await t.intentar({ tipo: 'regenerar_pdf', documento: 'cotizacion' });
    expect(r.archivo).toBe(t.actual().pdf);
    expect(r.cotizacion.actualizada).toBe(t.actual().actualizada);
    expect(existsSync(archivo)).toBe(true);
    expect(t.regenerados()).toBe(1);
    // Ya recuperado, se entrega sin volver a imprimirlo ni registrar otro evento.
    await t.ir({ tipo: 'regenerar_pdf', documento: 'cotizacion' });
    expect(existsSync(archivo)).toBe(true);
    expect(t.regenerados()).toBe(1);
  });

  it('si entretanto ese PDF dejó de ser el documento de la cotización, responde 409 sin borrarlo', async () => {
    const t = await preparar();
    await t.ir({ tipo: 'emitir' });
    const archivo = join(t.dir, 'pdf', t.actual().pdf!);
    await rm(archivo);
    navegador.alAbrir = async () => {
      navegador.alAbrir = null;
      await t.almacen.transaccion((u) => u.guardar({ ...u.obtener(t.actual().id)!, pdf: 'otro-documento.pdf' }));
    };
    await expect(t.intentar({ tipo: 'regenerar_pdf', documento: 'cotizacion' })).rejects.toMatchObject({
      status: 409,
      codigo: 'version_obsoleta',
    });
    expect(existsSync(archivo)).toBe(true);
    expect(t.regenerados()).toBe(0);
  });
});

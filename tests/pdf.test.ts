import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
  /** El lanzamiento de Chromium no termina hasta que esto se cumpla. */
  lanzamiento: null as Promise<void> | null,
}));
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(async () => {
      await navegador.lanzamiento;
      return {
        on: () => {},
        newPage: async () => {
          await navegador.alAbrir?.();
          if (navegador.colgar) await new Promise(() => {});
          return {
            close: async () => {},
            setDefaultTimeout: () => {},
            route: async () => {},
            setContent: async () => {},
            evaluate: async () => {},
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
      };
    }),
  },
}));
const { cerrarNavegadorPdf, descripcionLegible, generarPdf, inyectarRecursos, medidaPedida, plantilla, prepararPdf } =
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
  notas: [],
});
const dirs: string[] = [];
afterEach(async () => {
  Object.assign(navegador, { demora: 0, colgar: false, falla: null, alAbrir: null, lanzamiento: null });
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
    expect(html).toContain('<dt class="k">Revisión de</dt><dd>N° 323</dd>');
    expect(html).toContain('<dt class="k">Válida hasta</dt><dd>12 de octubre de 2026</dd>');
    expect(html).toContain('válida hasta el 12-10-2026');
    expect(html).toContain('<dt class="k">Emitida por</dt><dd>Paula</dd>');
    // El ítem se nombra con la medida pedida; el rango del catálogo solo define el precio. El vano no se repite aparte.
    expect(html).toContain('<b>Molco Pino Oregon 0,82 m × 2,00 m</b><span class="cod">MOL-O-3-A</span>');
    // Con el dibujo de línea del modelo, como referencia que se incrusta al imprimir.
    expect(html).toContain('<image href="neltume-dibujo:molco.png"');
    expect(html).not.toContain('Medida solicitada');
    expect(html).not.toContain('0,80 a 0,85');
    expect(html).toMatch(/Descuento 10 %.*−\$25\.000/);
    // El flete es una línea del detalle y el subtotal la incluye; el descuento es solo de los productos.
    expect(html).toMatch(/<b>Flete \/ despacho<\/b><span class="cod">FLETE<\/span><\/div><\/div><\/td><td class="r cant">1<\/td><td class="r unit">\$15\.000<\/td><td class="r tot">\$15\.000/);
    expect(html).toContain('<dt>Subtotal</dt><dd>$265.000</dd>');
    expect(html).toContain('sobre productos');
    expect(html).not.toContain('Flete por despacho</b>');
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
    const [conDescuento, sinDescuento] = html.split('<tr><td class="n">').slice(1).map(textoVisible);
    // Unitario $125.000 → −$18.750 → $106.250; la línea de 2 pasa de $250.000 a $212.500.
    expect(conDescuento).toMatch(/\$125\.000\s+\$106\.250/);
    expect(conDescuento).toMatch(/\$250\.000\s+\$212\.500/);
    expect(conDescuento).toContain('Descuento especial 15 %: −$18.750 c/u · Ahorro $37.500');
    expect(html).toContain('<s class="original">$125.000</s>');
    // La otra línea sigue a su precio, sin tachar ni rótulos de descuento.
    expect(sinDescuento).not.toMatch(/Descuento especial/);
    expect(veces(html, '<s class="original">')).toBe(2);
    const totales = textoVisible(html.split('<dl class="totales">')[1]);
    expect(totales).toMatch(/Subtotal original\s+\$375\.000/);
    expect(totales).toMatch(/Ahorro desc\. especiales\s+−\$37\.500/);
    expect(totales).toMatch(/Subtotal\s+\$337\.500/);
    expect(totales).toMatch(/Descuento 10 %\s+−\$33\.750/);
    // Sin descuentos especiales, el resumen queda como siempre.
    const sin = await plantilla(cotizacion(), {
      tipo: 'cotizacion', numero: 325, montos: cotizar([{ producto: puerta, cantidad: 1 }]), fecha: '2026-09-28T12:00:00.000Z',
    });
    expect(sin).not.toMatch(/Subtotal original|Ahorro|class="original"/);
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
    expect(automatico).toMatch(/Desc\. por cantidad 5 %\s+−\$/);
    expect(automatico).not.toMatch(/descuento por cantidad/i);
    const manual = await pdf({ descuentoManual: true });
    expect(manual).toMatch(/Descuento 5 %\s+−\$/);
    expect(manual).not.toMatch(/por cantidad/i);
    // Sin tramos en las reglas (cotizaciones anteriores) sigue igual.
    const anterior = await pdf({ descuentoManual: false }, REGLAS);
    expect(anterior).toMatch(/Descuento 5 %\s+−\$/);
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
    expect(html).toContain('<dt>Dirección de despacho</dt><dd>Los Carrera #450</dd>');
    expect(html).toContain('<dt>Transporte</dt><dd>Por confirmar</dd>');
    expect(html).not.toMatch(/<dd>\s*otro\s*<\/dd>/i);
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
    expect(html).toContain('<dt>Giro</dt><dd>Constructora</dd>');
    expect(html).toContain('<dt>Dirección de despacho</dt><dd>Los Carrera #450</dd>');
    expect(html).toContain('<dt>Transporte</dt><dd>Camión</dd>');
    expect(html).toContain('<dt class="k">Aprobada por</dt><dd>Paulette</dd>');
    expect(html).toContain('<b>Molco Pino Oregon 0,83 m × 2,00 m</b><span class="medida">Medida solicitada: 830 × 2000 mm (Hoja)</span>');
    // El plano lleva las cotas de la medida pedida, en milímetros.
    expect(html).toMatch(/<svg class="plano"[^]*>830<\/text>[^]*>2000<\/text><\/svg>/);
    // Fábrica ve además la referencia de catálogo (el rango que se cobra).
    expect(html).toContain('Referencia de catálogo: MOL-O-3-A');
    expect(textoVisible(html)).not.toMatch(/descuento/i);
    expect(html).toContain('<dt class="k">Cotización</dt><dd>N° 325</dd>');
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
    const [sinTipo, , sinMedida] = html.split('<tr><td class="n">').slice(1).map(textoVisible);
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

  it('hoja o vano es un dato para fábrica: la cotización no lo nombra y la nota de pedido sí', async () => {
    await aislarBaseDatos();
    const montos = cotizar(
      [
        { producto: puerta, cantidad: 1, anchoSolicitado: 0.82, altoSolicitado: 2, tipoMedida: 'vano' },
        { producto: puerta, cantidad: 1, anchoSolicitado: 0.835, altoSolicitado: 2, tipoMedida: 'vano', descripcionDocumento: 'Puerta con cerradura' },
        { producto: puerta, cantidad: 1, anchoSolicitado: 0.84, altoSolicitado: 2, tipoMedida: 'hoja' },
        { producto: puerta, cantidad: 1, anchoSolicitado: 0.8, altoSolicitado: 2, tipoMedida: 'hoja', descripcionDocumento: 'Puerta de baño' },
      ],
      undefined,
    );
    const fecha = '2026-09-28T12:00:00.000Z';
    const paraCliente = textoVisible(await plantilla(cotizacion(), { tipo: 'cotizacion', numero: 327, montos, fecha }));
    expect(paraCliente).not.toMatch(/vano|hoja/i);
    // La medida pedida va aparte solo con una descripción escrita a mano: si no, el nombre ya la lleva.
    expect(veces(paraCliente, 'Medida solicitada')).toBe(2);
    expect(paraCliente).toContain('Medida solicitada: 835 × 2000 mm');
    expect(paraCliente).toContain('Medida solicitada: 800 × 2000 mm');
    expect(paraCliente).toContain('Molco Pino Oregon 0,84 m × 2,00 m');
    const paraFabrica = textoVisible(await plantilla(cotizacion(), { tipo: 'nota', numero: 9, montos, fecha }));
    expect(paraFabrica).toContain('Medida solicitada: 820 × 2000 mm (Vano)');
    expect(paraFabrica).toContain('Medida solicitada: 835 × 2000 mm (Vano)');
    expect(paraFabrica).toContain('Medida solicitada: 840 × 2000 mm (Hoja)');
    expect(paraFabrica).toContain('Medida solicitada: 800 × 2000 mm (Hoja)');
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
    const [primera, segunda] = html.split('<tr><td class="n">').slice(1).map(textoVisible);
    expect(primera).toMatch(/Puerta japonesa[\s\S]*Por definir\s+Por definir/i);
    expect(segunda).toContain('Molco');
    const texto = textoVisible(html);
    expect(texto).toContain('Las líneas «Por definir» son pedidos especiales sin costo de fábrica');
    expect(texto).not.toContain('$450.000');
    expect(texto).toMatch(/Total\s+\$238\.000/);
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

  it('cada nota nombra a la otra nota de la cotización, y una puerta sin modelo 3D lleva el esquema genérico', async () => {
    await aislarBaseDatos();
    const sinDibujo = { ...puerta, codigo: 'ESP-O-3-A', modelo: 'ESPECIAL', descripcion: 'ESPECIAL PINO OREGON 0,80 A 0,85 MT X 2 MT' };
    const montos = cotizar([{ producto: sinDibujo, cantidad: 2, anchoSolicitado: 0.8, altoSolicitado: 2 }], { ajuste: 0, iva: 0.19 });
    const html = await plantilla(cotizacion(), {
      tipo: 'nota', numero: 577, fabrica: 'panguipulli', montos, fecha: '2026-09-28T12:00:00.000Z',
      otrasNotas: [{ fabrica: 'santiago', numero: 59, items: 1 }],
    });
    expect(textoVisible(html)).toMatch(/La cotización N° 325 tiene 2 notas de pedido\. La otra va a Santiago,\s+N° 59\s+, con 1 ítem\./);
    expect(html).toContain('<p class="fabrica"><b>Fábrica Panguipulli</b></p>');
    expect(html).toContain('Recibido por fábrica Panguipulli');
    // Un modelo sin dibujo: esquema genérico, con las cotas igual.
    expect(html).not.toContain('neltume-dibujo:');
    expect(html).toMatch(/<g class="generico">[^]*>800<\/text>[^]*>2000<\/text>/);
  });

  it('la nota de Santiago va a nombre de Neltume.co y sin el aviso de las otras notas; la de Panguipulli no cambia', async () => {
    await aislarBaseDatos();
    const q = cotizacion();
    const antes = structuredClone(q);
    const montos = cotizar([{ producto: puerta, cantidad: 2, anchoSolicitado: 0.83, altoSolicitado: 2, tipoMedida: 'hoja' }], { ajuste: 0, iva: 0.19 });
    const nota = (fabrica: 'panguipulli' | 'santiago', otra: 'panguipulli' | 'santiago') =>
      plantilla(q, {
        tipo: 'nota', numero: fabrica === 'santiago' ? 59 : 577, fabrica, montos, fecha: '2026-09-28T12:00:00.000Z',
        despacho: { direccion: 'Los Carrera #450', transporte: 'Camión' },
        otrasNotas: [{ fabrica: otra, numero: otra === 'santiago' ? 59 : 577, items: 1 }],
      });
    const santiago = await nota('santiago', 'panguipulli');
    const panguipulli = await nota('panguipulli', 'santiago');

    expect(santiago).toContain('<p class="k">Cliente</p><h2>Neltume.co</h2></div>');
    expect(textoVisible(santiago)).not.toContain('Juan');
    expect(santiago).not.toContain('12.345.678-5');
    expect(santiago).not.toContain('Constructora');
    // Sin el recuadro: ni el contenedor ni su texto, y el encabezado sigue directo con las partes.
    expect(santiago).not.toContain('class="otras"');
    expect(textoVisible(santiago)).not.toMatch(/notas de pedido\.|La otra va/);
    expect(santiago).toMatch(/<\/header><section class="partes">/);
    expect(santiago).toContain('<dt>Dirección de despacho</dt><dd>Los Carrera #450</dd>');
    expect(santiago).toContain('<p class="fabrica"><b>Fábrica Santiago</b></p>');
    expect(santiago).toContain('Recibido por fábrica Santiago');

    expect(panguipulli).toContain('<p class="k">Cliente</p><h2>Juan</h2>');
    expect(panguipulli).toContain('<dt>RUT</dt><dd>12.345.678-5</dd>');
    expect(panguipulli).toMatch(/<\/header><p class="otras">La cotización N° 325 tiene 2 notas de pedido\. La otra va a Santiago, <b>N° 59<\/b>, con 1 ítem\.<\/p><section class="partes">/);

    // Mismas líneas, cantidades, precios y totales en las dos.
    const detalle = (html: string) => html.slice(html.indexOf('<table>'), html.indexOf('<section class="fab">'));
    expect(detalle(santiago)).toBe(detalle(panguipulli));
    // La cotización al cliente sigue con su nombre, y nada del cliente guardado cambió.
    const comercial = await plantilla(q, { tipo: 'cotizacion', numero: 325, montos, fecha: '2026-09-28T12:00:00.000Z' });
    expect(comercial).toContain('<p class="k">Cliente</p><h2>Juan</h2>');
    expect(q).toEqual(antes);
  });

  it('cada modelo de puerta de la planilla de precios tiene su dibujo, y el PNG mide lo que dice el manifiesto', async () => {
    const { dibujosModelos, normalizarModelo, RECURSOS } = await import('../src/servidor/dibujos');
    const modelos = [
      'ANCACOMOE', 'BAKER', 'CALAFQUEN', 'CHAN CHAN', 'CHAUQUEN', 'COCHAMO', 'COZ COZ', 'ENCO', 'ENSENADA', 'FUTALEUFU',
      'FUTRONO', 'FUY', 'HUELLAHUE', 'HUERQUEHUE', 'Huilo Huilo', 'LANCO', 'LICAN', 'LIPINZA', 'LOS LAGOS', 'LOS RIOS',
      'MALALHUE', 'MARCO', 'MOLCO', 'NELTUME', 'PALENA', 'PANGUIPULLI', 'PETROHUE', 'PIRIHUEICO', 'PUÑIR', 'RANCO',
      'RIÑIHUE', 'RUPANCO', 'TOLEDO', 'TOLTEN', 'YELCHO',
    ];
    const dibujos = dibujosModelos();
    for (const modelo of modelos) {
      const dibujo = dibujos.get(normalizarModelo(modelo));
      expect(dibujo, `${modelo} no tiene dibujo`).toBeDefined();
      const png = await readFile(join(RECURSOS, 'dibujos', dibujo!.archivo));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], `${dibujo!.archivo}: tamaño del PNG`).toEqual(dibujo!.px);
      // El marco no tiene hoja que acotar; las puertas sí.
      if (modelo !== 'MARCO') expect(dibujo!.hoja, `${modelo}: sin la hoja para las cotas`).not.toBeNull();
    }
  });

  it('al imprimir, los dibujos y las fuentes de la plantilla se incrustan; una referencia sin archivo queda igual', async () => {
    const html = await inyectarRecursos(
      '<style>@font-face{src:url(neltume-fuente:host-grotesk.woff2)}</style><svg><image href="neltume-dibujo:molco.png"/><image href="neltume-dibujo:no-existe.png"/></svg>',
    );
    expect(html).toMatch(/url\(data:font\/woff2;base64,[A-Za-z0-9+/=]{1000,}\)/);
    expect(html).toMatch(/href="data:image\/png;base64,[A-Za-z0-9+/=]{1000,}"/);
    expect(html).toContain('href="neltume-dibujo:no-existe.png"');
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
    expect(html).toContain('Para aceptar esta cotización');
    const anulada = await plantilla(cotizacion(), {
      ...doc,
      anulada: { fecha: null, motivo: null, por: null },
    });
    expect(anulada).not.toContain('Para aceptar esta cotización');
    expect(anulada).toContain('COTIZACIÓN ANULADA');
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

  it('el arranque del Chromium compartido no hereda el plazo corto de quien lo pidió primero', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-pdf-'));
    dirs.push(dir);
    const { chromium } = await import('playwright');
    const lanzar = vi.mocked(chromium.launch);
    // Un documento que vence casi al instante (o el healthcheck) puede ser el primero en pedir el navegador: si el
    // arranque llevara su plazo, fallaría también para los demás documentos que lo esperan.
    for (const pedir of [() => prepararPdf(50), () => generarPdf(dir, 'cotizacion-6.pdf', '<html/>', 50)]) {
      await cerrarNavegadorPdf();
      lanzar.mockClear();
      await pedir().catch(() => {});
      expect(lanzar).toHaveBeenCalledTimes(1);
      expect(lanzar.mock.calls[0]![0]!.timeout).toBeGreaterThan(1_000);
    }
  });

  it('un documento de plazo corto no espera a un arranque lento ni lo descarta: el siguiente lo aprovecha', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-pdf-'));
    dirs.push(dir);
    const { chromium } = await import('playwright');
    const lanzar = vi.mocked(chromium.launch);
    await cerrarNavegadorPdf();
    lanzar.mockClear();
    let terminarArranque!: () => void;
    navegador.lanzamiento = new Promise<void>((r) => (terminarArranque = r));
    const cerrados = navegador.cerrado;
    // Vence a los 50 ms con el arranque todavía en curso: responde a tiempo, sin esperar a que termine.
    const vencido = await Promise.race([
      prepararPdf(50).catch((e: unknown) => e),
      new Promise((r) => setTimeout(() => r('esperó el arranque'), 2_000)),
    ]);
    expect(vencido).toMatchObject({ codigo: 'pdf_no_disponible', tecnico: expect.stringContaining('50 ms') });
    // El siguiente documento comparte ese arranque: no se lanza otro Chromium y el que llega no se cierra.
    const imprimir = generarPdf(dir, 'cotizacion-7.pdf', '<html/>');
    terminarArranque();
    await imprimir;
    expect(lanzar).toHaveBeenCalledTimes(1);
    expect(navegador.cerrado).toBe(cerrados);
    expect(await readdir(join(dir, 'pdf'))).toContain('cotizacion-7.pdf');
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

describe('Notas de pedido emitidas por fábrica', () => {
  it('al generar las notas, la de Santiago se guarda a nombre de Neltume.co; el cliente y el pedido a Panguipulli siguen iguales', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-pdf-fabricas-'));
    dirs.push(dir);
    const almacen = new Almacen(dir);
    const pedido = { modelo: 'MOLCO', madera: 'PINO OREGON', ancho: 0.82, alto: 2, medida: null, cantidad: 2, tipoMedida: 'hoja' };
    const cliente = { ...clienteVacio(), nombre: 'Ana Soto', rut: '12.345.678-5', telefono: '+56 9 1234 5678' };
    const llm = {
      interpretar: vi.fn().mockResolvedValue({ name: 'actualizar_cotizacion', input: { items: [pedido, { ...pedido, cantidad: 3 }], cliente } }),
    };
    const catalogo = { fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos: [puerta] };
    const servicio = new Servicio(catalogo, llm, almacen, { nombre: 'Paula', email: 'paula@neltume.cl' });
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza MOLCO' })).cotizacion;
    const ir = async (accion: Record<string, unknown>) =>
      (q = (await servicio.ejecutar({ ...accion, id: q.id, actualizada: q.actualizada } as never)).cotizacion);
    await ir({ tipo: 'emitir' });
    await ir({ tipo: 'aprobar' });
    await ir({ tipo: 'pago', monto: anticipoMinimo(q.montos.total) });
    await ir({ tipo: 'generar_nota', asignaciones: [{ indice: 0, fabrica: 'panguipulli' }, { indice: 1, fabrica: 'santiago' }] });

    const html = (archivo: string) =>
      (almacen.baseDatos().prepare('SELECT html FROM documentos_snapshot WHERE archivo = ?').get(archivo) as { html: string }).html;
    const [notaPanguipulli, notaSantiago] = q.notas;
    const santiago = html(notaSantiago.pdf);
    const panguipulli = html(notaPanguipulli.pdf);
    expect(santiago).toContain('<h2>Neltume.co</h2>');
    expect(textoVisible(santiago)).not.toMatch(/Ana Soto|12\.345\.678-5|1234 5678/);
    expect(santiago).not.toContain('class="otras"');
    expect(panguipulli).toContain('<h2>Ana Soto</h2>');
    expect(panguipulli).toContain(`La otra va a Santiago, <b>N° ${notaSantiago.numero}</b>, con 1 ítem.`);
    expect(html(q.pdf!)).toContain('<h2>Ana Soto</h2>');
    // La nota de Santiago sigue con sus líneas y precios de fábrica.
    expect(notaSantiago.montos.lineas.map((l) => [l.indice, l.cantidad, l.precioUnitario])).toEqual([[1, 3, 100_000]]);

    // El cliente guardado no cambia.
    expect(almacen.obtener(q.id)!.cliente).toMatchObject({ nombre: 'Ana Soto', rut: '12.345.678-5', telefono: '+56 9 1234 5678' });
    // Recuperar la nota de Santiago desde su snapshot da el mismo documento.
    await rm(join(dir, 'pdf', notaSantiago.pdf));
    await servicio.ejecutar({ tipo: 'regenerar_pdf', id: q.id, actualizada: q.actualizada, documento: 'nota', fabrica: 'santiago' } as never);
    expect(existsSync(join(dir, 'pdf', notaSantiago.pdf))).toBe(true);
    expect(html(notaSantiago.pdf)).toBe(santiago);

    // La integración con Panguipulli no cambia: su pedido sigue nombrando la nota de Santiago y su orden de trabajo,
    // el aviso de la otra nota.
    const { pedidoDeNota, prepararEnvio } = await import('../src/servidor/integracion-pedido');
    expect(pedidoDeNota(q, notaPanguipulli).relatedOrders).toEqual([
      { factoryCode: expect.any(String), orderNumber: String(notaSantiago.numero), itemCount: 1 },
    ]);
    const envio = await prepararEnvio(q, notaPanguipulli, { db: almacen.baseDatos() });
    expect(envio.htmlProduccion).toContain('<p class="otras">');
    expect(envio.htmlProduccion).toContain('<h2>Ana Soto</h2>');
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clienteVacio, type Producto } from '../src/catalogo/tipos';
import type { Cotizacion } from '../src/negocio/estado';
import { cotizar, descripcionLinea, montosVacios, REGLAS, type ReglasComerciales } from '../src/negocio/precios';
import { cerrarBaseDatos } from '../src/servidor/base-datos';

const navegador = vi.hoisted(() => ({ demora: 0, cerrado: 0 }));
vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(async () => ({
      on: () => {},
      newPage: async () => ({
        close: async () => {},
        setDefaultTimeout: () => {},
        route: async () => {},
        setContent: async () => {},
        pdf: async ({ path }: { path: string }) => {
          await new Promise((r) => setTimeout(r, navegador.demora));
          const { writeFile: escribir } = await import('node:fs/promises');
          await escribir(path, '%PDF-1.4');
        },
      }),
      close: async () => {
        navegador.cerrado++;
      },
    })),
  },
}));
const { descripcionLegible, generarPdf, medidaPedida, plantilla } = await import('../src/servidor/pdf');

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
  navegador.demora = 0;
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
    // El ítem se nombra con la medida pedida; el rango del catálogo solo define el precio.
    expect(html).toContain('Molco Pino Oregon 0,82 m × 2,00 m<br><small>Medida de vano');
    expect(html).not.toContain('0,80 a 0,85');
    expect(html).toMatch(/DESCUENTO 10 %.*−\$25\.000/);
    expect(html).toContain('FLETE');
    // El flete es una línea del detalle y el subtotal la incluye; el descuento es solo de los productos.
    expect(html).toMatch(/<td class="codigo">FLETE<\/td><td>Flete \/ despacho<\/td><td class="num">1<\/td><td class="num">\$15\.000<\/td><td class="num">\$15\.000/);
    expect(html).toMatch(/SUBTOTAL<\/span><b>\$265\.000/);
    expect(html).toContain('SOBRE PRODUCTOS');
    expect(html).toContain('Incluye flete por despacho');
    expect(html).not.toContain('Flete por despacho</td>');
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
    expect(html).toContain('Molco Pino Oregon 0,83 m × 2,00 m<br><small>Medida de hoja');
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
    expect(texto).toContain('Medida solicitada: 0,835 × 2,00 m · medida de vano');
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

  it('la nota para fábrica suma la referencia de catálogo y la medida exacta, nunca el margen', async () => {
    await aislarBaseDatos();
    const montos = cotizar(
      [{ producto: puerta, cantidad: 1, anchoSolicitado: 0.835, altoSolicitado: 2, tipoMedida: 'hoja', descripcionDocumento: 'Puerta con cerradura' }],
      { ajuste: 0, iva: 0.19 },
    );
    const html = await plantilla(cotizacion(), { tipo: 'nota', numero: 8, montos, fecha: '2026-09-28T12:00:00.000Z' });
    const texto = textoVisible(html);
    expect(texto).toContain('Puerta con cerradura');
    expect(texto).toContain('Medida solicitada: 0,835 × 2,00 m · medida de hoja');
    expect(texto).toContain('Referencia de catálogo: MOL-O-3-A · 0,80–0,85 × 2,00 m');
    expect(texto).not.toMatch(/margen|No especificado/i);
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
    expect(html).toContain('Forma de pago:</b> 50 % anticipo');
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

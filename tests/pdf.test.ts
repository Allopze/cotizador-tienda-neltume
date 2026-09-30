import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clienteVacio, type Producto } from '../src/catalogo/tipos';
import type { Cotizacion } from '../src/negocio/estado';
import { cotizar, montosVacios } from '../src/negocio/precios';
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
    expect(html).toContain('Medida solicitada: 0,82 × 2,00 m');
    expect(html).toContain('tipo: Vano');
    expect(html).toMatch(/DESCUENTO 10 %.*−\$25\.000/);
    expect(html).toContain('FLETE');
    expect(html).toMatch(/FLETE<\/span><b>\$15\.000/);
    expect(html).toContain('Incluye flete por despacho');
    expect(html).not.toContain('Flete por despacho</td>');
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
    expect(html).toContain('Medida solicitada: 0,83 × 2,00 m');
    expect(html).toContain('tipo: Hoja');
    expect(html).not.toContain('DESCUENTO');
    expect(html).toContain('Ref. cotización:</b> N° 325');
    expect(html).toContain('Recibido por fábrica');
    expect(html).not.toContain('GRACIAS');
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

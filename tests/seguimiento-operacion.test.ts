import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { clienteVacio, type Catalogo, type Producto, type SolicitudItem } from '../src/catalogo/tipos';
import type { Cotizacion } from '../src/negocio/estado';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';
import { SeguimientoOperacion } from '../src/app/seguimiento-operacion';
import { Documento } from '../src/app/panel-totales';

// La pantalla ofrece «Volver al paso anterior» y «Deshacer aprobación» exactamente cuando el servidor los acepta
// (plan 4.4 sobre 3.6): el mapa de pasos del cliente no puede desfasarse del de servicio.ts.
vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const molco: Producto = {
  codigo: 'MOL-O-3-A',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100_000,
  descripcion: 'MOLCO',
  filaOrigen: 4,
};
const catalogo: Catalogo = { fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos: [molco] };
const pedido: SolicitudItem = {
  modelo: 'MOLCO',
  madera: 'PINO OREGON',
  ancho: 0.82,
  alto: 2,
  medida: null,
  cantidad: 2,
  tipoMedida: 'hoja',
};
const dirs: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-seguimiento-'));
  dirs.push(dir);
  const llm = {
    interpretar: vi.fn().mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { items: [pedido], cliente: { ...clienteVacio(), nombre: 'Ana Soto' } },
    }),
  };
  const servicio = new Servicio(catalogo, llm, new Almacen(dir), { nombre: 'Paula', email: 'paula@neltume.cl' });
  const ir = async (q: Cotizacion, extra: Record<string, unknown>) =>
    (await servicio.ejecutar({ ...extra, id: q.id, actualizada: q.actualizada } as never)).cotizacion;
  /** ¿El servidor acepta la acción? No cambia nada guardado que importe: cada caso parte de su propia cotización. */
  const acepta = (q: Cotizacion, extra: Record<string, unknown>) => ir(q, extra).then(() => true, () => false);
  return { servicio, ir, acepta };
}

const pantalla = (actual: Cotizacion) =>
  renderToStaticMarkup(
    createElement(SeguimientoOperacion, {
      actual,
      ocupado: false,
      flujo: async () => true,
      anularPago: async () => true,
    }),
  );

describe('seguimiento de la operación: caminos de vuelta', () => {
  it('ofrece volver un paso y deshacer la aprobación solo cuando el servidor lo acepta', async () => {
    const t = await setup();
    const emitida = async () =>
      t.ir((await t.servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza MOLCO' })).cotizacion, { tipo: 'emitir' });
    const aprobada = async () => t.ir(await emitida(), { tipo: 'aprobar' });
    const mitad = (q: Cotizacion) => Math.ceil(q.montos.total / 2);
    const pagar = (q: Cotizacion, monto: number) => t.ir(q, { tipo: 'pago', monto });
    const operar = (q: Cotizacion, paso: string, extra: Record<string, unknown> = {}) =>
      t.ir(q, { tipo: 'operacion', paso, ...extra });
    const conNota = async () => {
      const q = await aprobada();
      return t.ir(await pagar(q, mitad(q)), { tipo: 'generar_nota' });
    };
    const saldo = (q: Cotizacion) => q.montos.total - mitad(q);

    // Cada estado operativo por el que pasa un pedido, armado por el servicio real.
    const casos: [string, () => Promise<Cotizacion>][] = [
      ['emitida', emitida],
      ['aprobada sin pagos', aprobada],
      ['anticipo sin nota', async () => { const q = await aprobada(); return pagar(q, mitad(q)); }],
      ['nota generada', conNota],
      ['en producción', async () => operar(await conNota(), 'iniciar_produccion')],
      ['saldo pendiente', async () => operar(await operar(await conNota(), 'iniciar_produccion'), 'produccion_terminada')],
      ['pagada', async () => {
        const q = await operar(await conNota(), 'iniciar_produccion');
        return operar(await pagar(q, saldo(q)), 'produccion_terminada');
      }],
      ['lista para despacho', async () => {
        const q = await operar(await conNota(), 'iniciar_produccion');
        return operar(await operar(await pagar(q, saldo(q)), 'produccion_terminada'), 'lista_despacho');
      }],
      ['despachada', async () => {
        let q = await operar(await conNota(), 'iniciar_produccion');
        q = await operar(await operar(await pagar(q, saldo(q)), 'produccion_terminada'), 'lista_despacho');
        return operar(q, 'despachada', { despacho: { transporte: 'Starken' } });
      }],
      ['facturada sin pagos', async () =>
        t.ir(await aprobada(), { tipo: 'facturacion', estado: 'facturada', tipoDocumento: 'boleta' })],
    ];
    const vistos: Record<string, { volver: boolean; deshacer: boolean }> = {};
    for (const [nombre, crear] of casos) {
      const q = await crear();
      const html = pantalla(q);
      const volver = html.includes('Volver al paso anterior');
      const deshacer = html.includes('Deshacer aprobación');
      vistos[nombre] = { volver, deshacer };
      expect([nombre, volver]).toEqual([nombre, await t.acepta(q, { tipo: 'retroceder_operacion', motivo: 'Prueba' })]);
      expect([nombre, deshacer]).toEqual([nombre, await t.acepta(await crear(), { tipo: 'desaprobar' })]);
    }
    // Lo que se espera de cada caso, para que un cambio en ambos lados a la vez no pase en silencio.
    expect(vistos).toMatchObject({
      emitida: { volver: false, deshacer: false },
      'aprobada sin pagos': { volver: false, deshacer: true },
      'anticipo sin nota': { volver: false, deshacer: false },
      'nota generada': { volver: false, deshacer: false },
      'en producción': { volver: true, deshacer: false },
      'saldo pendiente': { volver: true, deshacer: false },
      pagada: { volver: true, deshacer: false },
      'lista para despacho': { volver: true, deshacer: false },
      despachada: { volver: true, deshacer: false },
      'facturada sin pagos': { volver: false, deshacer: false },
    });
  });
});

describe('documentos de la cotización', () => {
  it('«Compartir» no se dibuja en el servidor ni al hidratar: aparece recién en un navegador que lo admite', () => {
    const props = {
      nombre: 'PDF de la cotización',
      archivo: 'cotizacion-325.pdf',
      descargando: null,
      descargar: () => {},
    };
    const doc = createElement(Documento, props);
    const conAcciones = renderToStaticMarkup(
      createElement(Documento, {
        ...props,
        acciones: { ver: () => true, compartir: () => {}, compartible: 'cotizacion-325.pdf' },
      }),
    );
    expect(conAcciones).toContain('href="/api/documento/cotizacion-325.pdf?ver=1"');
    expect(conAcciones).toContain('Descargar');
    expect(conAcciones).not.toContain('Compartir');
    // Sin las acciones (otras pantallas), el enlace «Ver» funciona igual.
    expect(renderToStaticMarkup(doc)).toContain('target="_blank"');
  });
});

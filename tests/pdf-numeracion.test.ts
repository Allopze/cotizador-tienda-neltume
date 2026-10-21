import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Catalogo, Producto, SolicitudItem } from '../src/catalogo/tipos';
import { clienteVacio } from '../src/catalogo/tipos';
import { anticipoMinimo, type Cotizacion } from '../src/negocio/estado';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';
import { cerrarNavegadorPdf } from '../src/servidor/pdf';

// Sin simular pdf.ts ni Playwright: Chromium falla de verdad porque CHROMIUM_PATH no existe.
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
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});
afterAll(() => cerrarNavegadorPdf());

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-pdf-numeracion-'));
  dirs.push(dir);
  const chromium = join(dir, 'no-existe', 'chromium');
  vi.stubEnv('CHROMIUM_PATH', chromium);
  const almacen = new Almacen(dir);
  const llm = {
    interpretar: vi.fn().mockResolvedValue({
      name: 'actualizar_cotizacion',
      input: { items: [pedido], cliente: { ...clienteVacio(), nombre: 'Ana Soto' } },
    }),
  };
  const servicio = new Servicio(catalogo, llm, almacen, { nombre: 'Paula', email: 'paula@neltume.cl' });
  let q = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'cotiza MOLCO' })).cotizacion;
  const ir = async (accion: Record<string, unknown>) => {
    q = (await servicio.ejecutar({ ...accion, id: q.id, actualizada: q.actualizada } as never)).cotizacion;
    return q;
  };
  const intentar = (accion: Record<string, unknown>) =>
    servicio.ejecutar({ ...accion, id: q.id, actualizada: q.actualizada } as never);
  const recargada = () => new Almacen(dir).obtener(q.id)!;
  /** Emitida sin pasar por Chromium (aquí no hay): número, archivo y estado como los deja emitir. */
  const emitidaSinPdf = async () => {
    q = await almacen.transaccion((u): Cotizacion => {
      const c = u.obtener(q.id)!;
      const numero = u.reservarCotizacion();
      Object.assign(c, {
        numero,
        pdf: `cotizacion-${numero}.pdf`,
        estado: 'emitida',
        estadoComercial: 'enviada',
        fechaEmision: '2026-10-13T12:00:00.000Z',
        vence: '2026-10-27',
        emitidaPor: 'Paula',
        actualizada: new Date().toISOString(),
      } satisfies Partial<Cotizacion>);
      u.guardar(c);
      return c;
    });
  };
  return { almacen, chromium, ir, intentar, recargada, emitidaSinPdf, actual: () => q };
}

const sinChromium = (chromium: string) => ({
  name: 'ErrorPdf',
  status: 503,
  codigo: 'pdf_no_disponible',
  // El registro técnico lleva la causa real, no un texto fijo.
  tecnico: expect.stringContaining(chromium),
});

describe('Sin Chromium no se gastan números', () => {
  it('emitir responde 503, no avanza el correlativo de cotización y deja el borrador intacto', async () => {
    const t = await setup();
    const antes = t.almacen.correlativos();
    await expect(t.intentar({ tipo: 'emitir' })).rejects.toMatchObject(sinChromium(t.chromium));
    await expect(t.intentar({ tipo: 'emitir' })).rejects.toMatchObject(sinChromium(t.chromium));
    expect(t.almacen.correlativos()).toEqual(antes);
    expect(t.recargada()).toMatchObject({
      estado: 'borrador',
      numero: null,
      pdf: null,
      actualizada: t.actual().actualizada,
    });
    expect(t.almacen.eventos(t.actual().id).map((e) => e.tipo)).not.toContain('emitida');
  });

  it('generar la nota de pedido responde 503 y no avanza el correlativo de notas', async () => {
    const t = await setup();
    await t.emitidaSinPdf();
    await t.ir({ tipo: 'aprobar' });
    await t.ir({ tipo: 'pago', monto: anticipoMinimo(t.actual().montos.total) });
    const antes = t.almacen.correlativos();
    await expect(t.intentar({ tipo: 'generar_nota', fabrica: 'panguipulli' })).rejects.toMatchObject(sinChromium(t.chromium));
    await expect(t.intentar({ tipo: 'generar_nota', fabrica: 'panguipulli' })).rejects.toMatchObject(sinChromium(t.chromium));
    expect(t.almacen.correlativos()).toEqual(antes);
    expect(t.recargada()).toMatchObject({
      estado: 'aprobada',
      nota: null,
      actualizada: t.actual().actualizada,
    });
  });

  it('regenerar un PDF perdido responde 503 sin registrar «PDF regenerado»', async () => {
    const t = await setup();
    await t.emitidaSinPdf();
    await expect(t.intentar({ tipo: 'regenerar_pdf', documento: 'cotizacion' })).rejects.toMatchObject(
      sinChromium(t.chromium),
    );
    expect(t.almacen.eventos(t.actual().id).map((e) => e.detalle)).not.toContain('PDF regenerado');
  });
});

// Regresiones de los hallazgos del validador del chat cerrados en la revisión final:
// BUG-029 (un precio de otro ítem o una medida no respalda), BUG-032 («no, mejor») y BUG-049 (descuento «en total»).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clienteVacio, type Catalogo, type Producto } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const puerta = (codigo: string, modelo: string): Producto => ({
  codigo,
  modelo,
  familia: 'PUERTA',
  tipo: 'PUERTA SÓLIDA',
  madera: 'MARA',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  altoMin: 2,
  altoMax: 2,
  largo: 2,
  precioNeto: 100_000,
  descripcion: `${modelo.toUpperCase()} MARA 0,80 A 0,85 MT X 2 MT`,
  filaOrigen: 1,
});
const catalogo: Catalogo = {
  fuente: 'test.xlsx',
  sha256: 'chat',
  fecha: '2026-01-01T00:00:00.000Z',
  productos: [puerta('MOL-1', 'MOLCO'), puerta('COZ-1', 'COZ COZ')],
};
const item = (modelo: string, extra: Record<string, unknown> = {}) => ({
  modelo,
  madera: 'MARA',
  ancho: 0.8,
  alto: 2,
  medida: null,
  cantidad: 2,
  fuente: `${modelo} mara 80x200`,
  ...extra,
});
const lista = (...items: object[]) => ({ name: 'actualizar_cotizacion', input: { items, cliente: clienteVacio() } });

const dirs: string[] = [];
async function setup(mensaje: string, respuesta: object) {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-regresion-chat-'));
  dirs.push(dir);
  const llm = { interpretar: vi.fn(async () => respuesta), verificarCifras: true, anclaje: 'corregir' as const };
  const servicio = new Servicio(catalogo, llm, new Almacen(dir));
  const r = await servicio.ejecutar({ tipo: 'chat', mensaje });
  return { r, servicio };
}
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

describe('BUG-029 · un precio de otro ítem o una medida no respalda al propio', () => {
  it('el precio escrito para la Molco no se aplica a la Coz Coz de la misma línea', async () => {
    const mensaje = '2 molco mara 80x200 a $300.000 y 3 coz coz mara 80x200';
    const { r } = await setup(
      mensaje,
      lista(
        item('MOLCO', { fuente: '2 molco mara 80x200 a $300.000', precio: { valor: 300_000, iva: 'neto' } }),
        item('COZ COZ', { cantidad: 3, fuente: '3 coz coz mara 80x200', precio: { valor: 300_000, iva: 'neto' } }),
      ),
    );
    const [molco, coz] = r.cotizacion.solicitudes;
    expect(molco.precioUnitario).toBe(300_000);
    expect(coz.precioUnitario ?? null).toBeNull();
    expect(r.avisos?.join(' ')).toMatch(/No apliqué el precio del ítem 2/);
  });

  it('una medida (90x210) no es un precio', async () => {
    const mensaje = '3 coz coz mara 90x210';
    const { r } = await setup(
      mensaje,
      lista(item('COZ COZ', { cantidad: 3, ancho: 0.9, alto: 2.1, fuente: mensaje, precio: { valor: 210, iva: 'neto' } })),
    );
    expect(r.cotizacion.solicitudes[0].precioUnitario ?? null).toBeNull();
    expect(r.avisos?.join(' ')).toMatch(/No apliqué el precio/);
  });
});

describe('BUG-032 · «no, mejor» manda la última cifra', () => {
  it('«3 molco de 80x200, no, mejor 4» cotiza 4', async () => {
    const mensaje = '3 molco mara de 80x200, no, mejor 4';
    const { r } = await setup(
      mensaje,
      lista(item('MOLCO', { cantidad: 3, fuente: mensaje })),
    );
    expect(r.cotizacion.solicitudes[0].cantidad).toBe(4);
  });
});

describe('BUG-049 · un descuento «en total» no se toma por unidad', () => {
  it('pide el descuento por unidad en vez de aplicarlo', async () => {
    const mensaje = '2 molco mara 80x200 con un descuento de $20.000 en total';
    const { r } = await setup(
      mensaje,
      lista(
        item('MOLCO', {
          fuente: mensaje,
          descuento: { tipo: 'monto', valor: 20_000 },
        }),
      ),
    );
    expect(r.cotizacion.solicitudes[0].descuento ?? null).toBeNull();
    expect(r.avisos?.join(' ')).toMatch(/descuento total/);
  });
});

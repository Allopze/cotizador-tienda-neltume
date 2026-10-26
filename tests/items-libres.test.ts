import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Catalogo, Producto } from '../src/catalogo/tipos';
import { contarPuertas } from '../src/negocio/descuento-cantidad';
import { calcularBulto } from '../src/negocio/starken';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { VERSION_ESQUEMA } from '../src/servidor/base-datos';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const molco: Producto = {
  codigo: 'MOL-L-0.8-2',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'LENGA',
  medida: '0.8 A 0.85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100_000,
  descripcion: 'MOLCO LENGA',
  filaOrigen: 1,
};
const catalogo: Catalogo = { fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos: [molco] };

const dirs: string[] = [];
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-libre-'));
  dirs.push(dir);
  const llm = { interpretar: vi.fn(), verificarCifras: true };
  return { dir, llm, servicio: new Servicio(catalogo, llm, new Almacen(dir)) };
}
afterEach(async () => {
  vi.clearAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

const COCACOLA = 'añade a la cotización una cocacola bien fría de 593ml por $1.490';
const cocacola = (datos: Record<string, unknown> = {}) => ({
  modelo: 'cocacola',
  madera: null,
  ancho: null,
  alto: null,
  medida: null,
  cantidad: 1,
  tipoMedida: null,
  descripcion: 'Coca-Cola bien fría 593 ml',
  fuente: 'una cocacola bien fría de 593ml por $1.490',
  precio: { valor: 1490, iva: null },
  libre: true,
  ...datos,
});
const molcos = {
  modelo: 'MOLCO',
  madera: 'LENGA',
  ancho: 0.8,
  alto: 2,
  medida: null,
  cantidad: 2,
  tipoMedida: 'hoja',
  fuente: '2 Molco lenga 80x200',
};
const agregar = (...items: Record<string, unknown>[]) => ({ name: 'modificar_cotizacion', input: { agregar: items } });

describe('ítem libre desde el chat', () => {
  it('lo que no es carpintería se cotiza con su nombre y precio, sin madera ni fábrica y sin aviso de ceros', async () => {
    const { servicio, llm } = await setup();
    llm.interpretar.mockResolvedValueOnce(agregar(cocacola()));
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje: COCACOLA });
    const [s] = r.cotizacion.solicitudes;
    expect(s).toMatchObject({
      modelo: 'cocacola',
      madera: null,
      ancho: null,
      alto: null,
      cantidad: 1,
      precioUnitario: 1490,
      descripcion: 'Coca-Cola bien fría 593 ml',
      personalizado: { familia: 'OTRO' },
    });
    expect(s).not.toHaveProperty('libre');
    expect(s).not.toHaveProperty('precio');
    expect(r.cotizacion.incompletos).toEqual([]);
    expect(r.cotizacion.montos.lineas[0]).toMatchObject({
      precioUnitario: 1490,
      total: 1490,
      descripcionDocumento: 'Coca-Cola bien fría 593 ml',
      producto: { codigo: 'OTRO', familia: 'OTRO', madera: '' },
    });
    expect(r.cotizacion.montos).toMatchObject({ subtotal: 1490, neto: 1490, iva: 283, total: 1773 });
    expect(r.avisos).toContainEqual(expect.stringMatching(/«cocacola» como ítem libre a \$1\.490 sin IVA c\/u: no va a fábrica/));
    expect(r.avisos?.some((a) => /faltan ceros/.test(a))).toBe(false);
  });

  it('la marca de libre nunca reemplaza un modelo del catálogo', async () => {
    const { servicio, llm } = await setup();
    llm.interpretar.mockResolvedValueOnce(agregar({ ...molcos, libre: true }));
    const q = (await servicio.ejecutar({ tipo: 'chat', mensaje: '2 Molco lenga 80x200' })).cotizacion;
    expect(q.solicitudes[0].personalizado).toBeFalsy();
    expect(q.montos.lineas[0].producto.codigo).toBe('MOL-L-0.8-2');
  });

  it('sin precio queda pendiente pidiendo solo el precio, y se completa por chat', async () => {
    const { servicio, llm } = await setup();
    const mensaje = 'agrega 2 bebidas';
    llm.interpretar.mockResolvedValueOnce(
      agregar(cocacola({ modelo: 'bebidas', descripcion: null, cantidad: 2, fuente: mensaje, precio: undefined })),
    );
    const r = await servicio.ejecutar({ tipo: 'chat', mensaje });
    let q = r.cotizacion;
    expect(q.solicitudes[0].personalizado).toEqual({ familia: 'OTRO' });
    expect(q.incompletos).toHaveLength(1);
    expect(q.incompletos[0].pregunta).toBe('Indica el precio y la cantidad de «bebidas».');
    expect(r.avisos).toContainEqual(expect.stringMatching(/«bebidas» como ítem libre \(no va a fábrica\)\. Indica su precio/));
    const cambio = 'las bebidas a $1.200 c/u';
    llm.interpretar.mockResolvedValueOnce({
      name: 'modificar_cotizacion',
      input: { items: [{ indice: 0, cambios: { precio: { valor: 1200, iva: 'neto' }, fuente: cambio } }] },
    });
    q = (await servicio.ejecutar({ tipo: 'chat', id: q.id, actualizada: q.actualizada, mensaje: cambio })).cotizacion;
    expect(q.incompletos).toEqual([]);
    expect(q.montos.lineas[0]).toMatchObject({ cantidad: 2, precioUnitario: 1200, total: 2400 });
  });
});

describe('ítem libre en la cotización', () => {
  it('no cuenta como puerta para el descuento por cantidad ni forma parte del bulto', () => {
    const libre = { producto: { familia: 'OTRO' as const }, cantidad: 50 };
    expect(contarPuertas([libre, { producto: { familia: 'PUERTA' }, cantidad: 2 }])).toBe(2);
    const r = calcularBulto(
      [{ producto: { ...molco, codigo: 'OTRO', familia: 'OTRO', madera: '' }, cantidad: 3, anchoSolicitado: null, altoSolicitado: null }],
      null,
    );
    expect(r).toMatchObject({ ok: false, motivo: 'sin_productos' });
  });

  it('se agrega a mano sin madera, sobrevive a la base y no lleva costo de fábrica', async () => {
    const { servicio, dir } = await setup();
    let q = (
      await servicio.ejecutar({
        tipo: 'agregar_personalizado',
        item: { nombre: 'Instalación', familia: 'OTRO', madera: '', cantidad: 1, precioUnitario: 45000, ancho: 0.8 },
      })
    ).cotizacion;
    expect(q.solicitudes[0]).toMatchObject({ modelo: 'Instalación', madera: null, ancho: null, personalizado: { familia: 'OTRO' } });
    expect(q.montos.lineas[0]).toMatchObject({ precioUnitario: 45000, producto: { codigo: 'OTRO' } });
    await expect(
      servicio.ejecutar({
        tipo: 'editar',
        id: q.id,
        actualizada: q.actualizada,
        items: [{ indice: 0, cambios: { costoFabrica: 20000 } }],
      }),
    ).rejects.toThrow(/no lleva costo de fábrica/);
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    q = new Almacen(dir).obtener(q.id)!;
    expect(q.solicitudes[0].personalizado).toEqual({ familia: 'OTRO' });
    expect(q.montos.lineas[0].producto).toMatchObject({ familia: 'OTRO', madera: '' });
  });

  it('un pendiente que no está en el catálogo pasa a ítem libre y suelta su madera y medidas', async () => {
    const { servicio, llm } = await setup();
    const mensaje = '1 parrilla lenga de 80x200';
    llm.interpretar.mockResolvedValueOnce(
      agregar({ ...molcos, modelo: 'parrilla', cantidad: 1, fuente: mensaje }),
    );
    let q = (await servicio.ejecutar({ tipo: 'chat', mensaje })).cotizacion;
    expect(q.incompletos).toHaveLength(1);
    q = (
      await servicio.ejecutar({
        tipo: 'editar',
        id: q.id,
        actualizada: q.actualizada,
        items: [{ indice: 0, cambios: { personalizado: { familia: 'OTRO' }, precioUnitario: 25000 } }],
      })
    ).cotizacion;
    expect(q.incompletos).toEqual([]);
    expect(q.solicitudes[0]).toMatchObject({ madera: null, ancho: null, alto: null, fabrica: null });
  });
});

describe('ítem libre y las notas de pedido', () => {
  async function aprobada(items: Record<string, unknown>[], mensaje: string) {
    const t = await setup();
    t.llm.interpretar.mockResolvedValueOnce({
      name: 'modificar_cotizacion',
      input: { agregar: items, cliente: { nombre: 'Ana Soto' } },
    });
    let q = (await t.servicio.ejecutar({ tipo: 'chat', mensaje })).cotizacion;
    q = (await t.servicio.ejecutar({ tipo: 'emitir', id: q.id, actualizada: q.actualizada })).cotizacion;
    q = (await t.servicio.ejecutar({ tipo: 'aprobar', id: q.id, actualizada: q.actualizada })).cotizacion;
    q = (
      await t.servicio.ejecutar({ tipo: 'pago', id: q.id, actualizada: q.actualizada, monto: Math.ceil(q.montos.total * 0.5) })
    ).cotizacion;
    return { ...t, q };
  }

  it('no va en ninguna nota ni recibe la fábrica por omisión', async () => {
    const { servicio, q: aprobadaQ } = await aprobada(
      [molcos, cocacola()],
      `2 Molco lenga 80x200 para Ana Soto y ${COCACOLA}`,
    );
    expect(aprobadaQ.montos.lineas).toHaveLength(2);
    const q = (
      await servicio.ejecutar({ tipo: 'generar_nota', fabrica: 'panguipulli', id: aprobadaQ.id, actualizada: aprobadaQ.actualizada })
    ).cotizacion;
    expect(q.notas).toHaveLength(1);
    expect(q.notas[0].montos.lineas.map((l) => l.indice)).toEqual([0]);
    expect(q.solicitudes.map((s) => s.fabrica ?? null)).toEqual(['panguipulli', null]);
  });

  it('una cotización con solo ítems libres lo dice en vez de pedir fábricas', async () => {
    const { servicio, q } = await aprobada([cocacola()], `${COCACOLA} para Ana Soto`);
    await expect(
      servicio.ejecutar({ tipo: 'generar_nota', fabrica: 'panguipulli', id: q.id, actualizada: q.actualizada }),
    ).rejects.toThrow(/solo tiene ítems libres, que no van a fábrica/);
  });
});

describe('migración v28', () => {
  it('agrega la marca de ítem libre a una base v27 sin tocar lo existente', async () => {
    const { servicio, dir } = await setup();
    const q = (
      await servicio.ejecutar({
        tipo: 'agregar_personalizado',
        item: { nombre: 'Puerta doble', familia: 'PUERTA', madera: 'Roble', cantidad: 1, precioUnitario: 450000 },
      })
    ).cotizacion;
    const db = new Almacen(dir).baseDatos();
    db.exec('ALTER TABLE solicitudes DROP COLUMN item_libre; PRAGMA user_version = 27;');
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    const almacen = new Almacen(dir);
    expect(almacen.baseDatos().pragma('user_version', { simple: true })).toBe(VERSION_ESQUEMA);
    expect(almacen.obtener(q.id)!.solicitudes[0].personalizado).toEqual({ familia: 'PUERTA' });
  });
});

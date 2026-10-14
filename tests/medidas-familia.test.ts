import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { resolverItem } from '../src/catalogo/resolver';
import { clienteVacio, type Catalogo, type Producto } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { ServicioAltaCatalogo } from '../src/servidor/alta-catalogo';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { guardarCatalogo, RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

/**
 * Rango de medidas por familia (K1): una puerta mide de 0,3 a 3 m; el largo de un accesorio, de 0,3 a 6 m. Un
 * guardapolvo de 3,6 m se lee, se cotiza, se muestra y se rechaza con el rango de su familia.
 */
const guardapolvo = (largo: number): Producto => ({
  codigo: `GUA-O-12X1-${largo}`,
  modelo: 'GUARDAPOLVO',
  familia: 'MOLDURA',
  tipo: null,
  madera: 'PINO OREGON',
  medida: '12X1',
  anchoMin: null,
  anchoMax: null,
  largo,
  precioNeto: 5_000,
  descripcion: `GUARDAPOLVO PINO OREGON 12X1 ${largo} MT`,
  filaOrigen: 3,
});
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
  precioNeto: 100_000,
  descripcion: 'MOLCO PINO OREGON 0,80 A 0,85 MT X 2 MT',
  filaOrigen: 4,
};
const marco = (madera: string, medida: string): Producto => ({
  codigo: `MAR-${madera[0]}-${medida}`,
  modelo: 'MARCO',
  familia: 'MARCO',
  tipo: 'PULG KIT',
  madera,
  medida,
  anchoMin: null,
  anchoMax: null,
  largo: 2.4,
  precioNeto: 20_000,
  descripcion: `MARCO ${madera} ${medida}`,
  filaOrigen: 5,
});
const catalogo = (): Catalogo => ({
  fuente: 'test.xlsx',
  sha256: 'familias',
  fecha: '2026-01-01T00:00:00.000Z',
  // Marcos: en pino oregón hay 2x4 y 2x6; en lenga, 2x5.
  productos: [
    puerta,
    guardapolvo(2.4),
    guardapolvo(3.6),
    marco('PINO OREGON', '2X4'),
    marco('PINO OREGON', '2X6'),
    marco('LENGA', '2X5'),
  ],
});

const dirs: string[] = [];
let db: Database.Database | undefined;
afterEach(async () => {
  if (db?.open) db.close();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});
async function setup(anclaje: 'avisar' | 'corregir' = 'avisar') {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-familias-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const llm = { interpretar: vi.fn(), verificarCifras: true, anclaje };
  const servicio = new Servicio(catalogo(), llm, almacen);
  const chat = async (mensaje: string, item: Record<string, unknown>) => {
    llm.interpretar.mockResolvedValueOnce({
      name: 'actualizar_cotizacion',
      input: { items: [item], cliente: clienteVacio() },
    });
    return servicio.ejecutar({ tipo: 'chat', mensaje });
  };
  const actividad = (id: string) => almacen.eventos(id).map((e) => e.detalle ?? '');
  return { almacen, servicio, chat, actividad };
}

describe('el largo de un accesorio de más de 3 m en el chat', () => {
  const fuente = '2 guardapolvos 12x1 pino de 360';
  const pedido = (alto: number) => ({
    modelo: 'GUARDAPOLVO',
    madera: 'PINO OREGON',
    ancho: null,
    alto,
    medida: '12x1',
    cantidad: 2,
    fuente,
  });

  for (const anclaje of ['avisar', 'corregir'] as const)
    it(`«de 360» se cotiza como 3,6 m, sin avisos y con la actividad en metros (modo ${anclaje})`, async () => {
      const { chat, actividad } = await setup(anclaje);
      for (const alto of [3.6, 360]) {
        const r = await chat(`cotiza ${fuente}`, pedido(alto));
        expect(r.avisos ?? [], `alto ${alto}`).toEqual([]);
        expect(r.cotizacion.incompletos, `alto ${alto}`).toEqual([]);
        expect(r.cotizacion.montos.lineas.map((l) => [l.producto.codigo, l.altoSolicitado])).toEqual([
          ['GUA-O-12X1-3.6', 3.6],
        ]);
        // Antes la actividad mostraba «0,36» para un largo guardado como 360.
        expect(actividad(r.cotizacion.id).join('\n')).toContain('2 × GUARDAPOLVO PINO OREGON 12X1 × 3,60');
      }
    });

  for (const anclaje of ['avisar', 'corregir'] as const)
    it(`sin la sección todavía, el largo de 3,6 m se respalda con el rango de su modelo (modo ${anclaje})`, async () => {
      // Sin sección, solo el catálogo dice que un guardapolvo es un accesorio: antes «360» no respaldaba 3,6 m y el
      // largo quedaba pendiente con el aviso «esa cifra no aparece en tu mensaje».
      const { chat } = await setup(anclaje);
      const frase = '2 guardapolvos pino de 360';
      const r = await chat(`cotiza ${frase}`, { ...pedido(3.6), medida: null, fuente: frase });
      expect(r.avisos ?? []).toEqual([]);
      expect(r.cotizacion.solicitudes[0]).toMatchObject({ alto: 3.6, medida: null });
      expect(r.cotizacion.incompletos.map((p) => p.rechazo)).toEqual([
        expect.objectContaining({ tipo: 'faltan_datos', campos: ['medida'] }),
      ]);
    });
});

describe('respuesta directa y escuadría «de N» con el catálogo del servidor', () => {
  it('«3,6 m» responde el largo pendiente de un guardapolvo sin sección, sin consultar a la IA', async () => {
    const { chat, servicio } = await setup('corregir');
    const frase = '2 guardapolvos pino';
    const item = { modelo: 'GUARDAPOLVO', madera: 'PINO OREGON', ancho: null, alto: null, medida: null, cantidad: 2 };
    const q = (await chat(`cotiza ${frase}`, { ...item, fuente: frase })).cotizacion;
    expect(q.incompletos.map((p) => p.rechazo)).toEqual([
      expect.objectContaining({ tipo: 'faltan_datos', campos: ['medida', 'alto'] }),
    ]);
    const r = await servicio.ejecutar({ tipo: 'chat', id: q.id, actualizada: q.actualizada, mensaje: '3,6 m' });
    expect(r.cotizacion.solicitudes[0]).toMatchObject({ alto: 3.6 });
  });

  it('«de N» solo es la escuadría que el catálogo tiene para ese modelo y esa madera', async () => {
    const { chat } = await setup('avisar');
    const pedido = (frase: string, madera: string) => ({
      modelo: 'MARCO', madera, ancho: null, alto: 2.4, medida: null, cantidad: 6, fuente: frase,
    });
    // En pino no hay 2x5: el 5 no se lee como escuadría y no se avisa una sección que no existe.
    const pino = '6 marcos de 5 en pino de 2,4';
    expect((await chat(`cotiza ${pino}`, pedido(pino, 'PINO OREGON'))).avisos ?? []).toEqual([]);
    // En lenga sí: el aviso dice la sección que parece decir el mensaje.
    const lenga = '6 marcos de 5 en lenga de 2,4';
    expect((await chat(`cotiza ${lenga}`, pedido(lenga, 'LENGA'))).avisos).toEqual([
      'Revisa el ítem 1 (MARCO): tu mensaje parece decir la sección «2X5» y no lo anoté.',
    ]);
  });
});

describe('pedido especial de un accesorio', () => {
  const especial = (alto: number) => ({
    nombre: 'Guardapolvo curvo',
    familia: 'MOLDURA' as const,
    madera: 'Raulí',
    ancho: null,
    alto,
    cantidad: 3,
    precioUnitario: 12_000,
  });

  it('acepta un largo de hasta 6 m y, sobre eso, el mensaje da el rango de su familia', async () => {
    const { servicio } = await setup();
    const q = (await servicio.ejecutar({ tipo: 'agregar_personalizado', item: especial(3.2) } as never)).cotizacion;
    expect(q.montos.lineas.map((l) => [l.producto.codigo, l.altoSolicitado])).toEqual([['ESPECIAL', 3.2]]);
    await expect(
      servicio.ejecutar({ tipo: 'agregar_personalizado', id: q.id, actualizada: q.actualizada, item: especial(7) } as never),
    ).rejects.toThrow('Revisa las medidas: escríbelas en metros, entre 0,3 y 6 (por ejemplo un largo de 3,60).');
    // Una puerta especial conserva su rango y su ejemplo.
    await expect(
      servicio.ejecutar({
        tipo: 'agregar_personalizado',
        id: q.id,
        actualizada: q.actualizada,
        item: { ...especial(3.2), familia: 'PUERTA', ancho: 0.9 },
      } as never),
    ).rejects.toThrow('Revisa las medidas: escríbelas en metros, entre 0,3 y 3 (por ejemplo 0,80 × 2,10).');
  });
});

describe('mensajes de rango según la familia', () => {
  it('una medida implausible dice el rango de su familia', () => {
    const largo = resolverItem(catalogo(), { modelo: 'GUARDAPOLVO', madera: 'PINO OREGON', medida: '12x1', alto: 7, cantidad: 1 });
    expect(largo).toMatchObject({
      ok: false,
      rechazo: { tipo: 'medida_implausible', campo: 'alto', disponibles: ['0,3 a 6 m (o 30 a 600 cm)'] },
    });
    const ancho = resolverItem(catalogo(), { modelo: 'MOLCO', madera: 'PINO OREGON', ancho: 4, alto: 2, cantidad: 1 });
    expect(ancho).toMatchObject({
      ok: false,
      rechazo: { tipo: 'medida_implausible', campo: 'ancho', disponibles: ['0,3 a 3 m (o 30 a 300 cm)'] },
    });
    // 3,5 m es un largo de guardapolvo que no está en el catálogo, no una medida implausible.
    const sinPrecio = resolverItem(catalogo(), { modelo: 'GUARDAPOLVO', madera: 'PINO OREGON', medida: '12x1', alto: 3.5, cantidad: 1 });
    expect(sinPrecio.ok ? null : sinPrecio.rechazo.tipo).not.toBe('medida_implausible');
  });

  it('el alta de un producto rechaza un largo fuera del rango de su familia diciendo cuál es', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-familias-alta-'));
    dirs.push(dir);
    db = abrirBaseDatos(join(dir, 'cotizador.sqlite'), { cachear: false });
    guardarCatalogo(db, catalogo());
    const alta = new ServicioAltaCatalogo(db, new RepositorioCatalogoSqlite(db), {
      interpretar: vi.fn(),
      interpretarProducto: vi.fn().mockRejectedValue(new Error('no')),
    });
    const moldura = {
      modelo: 'CORNISA',
      familia: 'MOLDURA' as const,
      madera: 'pino oregon',
      tipo: null,
      medida: '12x1',
      anchoMin: null,
      anchoMax: null,
      precioNeto: 9_000,
    };
    // Antes decía «debe ser mayor que cero», aunque el problema era pasar del tope.
    expect(() => alta.proponerManual(undefined, { ...moldura, largo: 7 }, 'u1')).toThrow('El largo debe estar entre 0,3 y 6 m.');
    expect(() =>
      alta.proponerManual(
        undefined,
        { ...moldura, modelo: 'MOLCO', familia: 'PUERTA', medida: null, anchoMin: 0.9, anchoMax: 0.95, largo: 3.5 },
        'u1',
      ),
    ).toThrow('El alto debe estar entre 0,3 y 3 m.');
    expect(alta.proponerManual(undefined, { ...moldura, largo: 3.6 }, 'u1').propuesta).toMatchObject({
      familia: 'MOLDURA',
      largo: 3.6,
    });
  });
});

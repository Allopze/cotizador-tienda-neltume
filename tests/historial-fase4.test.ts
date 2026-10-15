import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clienteVacio, type Catalogo, type Producto } from '../src/catalogo/tipos';
import { parametros, partesCsv } from '../src/app/historial';

// Historial (Fase 4 del plan): CSV por partes (#28), papelera paginada con búsqueda en el servidor y plazo (#27),
// filtros por seguimiento comercial, operación y vendedora. Base propia y sesión simulada.

vi.mock('../src/servidor/acceso-autenticado', () => ({
  exigirSesion: vi.fn(async () => ({
    ok: true,
    usuario: { id: 'u1', email: 'paula@neltume.test', nombre: 'Paula', rol: 'admin' },
  })),
}));
vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));
// Dos filas por archivo en vez de 5.000: el corte se prueba con pocas cotizaciones.
vi.mock('../src/servidor/exportar', async (original) => ({
  ...(await original<typeof import('../src/servidor/exportar')>()),
  MAX_EXPORTACION: 2,
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

let directorio: string | undefined;
afterEach(async () => {
  if (directorio) (await import('../src/servidor/almacen')).cerrarAlmacen();
  vi.unstubAllEnvs();
  vi.resetModules();
  if (directorio) await rm(directorio, { recursive: true, force: true });
  directorio = undefined;
});

async function montar() {
  directorio = await mkdtemp(join(tmpdir(), 'neltume-historial-fase4-'));
  vi.stubEnv('NELTUME_DATA_DIR', directorio);
  vi.stubEnv('NELTUME_DB_PATH', join(directorio, 'cotizador.sqlite'));
  const { GET } = await import('../src/app/api/accion/route');
  const { Almacen } = await import('../src/servidor/almacen');
  const { Servicio } = await import('../src/servidor/servicio');
  const almacen = new Almacen();
  const llm = { interpretar: vi.fn() };
  const servicioDe = (nombre: string) => new Servicio(catalogo, llm, almacen, { nombre, email: `${nombre}@neltume.test` });
  /** Borrador con un producto y este cliente, creado por `vendedora`. */
  const crear = async (cliente: string, vendedora = 'Paula') => {
    const servicio = servicioDe(vendedora);
    const { cotizacion: q } = await servicio.ejecutar({ tipo: 'agregar_producto', codigo: 'MOL-O-3-A', cantidad: 1, ancho: 0.82, alto: 2 });
    return (
      await servicio.ejecutar({
        tipo: 'editar',
        id: q.id,
        actualizada: q.actualizada,
        cliente: { ...clienteVacio(), nombre: cliente, comuna: 'Osorno' },
      })
    ).cotizacion;
  };
  const get = async (consulta: string) => {
    const r = await GET(new Request(`http://127.0.0.1:3000/api/accion?${consulta}`));
    const tipo = r.headers.get('content-type') ?? '';
    return {
      status: r.status,
      cache: r.headers.get('cache-control'),
      disposicion: r.headers.get('content-disposition'),
      cuerpo: tipo.includes('json') ? await r.json() : await r.text(),
    };
  };
  return { almacen, servicio: servicioDe('Paula'), crear, get, db: almacen.baseDatos() };
}

describe('#28 · CSV por partes', () => {
  it('sin parte avisa cuántas hay y en cuántas partes; cada parte trae su tramo y nunca se corta en silencio', async () => {
    const m = await montar();
    for (const nombre of ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco']) await m.crear(`Cliente ${nombre}`);

    const aviso = await m.get('formato=csv');
    expect(aviso.status).toBe(409);
    expect(aviso.cache).toBe('no-store');
    expect(aviso.cuerpo).toMatchObject({
      codigo: 'exportacion_por_partes',
      detalle: { total: 5, partes: 3, porParte: 2 },
    });
    expect(aviso.cuerpo.error).toContain('Hay 5 cotizaciones');

    const clientes = (csv: string) =>
      csv
        .replace(/^﻿/, '')
        .split('\r\n')
        .slice(1)
        .map((l) => l.split(';')[6]);
    const partes = [];
    for (const parte of [1, 2, 3]) {
      const r = await m.get(`formato=csv&parte=${parte}`);
      expect(r.status).toBe(200);
      expect(r.disposicion).toMatch(new RegExp(`filename="cotizaciones-\\d{4}-\\d{2}-\\d{2}-parte-${parte}-de-3\\.csv"`));
      partes.push(clientes(r.cuerpo));
    }
    // En el orden del historial (la más reciente primero), sin repetir ni saltar ninguna.
    expect(partes).toEqual([
      ['Cliente Cinco', 'Cliente Cuatro'],
      ['Cliente Tres', 'Cliente Dos'],
      ['Cliente Uno'],
    ]);
    expect(await m.get('formato=csv&parte=4')).toMatchObject({ status: 400, cuerpo: { codigo: 'solicitud_invalida' } });

    // Con filtros que dejan dos o menos, un solo archivo como antes, sin «parte» en el nombre.
    const filtrado = await m.get('formato=csv&q=cinco');
    expect(filtrado.status).toBe(200);
    expect(filtrado.disposicion).toMatch(/filename="cotizaciones-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(clientes(filtrado.cuerpo)).toEqual(['Cliente Cinco']);
  });

  it('la pantalla calcula las partes con el total del listado', () => {
    expect(partesCsv(5000, 5000)).toBeNull();
    expect(partesCsv(12_001, 5000)).toEqual([
      { parte: 1, desde: 1, hasta: 5000 },
      { parte: 2, desde: 5001, hasta: 10_000 },
      { parte: 3, desde: 10_001, hasta: 12_001 },
    ]);
    // Por omisión, el mismo tamaño que el servidor (aquí, el simulado de 2).
    expect(partesCsv(5)?.map((p) => p.hasta)).toEqual([2, 4, 5]);
  });
});

describe('#27 · papelera paginada', () => {
  it('pagina, busca en el servidor (cliente, comuna o producto) y dice en cuántos días se vacía', async () => {
    const m = await montar();
    const ids: string[] = [];
    for (const nombre of ['Ana Soto', 'Bruno Díaz', 'Carla Ríos']) {
      const q = await m.crear(nombre);
      await m.servicio.ejecutar({ tipo: 'eliminar', id: q.id, actualizada: q.actualizada });
      ids.push(q.id);
    }
    const primera = await m.get('papelera=1&porPagina=2');
    expect(primera.status).toBe(200);
    expect(primera.cache).toBe('no-store');
    expect(primera.cuerpo).toMatchObject({ total: 3, pagina: 1, porPagina: 2, plazoDias: 30 });
    // Del eliminado más reciente al más antiguo.
    expect(primera.cuerpo.borradores.map((b: { id: string }) => b.id)).toEqual([ids[2], ids[1]]);
    const segunda = await m.get('papelera=1&porPagina=2&pagina=2');
    expect(segunda.cuerpo.borradores.map((b: { id: string }) => b.id)).toEqual([ids[0]]);

    // Sin tildes ni mayúsculas; el total es el de lo que coincide.
    const diaz = await m.get('papelera=1&q=bruno%20diaz');
    expect(diaz.cuerpo).toMatchObject({ total: 1, borradores: [{ id: ids[1] }] });
    expect((await m.get('papelera=1&q=molco%20osorno')).cuerpo.total).toBe(3);
    expect((await m.get('papelera=1&q=nadie')).cuerpo).toMatchObject({ total: 0, borradores: [] });

    // Más de 200 por página o una página inválida: solicitud inválida, sin caché.
    expect(await m.get('papelera=1&porPagina=500')).toMatchObject({ status: 400, cache: 'no-store' });
    expect(await m.get('papelera=1&pagina=0')).toMatchObject({ status: 400 });
  });
});

describe('Historial · filtros por seguimiento, operación y vendedora', () => {
  it('filtra en el servidor por estado comercial, operativo y por quien creó la cotización', async () => {
    const m = await montar();
    const seguimiento = await m.crear('Cliente Seguimiento');
    const rechazada = await m.crear('Cliente Rechazada', 'Rocío');
    const anulada = await m.crear('Cliente Anulada', 'Rocío');
    const produccion = await m.crear('Cliente Producción');
    const antigua = await m.crear('Cliente Antigua');
    const despachada = await m.crear('Cliente Despachada', 'Rocío');
    const fijar = (id: string, columnas: Record<string, string>) =>
      m.db
        .prepare(`UPDATE cotizaciones SET ${Object.keys(columnas).map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`)
        .run({ ...columnas, id });
    fijar(seguimiento.id, { estado_comercial: 'seguimiento' });
    fijar(rechazada.id, { estado_comercial: 'rechazada' });
    // Una anulada se muestra como «Rechazada / cancelada» aunque su columna diga otra cosa.
    fijar(anulada.id, { estado: 'anulada', estado_comercial: 'enviada' });
    fijar(produccion.id, { estado: 'aprobada', estado_operativo: 'en_produccion' });
    // Dato antiguo: «produccion_terminada» se lee como «en_produccion».
    fijar(antigua.id, { estado: 'aprobada', estado_operativo: 'produccion_terminada' });
    fijar(despachada.id, { estado: 'aprobada', estado_operativo: 'despachada' });

    const nombres = async (consulta: string) => {
      const r = await m.get(consulta);
      expect(r.status, consulta).toBe(200);
      return r.cuerpo.cotizaciones.map((q: { cliente: { nombre: string } }) => q.cliente.nombre).sort();
    };
    expect(await nombres('comercial=seguimiento')).toEqual(['Cliente Seguimiento']);
    expect(await nombres('comercial=rechazada')).toEqual(['Cliente Anulada', 'Cliente Rechazada']);
    expect(await nombres('operativo=en_produccion')).toEqual(['Cliente Antigua', 'Cliente Producción']);
    expect(await nombres('operativo=despachada,lista_despacho')).toEqual(['Cliente Despachada']);
    expect(await nombres('vendedora=Roc%C3%ADo')).toEqual(['Cliente Anulada', 'Cliente Despachada', 'Cliente Rechazada']);
    // Se combinan entre sí y con el resto de los filtros.
    expect(await nombres('vendedora=Roc%C3%ADo&comercial=rechazada&estado=anulada')).toEqual(['Cliente Anulada']);
    expect(await nombres('vendedora=Nadie')).toEqual([]);
    // Un valor que no existe es un filtro inválido, no un listado vacío.
    expect(await m.get('comercial=perdida')).toMatchObject({ status: 400, cuerpo: { codigo: 'solicitud_invalida' } });
    expect(await m.get('operativo=fabricando')).toMatchObject({ status: 400 });
    // También acota la exportación.
    const csv = await m.get('formato=csv&vendedora=Paula&operativo=en_produccion');
    expect(csv.status).toBe(200);
    expect(csv.cuerpo.split('\r\n')).toHaveLength(3);

    // La lista de vendedoras del filtro, sin repetir y en orden alfabético.
    const vendedoras = await m.get('vendedoras=1');
    expect(vendedoras).toMatchObject({ status: 200, cache: 'no-store', cuerpo: { vendedoras: ['Paula', 'Rocío'] } });
    expect((await m.get('vendedoras=si')).status).toBe(400);
  });

  it('la pantalla pide los filtros nuevos al servidor', () => {
    const base = { q: '', estado: 'todas' as const, desde: '', hasta: '' };
    expect(parametros({ ...base, comercial: 'seguimiento', operativo: 'despachada', vendedora: 'Rocío' }).toString()).toBe(
      'comercial=seguimiento&operativo=despachada&vendedora=Roc%C3%ADo',
    );
    expect(parametros({ ...base, comercial: '', operativo: '', vendedora: '' }).toString()).toBe('');
  });
});

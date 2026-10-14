import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Catalogo, Cliente } from '../src/catalogo/tipos';
import { digitoVerificador } from '../src/negocio/cliente';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { buscarClientes, MAX_CLIENTES } from '../src/servidor/clientes';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));
const exigirSesion = vi.fn();
vi.mock('../src/servidor/acceso-autenticado', () => ({ exigirSesion: (req: Request) => exigirSesion(req) }));

const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  exigirSesion.mockReset();
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

const catalogo: Catalogo = {
  fuente: 'test.xlsx', sha256: 'catalogo-test', fecha: '2026-01-01T00:00:00.000Z',
  productos: [{
    codigo: 'HUI-M-3-A', modelo: 'Huilo Huilo', familia: 'PUERTA', tipo: 'PUERTA SÓLIDA', madera: 'MARA',
    medida: '0,80 A 0,85', anchoMin: 0.8, anchoMax: 0.85, altoMin: 2.3, altoMax: 2.4, largo: 2.35,
    precioNeto: 100_000, descripcion: 'HUILO HUILO MARA 0,80 A 0,85 MT X 2,30 A 2,40 MT', filaOrigen: 7,
  }],
};
/** RUT válido («12.345.678-5») a partir del cuerpo. */
const rut = (cuerpo: string) => `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${digitoVerificador(cuerpo)}`;

async function base() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-clientes-'));
  dirs.push(dir);
  const almacen = new Almacen(dir);
  const servicio = new Servicio(catalogo, { interpretar: vi.fn() }, almacen);
  /** Cotización nueva con este cliente; cada una queda más reciente que la anterior. */
  const crear = async (cliente: Partial<Cliente>) => {
    const { cotizacion: q } = await servicio.ejecutar({
      tipo: 'agregar_producto', codigo: 'HUI-M-3-A', cantidad: 1, ancho: 0.82, alto: 2.35,
    });
    return (await servicio.ejecutar({ tipo: 'editar', id: q.id, actualizada: q.actualizada, cliente })).cotizacion;
  };
  return { dir, db: almacen.baseDatos(), crear };
}

describe('clientes de cotizaciones anteriores (autocompletar)', () => {
  it('busca por nombre sin tildes ni mayúsculas, más recientes primero y sin repetir un cliente', async () => {
    const { db, crear } = await base();
    await crear({ nombre: 'Juan Pérez', rut: rut('12345678'), giro: 'Construcción', comuna: 'Temuco' });
    await crear({ nombre: 'Juana Soto', rut: rut('9876543'), comuna: 'Osorno' });
    // La cotización más reciente de Juan Pérez trae otro teléfono y no repite el giro.
    await crear({ nombre: 'JUAN PEREZ', rut: rut('12345678'), telefono: '+56 9 1111 2222', direccion: 'Los Aromos 12' });
    const clientes = buscarClientes(db, 'juan');
    expect(clientes.map((c) => c.nombre)).toEqual(['JUAN PEREZ', 'Juana Soto']);
    // Lo más reciente manda y lo anterior completa lo que falta.
    expect(clientes[0]).toEqual({
      nombre: 'JUAN PEREZ', rut: rut('12345678'), giro: 'Construcción', telefono: '+56 9 1111 2222',
      direccion: 'Los Aromos 12', comuna: 'Temuco',
    });
    expect(buscarClientes(db, 'pérez juan').map((c) => c.rut)).toEqual([rut('12345678')]);
    expect(buscarClientes(db, 'soto').map((c) => c.nombre)).toEqual(['Juana Soto']);
  });

  it('busca por RUT con o sin puntos y guion', async () => {
    const { db, crear } = await base();
    await crear({ nombre: 'Constructora Sur', rut: rut('76543210') });
    await crear({ nombre: 'Otra Empresa', rut: rut('11222333') });
    for (const q of ['76543210', '76.543', rut('76543210')])
      expect(buscarClientes(db, q).map((c) => c.nombre), q).toEqual(['Constructora Sur']);
  });

  it('un mismo nombre sin RUT es el mismo cliente; con RUT distinto son dos', async () => {
    const { db, crear } = await base();
    await crear({ nombre: 'Pedro Rojas', rut: rut('15111222'), comuna: 'Valdivia' });
    await crear({ nombre: 'Pedro Rojas', rut: rut('16333444') });
    await crear({ nombre: 'Pedro  Rojas', telefono: '555' });
    const clientes = buscarClientes(db, 'pedro');
    // El más reciente (sin RUT) toma el RUT del anterior; el de otro RUT queda aparte.
    expect(clientes).toEqual([
      expect.objectContaining({ nombre: 'Pedro Rojas', rut: rut('16333444'), telefono: '555' }),
      expect.objectContaining({ nombre: 'Pedro Rojas', rut: rut('15111222'), comuna: 'Valdivia' }),
    ]);
  });

  it('a lo más 8, sin la cotización abierta y nada con menos de dos letras', async () => {
    const { db, crear } = await base();
    let ultima = null;
    for (let i = 1; i <= 10; i++) ultima = await crear({ nombre: `Cliente ${String.fromCharCode(64 + i)} Ríos` });
    const clientes = buscarClientes(db, 'rios');
    expect(clientes).toHaveLength(MAX_CLIENTES);
    expect(clientes[0].nombre).toBe('Cliente J Ríos');
    expect(buscarClientes(db, 'rios', { excluir: ultima!.id })[0].nombre).toBe('Cliente I Ríos');
    expect(buscarClientes(db, 'r')).toEqual([]);
    expect(buscarClientes(db, '')).toEqual([]);
    // Los comodines de LIKE se buscan como texto: no devuelven a todos.
    expect(buscarClientes(db, '%%')).toEqual([]);
    expect(buscarClientes(db, '__')).toEqual([]);
  });

  it('GET /api/clientes exige sesión y responde sin caché', async () => {
    const { dir, crear } = await base();
    await crear({ nombre: 'Marta Gómez', rut: rut('10111222'), giro: 'Arquitectura' });
    vi.stubEnv('NELTUME_DATA_DIR', dir);
    vi.stubEnv('NELTUME_DB_PATH', join(dir, 'cotizador.sqlite'));
    const { GET } = await import('../src/app/api/clientes/route');
    const pedir = (q: string) => GET(new Request(`http://127.0.0.1:3000/api/clientes?${q}`));

    exigirSesion.mockResolvedValue({ ok: false, respuesta: Response.json({ error: 'Debes iniciar sesión.' }, { status: 401 }) });
    expect((await pedir('q=marta')).status).toBe(401);

    exigirSesion.mockResolvedValue({ ok: true, usuario: { id: 'u1', email: 'a@b.cl', nombre: 'Ana', rol: 'user' } });
    const r = await pedir('q=marta');
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(await r.json()).toEqual({
      clientes: [{ nombre: 'Marta Gómez', rut: rut('10111222'), giro: 'Arquitectura', telefono: null, direccion: null, comuna: null }],
    });
    expect((await pedir(`q=${'x'.repeat(101)}`)).status).toBe(400);
    expect((await pedir('q=marta&excluir=no-es-uuid')).status).toBe(400);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Catalogo } from '../src/catalogo/tipos';

// Ruta de Catálogo sobre una base propia, con sesión simulada y la clave de la IA ilegible (secreto rotado).
const sesion = vi.hoisted(() => ({ rol: 'admin' }));
vi.mock('../src/servidor/acceso-autenticado', () => ({
  exigirSesion: vi.fn(async () => ({
    ok: true,
    usuario: { id: 'u1', email: 'paula@neltume.test', nombre: 'Paula', rol: sesion.rol },
  })),
}));
vi.mock('../src/servidor/ajustes-ia', async () => {
  const { ErrorIA } = await import('../src/asistente/errores');
  return {
    crearLLM: vi.fn(() => {
      throw new ErrorIA('ia_clave_ilegible', 'La clave de IA guardada ya no se puede leer. Vuelve a ingresarla en Ajustes.', 503);
    }),
  };
});

const catalogo: Catalogo = {
  fuente: 'test.xlsx',
  sha256: 'sha',
  fecha: '2026-01-01T00:00:00.000Z',
  productos: [
    {
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
    },
  ],
};
const molcoAngosta = {
  modelo: 'MOLCO',
  familia: 'PUERTA',
  madera: 'PINO OREGON',
  tipo: null,
  medida: null,
  anchoMin: 0.6,
  anchoMax: 0.65,
  largo: 2,
  precioNeto: 90000,
};

let directorio: string | undefined;
afterEach(async () => {
  if (directorio) (await import('../src/servidor/base-datos')).cerrarBaseDatos();
  vi.unstubAllEnvs();
  vi.resetModules();
  sesion.rol = 'admin';
  if (directorio) await rm(directorio, { recursive: true, force: true });
  directorio = undefined;
});

async function montar() {
  directorio = await mkdtemp(join(tmpdir(), 'neltume-catalogo-ruta-'));
  vi.stubEnv('NELTUME_DATA_DIR', directorio);
  vi.stubEnv('NELTUME_DB_PATH', join(directorio, 'cotizador.sqlite'));
  const { POST } = await import('../src/app/api/catalogo/route');
  const { abrirBaseDatos } = await import('../src/servidor/base-datos');
  const { guardarCatalogo, RepositorioCatalogoSqlite } = await import('../src/servidor/repositorio-catalogo');
  guardarCatalogo(abrirBaseDatos(), catalogo);
  const pedir = async (cuerpo: unknown) => {
    const r = await POST(
      new Request('http://127.0.0.1:3000/api/catalogo', {
        method: 'POST',
        body: JSON.stringify(cuerpo),
        headers: { 'content-type': 'application/json' },
      }),
    );
    return { status: r.status, cuerpo: await r.json(), cache: r.headers.get('cache-control') };
  };
  return { pedir, repo: () => new RepositorioCatalogoSqlite(abrirBaseDatos()) };
}

describe('Catálogo con la clave de IA ilegible', () => {
  it('el alta manual, cancelar y confirmar siguen funcionando; solo el alta asistida responde 503', async () => {
    const m = await montar();
    const propuesta = await m.pedir({ tipo: 'manual', producto: molcoAngosta });
    expect(propuesta.status).toBe(200);
    const cancelada = await m.pedir({ tipo: 'cancelar', id: propuesta.cuerpo.id });
    expect(cancelada).toMatchObject({ status: 200, cuerpo: { cancelado: true } });

    const otra = await m.pedir({ tipo: 'manual', producto: molcoAngosta });
    const confirmada = await m.pedir({ tipo: 'confirmar', id: otra.cuerpo.id });
    expect(confirmada).toMatchObject({ status: 200, cuerpo: { producto: { modelo: 'MOLCO', anchoMin: 0.6 } } });
    const codigo = confirmada.cuerpo.producto.codigo as string;
    expect(m.repo().listarManuales()[0]).toMatchObject({ codigo, creadaPor: 'Paula' });

    expect(await m.pedir({ tipo: 'mensaje', mensaje: 'Molco pino de 60 a 65, alto 2 m' })).toMatchObject({
      status: 503,
      cuerpo: { codigo: 'ia_clave_ilegible', error: expect.stringMatching(/Vuelve a ingresarla en Ajustes/) },
    });
  });
});

describe('papelera de productos agregados a mano', () => {
  it('lista los eliminados y los restaura con su autor y su fecha de alta', async () => {
    const m = await montar();
    const propuesta = await m.pedir({ tipo: 'manual', producto: molcoAngosta });
    const { producto } = (await m.pedir({ tipo: 'confirmar', id: propuesta.cuerpo.id })).cuerpo;
    const [alta] = m.repo().listarManuales();
    expect((await m.pedir({ tipo: 'eliminar', codigo: producto.codigo })).status).toBe(200);

    const eliminados = await m.pedir({ tipo: 'listar_eliminados' });
    expect(eliminados.cache).toBe('no-store');
    expect(eliminados.cuerpo.productos).toEqual([
      expect.objectContaining({ codigo: producto.codigo, creadaPor: 'Paula', creada: alta.creada, codigoOcupado: false }),
    ]);
    expect(await m.pedir({ tipo: 'restaurar', codigo: producto.codigo })).toMatchObject({
      status: 200,
      cuerpo: { producto: { codigo: producto.codigo } },
    });
    expect(m.repo().listarManuales()).toEqual([alta]);
    expect((await m.pedir({ tipo: 'listar_eliminados' })).cuerpo.productos).toEqual([]);
    expect(await m.pedir({ tipo: 'restaurar', codigo: producto.codigo })).toMatchObject({
      status: 404,
      cuerpo: { codigo: 'no_encontrada' },
    });
  });

  it('volver a la planilla anterior es solo para quien administra', async () => {
    const m = await montar();
    sesion.rol = 'user';
    expect(
      await m.pedir({ tipo: 'volver_planilla', origen: 'principal', versionCatalogo: m.repo().version }),
    ).toMatchObject({ status: 403, cuerpo: { codigo: 'sin_permiso' } });
  });
});

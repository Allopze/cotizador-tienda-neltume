import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// «Probar modelo» (Ajustes → Asistente) sobre una base propia, con la sesión de administración simulada.
vi.mock('../src/servidor/acceso-autenticado', () => ({
  exigirSesion: vi.fn(async () => ({
    ok: true,
    usuario: { id: 'admin', email: 'admin@neltume.test', nombre: 'Administración', rol: 'admin' },
  })),
}));
// Un catálogo con los modelos de los casos de prueba: la falla debe venir de la clave, no de un catálogo vacío.
vi.mock('../src/servidor/catalogo', async () => {
  const { CASOS_PRUEBA } = await import('../src/asistente/prueba-modelo');
  const modelos = [
    ...new Set(CASOS_PRUEBA.flatMap((c) => c.esperado.items.flatMap((i) => (i.modelo ? [i.modelo] : [])))),
  ];
  const productos = modelos.map((modelo, i) => ({
    codigo: `P-${i}`,
    modelo,
    familia: 'PUERTA',
    tipo: 'PUERTA PANEL',
    madera: 'LENGA',
    medida: '0,80 A 0,85',
    anchoMin: 0.8,
    anchoMax: 0.85,
    largo: 2,
    precioNeto: 100000,
    descripcion: modelo,
    filaOrigen: i + 1,
  }));
  return { cargarCatalogo: vi.fn(async () => ({ fuente: 'test', sha256: 'test', fecha: '2026-01-01', productos })) };
});

let directorio: string | undefined;
afterEach(async () => {
  if (directorio) (await import('../src/servidor/base-datos')).cerrarBaseDatos();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  if (directorio) await rm(directorio, { recursive: true, force: true });
  directorio = undefined;
});

describe('probar el modelo desde Ajustes', () => {
  it('con la clave guardada ilegible responde su mensaje y su estado, no un 500 genérico', async () => {
    directorio = await mkdtemp(join(tmpdir(), 'neltume-probar-'));
    vi.stubEnv('NELTUME_DATA_DIR', directorio);
    vi.stubEnv('NELTUME_DB_PATH', join(directorio, 'cotizador.sqlite'));
    vi.stubEnv('CMD_API_KEY', '');
    // Nunca se llega a la red: la prueba no gasta la cuota de ningún modelo.
    const red = vi.fn(async () => {
      throw new Error('Sin red en las pruebas.');
    });
    vi.stubGlobal('fetch', red);
    vi.stubEnv('BETTER_AUTH_SECRET', 'secreto-anterior-0123456789-abcdefghijklmn');
    const { guardarClaveCommandCode } = await import('../src/servidor/ajustes-ia');
    guardarClaveCommandCode('clave-de-prueba');
    // Se rotó el secreto de sesión: la clave guardada ya no se puede descifrar.
    vi.stubEnv('BETTER_AUTH_SECRET', 'secreto-nuevo-0123456789-abcdefghijklmnopq');
    const { POST } = await import('../src/app/api/ajustes/probar/route');
    const r = await POST(
      new Request('http://127.0.0.1:3000/api/ajustes/probar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelo: 'deepseek/deepseek-v4.1-flash', caso: 0 }),
      }),
    );
    expect(r.status).toBe(503);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({
      error: 'La clave de IA guardada ya no se puede leer. Vuelve a ingresarla en Ajustes.',
      codigo: 'ia_clave_ilegible',
    });
    expect(red).not.toHaveBeenCalled();
  });
});

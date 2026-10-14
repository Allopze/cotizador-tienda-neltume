import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { montarInstalacion, ORIGEN } from './sesion-prueba';

// O4 / 5.4: /api/salud responde solo { ok } sin sesión (healthcheck de Compose) y el detalle a una administradora.

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.();
  desmontar = undefined;
});

async function montar({ chromium = process.execPath } = {}) {
  const instalacion = await montarInstalacion('salud');
  desmontar = instalacion.desmontar;
  // Cualquier ejecutable sirve para la comprobación (no se lanza): el de Node existe siempre.
  vi.stubEnv('CHROMIUM_PATH', chromium);
  vi.stubEnv('CMD_API_KEY', '');
  const { GET } = await import('../src/app/api/salud/route');
  const consultar = (cookie?: string) => GET(instalacion.peticion('/api/salud', { cookie }));
  return { ...instalacion, consultar };
}

describe('/api/salud', () => {
  it('sin sesión responde solo ok con 200', async () => {
    const { consultar } = await montar();
    const respuesta = await consultar();
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get('cache-control')).toBe('no-store');
    expect(await respuesta.json()).toEqual({ ok: true });
  });

  it('responde 503 sin Chromium o con la base en un esquema que esta versión no conoce', async () => {
    const sinChromium = await montar({ chromium: '/no/existe/chromium' });
    const respuesta = await sinChromium.consultar();
    expect(respuesta.status).toBe(503);
    expect(await respuesta.json()).toEqual({ ok: false });
    await sinChromium.desmontar();

    const { consultar, db } = await montar();
    db.pragma('user_version = 999');
    try {
      expect((await consultar()).status).toBe(503);
    } finally {
      db.pragma('user_version = 23');
    }
  });

  it('valida el Host', async () => {
    await montar();
    const { GET } = await import('../src/app/api/salud/route');
    expect((await GET(new Request(`${ORIGEN}/api/salud`, { headers: { host: 'malicioso.example' } }))).status).toBe(403);
  });

  it('a una administradora le muestra cada comprobación sin secretos', async () => {
    const { consultar, cuenta, directorio, db } = await montar();
    const admin = await cuenta('admin@neltume.test', 'admin');
    const estandar = await cuenta('persona@neltume.test', 'user');

    expect(await (await consultar(estandar.cookie)).json()).toEqual({ ok: true });

    let datos = await (await consultar(admin.cookie)).json();
    expect(datos.ok).toBe(true);
    expect(Object.keys(datos.comprobaciones).sort()).toEqual(
      ['autenticacion', 'base', 'chromium', 'disco', 'feriados', 'ia', 'respaldo'].sort(),
    );
    expect(datos.comprobaciones.base).toMatchObject({ estado: 'ok', versionEsquema: 23 });
    expect(datos.comprobaciones.disco.libresMb).toBeGreaterThan(0);
    expect(datos.comprobaciones.ia).toMatchObject({ estado: 'aviso', fuente: 'ninguna' });
    expect(datos.comprobaciones.respaldo.estado).toBe('aviso');

    // Un respaldo reciente, feriados sincronizados y clave de IA por entorno.
    mkdirSync(join(directorio, 'respaldos', `cotizador-${new Date().toISOString().replace(/[:.]/g, '-')}`), {
      recursive: true,
    });
    vi.stubEnv('NELTUME_FERIADOS_SYNC', '1');
    const sincronizado = new Date().toISOString();
    db.prepare('INSERT INTO feriados_sincronizacion (anio, sincronizado, intentado, error) VALUES (?, ?, ?, NULL)').run(
      2026,
      sincronizado,
      sincronizado,
    );
    vi.stubEnv('CMD_API_KEY', 'sk-clave-secreta-de-prueba');
    const respuesta = await consultar(admin.cookie);
    const texto = await respuesta.text();
    datos = JSON.parse(texto);
    expect(datos.comprobaciones.respaldo).toMatchObject({ estado: 'ok', cantidad: 1 });
    expect(datos.comprobaciones.feriados).toMatchObject({ estado: 'ok', ultimaSincronizacion: sincronizado });
    expect(datos.comprobaciones.ia).toMatchObject({ estado: 'ok', fuente: 'entorno' });
    expect(texto).not.toContain('sk-clave-secreta-de-prueba');
    expect(texto).not.toContain('vitest-secret');
  });

  it('un respaldo de hace más de dos días y feriados nunca sincronizados son avisos, no fallas', async () => {
    const { consultar, cuenta, directorio } = await montar();
    const admin = await cuenta('admin@neltume.test', 'admin');
    mkdirSync(join(directorio, 'respaldos', 'cotizador-2020-01-01T21-00-00-000Z'), { recursive: true });
    vi.stubEnv('NELTUME_FERIADOS_SYNC', '1');
    const respuesta = await consultar(admin.cookie);
    expect(respuesta.status).toBe(200);
    const { comprobaciones } = await respuesta.json();
    expect(comprobaciones.respaldo).toMatchObject({ estado: 'aviso', ultimoRespaldo: '2020-01-01T21:00:00.000Z' });
    expect(comprobaciones.feriados.estado).toBe('aviso');
  });
});

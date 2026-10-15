import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { montarInstalacion, ORIGEN } from './sesion-prueba';

// O4 / 5.4: /api/salud responde solo { ok } sin sesión (healthcheck de Compose) y el detalle a una administradora.

// El arranque real de Chromium se simula: prepararPdf es lo que /api/salud usa para lanzarlo y abrir una página.
const { prepararPdf } = vi.hoisted(() => ({ prepararPdf: vi.fn(async (plazo?: number): Promise<void> => void plazo) }));
vi.mock('../src/servidor/pdf', () => ({ prepararPdf }));

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.();
  desmontar = undefined;
  prepararPdf.mockReset();
  prepararPdf.mockImplementation(async () => {});
  vi.useRealTimers();
});

async function montar({ chromium = process.execPath } = {}) {
  const instalacion = await montarInstalacion('salud');
  desmontar = instalacion.desmontar;
  // Cualquier ejecutable sirve para ver que existe (el arranque se simula): el de Node existe siempre.
  vi.stubEnv('CHROMIUM_PATH', chromium);
  vi.stubEnv('CMD_API_KEY', '');
  for (const variable of ['STARKEN_URL', 'STARKEN_RUT', 'STARKEN_CLAVE', 'STARKEN_CUENTA_CORRIENTE', 'STARKEN_CUENTA_CORRIENTE_DV', 'STARKEN_RUT_CLIENTE'])
    vi.stubEnv(variable, '');
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
      ['autenticacion', 'base', 'chromium', 'disco', 'feriados', 'ia', 'respaldo', 'starken'].sort(),
    );
    expect(datos.comprobaciones.base).toMatchObject({ estado: 'ok', versionEsquema: 23 });
    expect(datos.comprobaciones.disco.libresMb).toBeGreaterThan(0);
    expect(datos.comprobaciones.ia).toMatchObject({ estado: 'aviso', fuente: 'ninguna' });
    expect(datos.comprobaciones.respaldo.estado).toBe('aviso');
    expect(datos.comprobaciones.chromium).toMatchObject({ estado: 'ok', detalle: 'Chromium arranca y abre páginas.' });
    expect(datos.comprobaciones.starken).toMatchObject({ estado: 'ok', configurado: false });

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

  it('lanza Chromium de verdad con plazo corto: si no arranca responde 503 y la administradora ve la causa', async () => {
    const { consultar, cuenta } = await montar();
    const admin = await cuenta('admin@neltume.test', 'admin');
    prepararPdf.mockRejectedValue(new Error('No se pudo preparar Chromium antes de reservar el documento: sin /dev/shm'));
    const respuesta = await consultar();
    expect(respuesta.status).toBe(503);
    expect(await respuesta.json()).toEqual({ ok: false });
    expect(prepararPdf).toHaveBeenCalledWith(8_000);
    const { comprobaciones } = await (await consultar(admin.cookie)).json();
    expect(comprobaciones.chromium).toMatchObject({
      estado: 'error',
      detalle: 'Chromium está instalado pero no arranca: sin /dev/shm',
    });
  });

  it('recuerda un arranque exitoso 10 minutos y una falla 1 minuto (el healthcheck corre cada 30 s)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
    const { consultar } = await montar();
    for (let i = 0; i < 3; i++) expect((await consultar()).status).toBe(200);
    expect(prepararPdf).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-14T12:09:59Z'));
    await consultar();
    expect(prepararPdf).toHaveBeenCalledTimes(1);

    // Vencidos los 10 minutos se vuelve a lanzar; esta vez falla.
    vi.setSystemTime(new Date('2026-10-14T12:10:01Z'));
    prepararPdf.mockRejectedValue(new Error('Chromium no abrió una página en 8000 ms.'));
    expect((await consultar()).status).toBe(503);
    expect(prepararPdf).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date('2026-10-14T12:10:30Z'));
    expect((await consultar()).status).toBe(503);
    expect(prepararPdf).toHaveBeenCalledTimes(2);

    // La falla se vuelve a comprobar al minuto: ya arranca.
    vi.setSystemTime(new Date('2026-10-14T12:11:02Z'));
    prepararPdf.mockImplementation(async () => {});
    expect((await consultar()).status).toBe(200);
    expect(prepararPdf).toHaveBeenCalledTimes(3);
  });

  it('dos consultas simultáneas comparten un solo arranque de Chromium', async () => {
    const { consultar } = await montar();
    let terminar!: () => void;
    prepararPdf.mockImplementation(() => new Promise<void>((r) => (terminar = r)));
    const consultas = Promise.all([consultar(), consultar()]);
    await vi.waitFor(() => expect(prepararPdf).toHaveBeenCalledTimes(1));
    terminar();
    expect((await consultas).map((r) => r.status)).toEqual([200, 200]);
    expect(prepararPdf).toHaveBeenCalledTimes(1);
  });

  it('sin Chromium instalado no intenta lanzarlo', async () => {
    const { consultar } = await montar({ chromium: '/no/existe/chromium' });
    expect((await consultar()).status).toBe(503);
    expect(prepararPdf).not.toHaveBeenCalled();
  });

  it('indica si Starken está configurado, sin mostrar credenciales y sin fallar el healthcheck', async () => {
    const { consultar, cuenta, db } = await montar();
    const admin = await cuenta('admin@neltume.test', 'admin');
    const starken = async () => {
      const respuesta = await consultar(admin.cookie);
      expect(respuesta.status).toBe(200);
      const texto = await respuesta.text();
      expect(texto).not.toContain('clave-starken-secreta');
      return JSON.parse(texto).comprobaciones.starken;
    };

    vi.stubEnv('STARKEN_CLAVE', 'clave-starken-secreta');
    expect(await starken()).toMatchObject({ estado: 'aviso', configurado: false, detalle: expect.stringMatching(/a medio configurar/) });

    vi.stubEnv('STARKEN_URL', 'https://restservices-qa.starken.cl/apiqa/starkenservices/rest');
    vi.stubEnv('STARKEN_RUT', '76.000.000-0');
    vi.stubEnv('STARKEN_RUT_CLIENTE', '76.000.000-0');
    expect(await starken()).toMatchObject({ estado: 'aviso', configurado: false, detalle: expect.stringMatching(/ciudad de origen/) });

    const { configuracionStarkenVacia } = await import('../src/servidor/starken-configuracion');
    db.prepare("INSERT INTO ajustes (clave, valor_json, actualizada) VALUES ('starken', ?, ?)").run(
      JSON.stringify({ ...configuracionStarkenVacia(), origen: { codigoCiudad: 1, nombre: 'SANTIAGO' } }),
      new Date().toISOString(),
    );
    expect(await starken()).toMatchObject({ estado: 'ok', configurado: true, detalle: 'Starken está configurado.' });
  });
});

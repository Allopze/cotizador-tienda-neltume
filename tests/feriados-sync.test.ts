import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBaseDatos, cerrarBaseDatos } from '../src/servidor/base-datos';
import { estadoFeriados, prepararFeriados, URL_FERIADOS } from '../src/servidor/feriados-sync';
import { esFeriado, registrarFeriadosExternos } from '../src/negocio/feriados';
import { sumarDiasHabiles } from '../src/negocio/vigencia';

const dirs: string[] = [];
async function base() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-feriados-'));
  dirs.push(dir);
  return abrirBaseDatos(join(dir, 'cotizador.sqlite'));
}
afterEach(async () => {
  registrarFeriadosExternos([]);
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) {
    cerrarBaseDatos(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

// Respuesta con la forma de boostr.cl: los feriados legales más uno puntual (viernes 16 de septiembre).
const respuesta = (anio: number, extra: string[] = []) =>
  Response.json({
    status: 'success',
    data: [
      ...['01-01', '05-01', '05-21', '09-18', '09-19', '12-25'].map((d) => ({
        date: `${anio}-${d}`,
        title: 'Feriado',
      })),
      ...extra.map((date) => ({ date, title: 'Feriado puntual' })),
    ],
  });
const ahora = new Date('2026-06-01T15:00:00Z');

describe('sincronización de feriados', () => {
  it('suma los feriados puntuales de la fuente a los calculados y los usa en los días hábiles', async () => {
    const db = await base();
    const obtener = vi.fn(async (url: string) =>
      respuesta(Number(url.match(/(\d{4})\.json$/)![1]), url.includes('2026') ? ['2026-09-17'] : []),
    );
    expect(sumarDiasHabiles('2026-09-16', 1)).toBe('2026-09-17');
    await prepararFeriados(db, { ahora, obtener, forzar: true });
    expect(obtener.mock.calls.map(([url]) => url)).toEqual([URL_FERIADOS(2026), URL_FERIADOS(2027)]);
    expect(esFeriado('2026-09-17')).toBe(true);
    // Miércoles 16 → jueves 17 (puntual), 18 y 19 feriados, fin de semana: el siguiente hábil es el lunes 21.
    expect(sumarDiasHabiles('2026-09-16', 1)).toBe('2026-09-21');
    // Lo calculado sigue aunque la fuente no lo incluya.
    expect(esFeriado('2026-10-12')).toBe(true);
  });

  it('una falla de la fuente no borra lo guardado y se registra para reintentar', async () => {
    const db = await base();
    await prepararFeriados(db, { ahora, obtener: async () => respuesta(2026, ['2026-09-17']), forzar: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await prepararFeriados(db, {
      ahora,
      obtener: async () => new Response('caído', { status: 503 }),
      forzar: true,
    });
    const estado = estadoFeriados(db);
    expect(estado.feriados.some((f) => f.fecha === '2026-09-17')).toBe(true);
    expect(estado.sincronizaciones[0]).toMatchObject({ anio: 2026, error: 'HTTP 503' });
    expect(estado.sincronizaciones[0].sincronizado).not.toBeNull();
  });

  it('rechaza respuestas vacías o con otro formato', async () => {
    const db = await base();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await prepararFeriados(db, {
      ahora,
      obtener: async () => Response.json({ status: 'success', data: [] }),
      forzar: true,
    });
    await prepararFeriados(db, { ahora, obtener: async () => Response.json({ hola: 1 }), forzar: true });
    expect(estadoFeriados(db).feriados).toEqual([]);
  });

  it('con datos al día no vuelve a consultar, y sin sincronización activa no sale a la red', async () => {
    const db = await base();
    await prepararFeriados(db, { ahora, obtener: async () => respuesta(2026), forzar: true });
    const obtener = vi.fn(async () => respuesta(2026));
    vi.stubEnv('NELTUME_FERIADOS_SYNC', '1');
    await prepararFeriados(db, { ahora, obtener });
    expect(obtener).not.toHaveBeenCalled();
    vi.stubEnv('NELTUME_FERIADOS_SYNC', '0');
    await prepararFeriados(db, { ahora: new Date('2026-06-05T15:00:00Z'), obtener });
    expect(obtener).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('al abrir la base se cargan los feriados ya sincronizados', async () => {
    const db = await base();
    await prepararFeriados(db, { ahora, obtener: async () => respuesta(2026, ['2026-09-17']), forzar: true });
    registrarFeriadosExternos([]);
    const ruta = db.name;
    cerrarBaseDatos(ruta);
    abrirBaseDatos(ruta);
    expect(esFeriado('2026-09-17')).toBe(true);
  });

  it('ignora los feriados manuales de versiones anteriores: los feriados son solo automáticos', async () => {
    const db = await base();
    db.prepare('INSERT INTO feriados_manuales (fecha, nombre, creada) VALUES (?, ?, ?)').run(
      '2026-11-13',
      'Fiesta regional',
      new Date().toISOString(),
    );
    await prepararFeriados(db, { ahora, obtener: async () => respuesta(2026), forzar: true });
    expect(esFeriado('2026-11-13')).toBe(false);
    expect(estadoFeriados(db).feriados.map((f) => f.fecha)).not.toContain('2026-11-13');
    const ruta = db.name;
    cerrarBaseDatos(ruta);
    abrirBaseDatos(ruta);
    expect(esFeriado('2026-11-13')).toBe(false);
  });

  it('solo guarda los feriados nacionales: civiles, religiosos e irrenunciables; descarta los regionales', async () => {
    const db = await base();
    // Forma de boostr.cl, con su tipo y su detalle; los dos últimos imitan feriados regionales.
    const fuente = {
      status: 'success',
      data: [
        { date: '2026-01-01', title: 'Año Nuevo', type: 'Civil', inalienable: true, extra: 'Civil e Irrenunciable' },
        { date: '2026-04-03', title: 'Viernes Santo', type: 'Religioso', inalienable: false, extra: 'Religioso' },
        { date: '2026-05-01', title: 'Día Nacional del Trabajo', type: 'Civil', inalienable: true, extra: 'Civil e Irrenunciable' },
        { date: '2026-05-21', title: 'Día de las Glorias Navales', type: 'Civil', inalienable: false, extra: 'Civil' },
        { date: '2026-09-18', title: 'Independencia Nacional', type: 'Civil', inalienable: true, extra: 'Civil e Irrenunciable' },
        { date: '2026-12-25', title: 'Navidad', type: 'Religioso', inalienable: true, extra: 'Religioso e Irrenunciable' },
        { date: '2026-06-07', title: 'Asalto y Toma del Morro de Arica', type: 'Civil', inalienable: false, extra: 'Regional (Región de Arica y Parinacota)' },
        { date: '2026-08-20', title: 'Nacimiento del Prócer de la Independencia', type: 'Regional', inalienable: false, extra: 'Chillán y Chillán Viejo' },
      ],
    };
    await prepararFeriados(db, { ahora, obtener: async () => Response.json(fuente), forzar: true });
    const fechas = estadoFeriados(db).feriados.map((f) => f.fecha);
    expect(fechas).toEqual(['2026-01-01', '2026-04-03', '2026-05-01', '2026-05-21', '2026-09-18', '2026-12-25']);
    expect(esFeriado('2026-06-07')).toBe(false);
    expect(esFeriado('2026-08-20')).toBe(false);
  });
});

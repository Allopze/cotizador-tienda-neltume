import { afterEach, describe, expect, it } from 'vitest';
import { montarInstalacion } from './sesion-prueba';

// G6 / 5.9: la API de cuentas no permite desactivarse a sí misma y registra quién cambió qué cuenta.

let desmontar: (() => Promise<void>) | undefined;
afterEach(async () => {
  await desmontar?.();
  desmontar = undefined;
});

async function montar() {
  const instalacion = await montarInstalacion('usuarios');
  desmontar = instalacion.desmontar;
  const ana = await instalacion.cuenta('ana@neltume.test', 'admin', 'Ana');
  const bea = await instalacion.cuenta('bea@neltume.test', 'admin', 'Bea');
  const rutas = await import('../src/app/api/usuarios/route');
  const patch = (json: unknown, cookie = ana.cookie) =>
    rutas.PATCH(instalacion.peticion('/api/usuarios', { cookie, json, metodo: 'PATCH' }));
  return { ...instalacion, ana, bea, rutas, patch };
}

const filas = (db: import('better-sqlite3').Database) =>
  db.prepare('SELECT actor, objetivo, accion FROM auditoria_cuentas ORDER BY id').all();

describe('Cuentas desde Ajustes', () => {
  it('no permite desactivar la propia cuenta aunque haya otras administradoras', async () => {
    const { ana, patch, db } = await montar();
    const respuesta = await patch({ accion: 'desactivar', id: ana.id });
    expect(respuesta.status).toBe(409);
    expect((await respuesta.json()).error).toMatch(/propia cuenta/);
    const fila = db.prepare('SELECT banned FROM "user" WHERE id = ?').get(ana.id) as { banned: number | null };
    expect(fila.banned ? 1 : 0).toBe(0);
    expect(filas(db)).toEqual([]);
  });

  it('registra quién creó, editó, desactivó, activó y restableció la clave de qué cuenta', async () => {
    const { ana, bea, patch, rutas, peticion, db } = await montar();
    const crear = await rutas.POST(
      peticion('/api/usuarios', {
        cookie: ana.cookie,
        json: { nombre: 'Carla', email: 'carla@neltume.test', password: 'otra-clave-segura-1' },
      }),
    );
    expect(crear.status).toBe(201);
    expect((await patch({ accion: 'editar', id: bea.id, nombre: 'Beatriz', email: 'beatriz@neltume.test' })).status).toBe(200);
    expect((await patch({ accion: 'desactivar', id: bea.id })).status).toBe(200);
    expect((await patch({ accion: 'activar', id: bea.id })).status).toBe(200);
    const clave = await patch({ accion: 'restablecer-clave', id: bea.id, password: 'clave-nueva-segura-2' });
    expect(clave.status).toBe(200);

    expect(filas(db)).toEqual([
      { actor: 'ana@neltume.test', objetivo: 'carla@neltume.test', accion: 'crear' },
      {
        actor: 'ana@neltume.test',
        objetivo: 'beatriz@neltume.test (correo antes: bea@neltume.test; nombre antes: Bea)',
        accion: 'editar',
      },
      { actor: 'ana@neltume.test', objetivo: 'beatriz@neltume.test', accion: 'desactivar' },
      { actor: 'ana@neltume.test', objetivo: 'beatriz@neltume.test', accion: 'activar' },
      { actor: 'ana@neltume.test', objetivo: 'beatriz@neltume.test', accion: 'restablecer-clave' },
    ]);
    // Nunca se guarda una contraseña en el registro.
    expect(JSON.stringify(filas(db))).not.toMatch(/clave-nueva|otra-clave/);

    // La respuesta trae los cambios del más reciente al más antiguo.
    const datos = await clave.json();
    expect(datos.cambios.map((c: { accion: string }) => c.accion)).toEqual([
      'restablecer-clave',
      'activar',
      'desactivar',
      'editar',
      'crear',
    ]);
  });

  it('muestra como máximo los últimos 50 cambios', async () => {
    const { ana, rutas, peticion, db } = await montar();
    const insertar = db.prepare('INSERT INTO auditoria_cuentas (fecha, actor, objetivo, accion) VALUES (?, ?, ?, ?)');
    for (let i = 0; i < 60; i++) insertar.run(new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), 'x', `c${i}`, 'activar');
    const respuesta = await rutas.GET(peticion('/api/usuarios', { cookie: ana.cookie }));
    const { cambios } = await respuesta.json();
    expect(cambios).toHaveLength(50);
    expect(cambios[0].objetivo).toBe('c59');
  });

  it('la terminal también deja registro', async () => {
    const { db } = await montar();
    const { ACTOR_TERMINAL, registrarCambioCuenta, ultimosCambiosCuentas } = await import(
      '../src/servidor/auditoria-cuentas'
    );
    registrarCambioCuenta({ actor: ACTOR_TERMINAL, objetivo: 'ana@neltume.test', accion: 'restablecer-clave' }, db);
    expect(ultimosCambiosCuentas(50, db)[0]).toMatchObject({ actor: 'terminal', accion: 'restablecer-clave' });
  });
});

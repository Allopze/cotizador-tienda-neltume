import { afterEach, describe, expect, it } from 'vitest';
import { CLAVE, montarInstalacion, ORIGEN } from './sesion-prueba';

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

// Los cambios de cuentas, sin los inicios de sesión (montar() inicia sesión con cada cuenta).
const filas = (db: import('better-sqlite3').Database) =>
  db.prepare("SELECT actor, objetivo, accion FROM auditoria_cuentas WHERE accion NOT LIKE 'inicio-sesion%' ORDER BY id").all();

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
    expect((await patch({ accion: 'editar', id: bea.id, nombre: 'Beatriz', email: 'beatriz@neltume.test', passwordActual: CLAVE })).status).toBe(200);
    expect((await patch({ accion: 'desactivar', id: bea.id })).status).toBe(200);
    expect((await patch({ accion: 'activar', id: bea.id })).status).toBe(200);
    const clave = await patch({ accion: 'restablecer-clave', id: bea.id, password: 'clave-nueva-segura-2', passwordActual: CLAVE });
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
    expect(JSON.stringify(db.prepare('SELECT * FROM auditoria_cuentas').all())).not.toMatch(/clave-nueva|otra-clave|clave-de-prueba/);

    // La respuesta trae los cambios del más reciente al más antiguo.
    const datos = await clave.json();
    expect(
      datos.cambios.map((c: { accion: string }) => c.accion).filter((a: string) => !a.startsWith('inicio-sesion')),
    ).toEqual([
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

describe('Cambiar el acceso de una cuenta exige la contraseña propia', () => {
  it('pide la contraseña para cambiar el correo o la clave, la verifica y no cambia nada si falta o es incorrecta', async () => {
    const { bea, patch, db } = await montar();
    const correo = () => (db.prepare('SELECT email FROM "user" WHERE id = ?').get(bea.id) as { email: string }).email;

    const sinClave = await patch({ accion: 'editar', id: bea.id, nombre: 'Bea', email: 'otra@neltume.test' });
    expect(sinClave.status).toBe(400);
    expect(await sinClave.json()).toMatchObject({ codigo: 'confirmar_clave', error: expect.stringMatching(/contraseña/) });
    const incorrecta = await patch({ accion: 'editar', id: bea.id, nombre: 'Bea', email: 'otra@neltume.test', passwordActual: 'no-es-mi-clave-1' });
    expect(incorrecta.status).toBe(403);
    expect((await incorrecta.json()).error).toBe('Tu contraseña no es correcta.');
    expect(correo()).toBe('bea@neltume.test');

    const resetSinClave = await patch({ accion: 'restablecer-clave', id: bea.id, password: 'clave-nueva-segura-2' });
    expect(resetSinClave.status).toBe(400);
    expect(filas(db)).toEqual([]);

    // Cambiar solo el nombre no toca el acceso: no la pide.
    expect((await patch({ accion: 'editar', id: bea.id, nombre: 'Beatriz', email: 'bea@neltume.test' })).status).toBe(200);
    expect((await patch({ accion: 'editar', id: bea.id, nombre: 'Beatriz', email: 'otra@neltume.test', passwordActual: CLAVE })).status).toBe(200);
    expect(correo()).toBe('otra@neltume.test');
  });

  it('tras cinco confirmaciones fallidas responde 429 aunque la siguiente sea correcta', async () => {
    const { bea, patch } = await montar();
    for (let i = 0; i < 5; i++)
      expect((await patch({ accion: 'restablecer-clave', id: bea.id, password: 'clave-nueva-segura-2', passwordActual: `mala-${i}-clave` })).status).toBe(403);
    const bloqueada = await patch({ accion: 'restablecer-clave', id: bea.id, password: 'clave-nueva-segura-2', passwordActual: CLAVE });
    expect(bloqueada.status).toBe(429);
  });
});

describe('Registro de inicios de sesión', () => {
  it('registra los inicios correctos y fallidos con el dispositivo, sin la contraseña', async () => {
    const { auth, db } = await montar();
    const intento = (email: string, password: string) =>
      auth.handler(
        new Request(`${ORIGEN}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: {
            origin: ORIGEN,
            'content-type': 'application/json',
            'cf-connecting-ip': '203.0.113.77',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
          },
          body: JSON.stringify({ email, password }),
        }),
      );
    expect((await intento('ana@neltume.test', 'una-clave-equivocada')).status).toBe(401);
    expect((await intento('nadie@neltume.test', 'otra-clave-equivocada')).status).toBe(401);
    expect((await intento('ana@neltume.test', CLAVE)).status).toBe(200);

    const inicios = db
      .prepare("SELECT actor, objetivo, accion FROM auditoria_cuentas WHERE accion LIKE 'inicio-sesion%' ORDER BY id")
      .all();
    // Los dos primeros son los inicios de montar() (Ana y Bea).
    expect(inicios.slice(0, 2)).toMatchObject([
      { actor: 'ana@neltume.test', accion: 'inicio-sesion' },
      { actor: 'bea@neltume.test', accion: 'inicio-sesion' },
    ]);
    expect(inicios.slice(2)).toEqual([
      { actor: 'ana@neltume.test', objetivo: 'Chrome en macOS · IP 203.0.113.77', accion: 'inicio-sesion-fallido' },
      { actor: 'nadie@neltume.test', objetivo: 'Chrome en macOS · IP 203.0.113.77', accion: 'inicio-sesion-fallido' },
      { actor: 'ana@neltume.test', objetivo: 'Chrome en macOS · IP 203.0.113.77', accion: 'inicio-sesion' },
    ]);
    expect(JSON.stringify(inicios)).not.toMatch(/equivocada|clave-de-prueba/);
  });

  it('el intento con una cuenta desactivada queda como fallido, igual que una contraseña incorrecta', async () => {
    const { auth, bea, patch, db } = await montar();
    expect((await patch({ accion: 'desactivar', id: bea.id })).status).toBe(200);
    const respuesta = await auth.handler(
      new Request(`${ORIGEN}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { origin: ORIGEN, 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.78' },
        body: JSON.stringify({ email: 'bea@neltume.test', password: CLAVE }),
      }),
    );
    expect(respuesta.status).toBe(401);
    const ultima = db.prepare('SELECT actor, accion FROM auditoria_cuentas ORDER BY id DESC LIMIT 1').get();
    expect(ultima).toEqual({ actor: 'bea@neltume.test', accion: 'inicio-sesion-fallido' });
  });
});

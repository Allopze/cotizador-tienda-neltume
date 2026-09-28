import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { crearAutenticacion, migrarEsquemaAutenticacion } from '../src/servidor/autenticacion-config';

const correo = 'persona@neltume.test';
const clave = 'clave-de-prueba-segura-123';
const origen = 'http://127.0.0.1:3000';

function cookieDe(respuesta: Response) {
  return respuesta.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');
}

async function solicitudAuth(
  auth: ReturnType<typeof crearAutenticacion>,
  ruta: string,
  init?: RequestInit,
  origenSolicitud = origen,
) {
  return auth.handler(new Request(`${origenSolicitud}/api/auth${ruta}`, init));
}

describe('Autenticación Better Auth', () => {
  let database: Database.Database | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
    vi.unstubAllEnvs();
  });

  it('migra las tablas de auth sin alterar datos existentes y deshabilita el registro público', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'vitest-secret-0123456789abcdef-0123456789');
    vi.stubEnv('BETTER_AUTH_URL', origen);
    database = new Database(':memory:');
    database.exec(`
      CREATE TABLE cotizaciones (id TEXT PRIMARY KEY);
      INSERT INTO cotizaciones VALUES ('323');
      CREATE TABLE productos_catalogo (codigo TEXT PRIMARY KEY, descripcion TEXT NOT NULL);
      INSERT INTO productos_catalogo VALUES ('HUIL-O-3-B', 'Puerta de prueba');
      CREATE TABLE correlativos (
        id INTEGER PRIMARY KEY,
        siguiente_cotizacion INTEGER NOT NULL,
        siguiente_nota INTEGER NOT NULL
      );
      INSERT INTO correlativos VALUES (1, 324, 2);
    `);

    await migrarEsquemaAutenticacion(database);
    const auth = crearAutenticacion(database);

    expect(database.prepare('SELECT id FROM cotizaciones').get()).toEqual({ id: '323' });
    expect(database.prepare('SELECT * FROM productos_catalogo').get()).toEqual({
      codigo: 'HUIL-O-3-B',
      descripcion: 'Puerta de prueba',
    });
    expect(database.prepare('SELECT * FROM correlativos').get()).toEqual({
      id: 1,
      siguiente_cotizacion: 324,
      siguiente_nota: 2,
    });
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'").get()).toBeTruthy();

    const respuesta = await solicitudAuth(auth, '/sign-up/email', {
      method: 'POST',
      headers: { origin: origen, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Invitado', email: correo, password: clave }),
    });
    expect(respuesta.ok).toBe(false);
    expect(database.prepare('SELECT id FROM user').all()).toHaveLength(0);
  });

  it('permite iniciar sesión, revoca al cerrar y rechaza una sesión expirada', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'vitest-secret-0123456789abcdef-0123456789');
    vi.stubEnv('BETTER_AUTH_URL', origen);
    database = new Database(':memory:');
    await migrarEsquemaAutenticacion(database);
    const auth = crearAutenticacion(database);

    const context = await auth.$context;
    const user = await context.internalAdapter.createUser(
      { email: correo, name: 'Persona de prueba', emailVerified: true, role: 'user' },
      { method: 'admin' },
    );
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await context.password.hash(clave),
    });

    const login = await solicitudAuth(auth, '/sign-in/email', {
      method: 'POST',
      headers: { origin: origen, 'content-type': 'application/json' },
      body: JSON.stringify({ email: correo, password: clave }),
    });
    expect(login.ok).toBe(true);
    const cookies = cookieDe(login);
    const sessionCookie = cookies.split('; ').find((item) => item.includes('session_token='));
    expect(sessionCookie).toBeDefined();
    const sesiones = await context.internalAdapter.listSessions(user.id);
    expect(sesiones).toHaveLength(1);
    const almacenada = sesiones[0];
    expect(almacenada.expiresAt.getTime() - almacenada.createdAt.getTime()).toBe(12 * 60 * 60 * 1000);

    const autenticada = await solicitudAuth(auth, '/get-session', { headers: { cookie: cookies } });
    expect(autenticada.ok).toBe(true);
    expect((await autenticada.json()).user.email).toBe(correo);

    await solicitudAuth(auth, '/sign-out', {
      method: 'POST',
      headers: { cookie: cookies, origin: origen, 'content-type': 'application/json' },
      body: '{}',
    });
    const trasSalir = await solicitudAuth(auth, '/get-session', { headers: { cookie: cookies } });
    expect(await trasSalir.json()).toBeNull();

    const segundoLogin = await solicitudAuth(auth, '/sign-in/email', {
      method: 'POST',
      headers: { origin: origen, 'content-type': 'application/json' },
      body: JSON.stringify({ email: correo, password: clave }),
    });
    const segundaCookie = cookieDe(segundoLogin);
    const sesionesVivas = await context.internalAdapter.listSessions(user.id);
    const segundaSesion = sesionesVivas.find((session) => session.token !== almacenada.token)!;
    await context.internalAdapter.updateSession(segundaSesion.token, { expiresAt: new Date(Date.now() - 1000) });
    const expirada = await solicitudAuth(auth, '/get-session', { headers: { cookie: segundaCookie } });
    expect(await expirada.json()).toBeNull();

    await context.internalAdapter.updateUser(user.id, { banned: true, banReason: 'Desactivada', banExpires: null });
    await context.internalAdapter.deleteUserSessions(user.id);
    const cuentaDesactivada = await solicitudAuth(auth, '/sign-in/email', {
      method: 'POST',
      headers: { origin: origen, 'content-type': 'application/json' },
      body: JSON.stringify({ email: correo, password: clave }),
    });
    expect(cuentaDesactivada.status).toBe(403);
    const sesionRevocada = await solicitudAuth(auth, '/get-session', { headers: { cookie: segundaCookie } });
    expect(await sesionRevocada.json()).toBeNull();
  });

  it('acepta el puerto alternativo de Next solo para un origen loopback del mismo host', async () => {
    vi.stubEnv('BETTER_AUTH_SECRET', 'vitest-secret-0123456789abcdef-0123456789');
    vi.stubEnv('BETTER_AUTH_URL', origen);
    database = new Database(':memory:');
    await migrarEsquemaAutenticacion(database);
    const auth = crearAutenticacion(database);
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser(
      { email: correo, name: 'Persona de prueba', emailVerified: true, role: 'user' },
      { method: 'admin' },
    );
    await context.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await context.password.hash(clave),
    });

    const origenAlternativo = 'http://127.0.0.1:3002';
    const login = await solicitudAuth(
      auth,
      '/sign-in/email',
      {
        method: 'POST',
        headers: {
          origin: origenAlternativo,
          host: '127.0.0.1:3002',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: correo, password: clave }),
      },
      origenAlternativo,
    );
    expect(login.ok).toBe(true);

    const origenExterno = await solicitudAuth(
      auth,
      '/sign-in/email',
      {
        method: 'POST',
        headers: {
          origin: 'https://malicioso.test',
          host: '127.0.0.1:3002',
          cookie: 'comprobacion=1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email: correo, password: clave }),
      },
      origenAlternativo,
    );
    expect(origenExterno.status).toBe(403);
  });
});

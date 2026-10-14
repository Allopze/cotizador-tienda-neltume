import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hostPermitido, hostsConfigurados, interpretarHost, rechazoAcceso } from '../src/servidor/acceso';
import {
  cabeceraIpCliente,
  crearAutenticacion,
  esRutaAdminAuth,
  MAX_FALLOS_POR_CORREO,
  migrarEsquemaAutenticacion,
  validarConfiguracionAutenticacion,
} from '../src/servidor/autenticacion-config';
import { leerJson, MAX_CUERPO_BYTES } from '../src/servidor/cuerpo';

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
    expect(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'session'").get(),
    ).toBeTruthy();

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
    // createdAt y expiresAt se calculan con Date.now() distintos: se tolera ±1 s.
    expect(
      Math.abs(almacenada.expiresAt.getTime() - almacenada.createdAt.getTime() - 12 * 60 * 60 * 1000),
    ).toBeLessThanOrEqual(1000);

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
    await context.internalAdapter.updateSession(segundaSesion.token, {
      expiresAt: new Date(Date.now() - 1000),
    });
    const expirada = await solicitudAuth(auth, '/get-session', { headers: { cookie: segundaCookie } });
    expect(await expirada.json()).toBeNull();

    await context.internalAdapter.updateUser(user.id, {
      banned: true,
      banReason: 'Desactivada',
      banExpires: null,
    });
    await context.internalAdapter.deleteUserSessions(user.id);
    const cuentaDesactivada = await solicitudAuth(auth, '/sign-in/email', {
      method: 'POST',
      headers: { origin: origen, 'content-type': 'application/json' },
      body: JSON.stringify({ email: correo, password: clave }),
    });
    // Una cuenta desactivada responde exactamente igual que una contraseña incorrecta: no revela que existe.
    expect(cuentaDesactivada.status).toBe(401);
    const claveIncorrecta = await solicitudAuth(auth, '/sign-in/email', {
      method: 'POST',
      headers: { origin: origen, 'content-type': 'application/json' },
      body: JSON.stringify({ email: correo, password: 'otra-clave-incorrecta-1' }),
    });
    expect(claveIncorrecta.status).toBe(401);
    const noExiste = await solicitudAuth(auth, '/sign-in/email', {
      method: 'POST',
      headers: { origin: origen, 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nadie@neltume.test', password: clave }),
    });
    const cuerpos = [await cuentaDesactivada.json(), await claveIncorrecta.json(), await noExiste.json()];
    expect(cuerpos[0]).toEqual(cuerpos[1]);
    expect(cuerpos[0]).toEqual(cuerpos[2]);
    expect(JSON.stringify(cuerpos[0])).not.toMatch(/ban/i);
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

async function crearCuenta(
  auth: ReturnType<typeof crearAutenticacion>,
  email: string,
  role: 'user' | 'admin',
) {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser(
    { email, name: 'Persona de prueba', emailVerified: true, role },
    { method: 'admin' },
  );
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await context.password.hash(clave),
  });
  return user;
}

const iniciar = (auth: ReturnType<typeof crearAutenticacion>, email: string, password: string, ip: string) =>
  solicitudAuth(auth, '/sign-in/email', {
    method: 'POST',
    headers: { origin: origen, 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ email, password }),
  });

describe('Endurecimiento de autenticación', () => {
  let database: Database.Database | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
    vi.unstubAllEnvs();
  });

  async function preparar() {
    vi.stubEnv('BETTER_AUTH_SECRET', 'vitest-secret-0123456789abcdef-0123456789');
    vi.stubEnv('BETTER_AUTH_URL', origen);
    database = new Database(':memory:');
    await migrarEsquemaAutenticacion(database);
    return crearAutenticacion(database);
  }

  it('no expone las rutas del plugin admin por HTTP', async () => {
    const auth = await preparar();
    await crearCuenta(auth, correo, 'admin');
    const login = await iniciar(auth, correo, clave, '203.0.113.1');
    expect(login.ok).toBe(true);
    const cookies = cookieDe(login);

    const listar = await solicitudAuth(auth, '/admin/list-users', { headers: { cookie: cookies } });
    expect(listar.status).toBe(404);
    const suplantar = await solicitudAuth(auth, '/admin/impersonate-user', {
      method: 'POST',
      headers: { cookie: cookies, origin: origen, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'x' }),
    });
    expect(suplantar.status).toBe(404);

    expect(esRutaAdminAuth('/api/auth/admin/set-user-password')).toBe(true);
    expect(esRutaAdminAuth('/api/auth//Admin')).toBe(true);
    expect(esRutaAdminAuth('/api/auth/get-session')).toBe(false);
    expect(esRutaAdminAuth('/api/auth/administrar')).toBe(false);
  });

  it('bloquea un correo tras varios fallos aunque cambie la IP', async () => {
    const auth = await preparar();
    await crearCuenta(auth, correo, 'user');
    for (let i = 0; i < MAX_FALLOS_POR_CORREO; i++) {
      const fallo = await iniciar(auth, correo, 'clave-incorrecta-123456', `198.51.100.${i + 1}`);
      expect(fallo.status).toBe(401);
    }
    const bloqueado = await iniciar(auth, correo, clave, '198.51.100.200');
    expect(bloqueado.status).toBe(429);
    const otraCuenta = await iniciar(auth, 'otra@neltume.test', 'clave-incorrecta-123456', '198.51.100.201');
    expect(otraCuenta.status).toBe(401);
  });

  it('interpreta NELTUME_HOSTS igual para el filtro de Host y los orígenes', () => {
    expect(interpretarHost('Cotizador.Neltume.cl')).toEqual({
      hostname: 'cotizador.neltume.cl',
      origen: 'https://cotizador.neltume.cl',
    });
    expect(interpretarHost('cotizador.neltume.cl:8443')).toEqual({
      hostname: 'cotizador.neltume.cl',
      origen: 'https://cotizador.neltume.cl:8443',
    });
    expect(interpretarHost('https://demo.neltume.cl/')).toEqual({
      hostname: 'demo.neltume.cl',
      origen: 'https://demo.neltume.cl',
    });
    expect(interpretarHost('')).toBeNull();
    expect(interpretarHost('ftp://demo.neltume.cl')).toBeNull();
    expect(hostsConfigurados(' a.neltume.cl , https://b.neltume.cl,, ').map((h) => h.hostname)).toEqual([
      'a.neltume.cl',
      'b.neltume.cl',
    ]);

    vi.stubEnv('NELTUME_HOSTS', 'https://demo.neltume.cl');
    expect(hostPermitido('demo.neltume.cl')).toBe(true);
    expect(hostPermitido('DEMO.neltume.cl:443')).toBe(true);
    expect(hostPermitido('127.0.0.1:3000')).toBe(true);
    expect(hostPermitido('evil.example')).toBe(false);
    expect(hostPermitido(null)).toBe(false);
  });

  it('valida la configuración de producción y del secreto', () => {
    vi.stubEnv('BETTER_AUTH_SECRET', '');
    vi.stubEnv('NELTUME_HOSTS', 'demo.neltume.cl');
    expect(() => validarConfiguracionAutenticacion()).toThrow(/BETTER_AUTH_SECRET/);

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TEST', ''); // Vitest define TEST=true.
    vi.stubEnv('BETTER_AUTH_SECRET', 'secreto-de-produccion-0123456789-abcdef');
    vi.stubEnv('BETTER_AUTH_URL', 'https://demo.neltume.cl');
    expect(() => validarConfiguracionAutenticacion()).not.toThrow();
    vi.stubEnv('BETTER_AUTH_URL', 'https://otro.neltume.cl');
    expect(() => validarConfiguracionAutenticacion()).toThrow(/NELTUME_HOSTS/);
    vi.stubEnv('BETTER_AUTH_URL', 'https://demo.neltume.cl');
    vi.stubEnv('TEST', '1');
    expect(() => validarConfiguracionAutenticacion()).toThrow(/TEST/);
  });

  it('solo confía en orígenes loopback fuera de producción', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BETTER_AUTH_SECRET', 'vitest-secret-0123456789abcdef-0123456789');
    vi.stubEnv('BETTER_AUTH_URL', 'https://demo.neltume.cl');
    vi.stubEnv('NELTUME_HOSTS', 'demo.neltume.cl');
    database = new Database(':memory:');
    await migrarEsquemaAutenticacion(database);
    const auth = crearAutenticacion(database);
    const respuesta = await auth.handler(
      new Request('https://demo.neltume.cl/api/auth/sign-in/email', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:3000', cookie: 'a=1', 'content-type': 'application/json' },
        body: JSON.stringify({ email: correo, password: clave }),
      }),
    );
    expect(respuesta.status).toBe(403);
  });
});

describe('Lectura acotada del cuerpo JSON', () => {
  const peticion = (cuerpo: string, tipo = 'application/json') =>
    new Request('http://127.0.0.1:3000/api/x', {
      method: 'POST',
      headers: { 'content-type': tipo },
      body: cuerpo,
    });

  it('rechaza tipos no JSON, cuerpos excesivos y JSON inválido', async () => {
    const tipo = await leerJson(peticion('{}', 'text/plain'));
    expect(!tipo.ok && tipo.respuesta.status).toBe(415);
    const grande = await leerJson(peticion(JSON.stringify({ x: 'a'.repeat(MAX_CUERPO_BYTES) })));
    expect(!grande.ok && grande.respuesta.status).toBe(413);
    const invalido = await leerJson(peticion('{'));
    expect(!invalido.ok && invalido.respuesta.status).toBe(400);
    const valido = await leerJson(peticion('{"a":1}', 'application/json; charset=utf-8'));
    expect(valido.ok && valido.valor).toEqual({ a: 1 });
  });
});

describe('Roles en rutas protegidas', () => {
  let directorio: string | undefined;

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    if (directorio) await rm(directorio, { recursive: true, force: true });
    directorio = undefined;
  });

  it('exige rol admin cuando la ruta lo pide', async () => {
    directorio = await mkdtemp(join(tmpdir(), 'cotizador-roles-'));
    vi.stubEnv('BETTER_AUTH_SECRET', 'vitest-secret-0123456789abcdef-0123456789');
    vi.stubEnv('BETTER_AUTH_URL', origen);
    vi.stubEnv('NELTUME_DATA_DIR', directorio);
    vi.stubEnv('NELTUME_DB_PATH', join(directorio, 'cotizador.sqlite'));
    const { abrirBaseDatos, cerrarBaseDatos } = await import('../src/servidor/base-datos');
    await migrarEsquemaAutenticacion(abrirBaseDatos());
    const { auth } = await import('../src/servidor/autenticacion');
    const { exigirSesion } = await import('../src/servidor/acceso-autenticado');
    try {
      await crearCuenta(auth, correo, 'user');
      await crearCuenta(auth, 'admin@neltume.test', 'admin');
      const solicitud = async (email: string) => {
        const login = await iniciar(auth, email, clave, '192.0.2.10');
        expect(login.ok).toBe(true);
        return new Request(`${origen}/api/ajustes`, {
          method: 'POST',
          headers: { host: '127.0.0.1:3000', origin: origen, cookie: cookieDe(login) },
        });
      };

      const comun = await exigirSesion(await solicitud(correo), { escritura: true, rol: 'admin' });
      expect(!comun.ok && comun.respuesta.status).toBe(403);
      const lectura = await exigirSesion(await solicitud(correo));
      expect(lectura.ok && lectura.usuario.rol).toBe('user');
      const admin = await exigirSesion(await solicitud('admin@neltume.test'), {
        escritura: true,
        rol: 'admin',
      });
      expect(admin.ok && admin.usuario.rol).toBe('admin');
    } finally {
      cerrarBaseDatos();
    }
  });
});

describe('IP del cliente según el proxy (NELTUME_IP_HEADER)', () => {
  let database: Database.Database | undefined;

  afterEach(() => {
    database?.close();
    database = undefined;
    vi.unstubAllEnvs();
  });

  async function preparar(cabecera: string) {
    vi.stubEnv('BETTER_AUTH_SECRET', 'vitest-secret-0123456789abcdef-0123456789');
    vi.stubEnv('BETTER_AUTH_URL', origen);
    vi.stubEnv('NELTUME_IP_HEADER', cabecera);
    database = new Database(':memory:');
    await migrarEsquemaAutenticacion(database);
    return crearAutenticacion(database);
  }

  // Cada intento usa otro correo para medir solo el límite por IP (5 cada 15 minutos), no el límite por correo.
  const intento = (auth: ReturnType<typeof crearAutenticacion>, n: number, cabeceras: Record<string, string>) =>
    solicitudAuth(auth, '/sign-in/email', {
      method: 'POST',
      headers: { origin: origen, 'content-type': 'application/json', ...cabeceras },
      body: JSON.stringify({ email: `nadie${n}@neltume.test`, password: 'clave-incorrecta-123456' }),
    });

  it('acepta solo los valores conocidos y usa cf-connecting-ip por omisión', () => {
    expect(cabeceraIpCliente(undefined)).toBe('cf-connecting-ip');
    expect(cabeceraIpCliente(' X-Real-IP ')).toBe('x-real-ip');
    expect(cabeceraIpCliente('ninguna')).toBe('ninguna');
    expect(() => cabeceraIpCliente('true-client-ip')).toThrow(/NELTUME_IP_HEADER/);
    vi.stubEnv('NELTUME_IP_HEADER', 'x-client-ip');
    expect(() => validarConfiguracionAutenticacion()).toThrow(/NELTUME_IP_HEADER/);
  });

  it('con x-real-ip ignora cf-connecting-ip: inventarla en cada intento no salta el límite', async () => {
    const auth = await preparar('x-real-ip');
    for (let i = 0; i < 5; i++)
      expect((await intento(auth, i, { 'x-real-ip': '203.0.113.5', 'cf-connecting-ip': `198.51.100.${i}` })).status).toBe(401);
    const sexto = await intento(auth, 5, { 'x-real-ip': '203.0.113.5', 'cf-connecting-ip': '198.51.100.99' });
    expect(sexto.status).toBe(429);
    const otraPersona = await intento(auth, 6, { 'x-real-ip': '203.0.113.6' });
    expect(otraPersona.status).toBe(401);
  });

  it('con ninguna todas comparten una sola cubeta (el riesgo documentado)', async () => {
    const auth = await preparar('ninguna');
    for (let i = 0; i < 5; i++)
      expect((await intento(auth, i, { 'cf-connecting-ip': `198.51.100.${i}` })).status).toBe(401);
    expect((await intento(auth, 5, { 'cf-connecting-ip': '198.51.100.200' })).status).toBe(429);
  });
});

describe('Escrituras: Origin y Sec-Fetch-Site', () => {
  const pedido = (cabeceras: Record<string, string>) =>
    new Request(`${origen}/api/accion`, { method: 'POST', headers: { host: '127.0.0.1:3000', ...cabeceras } });

  it('rechaza una escritura de otro sitio aunque no traiga Origin', () => {
    for (const sitio of ['cross-site', 'same-site', 'none'])
      expect(rechazoAcceso(pedido({ 'sec-fetch-site': sitio }), { escritura: true })?.status).toBe(403);
    expect(
      rechazoAcceso(pedido({ origin: origen, 'sec-fetch-site': 'cross-site' }), { escritura: true })?.status,
    ).toBe(403);
  });

  it('acepta la propia aplicación y los clientes que no son navegador', () => {
    expect(rechazoAcceso(pedido({ 'sec-fetch-site': 'same-origin' }), { escritura: true })).toBeNull();
    expect(rechazoAcceso(pedido({ origin: origen, 'sec-fetch-site': 'same-origin' }), { escritura: true })).toBeNull();
    // curl, scripts y pruebas no envían ninguna de las dos.
    expect(rechazoAcceso(pedido({}), { escritura: true })).toBeNull();
    // Origin ajeno sigue rechazado; una lectura no mira Sec-Fetch-Site.
    expect(rechazoAcceso(pedido({ origin: 'https://malicioso.test' }), { escritura: true })?.status).toBe(403);
    expect(rechazoAcceso(pedido({ 'sec-fetch-site': 'cross-site' }))).toBeNull();
  });
});

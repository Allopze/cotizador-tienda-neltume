import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, vi } from 'vitest';

// Instalación temporal con base propia y sesiones reales de Better Auth, para probar rutas de /api.
// Cada prueba la monta (vi.resetModules + stubEnv) y la desmonta con `desmontar()`.
export const ORIGEN = 'http://127.0.0.1:3000';
export const CLAVE = 'clave-de-prueba-segura-123';
// Una IP distinta por inicio de sesión: el límite por IP (5 cada 15 minutos) no interfiere entre cuentas.
let ultimaIp = 0;

export async function montarInstalacion(prefijo: string) {
  const directorio = await mkdtemp(join(tmpdir(), `cotizador-${prefijo}-`));
  vi.stubEnv('BETTER_AUTH_SECRET', 'vitest-secret-0123456789abcdef-0123456789');
  vi.stubEnv('BETTER_AUTH_URL', ORIGEN);
  vi.stubEnv('NELTUME_DATA_DIR', directorio);
  vi.stubEnv('NELTUME_DB_PATH', join(directorio, 'cotizador.sqlite'));
  vi.stubEnv('NELTUME_RESPALDO_DIR', join(directorio, 'respaldos'));
  const { abrirBaseDatos, cerrarBaseDatos } = await import('../src/servidor/base-datos');
  const { migrarEsquemaAutenticacion } = await import('../src/servidor/autenticacion-config');
  const db = abrirBaseDatos();
  await migrarEsquemaAutenticacion(db);
  const { auth } = await import('../src/servidor/autenticacion');
  const contexto = await auth.$context;

  /** Crea una cuenta con la clave de prueba e inicia sesión; devuelve su id y la cookie. */
  const cuenta = async (email: string, role: 'admin' | 'user' = 'admin', nombre = 'Persona de prueba') => {
    const user = await contexto.internalAdapter.createUser(
      { email, name: nombre, emailVerified: true, role },
      { method: 'admin' },
    );
    await contexto.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await contexto.password.hash(CLAVE),
    });
    const login = await auth.handler(
      new Request(`${ORIGEN}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { origin: ORIGEN, 'content-type': 'application/json', 'cf-connecting-ip': `192.0.2.${(ultimaIp++ % 250) + 1}` },
        body: JSON.stringify({ email, password: CLAVE }),
      }),
    );
    expect(login.ok).toBe(true);
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(';', 1)[0])
      .join('; ');
    return { id: user.id, cookie };
  };

  /** Solicitud con Host y Origin de la aplicación; con `json` va como POST salvo que se indique el método. */
  const peticion = (
    ruta: string,
    opciones: { cookie?: string; json?: unknown; metodo?: string; cabeceras?: Record<string, string> } = {},
  ) => {
    const conCuerpo = opciones.json !== undefined;
    return new Request(`${ORIGEN}${ruta}`, {
      method: opciones.metodo ?? (conCuerpo ? 'POST' : 'GET'),
      headers: {
        host: '127.0.0.1:3000',
        origin: ORIGEN,
        ...(opciones.cookie ? { cookie: opciones.cookie } : {}),
        ...(conCuerpo ? { 'content-type': 'application/json' } : {}),
        ...opciones.cabeceras,
      },
      ...(conCuerpo ? { body: JSON.stringify(opciones.json) } : {}),
    });
  };

  const desmontar = async () => {
    cerrarBaseDatos();
    vi.unstubAllEnvs();
    vi.resetModules();
    await rm(directorio, { recursive: true, force: true });
  };

  return { directorio, db, auth, contexto, cuenta, peticion, desmontar };
}

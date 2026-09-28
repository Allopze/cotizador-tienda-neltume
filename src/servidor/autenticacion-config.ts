import type Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { admin } from 'better-auth/plugins';

const DURACION_SESION_SEGUNDOS = 12 * 60 * 60;
const SECRETO_DESARROLLO = 'neltume-cotizador-only-for-local-development-change-before-deploy';
const HOSTS_LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

function origenesPermitidos(baseURL: string, request?: Request) {
  const origenes = new Set([
    baseURL,
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3100',
    'http://localhost:3000',
    'http://localhost:3100',
    'http://[::1]:3000',
    'http://[::1]:3100',
  ]);

  for (const host of (process.env.NELTUME_HOSTS ?? '').split(',').map((v) => v.trim()).filter(Boolean)) {
    try {
      const url = new URL(host.includes('://') ? host : `https://${host}`);
      origenes.add(url.origin);
    } catch {
      // Un Host inválido seguirá rechazándose en src/servidor/acceso.ts.
    }
  }

  if (process.env.NODE_ENV !== 'production' && request) {
    const origen = request.headers.get('origin') ?? request.headers.get('referer');
    const host = request.headers.get('host');

    if (origen && host && URL.canParse(origen)) {
      const url = new URL(origen);
      if (
        url.protocol === 'http:' &&
        HOSTS_LOOPBACK.has(url.hostname) &&
        url.host.toLowerCase() === host.toLowerCase()
      ) {
        origenes.add(url.origin);
      }
    }
  }

  return [...origenes];
}

export function opcionesAutenticacion(
  database: Database.Database,
): BetterAuthOptions & { plugins: ReturnType<typeof admin>[] } {
  const baseURL = process.env.BETTER_AUTH_URL ?? 'http://127.0.0.1:3000';
  const secret = process.env.BETTER_AUTH_SECRET ?? SECRETO_DESARROLLO;

  return {
    appName: 'Neltume Cotizador',
    baseURL,
    basePath: '/api/auth',
    secret,
    database,
    trustedOrigins: (request) => origenesPermitidos(baseURL, request),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: DURACION_SESION_SEGUNDOS,
      updateAge: DURACION_SESION_SEGUNDOS,
      storeSessionInDatabase: true,
    },
    rateLimit: {
      enabled: true,
      storage: 'database' as const,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 15 * 60, max: 5 },
      },
    },
    plugins: [admin({ defaultRole: 'user' })],
  };
}

export function crearAutenticacion(database: Database.Database) {
  return betterAuth(opcionesAutenticacion(database));
}

export type Autenticacion = ReturnType<typeof crearAutenticacion>;

export function validarConfiguracionAutenticacion() {
  if (process.env.NODE_ENV !== 'production') return;

  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('Configura BETTER_AUTH_SECRET con al menos 32 caracteres antes de iniciar en producción.');
  }
  if (
    !process.env.BETTER_AUTH_URL ||
    !URL.canParse(process.env.BETTER_AUTH_URL) ||
    new URL(process.env.BETTER_AUTH_URL).protocol !== 'https:'
  ) {
    throw new Error('Configura BETTER_AUTH_URL con el origen HTTPS público antes de iniciar en producción.');
  }
}

export async function migrarEsquemaAutenticacion(database: Database.Database) {
  const migracion = await getMigrations(opcionesAutenticacion(database));
  if (migracion.schemaProblems.length || migracion.unsafeChanges.length) {
    throw new Error(
      [...migracion.schemaProblems, ...migracion.unsafeChanges].join('\n'),
    );
  }
  await migracion.runMigrations();
}

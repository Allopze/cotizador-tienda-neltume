import type Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import { getMigrations } from 'better-auth/db/migration';
import { admin } from 'better-auth/plugins';
import { HOSTNAMES_LOOPBACK, hostsConfigurados } from './acceso';

const DURACION_SESION_SEGUNDOS = 12 * 60 * 60;
const SECRETO_DESARROLLO = 'neltume-cotizador-only-for-local-development-change-before-deploy';
const ORIGENES_LOOPBACK = [
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3100',
  'http://localhost:3000',
  'http://localhost:3100',
  'http://[::1]:3000',
  'http://[::1]:3100',
];
export const MAX_FALLOS_POR_CORREO = 10;
const VENTANA_FALLOS_MS = 15 * 60 * 1000;
const MAX_CORREOS_REGISTRADOS = 5000;

const produccion = () => process.env.NODE_ENV === 'production';

// Las cuentas se gestionan solo con scripts/usuarios.ts; el plugin admin no se expone por HTTP.
export const esRutaAdminAuth = (pathname: string) => /^\/api\/auth\/+admin(\/|$)/i.test(pathname);

export function secretoAutenticacion() {
  const secreto = process.env.BETTER_AUTH_SECRET || '';
  // En producción validarConfiguracionAutenticacion() rechaza cada solicitud sin secreto; aquí no se
  // lanza para que `next build` pueda evaluar los módulos sin variables de ejecución.
  if (secreto || produccion()) return secreto || SECRETO_DESARROLLO;
  if (hostsConfigurados().length)
    throw new Error(
      'NELTUME_HOSTS está configurado pero falta BETTER_AUTH_SECRET: no se usa el secreto de desarrollo en una instancia expuesta. Genera uno con `openssl rand -base64 32`.',
    );
  return SECRETO_DESARROLLO;
}

function origenesPermitidos(baseURL: string, request?: Request) {
  const origenes = new Set([baseURL]);
  for (const { origen } of hostsConfigurados()) origenes.add(origen);
  if (produccion()) return [...origenes];

  for (const origen of ORIGENES_LOOPBACK) origenes.add(origen);
  if (request) {
    const origen = request.headers.get('origin') ?? request.headers.get('referer');
    const host = request.headers.get('host');

    if (origen && host && URL.canParse(origen)) {
      const url = new URL(origen);
      if (
        url.protocol === 'http:' &&
        HOSTNAMES_LOOPBACK.has(url.hostname) &&
        url.host.toLowerCase() === host.toLowerCase()
      ) {
        origenes.add(url.origin);
      }
    }
  }
  return [...origenes];
}

const correoDe = (body: unknown) => {
  const email = (body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : null;
};

// Complementa el límite por IP: frena la fuerza bruta distribuida contra una misma cuenta.
// En memoria: `next start` corre en un solo proceso; un reinicio borra los contadores.
function limitePorCorreo() {
  const fallos = new Map<string, { cantidad: number; desde: number }>();
  const vigente = (email: string, ahora: number) => {
    const registro = fallos.get(email);
    if (registro && ahora - registro.desde > VENTANA_FALLOS_MS) {
      fallos.delete(email);
      return undefined;
    }
    return registro;
  };
  const podar = (ahora: number) => {
    for (const [email, registro] of fallos)
      if (ahora - registro.desde > VENTANA_FALLOS_MS) fallos.delete(email);
  };

  return {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.request && esRutaAdminAuth(new URL(ctx.request.url).pathname)) throw new APIError('NOT_FOUND');
      if (ctx.path !== '/sign-in/email') return;
      const email = correoDe(ctx.body);
      if (email && (vigente(email, Date.now())?.cantidad ?? 0) >= MAX_FALLOS_POR_CORREO)
        throw new APIError('TOO_MANY_REQUESTS', {
          message: 'Demasiados intentos fallidos para esta cuenta. Espera unos minutos.',
        });
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-in/email') return;
      const email = correoDe(ctx.body);
      if (!email) return;
      const resultado = ctx.context.returned;
      if (!isAPIError(resultado)) {
        fallos.delete(email);
        return;
      }
      if (resultado.statusCode !== 401) return;
      const ahora = Date.now();
      const registro = vigente(email, ahora);
      if (registro) registro.cantidad += 1;
      else {
        if (fallos.size >= MAX_CORREOS_REGISTRADOS) podar(ahora);
        fallos.set(email, { cantidad: 1, desde: ahora });
      }
    }),
  };
}

export function opcionesAutenticacion(
  database: Database.Database,
): BetterAuthOptions & { plugins: ReturnType<typeof admin>[] } {
  const baseURL = process.env.BETTER_AUTH_URL || 'http://127.0.0.1:3000';
  const secret = secretoAutenticacion();

  return {
    appName: 'Neltume Cotizador',
    baseURL,
    basePath: '/api/auth',
    secret,
    database,
    trustedOrigins: (request) => origenesPermitidos(baseURL, request),
    // Better Auth desactiva estas comprobaciones si NODE_ENV=test o TEST está definido: se fijan explícitas.
    advanced: {
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'] },
    },
    hooks: limitePorCorreo(),
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
  if (!produccion()) {
    secretoAutenticacion();
    return;
  }

  const test = (process.env.TEST ?? '').trim().toLowerCase();
  if (test && test !== '0' && test !== 'false')
    throw new Error('La variable TEST no debe estar definida en producción.');
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      'Configura BETTER_AUTH_SECRET con al menos 32 caracteres antes de iniciar en producción.',
    );
  }
  const baseURL = process.env.BETTER_AUTH_URL;
  if (!baseURL || !URL.canParse(baseURL) || new URL(baseURL).protocol !== 'https:') {
    throw new Error('Configura BETTER_AUTH_URL con el origen HTTPS público antes de iniciar en producción.');
  }
  const { hostname } = new URL(baseURL);
  if (!HOSTNAMES_LOOPBACK.has(hostname) && !hostsConfigurados().some((h) => h.hostname === hostname)) {
    throw new Error(
      `El hostname de BETTER_AUTH_URL (${hostname}) debe figurar en NELTUME_HOSTS; de lo contrario el filtro de Host rechazará todas las solicitudes.`,
    );
  }
}

export async function migrarEsquemaAutenticacion(database: Database.Database) {
  const migracion = await getMigrations(opcionesAutenticacion(database));
  if (migracion.schemaProblems.length || migracion.unsafeChanges.length) {
    throw new Error([...migracion.schemaProblems, ...migracion.unsafeChanges].join('\n'));
  }
  await migracion.runMigrations();
}

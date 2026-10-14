import type Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware, getIP, isAPIError } from 'better-auth/api';
import { getMigrations } from 'better-auth/db/migration';
import { admin } from 'better-auth/plugins';
import { HOSTNAMES_LOOPBACK, hostsConfigurados } from './acceso';
import { registrarInicioSesion } from './auditoria-cuentas';
import { describirDispositivo } from './dispositivo';

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

/**
 * Cabecera de la que se toma la IP del cliente para el límite de intentos (NELTUME_IP_HEADER). Solo se confía en
 * la que pone el proxy que está delante: si se leyera otra, cualquiera podría inventarla en cada intento y saltarse
 * el límite por IP.
 * - `cf-connecting-ip` (predeterminada): Cloudflare Tunnel o un proxy de Cloudflare, que reemplazan la cabecera.
 * - `x-real-ip`: Nginx con `proxy_set_header X-Real-IP $remote_addr;`.
 * - `x-forwarded-for`: un proxy que la reemplaza por la IP del cliente (Caddy por omisión). Si trae varias IP
 *   (una la agregó el propio cliente), Better Auth no elige ninguna y esa solicitud cae en la cubeta compartida.
 * - `ninguna`: sin proxy de confianza. Riesgo de cubeta compartida: todas las personas cuentan como una sola IP, y
 *   pocos intentos fallidos de cualquiera (5 en 15 minutos) bloquean el inicio de sesión de todas por un rato.
 *   El límite por correo (MAX_FALLOS_POR_CORREO) sigue aplicándose a cada cuenta.
 */
export const CABECERAS_IP_CLIENTE = ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for', 'ninguna'] as const;
export type CabeceraIpCliente = (typeof CABECERAS_IP_CLIENTE)[number];

export function cabeceraIpCliente(valor = process.env.NELTUME_IP_HEADER): CabeceraIpCliente {
  const normalizado = (valor ?? '').trim().toLowerCase() || 'cf-connecting-ip';
  if (!(CABECERAS_IP_CLIENTE as readonly string[]).includes(normalizado))
    throw new Error(
      `NELTUME_IP_HEADER no es válida (${normalizado.slice(0, 40)}). Usa una de: ${CABECERAS_IP_CLIENTE.join(', ')}.`,
    );
  return normalizado as CabeceraIpCliente;
}

// Las cuentas se gestionan desde rutas propias y scripts/usuarios.ts; el plugin admin no se expone por HTTP.
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

/** Lo que responde Better Auth ante una contraseña incorrecta; una cuenta desactivada responde exactamente igual. */
const credencialesInvalidas = () =>
  new APIError('UNAUTHORIZED', { message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' });

const desactivada = (usuario: unknown) => {
  const u = usuario as { banned?: boolean | null; banExpires?: Date | string | null } | null | undefined;
  return !!u?.banned && (!u.banExpires || new Date(u.banExpires).getTime() > Date.now());
};

/**
 * Hooks del inicio de sesión:
 * - Límite por correo: complementa el límite por IP y frena la fuerza bruta distribuida contra una misma cuenta. En
 *   memoria: `next start` corre en un solo proceso; un reinicio borra los contadores.
 * - Cuenta desactivada: responde el mismo 401 que una contraseña incorrecta (el plugin admin respondería 403 y
 *   revelaría que la cuenta existe). Se calcula un hash para que la respuesta tarde lo mismo.
 * - Registro: cada inicio de sesión, correcto o fallido, queda en auditoria_cuentas con el dispositivo y la IP; nunca
 *   la contraseña.
 */
function hooksInicioSesion(database: Database.Database) {
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
  const contarFallo = (email: string) => {
    const ahora = Date.now();
    const registro = vigente(email, ahora);
    if (registro) registro.cantidad += 1;
    else {
      if (fallos.size >= MAX_CORREOS_REGISTRADOS) podar(ahora);
      fallos.set(email, { cantidad: 1, desde: ahora });
    }
  };
  const registrar = (ctx: { request?: Request; headers?: Headers; context: { options: BetterAuthOptions } }, email: string, correcto: boolean) => {
    const origen = ctx.request ?? ctx.headers;
    const ip = origen ? getIP(origen, ctx.context.options) : null;
    const dispositivo = describirDispositivo(origen ? ('headers' in origen ? origen.headers : origen).get('user-agent') : null);
    const detalle = [dispositivo, ip && `IP ${ip}`].filter(Boolean).join(' · ') || null;
    registrarInicioSesion(database, { correo: email, correcto, detalle });
  };

  return {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.request && esRutaAdminAuth(new URL(ctx.request.url).pathname)) throw new APIError('NOT_FOUND');
      if (ctx.path !== '/sign-in/email') return;
      const email = correoDe(ctx.body);
      if (!email) return;
      if ((vigente(email, Date.now())?.cantidad ?? 0) >= MAX_FALLOS_POR_CORREO)
        throw new APIError('TOO_MANY_REQUESTS', {
          message: 'Demasiados intentos fallidos para esta cuenta. Espera unos minutos.',
        });
      const encontrado = await ctx.context.internalAdapter.findUserByEmail(email);
      if (encontrado && desactivada(encontrado.user)) {
        const password = (ctx.body as { password?: unknown }).password;
        await ctx.context.password.hash(typeof password === 'string' ? password : '');
        contarFallo(email);
        registrar(ctx, email, false);
        throw credencialesInvalidas();
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-in/email') return;
      const email = correoDe(ctx.body);
      if (!email) return;
      const resultado = ctx.context.returned;
      if (!isAPIError(resultado)) {
        fallos.delete(email);
        registrar(ctx, email, true);
        return;
      }
      if (resultado.statusCode !== 401) return;
      contarFallo(email);
      registrar(ctx, email, false);
    }),
  };
}

export function opcionesAutenticacion(
  database: Database.Database,
): BetterAuthOptions & { plugins: ReturnType<typeof admin>[] } {
  const baseURL = process.env.BETTER_AUTH_URL || 'http://127.0.0.1:3000';
  const secret = secretoAutenticacion();
  const cabeceraIp = cabeceraIpCliente();

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
      // Una lista vacía (`ninguna`) no lee ninguna cabecera: todas las solicitudes comparten una sola cubeta.
      ipAddress: { ipAddressHeaders: cabeceraIp === 'ninguna' ? [] : [cabeceraIp] },
    },
    hooks: hooksInicioSesion(database),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
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
        '/change-password': { window: 15 * 60, max: 5 },
      },
    },
    plugins: [admin({ defaultRole: 'admin' })],
  };
}

export function crearAutenticacion(database: Database.Database) {
  return betterAuth(opcionesAutenticacion(database));
}

export type Autenticacion = ReturnType<typeof crearAutenticacion>;

export function validarConfiguracionAutenticacion() {
  cabeceraIpCliente();
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
  // Neltume no tiene cuentas de rol usuario: normaliza también las cuentas creadas por versiones anteriores.
  database.prepare('UPDATE "user" SET role = ? WHERE role IS NULL OR role <> ?').run('admin', 'admin');
}

import { z } from 'zod';
import { auth } from '@/servidor/autenticacion';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { registrarCambioCuenta, ultimosCambiosCuentas } from '@/servidor/auditoria-cuentas';
import { leerJson } from '@/servidor/cuerpo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const nuevaCuentaSchema = z
  .object({
    nombre: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(8).max(128),
  })
  .strict();

const sinCache = { 'Cache-Control': 'no-store' };

// Contraseña de quien hace el cambio: se exige para cambiar el correo o la contraseña de una cuenta.
const passwordActual = z.string().max(128).optional();

const accionUsuarioSchema = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('editar'), id: z.string().min(1), nombre: z.string().trim().min(1).max(120), email: z.string().trim().toLowerCase().email().max(254), passwordActual }).strict(),
  z.object({ accion: z.literal('activar'), id: z.string().min(1) }).strict(),
  z.object({ accion: z.literal('desactivar'), id: z.string().min(1) }).strict(),
  z.object({ accion: z.literal('restablecer-clave'), id: z.string().min(1), password: z.string().min(8).max(128), passwordActual }).strict(),
]);

// Confirmaciones fallidas por cuenta: con una sesión robada no se puede probar contraseñas sin límite.
const MAX_CONFIRMACIONES_FALLIDAS = 5;
const VENTANA_CONFIRMACION_MS = 15 * 60 * 1000;
const confirmacionesFallidas = new Map<string, { cantidad: number; desde: number }>();

type Contexto = Awaited<typeof auth.$context>;

/**
 * Cambiar el correo o la contraseña de una cuenta permite tomarla: con una sesión ajena abierta en un equipo
 * compartido bastaría un clic. Por eso se pide la contraseña de quien hace el cambio. Devuelve la respuesta de error
 * o `null` si la confirmación es correcta.
 */
async function rechazoConfirmacion(contexto: Contexto, actorId: string, password: string | undefined) {
  const ahora = Date.now();
  const registro = confirmacionesFallidas.get(actorId);
  if (registro && ahora - registro.desde > VENTANA_CONFIRMACION_MS) confirmacionesFallidas.delete(actorId);
  if ((confirmacionesFallidas.get(actorId)?.cantidad ?? 0) >= MAX_CONFIRMACIONES_FALLIDAS)
    return Response.json(
      { error: 'Demasiados intentos con una contraseña incorrecta. Espera unos minutos.', codigo: 'confirmar_clave' },
      { status: 429, headers: sinCache },
    );
  if (!password)
    return Response.json(
      { error: 'Escribe tu contraseña para confirmar el cambio.', codigo: 'confirmar_clave' },
      { status: 400, headers: sinCache },
    );
  const cuenta = await contexto.internalAdapter.findCredentialAccount(actorId);
  const correcta = !!cuenta?.password && (await contexto.password.verify({ hash: cuenta.password, password }));
  if (correcta) {
    confirmacionesFallidas.delete(actorId);
    return null;
  }
  const vigente = confirmacionesFallidas.get(actorId);
  if (vigente) vigente.cantidad += 1;
  else confirmacionesFallidas.set(actorId, { cantidad: 1, desde: ahora });
  return Response.json(
    { error: 'Tu contraseña no es correcta.', codigo: 'confirmar_clave' },
    { status: 403, headers: sinCache },
  );
}

async function listarUsuarios() {
  const contexto = await auth.$context;
  const usuarios = await contexto.internalAdapter.listUsers(1000, 0);
  return usuarios.map((usuario) => {
    const u = usuario as typeof usuario & { role?: string | null; banned?: boolean; banReason?: string | null };
    return {
      id: u.id,
      nombre: u.name,
      email: u.email,
      rol: u.role ?? 'admin',
      activo: !u.banned,
      creado: u.createdAt,
      actualizado: u.updatedAt,
    };
  });
}

/** Lista de cuentas, la cuenta de quien consulta y los últimos cambios de cuentas (quién hizo qué a quién). */
async function respuestaCuentas(actual: string) {
  return Response.json(
    { usuarios: await listarUsuarios(), actual, cambios: ultimosCambiosCuentas() },
    { headers: sinCache },
  );
}

export async function GET(req: Request) {
  const sesion = await exigirSesion(req, { rol: 'admin' });
  if (!sesion.ok) return sesion.respuesta;
  try {
    return await respuestaCuentas(sesion.usuario.id);
  } catch {
    return Response.json({ error: 'No se pudo leer las cuentas.' }, { status: 500, headers: sinCache });
  }
}

export async function PATCH(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true, rol: 'admin' });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = accionUsuarioSchema.safeParse(cuerpo.valor);
  if (!parsed.success)
    return Response.json({ error: parsed.error.issues[0]?.message ?? 'Datos de cuenta inválidos.' }, { status: 400, headers: sinCache });
  try {
    const contexto = await auth.$context;
    const usuarios = await contexto.internalAdapter.listUsers(1000, 0);
    const objetivo = usuarios.find((usuario) => usuario.id === parsed.data.id);
    if (!objetivo) return Response.json({ error: 'No se encontró la cuenta.' }, { status: 404, headers: sinCache });
    const cuenta = objetivo as typeof objetivo & { role?: string | null; banned?: boolean };
    const actor = sesion.usuario.email;
    let descripcionObjetivo = objetivo.email;
    const cambiaAcceso =
      parsed.data.accion === 'restablecer-clave' ||
      (parsed.data.accion === 'editar' && parsed.data.email !== objetivo.email.toLowerCase());
    if (cambiaAcceso) {
      const confirmacion = 'passwordActual' in parsed.data ? parsed.data.passwordActual : undefined;
      const rechazo = await rechazoConfirmacion(contexto, sesion.usuario.id, confirmacion);
      if (rechazo) return rechazo;
    }
    if (parsed.data.accion === 'editar') {
      const existente = await contexto.internalAdapter.findUserByEmail(parsed.data.email);
      if (existente && existente.user.id !== objetivo.id)
        return Response.json({ error: 'Ya existe una cuenta con ese correo.' }, { status: 409, headers: sinCache });
      await contexto.internalAdapter.updateUser(objetivo.id, {
        name: parsed.data.nombre,
        email: parsed.data.email,
        emailVerified: true,
      });
      const antes = [
        parsed.data.email !== objetivo.email ? `correo antes: ${objetivo.email}` : '',
        parsed.data.nombre !== objetivo.name ? `nombre antes: ${objetivo.name}` : '',
      ].filter(Boolean);
      descripcionObjetivo = antes.length ? `${parsed.data.email} (${antes.join('; ')})` : parsed.data.email;
    } else if (parsed.data.accion === 'desactivar') {
      // La interfaz ya oculta el botón; la API también lo impide: quien se desactiva pierde su propia sesión.
      if (objetivo.id === sesion.usuario.id)
        return Response.json(
          { error: 'No puedes desactivar tu propia cuenta. Pide a otra persona administradora que lo haga.' },
          { status: 409, headers: sinCache },
        );
      const activos = usuarios.filter((usuario) => {
        const u = usuario as typeof cuenta;
        return (u.role ?? 'admin') === 'admin' && !u.banned;
      });
      if (!cuenta.banned && activos.length <= 1)
        return Response.json({ error: 'No se puede desactivar la última cuenta administradora.' }, { status: 409, headers: sinCache });
      await contexto.internalAdapter.updateUser(objetivo.id, { banned: true, banReason: 'Cuenta desactivada desde Ajustes.', banExpires: null });
      await contexto.internalAdapter.deleteUserSessions(objetivo.id);
    } else if (parsed.data.accion === 'activar') {
      await contexto.internalAdapter.updateUser(objetivo.id, { banned: false, banReason: null, banExpires: null });
    } else {
      const hash = await contexto.password.hash(parsed.data.password);
      if (await contexto.internalAdapter.findCredentialAccount(objetivo.id)) await contexto.internalAdapter.updatePassword(objetivo.id, hash);
      else await contexto.internalAdapter.createAccount({ userId: objetivo.id, providerId: 'credential', accountId: objetivo.id, password: hash });
      await contexto.internalAdapter.deleteUserSessions(objetivo.id);
    }
    registrarCambioCuenta({ actor, objetivo: descripcionObjetivo, accion: parsed.data.accion });
    return await respuestaCuentas(sesion.usuario.id);
  } catch (error) {
    console.error('[usuarios] fallo al actualizar cuenta:', error instanceof Error ? error.name : 'desconocido');
    return Response.json({ error: 'No se pudo actualizar la cuenta.' }, { status: 500, headers: sinCache });
  }
}

export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true, rol: 'admin' });
  if (!sesion.ok) return sesion.respuesta;

  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = nuevaCuentaSchema.safeParse(cuerpo.valor);
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos de cuenta inválidos.' },
      { status: 400, headers: sinCache },
    );

  const { nombre, email, password } = parsed.data;
  let contexto: Awaited<typeof auth.$context> | undefined;
  try {
    contexto = await auth.$context;
    if (await contexto.internalAdapter.findUserByEmail(email))
      return Response.json(
        { error: 'Ya existe una cuenta con ese correo.' },
        { status: 409, headers: sinCache },
      );

    const usuario = await contexto.internalAdapter.createUser(
      { email, name: nombre, emailVerified: true, role: 'admin' },
      { method: 'admin' },
    );
    if (!usuario) throw new Error('No se pudo crear el usuario.');

    try {
      const hash = await contexto.password.hash(password);
      await contexto.internalAdapter.linkAccount({
        userId: usuario.id,
        providerId: 'credential',
        accountId: usuario.id,
        password: hash,
      });
    } catch (error) {
      try {
        await contexto.internalAdapter.deleteUser(usuario.id);
      } catch {
        // Conserva el error original; nunca se registra la contraseña ni el cuerpo de la petición.
      }
      throw error;
    }
    registrarCambioCuenta({ actor: sesion.usuario.email, objetivo: usuario.email, accion: 'crear' });

    return Response.json(
      { usuario: { email: usuario.email, nombre: usuario.name, rol: 'admin' } },
      { status: 201, headers: sinCache },
    );
  } catch (error) {
    if (contexto) {
      const existente = await contexto.internalAdapter.findUserByEmail(email).catch(() => null);
      if (existente)
        return Response.json(
          { error: 'Ya existe una cuenta con ese correo.' },
          { status: 409, headers: sinCache },
        );
    }
    console.error('[usuarios] fallo al crear cuenta:', error instanceof Error ? error.name : 'desconocido');
    return Response.json({ error: 'No se pudo crear la cuenta.' }, { status: 500, headers: sinCache });
  }
}

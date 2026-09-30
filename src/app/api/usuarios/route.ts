import { z } from 'zod';
import { auth } from '@/servidor/autenticacion';
import { exigirSesion } from '@/servidor/acceso-autenticado';
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

const accionUsuarioSchema = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('editar'), id: z.string().min(1), nombre: z.string().trim().min(1).max(120), email: z.string().trim().toLowerCase().email().max(254) }).strict(),
  z.object({ accion: z.literal('activar'), id: z.string().min(1) }).strict(),
  z.object({ accion: z.literal('desactivar'), id: z.string().min(1) }).strict(),
  z.object({ accion: z.literal('restablecer-clave'), id: z.string().min(1), password: z.string().min(8).max(128) }).strict(),
]);

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

export async function GET(req: Request) {
  const sesion = await exigirSesion(req, { rol: 'admin' });
  if (!sesion.ok) return sesion.respuesta;
  try {
    return Response.json({ usuarios: await listarUsuarios(), actual: sesion.usuario.id }, { headers: sinCache });
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
    if (parsed.data.accion === 'editar') {
      const existente = await contexto.internalAdapter.findUserByEmail(parsed.data.email);
      if (existente && existente.user.id !== objetivo.id)
        return Response.json({ error: 'Ya existe una cuenta con ese correo.' }, { status: 409, headers: sinCache });
      await contexto.internalAdapter.updateUser(objetivo.id, {
        name: parsed.data.nombre,
        email: parsed.data.email,
        emailVerified: true,
      });
    } else if (parsed.data.accion === 'desactivar') {
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
    return Response.json({ usuarios: await listarUsuarios(), actual: sesion.usuario.id }, { headers: sinCache });
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

import { z } from 'zod';
import { rechazoAcceso } from '@/servidor/acceso';
import { ACTOR_PRIMER_ARRANQUE, registrarCambioCuenta } from '@/servidor/auditoria-cuentas';
import { validarConfiguracionAutenticacion } from '@/servidor/autenticacion-config';
import { leerJson } from '@/servidor/cuerpo';
import {
  asegurarCodigoPrimerArranque,
  borrarCodigoPrimerArranque,
  codigoPrimerArranqueValido,
  enExclusiva,
  hayCuentas,
} from '@/servidor/primer-arranque';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sinCache = { 'Cache-Control': 'no-store' };
// Con al menos una cuenta la ruta no existe: no revela nada ni permite crear otra.
const noEncontrada = () => Response.json({ error: 'No encontrado.' }, { status: 404, headers: sinCache });

const primeraCuentaSchema = z
  .object({
    codigo: z.string().trim().min(1, 'Ingresa el código del registro del servidor.').max(64),
    nombre: z.string().trim().min(1, 'Ingresa tu nombre.').max(120),
    email: z.string().trim().toLowerCase().email('Ingresa un correo válido.').max(254),
    password: z
      .string()
      .min(8, 'La contraseña debe tener al menos 8 caracteres.')
      .max(128, 'La contraseña debe tener como máximo 128 caracteres.'),
  })
  .strict();

/** Indica si falta crear la primera cuenta y, si falta, deja un código vigente en el registro del servidor. */
export async function GET(req: Request) {
  const rechazo = rechazoAcceso(req);
  if (rechazo) return rechazo;
  if (hayCuentas()) return noEncontrada();
  const codigo = asegurarCodigoPrimerArranque();
  return Response.json({ pendiente: true, vence: codigo?.vence ?? null }, { headers: sinCache });
}

/** Crea la primera cuenta administradora con el código de un solo uso. */
export async function POST(req: Request) {
  const rechazo = rechazoAcceso(req, { escritura: true });
  if (rechazo) return rechazo;
  validarConfiguracionAutenticacion();
  if (hayCuentas()) return noEncontrada();
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = primeraCuentaSchema.safeParse(cuerpo.valor);
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Datos de cuenta inválidos.' },
      { status: 400, headers: sinCache },
    );
  const { codigo, nombre, email, password } = parsed.data;

  return enExclusiva(async () => {
    if (hayCuentas()) return noEncontrada();
    if (!codigoPrimerArranqueValido(codigo))
      return Response.json(
        {
          error:
            'El código no es válido o ya venció. Copia el último código que aparece en el registro del servidor.',
        },
        { status: 403, headers: sinCache },
      );
    const { auth } = await import('@/servidor/autenticacion');
    const contexto = await auth.$context;
    let usuario: Awaited<ReturnType<typeof contexto.internalAdapter.createUser>> | undefined;
    try {
      usuario = await contexto.internalAdapter.createUser(
        { email, name: nombre, emailVerified: true, role: 'admin' },
        { method: 'admin' },
      );
      if (!usuario) throw new Error('No se pudo crear el usuario.');
      await contexto.internalAdapter.linkAccount({
        userId: usuario.id,
        providerId: 'credential',
        accountId: usuario.id,
        password: await contexto.password.hash(password),
      });
    } catch (error) {
      if (usuario) await contexto.internalAdapter.deleteUser(usuario.id).catch(() => undefined);
      // Nunca se registra la contraseña ni el cuerpo de la petición.
      console.error('[primer-arranque] fallo al crear la cuenta:', error instanceof Error ? error.name : 'desconocido');
      return Response.json(
        { error: 'No se pudo crear la cuenta. Vuelve a intentarlo.' },
        { status: 500, headers: sinCache },
      );
    }
    borrarCodigoPrimerArranque();
    registrarCambioCuenta({ actor: ACTOR_PRIMER_ARRANQUE, objetivo: usuario.email, accion: 'crear-primera' });
    return Response.json(
      { usuario: { email: usuario.email, nombre: usuario.name, rol: 'admin' } },
      { status: 201, headers: sinCache },
    );
  });
}

import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import {
  migrarEsquemaAutenticacion,
  validarConfiguracionAutenticacion,
} from '../src/servidor/autenticacion-config';

const emailSchema = z.string().trim().toLowerCase().email();
const comando = process.argv[2];
const email = emailSchema.safeParse(process.argv[3] ?? '');
const extras = process.argv.slice(4).filter((value) => value !== '--admin');
const nombre = extras.join(' ').trim();

function pedirClave(mensaje: string) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error(
      'Ejecuta este comando en una terminal interactiva para ingresar la contraseña de forma segura.',
    );
  }

  return new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;
    const caracteres: string[] = [];
    const decoder = new StringDecoder('utf8');
    let finalizado = false;
    const rawAnterior = stdin.isRaw;

    const terminar = (error?: Error) => {
      if (finalizado) return;
      finalizado = true;
      stdin.off('data', recibir);
      stdin.setRawMode(rawAnterior ?? false);
      stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(caracteres.join(''));
    };

    const recibir = (dato: Buffer) => {
      for (const caracter of decoder.write(dato)) {
        if (caracter === '\u0003') return terminar(new Error('Operación cancelada.'));
        if (caracter === '\r' || caracter === '\n') return terminar();
        if (caracter === '\b' || caracter === '\u007f') {
          if (caracteres.length) {
            caracteres.pop();
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (caracter >= ' ') {
          caracteres.push(caracter);
          process.stdout.write('*');
        }
      }
    };

    process.stdout.write(mensaje);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.on('data', recibir);
  });
}

function uso() {
  console.log(`
Gestión local de cuentas:
  npm run usuarios -- crear <correo> [nombre]
  npm run usuarios -- desactivar <correo>
  npm run usuarios -- activar <correo>
  npm run usuarios -- restablecer-clave <correo>

Las contraseñas se solicitan en la terminal y no se pasan como argumento.
`);
}

async function principal() {
  if (!['crear', 'desactivar', 'activar', 'restablecer-clave'].includes(comando ?? '') || !email.success) {
    uso();
    process.exitCode = 2;
    return;
  }

  validarConfiguracionAutenticacion();
  const database = abrirBaseDatos();
  await migrarEsquemaAutenticacion(database);
  const { auth } = await import('../src/servidor/autenticacion');
  const context = await auth.$context;
  const existente = await context.internalAdapter.findUserByEmail(email.data);

  if (comando === 'crear') {
    if (existente) throw new Error('Ya existe una cuenta con ese correo.');
    const clave = await pedirClave('Contraseña (mínimo 12 caracteres): ');
    if (clave.length < 12) throw new Error('La contraseña debe tener al menos 12 caracteres.');
    const usuarioNuevo = await context.internalAdapter.createUser(
      {
        email: email.data,
        name: nombre || email.data.split('@')[0],
        emailVerified: true,
        role: 'admin',
      },
      { method: 'admin' },
    );
    try {
      const hash = await context.password.hash(clave);
      await context.internalAdapter.linkAccount({
        userId: usuarioNuevo.id,
        providerId: 'credential',
        accountId: usuarioNuevo.id,
        password: hash,
      });
    } catch (error) {
      await context.internalAdapter.deleteUser(usuarioNuevo.id);
      throw error;
    }
    console.log(`Cuenta admin creada: ${usuarioNuevo.email}.`);
    return;
  }

  if (!existente) throw new Error('No existe una cuenta con ese correo.');
  const usuario = existente.user as typeof existente.user & { role?: string; banned?: boolean };

  if (comando === 'desactivar') {
    if (usuario.role === 'admin' && !usuario.banned) {
      const usuarios = await context.internalAdapter.listUsers(1000, 0);
      const adminsActivos = usuarios.filter((u) => {
        const cuenta = u as typeof usuario;
        return cuenta.role === 'admin' && !cuenta.banned;
      });
      if (adminsActivos.length <= 1)
        throw new Error('No se puede desactivar la última cuenta administradora.');
    }
    await context.internalAdapter.updateUser(usuario.id, {
      banned: true,
      banReason: 'Cuenta desactivada por operación local.',
      banExpires: null,
    });
    await context.internalAdapter.deleteUserSessions(usuario.id);
    console.log(`Cuenta desactivada: ${email.data}.`);
    return;
  }

  if (comando === 'activar') {
    await context.internalAdapter.updateUser(usuario.id, {
      banned: false,
      banReason: null,
      banExpires: null,
    });
    console.log(`Cuenta activada: ${email.data}.`);
    return;
  }

  const clave = await pedirClave('Nueva contraseña (mínimo 12 caracteres): ');
  if (clave.length < 12) throw new Error('La contraseña debe tener al menos 12 caracteres.');
  const hash = await context.password.hash(clave);
  if (await context.internalAdapter.findCredentialAccount(usuario.id)) {
    await context.internalAdapter.updatePassword(usuario.id, hash);
  } else {
    await context.internalAdapter.createAccount({
      userId: usuario.id,
      providerId: 'credential',
      accountId: usuario.id,
      password: hash,
    });
  }
  await context.internalAdapter.deleteUserSessions(usuario.id);
  console.log(`Contraseña restablecida y sesiones revocadas: ${email.data}.`);
}

principal().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'No se pudo completar la operación.');
  process.exitCode = 1;
});

// Textos y reglas del inicio de sesión y de la primera cuenta, sin React: se prueban en tests/login-formularios.test.ts
// y tests/pantalla-cuentas-compartir.test.ts.
import { correoValido } from '../error-campo';

/** Aviso de sesión vencida: el borrador solo se conserva en el cotizador. */
export function avisoSesionExpirada(desde: string | null) {
  return desde === 'cotizador'
    ? 'Tu sesión expiró. Vuelve a ingresar; tu borrador se conservó.'
    : 'Tu sesión expiró. Vuelve a ingresar para continuar.';
}

export type CampoPrimeraCuenta = 'codigo' | 'nombre' | 'correo' | 'clave' | 'repetida';

/** El campo al que corresponde un error del servidor: el código vencido (403) o el que nombra el mensaje (400). */
export function campoDelError(status: number, mensaje: string): CampoPrimeraCuenta | null {
  if (status === 403) return 'codigo';
  if (status !== 400) return null;
  if (/código/i.test(mensaje)) return 'codigo';
  if (/nombre/i.test(mensaje)) return 'nombre';
  if (/correo/i.test(mensaje)) return 'correo';
  if (/contraseña/i.test(mensaje)) return 'clave';
  return null;
}


/** Mismos límites que Better Auth (minPasswordLength / maxPasswordLength en autenticacion-config). */
export const CLAVE_PRIMERA_CUENTA = { minimo: 8, maximo: 128 } as const;

/**
 * Revisa el formulario de la primera cuenta antes de enviarlo, en el orden de los campos: el primer problema va junto
 * a su campo. null si se puede enviar; el servidor hace la validación definitiva.
 */
export function validarPrimeraCuenta(datos: {
  codigo: string;
  nombre: string;
  email: string;
  password: string;
  repetida: string;
}): { campo: CampoPrimeraCuenta; mensaje: string } | null {
  const { minimo, maximo } = CLAVE_PRIMERA_CUENTA;
  if (!datos.codigo.trim()) return { campo: 'codigo', mensaje: 'Pega el código que aparece en el registro del servidor.' };
  if (!datos.nombre.trim()) return { campo: 'nombre', mensaje: 'Escribe tu nombre.' };
  if (!datos.email.trim()) return { campo: 'correo', mensaje: 'Escribe tu correo electrónico.' };
  if (!correoValido(datos.email))
    return { campo: 'correo', mensaje: 'Revisa el correo: debe tener la forma nombre@dominio.cl.' };
  if (datos.password.length < minimo || datos.password.length > maximo)
    return { campo: 'clave', mensaje: `La contraseña debe tener entre ${minimo} y ${maximo} caracteres.` };
  if (datos.password !== datos.repetida)
    return { campo: 'repetida', mensaje: 'La confirmación no coincide con la contraseña.' };
  return null;
}

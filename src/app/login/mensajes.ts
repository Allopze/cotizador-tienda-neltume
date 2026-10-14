// Textos y reglas del inicio de sesión y de la primera cuenta, sin React: se prueban en tests/login-formularios.test.ts.

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


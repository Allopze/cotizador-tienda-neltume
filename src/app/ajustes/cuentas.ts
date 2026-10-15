// Textos y reglas de Ajustes → Usuarios, sin React: se prueban en tests/pantalla-cuentas-compartir.test.ts.
import type { AccionCuenta } from '@/servidor/auditoria-cuentas';

/** Cómo se lee cada movimiento del registro de cambios. Una acción nueva del servidor obliga a nombrarla aquí. */
export const ACCIONES_CUENTA: Record<AccionCuenta, string> = {
  crear: 'Creó la cuenta',
  'crear-primera': 'Creó la primera cuenta',
  editar: 'Editó la cuenta',
  desactivar: 'Desactivó la cuenta',
  activar: 'Activó la cuenta',
  'restablecer-clave': 'Restableció la contraseña',
  'inicio-sesion': 'Inició sesión',
  'inicio-sesion-fallido': 'Intento fallido de inicio de sesión',
};

/** El texto de un movimiento; uno que esta versión no conoce (de una versión más nueva) se muestra tal cual. */
export const textoAccionCuenta = (accion: string) =>
  (ACCIONES_CUENTA as Record<string, string | undefined>)[accion] ?? accion;

/** Fecha y hora de un movimiento en la hora de Chile, como «14 oct 2026, 09:30 p. m.». */
export const fechaHoraCuenta = (iso: string) =>
  new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * ¿Hay que avisar que queda una sola administradora? Cuentan solo las cuentas activas con rol de administración: una
 * desactivada no puede restablecer la contraseña de otra.
 */
export const faltaOtraAdministradora = (usuarios: readonly { rol: string; activo: boolean }[]) =>
  usuarios.filter((u) => u.activo && u.rol === 'admin').length < 2;

import { abrirBaseDatos } from './base-datos';
import {
  crearAutenticacion,
  validarConfiguracionAutenticacion,
} from './autenticacion-config';

export const auth = crearAutenticacion(abrirBaseDatos());

export async function obtenerSesion(headers: Headers) {
  validarConfiguracionAutenticacion();
  return auth.api.getSession({ headers });
}

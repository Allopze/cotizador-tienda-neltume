import { abrirBaseDatos } from './base-datos';
import { crearAutenticacion } from './autenticacion-config';

export const auth = crearAutenticacion(abrirBaseDatos());

import { abrirBaseDatos } from '../src/servidor/base-datos';
import {
  migrarEsquemaAutenticacion,
  validarConfiguracionAutenticacion,
} from '../src/servidor/autenticacion-config';

try {
  validarConfiguracionAutenticacion();
  await migrarEsquemaAutenticacion(abrirBaseDatos());
  console.log('Esquema de autenticación listo en la base SQLite configurada.');
} catch (error) {
  console.error('No se pudo migrar el esquema de autenticación.');
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
}

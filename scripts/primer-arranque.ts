import { abrirBaseDatos, cerrarBaseDatos } from '../src/servidor/base-datos';
import { asegurarCodigoPrimerArranque } from '../src/servidor/primer-arranque';

// Uso: npm run primer-arranque
// Lo ejecuta docker/iniciar.sh al iniciar el contenedor, después de migrar el esquema de cuentas. Si la base no
// tiene ninguna cuenta, escribe en el registro un código nuevo de un solo uso para crear la primera desde la página
// de inicio de sesión (el último código del registro es el que vale). Con cuentas, no hace nada.
try {
  const resultado = asegurarCodigoPrimerArranque({ db: abrirBaseDatos(), renovar: true });
  if (!resultado) console.log('Primer arranque: ya hay cuentas; no se genera código.');
} catch (error) {
  console.error('No se pudo preparar el código de primer arranque.');
  if (error instanceof Error) console.error(error.message);
  process.exitCode = 1;
} finally {
  cerrarBaseDatos();
}

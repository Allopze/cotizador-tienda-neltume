import { abrirBaseDatos, cerrarBaseDatos } from '../src/servidor/base-datos';
import { estadoFeriados, prepararFeriados } from '../src/servidor/feriados-sync';

// Uso: npm run feriados — sincroniza ahora el año en curso y el siguiente y muestra lo guardado.
async function main() {
  const db = abrirBaseDatos();
  await prepararFeriados(db, { forzar: true });
  const { sincronizaciones, feriados } = estadoFeriados(db);
  for (const s of sincronizaciones)
    console.log(
      `${s.anio}: ${s.sincronizado ? `sincronizado ${s.sincronizado}` : 'sin sincronizar'}${s.error ? ` · último error: ${s.error}` : ''}`,
    );
  console.log('');
  for (const f of feriados) console.log(`${f.fecha}  ${f.nombre}`);
}

main()
  .catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => cerrarBaseDatos());

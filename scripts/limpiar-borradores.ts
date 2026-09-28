import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';

// Uso: npm run limpiar-borradores -- [--dias 30] [--con-items] [--confirmar]
// Sin --confirmar solo lista lo que se eliminaría. Sin --con-items solo considera borradores vacíos.
const args = process.argv.slice(2);
const valor = (nombre: string) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
};
const dias = Number(valor('--dias') ?? 30);
const conItems = args.includes('--con-items');
const confirmar = args.includes('--confirmar');

async function main() {
  if (!Number.isInteger(dias) || dias < 1) throw new Error('--dias debe ser un entero mayor o igual a 1.');
  const almacen = new Almacen();
  const candidatos = almacen.borradoresAbandonados({ dias, conItems });
  if (!candidatos.length) {
    console.log(`No hay borradores ${conItems ? '' : 'vacíos '}sin actividad en los últimos ${dias} días.`);
    return;
  }
  for (const b of candidatos)
    console.log(
      `${b.actualizada.slice(0, 10)}  ${b.id}  ${b.cliente ?? '(sin cliente)'}  ${b.items} ítem(s)  ${b.creadaPor ?? ''}`,
    );
  if (!confirmar) {
    console.log(`\n${candidatos.length} borrador(es) se eliminarían. Repite con --confirmar para hacerlo.`);
    return;
  }
  const eliminados = await almacen.eliminarBorradores(candidatos.map((b) => b.id));
  console.log(`\nSe eliminaron ${eliminados} borrador(es).`);
}

main()
  .catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => cerrarAlmacen());

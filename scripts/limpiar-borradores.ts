import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { eliminarReferencias, referenciasHuerfanas } from '../src/servidor/archivos-referencia';
import { tamanoReferencia } from '../src/negocio/personalizados';

// Uso: npm run limpiar-borradores -- [--dias 30] [--con-items] [--confirmar]
// Sin --confirmar solo lista lo que se eliminaría. Sin --con-items solo considera borradores vacíos.
// También borra las referencias del cliente (data/referencias) que ya no usa ninguna cotización.
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
  await limpiarBorradores(almacen);
  // Después de los borradores: las referencias que solo usaban ellos quedan huérfanas en la misma pasada.
  await limpiarReferencias(almacen);
}

async function limpiarBorradores(almacen: Almacen) {
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

async function limpiarReferencias(almacen: Almacen) {
  // Un borrador eliminado sin --confirmar sigue en la base: sus referencias siguen en uso.
  const huerfanas = await referenciasHuerfanas(almacen.directorio, almacen.archivosReferencia());
  if (!huerfanas.length) {
    console.log('No hay referencias del cliente sin uso.');
    return;
  }
  for (const r of huerfanas)
    console.log(`${r.modificado.toISOString().slice(0, 10)}  ${r.archivo}  ${tamanoReferencia(r.tamano)}`);
  const total = tamanoReferencia(huerfanas.reduce((suma, r) => suma + r.tamano, 0));
  if (!confirmar) {
    console.log(`\n${huerfanas.length} referencia(s) sin uso (${total}) se eliminarían. Repite con --confirmar para hacerlo.`);
    return;
  }
  // Se vuelve a consultar el uso justo antes de borrar: otra persona pudo adjuntar el mismo archivo.
  const eliminadas = await eliminarReferencias(almacen.directorio, huerfanas.map((r) => r.archivo), almacen.archivosReferencia());
  console.log(`\nSe eliminaron ${eliminadas} referencia(s) sin uso.`);
}

main()
  .catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => cerrarAlmacen());

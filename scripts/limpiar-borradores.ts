import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { eliminarReferencias, referenciasHuerfanas } from '../src/servidor/archivos-referencia';
import { tamanoReferencia } from '../src/negocio/personalizados';

// Uso: npm run limpiar-borradores -- [--dias 30] [--con-items] [--confirmar]
// Sin --confirmar solo lista lo que se eliminaría. Sin --con-items solo considera borradores vacíos.
// Los borradores eliminados van a la papelera; la papelera se vacía de lo eliminado hace más de --dias días.
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
  // Lo recién eliminado queda en la papelera: solo se vacía lo que lleva ahí más del plazo.
  await vaciarPapelera(almacen);
  // Al final: las referencias que solo usaban los borradores vaciados quedan huérfanas en la misma pasada.
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
    console.log(`\n${candidatos.length} borrador(es) irían a la papelera. Repite con --confirmar para hacerlo.`);
    return;
  }
  const eliminados = await almacen.eliminarBorradores(candidatos.map((b) => b.id));
  console.log(`\nSe movieron ${eliminados} borrador(es) a la papelera.`);
}

/** Cliente e ítems de un borrador; código y descripción de un producto. */
function resumenPapelera(tipo: string, contenido: string) {
  try {
    const datos = JSON.parse(contenido);
    if (tipo === 'producto') return `${datos.codigo ?? ''}  ${datos.descripcion ?? datos.modelo ?? ''}`;
    return `${datos.cliente?.nombre ?? '(sin cliente)'}  ${datos.solicitudes?.length ?? 0} ítem(s)`;
  } catch {
    return '(contenido ilegible)';
  }
}

async function vaciarPapelera(almacen: Almacen) {
  const antiguas = almacen.papeleraAntigua(dias);
  if (!antiguas.length) {
    console.log(`No hay entradas en la papelera eliminadas hace más de ${dias} días.`);
    return;
  }
  for (const e of antiguas)
    console.log(`${e.eliminada.slice(0, 10)}  ${e.tipo}  ${e.id}  ${resumenPapelera(e.tipo, e.contenido)}`);
  if (!confirmar) {
    console.log(`\n${antiguas.length} entrada(s) de la papelera se eliminarían. Repite con --confirmar para hacerlo.`);
    return;
  }
  const vaciadas = await almacen.vaciarPapelera(antiguas);
  console.log(`\nSe eliminaron ${vaciadas} entrada(s) de la papelera.`);
}

async function limpiarReferencias(almacen: Almacen) {
  // Un borrador o una entrada de la papelera que sigue en la base (sin --confirmar) mantiene en uso sus referencias.
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

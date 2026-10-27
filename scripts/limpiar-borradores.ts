import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { eliminarReferencias, referenciasHuerfanas } from '../src/servidor/archivos-referencia';
import { tamanoReferencia } from '../src/negocio/personalizados';
import {
  auditoriaAntigua,
  compactarSnapshots,
  DIAS_AUDITORIA,
  eliminarArchivos,
  eliminarLockVencido,
  lockVencido,
  pdfAnuladosAntiguos,
  pruebasAntiguas,
  purgarAuditoria,
  purgarPruebas,
  purgarSnapshots,
  snapshotsCompactables,
  snapshotsPurgables,
  temporalesHuerfanos,
  type ArchivoPurgable,
} from '../src/servidor/limpieza';

// Uso: npm run limpiar-borradores -- [--dias 30] [--con-items] [--confirmar]
// Sin --confirmar solo lista lo que se eliminaría. Sin --con-items solo considera borradores vacíos.
// Los borradores eliminados van a la papelera; la papelera se vacía de lo eliminado hace más de --dias días.
// También borra las referencias del cliente (data/referencias) que ya no usa ninguna cotización y lo que crece sin
// uso (src/servidor/limpieza.ts): snapshots de cotizaciones anuladas hace más de --dias días o que ya no existen,
// copias «ANULADA» de más de --dias días (se regeneran si alguien las pide), auditoría de cuentas y pruebas de
// conexión con la fábrica de más de un año, PDF temporales de impresiones interrumpidas y un data/.estado.lock abandonado. Además compacta los snapshots
// antiguos que guardaban el logo en base64 (ahora es una referencia).
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
  await limpiarSnapshots(almacen);
  await limpiarAuditoria(almacen);
  await limpiarPruebas(almacen);
  await limpiarArchivos(almacen);
}

async function limpiarSnapshots(almacen: Almacen) {
  const db = almacen.baseDatos();
  const purgables = snapshotsPurgables(db, dias);
  if (!purgables.length) console.log(`No hay snapshots de documentos anulados hace más de ${dias} días ni sin cotización.`);
  else {
    for (const s of purgables)
      console.log(
        `${(s.fecha ?? '').slice(0, 10) || '(sin fecha)'}  ${s.archivo}  ${s.motivo === 'anulada' ? `N° ${s.numero} anulada` : 'sin cotización'}`,
      );
    if (!confirmar)
      console.log(`\n${purgables.length} snapshot(s) de documentos se eliminarían. Repite con --confirmar para hacerlo.`);
    else console.log(`\nSe eliminaron ${purgarSnapshots(db, purgables, dias)} snapshot(s) de documentos.`);
  }
  const compactables = snapshotsCompactables(db);
  if (!compactables.length) return;
  const ahorro = tamanoReferencia(compactables.reduce((suma, c) => suma + c.ahorro, 0));
  if (!confirmar)
    console.log(
      `${compactables.length} snapshot(s) guardan el logo en base64 (${ahorro}); se compactarían. Repite con --confirmar para hacerlo.`,
    );
  else console.log(`Se compactaron ${compactarSnapshots(db, compactables)} snapshot(s) con el logo en base64 (${ahorro}).`);
}

async function limpiarAuditoria(almacen: Almacen) {
  const db = almacen.baseDatos();
  const { cantidad, desde } = auditoriaAntigua(db);
  if (!cantidad) {
    console.log(`No hay registros de auditoría de cuentas de más de ${DIAS_AUDITORIA} días.`);
    return;
  }
  if (!confirmar) {
    console.log(
      `${cantidad} registro(s) de auditoría de cuentas de más de ${DIAS_AUDITORIA} días (desde ${desde?.slice(0, 10)}) se eliminarían. Repite con --confirmar para hacerlo.`,
    );
    return;
  }
  console.log(`Se eliminaron ${purgarAuditoria(db)} registro(s) de auditoría de cuentas de más de ${DIAS_AUDITORIA} días.`);
}

async function limpiarPruebas(almacen: Almacen) {
  const db = almacen.baseDatos();
  const { cantidad, desde } = pruebasAntiguas(db);
  if (!cantidad) {
    console.log(`No hay pruebas de conexión con la fábrica de más de ${DIAS_AUDITORIA} días.`);
    return;
  }
  if (!confirmar) {
    console.log(
      `${cantidad} prueba(s) de conexión con la fábrica de más de ${DIAS_AUDITORIA} días (desde ${desde?.slice(0, 10)}) se eliminarían. Repite con --confirmar para hacerlo.`,
    );
    return;
  }
  console.log(`Se eliminaron ${purgarPruebas(db)} prueba(s) de conexión con la fábrica de más de ${DIAS_AUDITORIA} días.`);
}

async function limpiarArchivos(almacen: Almacen) {
  const grupos: [string, ArchivoPurgable[]][] = [
    [`copia(s) «ANULADA» de más de ${dias} días (se regeneran si se piden)`, await pdfAnuladosAntiguos(almacen.directorio, dias)],
    ['PDF temporal(es) de impresiones interrumpidas', await temporalesHuerfanos(almacen.directorio)],
  ];
  for (const [descripcion, archivos] of grupos) {
    if (!archivos.length) continue;
    for (const a of archivos) console.log(`${a.modificado.toISOString().slice(0, 10)}  ${a.ruta}  ${tamanoReferencia(a.tamano)}`);
    const total = tamanoReferencia(archivos.reduce((suma, a) => suma + a.tamano, 0));
    if (!confirmar)
      console.log(`\n${archivos.length} ${descripcion} (${total}) se eliminarían. Repite con --confirmar para hacerlo.`);
    else console.log(`\nSe eliminaron ${await eliminarArchivos(almacen.directorio, archivos)} ${descripcion}.`);
  }
  const lock = await lockVencido(almacen.directorio);
  if (lock) {
    if (!confirmar)
      console.log(
        `data/.estado.lock quedó de un proceso terminado (${lock.modificado.toISOString()}); se eliminaría. Repite con --confirmar para hacerlo.`,
      );
    else if (await eliminarLockVencido(almacen.directorio)) console.log('Se eliminó data/.estado.lock abandonado.');
  }
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
  const eliminados = await almacen.eliminarBorradores(candidatos.map((b) => ({ id: b.id, actualizada: b.actualizada })));
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

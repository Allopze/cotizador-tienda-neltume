import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { FABRICAS, nombreFabrica, type Fabrica } from '../src/negocio/estado';

// Correlativos de notas de pedido, uno por fábrica (ver `FABRICAS`).
//   npm run notas                                   muestra el próximo N° de cada fábrica y las notas sin fábrica
//   npm run notas -- correlativo <fabrica> <numero> fija el próximo N° de esa fábrica (mayor que el último usado)
//   npm run notas -- asignar <numero> <fabrica>     asigna la fábrica a una nota generada antes de separarlas
const [comando, ...resto] = process.argv.slice(2);

function uso() {
  console.log(`
Correlativos de notas de pedido por fábrica (${FABRICAS.join(', ')}):
  npm run notas
  npm run notas -- correlativo <fabrica> <próximo número>
  npm run notas -- asignar <número de nota> <fabrica>
`);
}

const leerFabrica = (valor: string | undefined) => {
  const f = valor?.trim().toLowerCase();
  if (!FABRICAS.includes(f as Fabrica))
    throw new Error(`Fábrica desconocida: «${valor ?? ''}». Usa ${FABRICAS.join(' o ')}.`);
  return f as Fabrica;
};
const leerNumero = (valor: string | undefined) => {
  const n = Number(valor);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Número inválido: «${valor ?? ''}».`);
  return n;
};

function mostrar(almacen: Almacen) {
  const siguientes = almacen.correlativosNota();
  console.log('Próximo N° de nota de pedido:');
  for (const f of FABRICAS) console.log(`  ${nombreFabrica[f].padEnd(12)} ${siguientes[f]}`);
  const sinFabrica = almacen.notasSinFabrica();
  if (!sinFabrica.length) return;
  console.log(
    `\nNotas sin fábrica asignada (${sinFabrica.length}); asígnalas con «npm run notas -- asignar <número> <fabrica>»:`,
  );
  for (const n of sinFabrica)
    console.log(
      `  N° ${n.numero} · cotización N° ${n.cotizacion ?? '—'} · ${n.cliente ?? 'sin cliente'} · ${n.fecha.slice(0, 10)}`,
    );
}

async function main() {
  const almacen = new Almacen();
  if (!comando) return mostrar(almacen);
  if (comando === 'correlativo') {
    const fabrica = leerFabrica(resto[0]);
    almacen.fijarCorrelativoNota(fabrica, leerNumero(resto[1]));
    console.log(
      `Listo: la próxima nota de ${nombreFabrica[fabrica]} será la N° ${almacen.correlativosNota()[fabrica]}.\n`,
    );
    return mostrar(almacen);
  }
  if (comando === 'asignar') {
    const numero = leerNumero(resto[0]);
    const fabrica = leerFabrica(resto[1]);
    almacen.asignarFabricaNota(numero, fabrica);
    console.log(`Listo: la nota de pedido N° ${numero} quedó asignada a ${nombreFabrica[fabrica]}.\n`);
    return mostrar(almacen);
  }
  uso();
  process.exitCode = 2;
}

main()
  .catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => cerrarAlmacen());

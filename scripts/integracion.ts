import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { nombreFabrica, numeroNota } from '../src/negocio/estado';
import { reintentarEnvio, resumenBandeja, ultimosEnvios } from '../src/servidor/integracion-bandeja';
import { configuracionFabrica, estadoConfiguracion, FABRICAS_INTEGRADAS } from '../src/servidor/integracion-configuracion';
import { esperarIntegracion, procesarPendientes } from '../src/servidor/integracion-envio';
import { prepararEnvio } from '../src/servidor/integracion-pedido';
import { cerrarNavegadorPdf } from '../src/servidor/pdf';

// Envíos automáticos de notas de pedido a la aplicación de la fábrica (docs/integracion-fabrica.md). Solo para
// operar el servidor: quien cotiza no usa nada de esto, el envío ocurre solo al generar la nota.
//   npm run integracion                          estado de la configuración y últimos envíos
//   npm run integracion -- enviar                entrega ahora lo pendiente que ya toca
//   npm run integracion -- reintentar <id>       vuelve a poner en cola un envío fallido
//   npm run integracion -- encolar <cotización>  encola la nota de una fábrica integrada de esa cotización aprobada
//                                                (una nota anterior a activar la integración, o cuyo envío no se preparó)
const [comando, ...resto] = process.argv.slice(2);

function uso() {
  console.log(`
Envíos a fábrica:
  npm run integracion
  npm run integracion -- enviar
  npm run integracion -- reintentar <id del envío>
  npm run integracion -- encolar <N° de cotización>
`);
}

const leerNumero = (valor: string | undefined) => {
  const n = Number(valor);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Número inválido: «${valor ?? ''}».`);
  return n;
};

function mostrar(almacen: Almacen) {
  const db = almacen.baseDatos();
  for (const f of FABRICAS_INTEGRADAS) console.log(`${nombreFabrica[f]}: ${estadoConfiguracion(f).replace('_', ' ')}`);
  const r = resumenBandeja(db);
  console.log(`Pendientes: ${r.pendientes} · Fallidos: ${r.fallidos} · Entregados: ${r.entregados}`);
  const envios = ultimosEnvios(db);
  if (!envios.length) return console.log('\nTodavía no hay envíos.');
  console.log('\nÚltimos envíos:');
  for (const e of envios)
    console.log(
      `  #${e.id} · cotización N° ${e.cotizacion ?? '—'} · ${nombreFabrica[e.fabrica]} rev. ${e.revision} · ${e.evento} · ${e.estado}` +
        ` · ${e.intentos} intento${e.intentos === 1 ? '' : 's'}` +
        (e.estado === 'pendiente' ? ` · próximo ${e.proximo_intento}` : '') +
        (e.entregado ? ` · entregado ${e.entregado}` : '') +
        (e.ultimo_error ? `\n      ${e.ultimo_status ? `[${e.ultimo_status}] ` : ''}${e.ultimo_error}` : ''),
    );
}

async function main() {
  const almacen = new Almacen();
  if (!comando) return mostrar(almacen);
  if (comando === 'enviar') {
    const n = await procesarPendientes({ directorio: almacen.directorio, db: almacen.baseDatos() });
    console.log(`Se intentaron ${n} envío${n === 1 ? '' : 's'}.\n`);
    return mostrar(almacen);
  }
  if (comando === 'reintentar') {
    const id = leerNumero(resto[0]);
    if (!reintentarEnvio(almacen.baseDatos(), id)) throw new Error(`El envío #${id} no existe o no está fallido.`);
    console.log(`Listo: el envío #${id} volvió a la cola. Sale en la próxima pasada (o con «npm run integracion -- enviar»).\n`);
    return mostrar(almacen);
  }
  if (comando === 'encolar') {
    const numero = leerNumero(resto[0]);
    const q = await almacen.transaccion((u) => u.porNumero(numero));
    if (!q || q.estado !== 'aprobada') throw new Error(`La cotización N° ${numero} no existe o no está aprobada.`);
    const notas = q.notas.filter((n) => !n.anulada && n.fabrica && FABRICAS_INTEGRADAS.includes(n.fabrica));
    if (!notas.length) throw new Error(`La cotización N° ${numero} no tiene una nota vigente para una fábrica integrada.`);
    const forzar = resto.includes('--forzar');
    for (const nota of notas) {
      const db = almacen.baseDatos();
      const yaEncolada = db
        .prepare('SELECT 1 FROM integracion_envios WHERE cotizacion_id = ? AND fabrica = ? LIMIT 1')
        .get(q.id, nota.fabrica);
      if (!configuracionFabrica(nota.fabrica!) && !yaEncolada)
        throw new Error(`La integración con ${nombreFabrica[nota.fabrica!]} no está configurada.`);
      // Repetir el comando sobre una nota ya entregada crearía una revisión idéntica (auditoría BUG-043).
      const entregada = db
        .prepare("SELECT 1 FROM integracion_envios WHERE cotizacion_id = ? AND fabrica = ? AND estado = 'entregado' LIMIT 1")
        .get(q.id, nota.fabrica);
      if (entregada && !forzar)
        throw new Error(
          `La nota de ${nombreFabrica[nota.fabrica!]} ya se entregó a la fábrica. Repite con --forzar si de verdad quieres enviar otra revisión.`,
        );
      const envio = await prepararEnvio(q, nota, { db });
      await almacen.transaccion((u) => {
        // Si la cotización cambió entretanto (se anuló o se renumeró), no se encola una versión vieja.
        const actual = u.obtener(q.id);
        if (actual?.actualizada !== q.actualizada) throw new Error('La cotización cambió mientras se preparaba el envío. Vuelve a intentarlo.');
        u.encolarIntegracion({ tipo: 'pedido', cotizacionId: q.id, envio });
      });
      console.log(`Listo: la nota de pedido ${numeroNota(nota)} quedó en la cola.`);
    }
    // Encolar ya despertó el envío en este proceso: se espera antes de mostrar el resultado y cerrar la base.
    await esperarIntegracion(almacen.directorio);
    console.log('');
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
  .finally(async () => {
    await cerrarNavegadorPdf();
    cerrarAlmacen();
  });

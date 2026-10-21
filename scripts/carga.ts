// Prueba de carga mixta: 2 a 4 personas usan el cotizador a la vez, sobre `Servicio` igual que /api/accion (un
// Almacen y el catálogo de la base por acción), con el catálogo real importado en una base temporal y la IA fija
// (sin red ni gasto). Cada persona cotiza por chat, edita, emite el PDF con Chromium, aprueba, paga, genera la nota
// y, de vez en cuando, toca la cotización de otra con una versión vieja (debe responder 409, no 500).
//
//   npx tsx scripts/carga.ts [--personas 3] [--rondas 5] [--planilla datos-privados/COTIZADOR_2026.xlsx]
//
// Mide latencias por acción y falla (código 1) si hay errores internos (500), números de cotización o de nota
// quemados (saltos en el correlativo), PDF faltantes o una base que no pasa integrity_check. Nunca toca data/:
// la base, los PDF y el catálogo importado quedan en un directorio temporal que se borra al terminar.
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    personas: { type: 'string', default: '3' },
    rondas: { type: 'string', default: '5' },
    planilla: { type: 'string' },
    conservar: { type: 'boolean' },
  },
});
const personas = Number(values.personas);
const rondas = Number(values.rondas);
if (!Number.isInteger(personas) || personas < 2 || personas > 4) throw new Error('--personas debe ser 2, 3 o 4.');
if (!Number.isInteger(rondas) || rondas < 1) throw new Error('--rondas debe ser un entero positivo.');
const planilla = resolve(values.planilla ?? process.env.NELTUME_PLANILLA ?? 'datos-privados/COTIZADOR_2026.xlsx');
if (!existsSync(planilla)) throw new Error(`No se encontró la planilla ${planilla} (solo se lee).`);

// Antes de importar los módulos del servidor: la base y los PDF van a un directorio temporal.
const directorio = await mkdtemp(join(tmpdir(), 'neltume-carga-'));
process.env.NELTUME_DATA_DIR = directorio;
process.env.NELTUME_DB_PATH = join(directorio, 'cotizador.sqlite');
process.env.NELTUME_FERIADOS_SYNC = '0';

const { importarPlanilla } = await import('../src/catalogo/planilla');
const { leerConfiguracionCatalogo } = await import('../src/catalogo/configuracion-archivo');
const { LLMFijo } = await import('../src/asistente/fijo');
const { anticipoMinimo } = await import('../src/negocio/estado');
const { Almacen, cerrarAlmacen } = await import('../src/servidor/almacen');
const { cargarCatalogo } = await import('../src/servidor/catalogo');
const { chromiumPath } = await import('../src/servidor/chromium');
const { ErrorUsuario } = await import('../src/servidor/errores');
const { cerrarNavegadorPdf } = await import('../src/servidor/pdf');
const { Servicio } = await import('../src/servidor/servicio');
type Accion = Parameters<InstanceType<typeof Servicio>['ejecutar']>[0];
type Cotizacion = Awaited<ReturnType<InstanceType<typeof Servicio>['ejecutar']>>['cotizacion'];

if (!chromiumPath()) throw new Error('No hay Chrome ni Chromium: define CHROMIUM_PATH para generar los PDF.');

const latencias = new Map<string, number[]>();
const esperados = new Map<string, number>();
const internos: string[] = [];
const ultima: (Cotizacion | null)[] = Array(personas).fill(null);

/** Una acción como la haría /api/accion: Almacen y catálogo nuevos, y el error clasificado como lo respondería. */
async function accion(persona: number, a: Accion, etiqueta: string = a.tipo) {
  const inicio = performance.now();
  try {
    const servicio = new Servicio(await cargarCatalogo(), new LLMFijo(), new Almacen(), {
      nombre: `Persona ${persona + 1}`,
      email: `persona${persona + 1}@neltume.test`,
    });
    const r = await servicio.ejecutar(a);
    return r;
  } catch (error) {
    if (error instanceof ErrorUsuario && error.status < 500) {
      const clave = `${etiqueta} → ${error.status} ${error.codigo ?? ''}`.trim();
      esperados.set(clave, (esperados.get(clave) ?? 0) + 1);
      return null;
    }
    internos.push(`${etiqueta} (persona ${persona + 1}): ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    return null;
  } finally {
    const ms = performance.now() - inicio;
    latencias.set(etiqueta, [...(latencias.get(etiqueta) ?? []), ms]);
  }
}

/** Una ronda completa de una persona: de la cotización por chat a la nota de pedido. */
async function ronda(persona: number, n: number) {
  const mensaje = n % 2 ? 'Huilo Huilo para María José' : 'Cotiza Huilo Huilo en pino oregón';
  let r = await accion(persona, { tipo: 'chat', mensaje });
  if (!r) return;
  let q = r.cotizacion;
  ultima[persona] = q;
  const paso = async (a: Record<string, unknown>, etiqueta?: string) => {
    const res = await accion(persona, { ...a, id: q.id, actualizada: q.actualizada } as Accion, etiqueta);
    if (res) {
      q = res.cotizacion;
      ultima[persona] = q;
    }
    return res;
  };
  // La IA fija no dice si la medida es de hoja o de vano: se confirma como lo haría la vendedora.
  if (!(await paso({ tipo: 'editar', items: [{ indice: 0, cambios: { tipoMedida: 'hoja' } }], cantidades: [{ indice: 0, cantidad: 2 + ((persona + n) % 5) }] }))) return;
  await paso({ tipo: 'editar', cliente: { telefono: `+56 9 ${1000_0000 + persona * 1000 + n}` } });
  // Una versión vieja de la cotización de la persona siguiente: debe responder 409 sin tocarla.
  const otra = ultima[(persona + 1) % personas];
  if (otra && otra.estado === 'borrador')
    await accion(persona, { tipo: 'editar', id: otra.id, actualizada: '2000-01-01T00:00:00.000Z', cantidades: [{ indice: 0, cantidad: 9 }] }, 'editar ajena (versión vieja)');
  r = await paso({ tipo: 'emitir' });
  if (!r) return;
  // Doble envío de «Emitir»: devuelve la misma emitida, sin otro número.
  await accion(persona, { tipo: 'emitir', id: q.id, actualizada: q.actualizada }, 'emitir (repetido)');
  if (n % 3 === 2) return; // Algunas quedan solo emitidas.
  if (!(await paso({ tipo: 'aprobar' }))) return;
  if (!(await paso({ tipo: 'pago', monto: anticipoMinimo(q.montos.total) }))) return;
  if (!(await paso({ tipo: 'generar_nota', fabrica: 'panguipulli' }))) return;
  const saldo = q.montos.total - (q.pagos ?? []).reduce((s, p) => s + p.monto, 0);
  if (saldo > 0) await paso({ tipo: 'pago', monto: saldo }, 'pago saldo');
}

const p = (xs: number[], q: number) => {
  const orden = [...xs].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.floor(q * orden.length))];
};

let fallas: string[] = [];
try {
  const t0 = performance.now();
  const importado = await importarPlanilla(planilla, await leerConfiguracionCatalogo());
  await new Almacen().guardarCatalogo(importado.catalogo, importado.configuracion);
  console.log(`Catálogo: ${importado.catalogo.productos.length} productos (${Math.round(performance.now() - t0)} ms). Base temporal: ${directorio}`);
  const inicial = { ...new Almacen().correlativos(), siguienteNota: new Almacen().correlativosNota().panguipulli };
  const inicio = performance.now();
  await Promise.all(
    Array.from({ length: personas }, async (_, persona) => {
      for (let n = 0; n < rondas; n++) await ronda(persona, n);
    }),
  );
  const total = performance.now() - inicio;

  // ---------- Comprobaciones ----------
  const almacen = new Almacen();
  const { cotizaciones } = await almacen.leer();
  const numeros = cotizaciones.map((q) => q.numero).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const notas = cotizaciones.map((q) => q.nota?.numero).filter((n): n is number => n != null).sort((a, b) => a - b);
  const final = { ...almacen.correlativos(), siguienteNota: almacen.correlativosNota().panguipulli };
  const esperadosCot = Array.from({ length: final.siguienteCotizacion - inicial.siguienteCotizacion }, (_, i) => inicial.siguienteCotizacion + i);
  const esperadosNota = Array.from({ length: final.siguienteNota - inicial.siguienteNota }, (_, i) => inicial.siguienteNota + i);
  const quemadosCot = esperadosCot.filter((n) => !numeros.includes(n));
  const quemadosNota = esperadosNota.filter((n) => !notas.includes(n));
  if (!numeros.length || !notas.length) fallas.push('La carga no llegó a emitir cotizaciones y notas: revisa el guion.');
  if (internos.length) fallas.push(`${internos.length} errores internos (500):\n  ${internos.join('\n  ')}`);
  if (quemadosCot.length) fallas.push(`Números de cotización quemados: ${quemadosCot.join(', ')}`);
  if (quemadosNota.length) fallas.push(`Números de nota quemados: ${quemadosNota.join(', ')}`);
  if (new Set(numeros).size !== numeros.length) fallas.push('Hay números de cotización repetidos.');
  const sinPdf = cotizaciones.filter(
    (q) => (q.pdf && !existsSync(join(directorio, 'pdf', q.pdf))) || (q.nota && !existsSync(join(directorio, 'pdf', q.nota.pdf))),
  );
  if (sinPdf.length) fallas.push(`${sinPdf.length} documentos emitidos sin su PDF.`);
  const integridad = almacen.baseDatos().pragma('integrity_check', { simple: true });
  if (integridad !== 'ok') fallas.push(`integrity_check: ${integridad}`);
  const ocupado = [...esperados].filter(([k]) => k.includes('ocupado')).reduce((s, [, v]) => s + v, 0);

  // ---------- Informe ----------
  console.log(`\n${personas} personas × ${rondas} rondas en ${(total / 1000).toFixed(1)} s`);
  console.log(`Cotizaciones: ${cotizaciones.length}; emitidas ${numeros.length} (N° ${numeros[0] ?? '-'}–${numeros.at(-1) ?? '-'}); notas ${notas.length}`);
  console.log('\n| Acción | n | p50 ms | p95 ms | máx ms |\n|---|---:|---:|---:|---:|');
  for (const [etiqueta, xs] of [...latencias].sort(([a], [b]) => a.localeCompare(b)))
    console.log(`| ${etiqueta} | ${xs.length} | ${Math.round(p(xs, 0.5))} | ${Math.round(p(xs, 0.95))} | ${Math.round(Math.max(...xs))} |`);
  console.log('\nRespuestas 4xx (esperadas):');
  for (const [k, v] of [...esperados].sort()) console.log(`  ${k}: ${v}`);
  if (!esperados.size) console.log('  ninguna');
  if (ocupado) console.log(`\n${ocupado} respuestas «ocupado» (409): reintentables, no son errores.`);
  console.log(fallas.length ? `\nFALLA:\n- ${fallas.join('\n- ')}` : '\nSin errores internos, sin números quemados y la base íntegra.');
} catch (error) {
  fallas = [String(error instanceof Error ? error.stack : error)];
  console.error(fallas[0]);
} finally {
  await cerrarNavegadorPdf();
  cerrarAlmacen();
  if (!values.conservar) await rm(directorio, { recursive: true, force: true });
  process.exitCode = fallas.length ? 1 : 0;
}

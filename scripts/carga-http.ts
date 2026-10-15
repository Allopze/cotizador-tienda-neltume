// Carga HTTP contra el build de producción (`next start`): lo que `scripts/carga.ts` mide sobre `Servicio`, pero
// pasando por el servidor real (sesión de Better Auth, proxy, rutas y serialización JSON). Monta una instalación
// temporal con el catálogo real, cuentas de prueba y, si se pide, miles de cotizaciones sembradas; arranca
// `next start` con la IA y Starken simulados, y luego:
//
//   1. corre `ab` (ApacheBench) sobre las rutas de lectura y el chat, con la cookie de una sesión real;
//   2. con --minutos, una prueba de resistencia: 2 a 4 personas cotizan, emiten PDF, aprueban, pagan y generan la
//      nota por HTTP sin parar, mientras se muestrea la memoria (RSS) del servidor y de su Chromium.
//
//   npm run build && npx tsx scripts/carga-http.ts [--puerto 3200] [--sembrar 20000] [--ab-n 2000] [--ab-c 8]
//       [--minutos 15] [--personas 3] [--heap-mb 512] [--planilla datos-privados/COTIZADOR_2026.xlsx] [--conservar]
//
// Falla (código 1) con respuestas 5xx, números quemados, PDF faltantes o una base que no pasa integrity_check.
// Nunca toca data/: todo queda en un directorio temporal que se borra al terminar (salvo con --conservar).
import Database from 'better-sqlite3';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, openSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as esperar } from 'node:timers/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    puerto: { type: 'string', default: '3200' },
    sembrar: { type: 'string', default: '0' },
    'ab-n': { type: 'string', default: '2000' },
    'ab-c': { type: 'string', default: '8' },
    'sin-ab': { type: 'boolean' },
    minutos: { type: 'string', default: '0' },
    personas: { type: 'string', default: '3' },
    planilla: { type: 'string' },
    'dist-dir': { type: 'string', default: '.next' },
    conservar: { type: 'boolean' },
    /** Tope del heap de V8 del servidor (--max-old-space-size), para acercarse al contenedor con mem_limit. */
    'heap-mb': { type: 'string' },
  },
});
const puerto = Number(values.puerto);
const sembrar = Number(values.sembrar);
const abN = Number(values['ab-n']);
const abC = Number(values['ab-c']);
const minutos = Number(values.minutos);
const personas = Number(values.personas);
if (!Number.isInteger(personas) || personas < 2 || personas > 4)
  throw new Error('--personas debe ser 2, 3 o 4.');
if (!Number.isInteger(sembrar) || sembrar < 0) throw new Error('--sembrar debe ser un entero ≥ 0.');
const planilla = resolve(
  values.planilla ?? process.env.NELTUME_PLANILLA ?? 'datos-privados/COTIZADOR_2026.xlsx',
);
if (!existsSync(planilla)) throw new Error(`No se encontró la planilla ${planilla} (solo se lee).`);
const distDir = values['dist-dir']!;
if (!existsSync(join(distDir, 'BUILD_ID')))
  throw new Error(`No hay build en ${distDir}: corre antes \`npm run build\`.`);
if (!spawnSync('ab', ['-V']).stdout?.length && !values['sin-ab'])
  throw new Error('Falta `ab` (ApacheBench); usa --sin-ab.');

const ORIGEN = `http://127.0.0.1:${puerto}`;
// En producción BETTER_AUTH_URL debe ser https (validarConfiguracionAutenticacion). Se declara el mismo host con https
// y las solicitudes van por HTTP directo, sin proxy TLS: el Origin de las escrituras lleva ese origen https (mismo
// host que el Host), y la cookie Secure se envía a mano. Así se mide el servidor y no el proxy.
const ORIGEN_PUBLICO = `https://127.0.0.1:${puerto}`;
const directorio = await mkdtemp(join(tmpdir(), 'neltume-carga-http-'));
const entorno = {
  NELTUME_DATA_DIR: directorio,
  NELTUME_DB_PATH: join(directorio, 'cotizador.sqlite'),
  NELTUME_RESPALDO_DIR: join(directorio, 'respaldos'),
  NELTUME_FERIADOS_SYNC: '0',
  NELTUME_LLM: 'fijo',
  NELTUME_STARKEN: 'fijo',
  NELTUME_TEST_MODE: '1',
  // NELTUME_TEST_MODE cambia el distDir a .next-e2e: se fija el del build que se mide.
  NELTUME_DIST_DIR: distDir,
  BETTER_AUTH_SECRET: 'carga-http-secret-neltume-0123456789abcdef',
  BETTER_AUTH_URL: ORIGEN_PUBLICO,
};
Object.assign(process.env, entorno);
const CLAVE = 'clave-de-carga-segura-123';
const cuentas = Array.from({ length: personas }, (_, i) => `persona${i + 1}@neltume.test`);

// ---------- Instalación temporal (antes de arrancar el servidor) ----------
const { importarPlanilla } = await import('../src/catalogo/planilla');
const { leerConfiguracionCatalogo } = await import('../src/catalogo/configuracion-archivo');
const { LLMFijo } = await import('../src/asistente/fijo');
const { anticipoMinimo } = await import('../src/negocio/estado');
type Cotizacion = import('../src/negocio/estado').Cotizacion;
const { Almacen, cerrarAlmacen, guardarEstadoCompleto } = await import('../src/servidor/almacen');
const { cargarCatalogo } = await import('../src/servidor/catalogo');
const { Servicio } = await import('../src/servidor/servicio');
const { abrirBaseDatos, cerrarBaseDatos } = await import('../src/servidor/base-datos');
const { migrarEsquemaAutenticacion } = await import('../src/servidor/autenticacion-config');

const t0 = performance.now();
const importado = await importarPlanilla(planilla, await leerConfiguracionCatalogo());
const almacen = new Almacen();
await almacen.guardarCatalogo(importado.catalogo, importado.configuracion);
await migrarEsquemaAutenticacion(abrirBaseDatos());
{
  const { auth } = await import('../src/servidor/autenticacion');
  const contexto = await auth.$context;
  for (const email of cuentas) {
    const user = await contexto.internalAdapter.createUser(
      { email, name: email.split('@')[0], emailVerified: true, role: 'admin' },
      { method: 'admin' },
    );
    await contexto.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await contexto.password.hash(CLAVE),
    });
  }
}
let msSiembra = 0;
if (sembrar) {
  // Una cotización real del servicio (con la IA fija) como plantilla; luego copias con clientes y fechas distintos,
  // un tercio emitidas con número, como en tests/carga-concurrencia.test.ts.
  const servicio = new Servicio(await cargarCatalogo(), new LLMFijo(), almacen, {
    nombre: 'Siembra',
    email: 'siembra@neltume.test',
  });
  const plantilla = (await servicio.ejecutar({ tipo: 'chat', mensaje: 'Cotiza Huilo Huilo en pino oregón' }))
    .cotizacion;
  const m = performance.now();
  const estado = await almacen.leer();
  const base = estado.siguienteCotizacion;
  for (let i = 0; i < sembrar; i++) {
    const emitida = i % 3 === 0;
    const dia = String(1 + (i % 28)).padStart(2, '0');
    const mes = String(1 + (Math.floor(i / 28) % 9)).padStart(2, '0');
    estado.cotizaciones.push({
      ...structuredClone(plantilla),
      id: crypto.randomUUID(),
      numero: emitida ? base + i : null,
      estado: emitida ? 'emitida' : 'borrador',
      pdf: emitida ? `cotizacion-${base + i}.pdf` : null,
      fechaEmision: emitida ? `2026-${mes}-${dia}T15:00:00.000Z` : null,
      vence: emitida ? `2026-${mes}-${dia}` : null,
      estadoComercial: emitida ? 'enviada' : plantilla.estadoComercial,
      cliente: { ...plantilla.cliente, nombre: `Cliente ${i}`, comuna: i % 2 ? 'Osorno' : 'Temuco' },
      creada: `2026-${mes}-${dia}T12:00:00.000Z`,
      actualizada: `2026-${mes}-${dia}T12:00:00.${String(i % 1000).padStart(3, '0')}Z`,
    } as Cotizacion);
  }
  estado.siguienteCotizacion = base + sembrar;
  guardarEstadoCompleto(almacen.baseDatos(), estado);
  msSiembra = performance.now() - m;
}
const inicial = almacen.correlativos();
cerrarAlmacen();
cerrarBaseDatos();
console.log(
  `Instalación en ${directorio}: ${importado.catalogo.productos.length} productos, ${personas} cuentas` +
    `${sembrar ? `, ${sembrar.toLocaleString('es-CL')} cotizaciones sembradas en ${Math.round(msSiembra)} ms` : ''} (${Math.round(performance.now() - t0)} ms).`,
);

// ---------- Servidor ----------
// El registro va directo a un archivo: con una tubería, `spawnSync('ab')` bloquea este proceso, nadie la vacía y el
// servidor se detiene al llenarse (≈900 mensajes del chat), lo que parecía una solicitud colgada.
const registro = openSync(join(directorio, 'servidor.log'), 'a');
let servidor: ChildProcess | null = null;
const fallas: string[] = [];

/** PID del servidor y de todos sus descendientes (Chromium del PDF incluido). */
function arbol(pid: number): number[] {
  const hijos = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
    .stdout.split('\n')
    .filter(Boolean)
    .map(Number);
  return [pid, ...hijos.flatMap(arbol)];
}
/** RSS en MB del proceso de Node y del árbol completo. */
function memoria() {
  const pid = servidor?.pid;
  if (!pid) return { node: 0, total: 0, procesos: 0 };
  const pids = arbol(pid);
  const salida = spawnSync('ps', ['-o', 'pid=,rss=,comm=', '-p', pids.join(',')], {
    encoding: 'utf8',
  }).stdout;
  let node = 0;
  let total = 0;
  for (const linea of salida.split('\n').filter(Boolean)) {
    const [p, rss] = linea.trim().split(/\s+/);
    total += Number(rss) / 1024;
    // `next start` corre el servidor en un proceso hijo de Node: el de más memoria que no es Chromium.
    if (!/chrom/i.test(linea)) node = Math.max(node, Number(rss) / 1024);
    void p;
  }
  return { node, total, procesos: pids.length };
}

async function arrancar() {
  const next = join('node_modules', '.bin', 'next');
  servidor = spawn(next, ['start', '--hostname', '127.0.0.1', '--port', String(puerto)], {
    env: {
      ...process.env,
      ...entorno,
      NODE_ENV: 'production',
      ...(values['heap-mb'] ? { NODE_OPTIONS: `--max-old-space-size=${Number(values['heap-mb'])}` } : {}),
    },
    detached: true,
    stdio: ['ignore', registro, registro],
  });
  const limite = Date.now() + 60_000;
  const inicio = performance.now();
  while (Date.now() < limite) {
    if (servidor.exitCode !== null)
      throw new Error(`next start terminó (${servidor.exitCode}); ver ${join(directorio, 'servidor.log')}`);
    try {
      const r = await fetch(`${ORIGEN}/api/salud`);
      if (r.status === 200 || r.status === 503) return performance.now() - inicio;
    } catch {
      // Aún no escucha.
    }
    await esperar(250);
  }
  throw new Error('next start no respondió en 60 s.');
}

async function detener() {
  if (!servidor?.pid || servidor.exitCode !== null) return;
  const fin = new Promise((r) => servidor!.once('exit', r));
  try {
    process.kill(-servidor.pid, 'SIGTERM');
  } catch {
    return;
  }
  // Next no siempre cierra ordenado con SIGTERM: a los 5 s, SIGKILL al grupo (Chromium incluido).
  const resultado = await Promise.race([fin.then(() => 'ok'), esperar(5000).then(() => 'plazo')]);
  if (resultado === 'plazo')
    try {
      process.kill(-servidor.pid, 'SIGKILL');
    } catch {
      // Ya terminó.
    }
}

async function iniciarSesion(email: string) {
  const r = await fetch(`${ORIGEN}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: ORIGEN_PUBLICO, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: CLAVE }),
  });
  if (!r.ok) throw new Error(`No se pudo iniciar sesión con ${email}: ${r.status} ${await r.text()}`);
  return r.headers
    .getSetCookie()
    .map((c) => c.split(';', 1)[0])
    .join('; ');
}

// ---------- ab ----------
interface MedidaAb {
  ruta: string;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  no2xx: number;
  excepciones: number;
  /** RSS del proceso de Node del servidor al terminar la ráfaga, en MB. */
  rss: number;
}
async function ab(
  etiqueta: string,
  ruta: string,
  cookie: string | null,
  cuerpo?: unknown,
  n = abN,
  c = abC,
): Promise<MedidaAb> {
  // Plazo de 120 s por solicitud (ab corta a los 30 s): una solicitud lenta se mide en vez de abortar la corrida.
  const args = ['-q', '-s', '120', '-n', String(n), '-c', String(c), '-H', 'Accept: application/json'];
  if (cookie) args.push('-H', `Cookie: ${cookie}`);
  if (cuerpo !== undefined) {
    const archivo = join(directorio, `ab-${etiqueta.replace(/\W+/g, '-')}.json`);
    await writeFile(archivo, JSON.stringify(cuerpo));
    args.push('-p', archivo, '-T', 'application/json');
  }
  args.push(`${ORIGEN}${ruta}`);
  const r = spawnSync('ab', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const salida = r.stdout + r.stderr;
  const num = (re: RegExp) => Number(salida.match(re)?.[1] ?? NaN);
  const medida = {
    ruta: etiqueta,
    rps: num(/Requests per second:\s+([\d.]+)/),
    p50: num(/^\s+50%\s+(\d+)/m),
    p95: num(/^\s+95%\s+(\d+)/m),
    p99: num(/^\s+99%\s+(\d+)/m),
    max: num(/^\s+100%\s+(\d+)/m),
    no2xx: num(/Non-2xx responses:\s+(\d+)/) || 0,
    excepciones: num(/Exceptions: (\d+)\)/) || 0,
    rss: Math.round(memoria().node),
  };
  if (Number.isNaN(medida.rps)) fallas.push(`ab ${etiqueta} no terminó:\n${salida.slice(-800)}`);
  else if (medida.no2xx || medida.excepciones)
    fallas.push(`ab ${etiqueta}: ${medida.no2xx} respuestas no 2xx, ${medida.excepciones} excepciones.`);
  return medida;
}

// ---------- Resistencia ----------
const estados = new Map<number, number>();
const errores5xx: string[] = [];
const tiempos: { t: number; etiqueta: string; ms: number }[] = [];
const muestras: { t: number; node: number; total: number; procesos: number }[] = [];

async function pedir(cookie: string, etiqueta: string, ruta: string, cuerpo?: unknown) {
  const inicio = performance.now();
  const r = await fetch(`${ORIGEN}${ruta}`, {
    method: cuerpo === undefined ? 'GET' : 'POST',
    headers: {
      cookie,
      ...(cuerpo === undefined ? {} : { 'content-type': 'application/json', origin: ORIGEN_PUBLICO }),
    },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  });
  const texto = await r.text();
  const ms = performance.now() - inicio;
  tiempos.push({ t: inicio, etiqueta, ms });
  estados.set(r.status, (estados.get(r.status) ?? 0) + 1);
  if (r.status >= 500) errores5xx.push(`${etiqueta} → ${r.status}: ${texto.slice(0, 200)}`);
  return {
    status: r.status,
    datos: r.headers.get('content-type')?.includes('json')
      ? (JSON.parse(texto) as Record<string, unknown>)
      : null,
  };
}

async function resistencia(cookies: string[], hasta: number) {
  let rondas = 0;
  await Promise.all(
    cookies.map(async (cookie, persona) => {
      for (let n = 0; performance.now() < hasta; n++) {
        rondas++;
        const accion = (cuerpo: Record<string, unknown>, etiqueta = String(cuerpo.tipo)) =>
          pedir(cookie, etiqueta, '/api/accion', cuerpo);
        const chat = await accion({
          tipo: 'chat',
          mensaje: n % 2 ? 'Huilo Huilo para María José' : 'Cotiza Huilo Huilo en pino oregón',
        });
        let q = chat.datos?.cotizacion as Cotizacion | undefined;
        if (!q) continue;
        const paso = async (cuerpo: Record<string, unknown>, etiqueta?: string) => {
          const r = await accion({ ...cuerpo, id: q!.id, actualizada: q!.actualizada }, etiqueta);
          if (r.status === 200) q = r.datos!.cotizacion as Cotizacion;
          return r.status === 200;
        };
        if (
          !(await paso({
            tipo: 'editar',
            items: [{ indice: 0, cambios: { tipoMedida: 'hoja' } }],
            cantidades: [{ indice: 0, cantidad: 2 + ((persona + n) % 5) }],
          }))
        )
          continue;
        await pedir(cookie, 'listado', '/api/accion?pagina=1&porPagina=30');
        await pedir(
          cookie,
          'búsqueda',
          `/api/accion?q=${encodeURIComponent(`Cliente ${n * 7}`)}&pagina=1&porPagina=30`,
        );
        await pedir(cookie, 'abrir', `/api/accion?id=${q.id}`);
        if (!(await paso({ tipo: 'emitir' }))) continue;
        if (n % 3 === 2) {
          // Algunas se descartan: borrador duplicado y eliminado (pasa a la papelera).
          const dup = await accion({ tipo: 'duplicar', id: q.id });
          const copia = dup.datos?.cotizacion as Cotizacion | undefined;
          if (copia) await accion({ tipo: 'eliminar', id: copia.id, actualizada: copia.actualizada });
          continue;
        }
        if (!(await paso({ tipo: 'aprobar' }))) continue;
        if (!(await paso({ tipo: 'pago', monto: anticipoMinimo(q.montos.total) }))) continue;
        if (!(await paso({ tipo: 'generar_nota' }))) continue;
        const saldo = q.montos.total - (q.pagos ?? []).reduce((s, p) => s + p.monto, 0);
        if (saldo > 0) await paso({ tipo: 'pago', monto: saldo }, 'pago saldo');
      }
    }),
  );
  return rondas;
}

const p = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const orden = [...xs].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.floor(q * orden.length))];
};
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
const tamanoBase = () =>
  ['', '-wal', '-shm']
    .map((s) => join(directorio, `cotizador.sqlite${s}`))
    .filter(existsSync)
    .reduce((s, f) => s + statSync(f).size, 0);

try {
  const msArranque = await arrancar();
  const m0 = memoria();
  console.log(
    `next start en el puerto ${puerto}: responde en ${Math.round(msArranque)} ms, RSS ${Math.round(m0.node)} MB.`,
  );
  const cookies = [];
  for (const email of cuentas) cookies.push(await iniciarSesion(email));
  console.log(`Base al arrancar: ${mb(tamanoBase())} MB.`);

  if (!values['sin-ab']) {
    const resultados: MedidaAb[] = [];
    // Calentamiento: la primera solicitud de cada ruta compila nada en producción, pero abre la base y el catálogo.
    await ab('calentamiento', '/api/accion?pagina=1&porPagina=30', cookies[0], undefined, 50, 2);
    resultados.push(await ab('GET /api/salud (sin sesión)', '/api/salud', null));
    resultados.push(await ab('GET /login (página)', '/login', null));
    resultados.push(await ab('GET / (cotizador, con sesión)', '/', cookies[0]));
    resultados.push(
      await ab('GET historial: página 1 (30)', '/api/accion?pagina=1&porPagina=30', cookies[0]),
    );
    resultados.push(
      await ab('GET historial: página 200 (30)', '/api/accion?pagina=200&porPagina=30', cookies[0]),
    );
    resultados.push(
      await ab(
        'GET búsqueda «cliente 1999»',
        '/api/accion?q=cliente%201999&pagina=1&porPagina=30',
        cookies[0],
      ),
    );
    resultados.push(
      await ab(
        'GET filtro emitidas + fechas',
        '/api/accion?estado=emitida&desde=2026-03-01&hasta=2026-03-31&pagina=1&porPagina=30',
        cookies[0],
      ),
    );
    resultados.push(
      await ab('GET /api/catalogo', '/api/catalogo', cookies[0], undefined, Math.min(abN, 500)),
    );
    resultados.push(
      await ab(
        'POST chat (borrador nuevo)',
        '/api/accion',
        cookies[0],
        { tipo: 'chat', mensaje: 'Cotiza Huilo Huilo en pino oregón' },
        Math.min(abN, 1000),
        Math.min(abC, 4),
      ),
    );
    const m1 = memoria();
    console.log(`\n### ab (n=${abN}, c=${abC}; chat n=${Math.min(abN, 1000)}, c=${Math.min(abC, 4)})\n`);
    console.log(
      '| Ruta | req/s | p50 ms | p95 ms | p99 ms | máx ms | no 2xx | RSS Node MB |\n|---|---:|---:|---:|---:|---:|---:|---:|',
    );
    for (const r of resultados)
      console.log(
        `| ${r.ruta} | ${r.rps.toFixed(1)} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.max} | ${r.no2xx} | ${r.rss} |`,
      );
    console.log(
      `\nRSS tras ab: Node ${Math.round(m1.node)} MB, árbol ${Math.round(m1.total)} MB (${m1.procesos} procesos). Base ${mb(tamanoBase())} MB.`,
    );
  }

  if (minutos > 0) {
    const inicio = performance.now();
    const hasta = inicio + minutos * 60_000;
    const muestreo = setInterval(
      () => muestras.push({ t: performance.now() - inicio, ...memoria() }),
      15_000,
    );
    muestras.push({ t: 0, ...memoria() });
    const rondas = await resistencia(cookies, hasta);
    clearInterval(muestreo);
    muestras.push({ t: performance.now() - inicio, ...memoria() });
    console.log(
      `\n### Resistencia: ${personas} personas × ${minutos} min, ${rondas} rondas, ${tiempos.length} solicitudes\n`,
    );
    const ventana = (desde: number, hasta2: number) =>
      tiempos.filter((x) => x.t - inicio >= desde && x.t - inicio < hasta2);
    const tercio = (minutos * 60_000) / 3;
    console.log(
      '| Acción | n | p50 ms | p95 ms | máx ms | p50 1er tercio | p50 último tercio |\n|---|---:|---:|---:|---:|---:|---:|',
    );
    const etiquetas = [...new Set(tiempos.map((x) => x.etiqueta))].sort();
    for (const e of etiquetas) {
      const xs = tiempos.filter((x) => x.etiqueta === e).map((x) => x.ms);
      const a = ventana(0, tercio)
        .filter((x) => x.etiqueta === e)
        .map((x) => x.ms);
      const b = ventana(2 * tercio, Infinity)
        .filter((x) => x.etiqueta === e)
        .map((x) => x.ms);
      console.log(
        `| ${e} | ${xs.length} | ${Math.round(p(xs, 0.5))} | ${Math.round(p(xs, 0.95))} | ${Math.round(Math.max(...xs))} | ${Math.round(p(a, 0.5))} | ${Math.round(p(b, 0.5))} |`,
      );
    }
    console.log(
      `\nCódigos HTTP: ${[...estados]
        .sort()
        .map(([s, n]) => `${s}: ${n}`)
        .join(', ')}`,
    );
    console.log('\nMemoria (RSS, MB) cada ~15 s: min → Node / árbol con Chromium');
    const paso = Math.max(1, Math.floor(muestras.length / 12));
    console.log(
      muestras
        .filter((_, i) => i % paso === 0 || i === muestras.length - 1)
        .map(
          (m) =>
            `${(m.t / 60_000).toFixed(1)} min → ${Math.round(m.node)} / ${Math.round(m.total)} (${m.procesos} proc.)`,
        )
        .join('\n'),
    );
    const nodos = muestras.map((m) => m.node);
    console.log(
      `Node: mín ${Math.round(Math.min(...nodos))}, máx ${Math.round(Math.max(...nodos))}, final ${Math.round(nodos.at(-1)!)} MB.`,
    );
    if (errores5xx.length)
      fallas.push(
        `${errores5xx.length} respuestas 5xx:\n  ${[...new Set(errores5xx)].slice(0, 10).join('\n  ')}`,
      );
  }
} catch (error) {
  fallas.push(String(error instanceof Error ? error.stack : error));
} finally {
  await detener();
  closeSync(registro);
}

// ---------- Comprobaciones con el servidor detenido ----------
try {
  const db = new Database(join(directorio, 'cotizador.sqlite'), { readonly: true });
  try {
    const integridad = db.pragma('integrity_check', { simple: true });
    if (integridad !== 'ok') fallas.push(`integrity_check: ${integridad}`);
    const { siguiente_cotizacion, siguiente_nota } = db
      .prepare('SELECT siguiente_cotizacion, siguiente_nota FROM correlativos WHERE id = 1')
      .get() as {
      siguiente_cotizacion: number;
      siguiente_nota: number;
    };
    const numeros = new Set(
      (
        db.prepare('SELECT numero FROM cotizaciones WHERE numero IS NOT NULL').all() as { numero: number }[]
      ).map((r) => r.numero),
    );
    const notas = new Set(
      (db.prepare('SELECT numero FROM notas_pedido').all() as { numero: number }[]).map((r) => r.numero),
    );
    const quemados = [];
    for (let n = inicial.siguienteCotizacion; n < siguiente_cotizacion; n++)
      if (!numeros.has(n)) quemados.push(n);
    const quemadasNotas = [];
    for (let n = inicial.siguienteNota; n < siguiente_nota; n++) if (!notas.has(n)) quemadasNotas.push(n);
    if (quemados.length) fallas.push(`Números de cotización quemados: ${quemados.join(', ')}`);
    if (quemadasNotas.length) fallas.push(`Números de nota quemados: ${quemadasNotas.join(', ')}`);
    const pdfs = (
      db
        .prepare('SELECT pdf FROM cotizaciones WHERE pdf IS NOT NULL AND numero >= ?')
        .all(inicial.siguienteCotizacion) as { pdf: string }[]
    ).map((r) => r.pdf);
    const sinPdf = pdfs.filter((f) => !existsSync(join(directorio, 'pdf', f)));
    if (sinPdf.length) fallas.push(`${sinPdf.length} cotizaciones emitidas en la carga sin su PDF.`);
    const total = (db.prepare('SELECT COUNT(*) AS n FROM cotizaciones').get() as { n: number }).n;
    console.log(
      `\nAl terminar: ${total.toLocaleString('es-CL')} cotizaciones, ${siguiente_cotizacion - inicial.siguienteCotizacion} emitidas en la carga, ` +
        `${siguiente_nota - inicial.siguienteNota} notas, ${pdfs.length} PDF; base ${mb(tamanoBase())} MB (con -wal).`,
    );
  } finally {
    db.close();
  }
  const log = await readFile(join(directorio, 'servidor.log'), 'utf8');
  const lineasError = log
    .split('\n')
    .filter((l) => /\berror\b|unhandled|uncaught/i.test(l) && !l.includes('[asistente]'));
  console.log(
    `Registro del servidor: ${lineasError.length} líneas de error${lineasError.length ? `, p. ej.:\n  ${lineasError.slice(0, 5).join('\n  ')}` : '.'}`,
  );
} catch (error) {
  fallas.push(String(error instanceof Error ? error.stack : error));
}
console.log(
  fallas.length
    ? `\nFALLA:\n- ${fallas.join('\n- ')}`
    : '\nSin 5xx, sin números quemados, con todos los PDF y la base íntegra.',
);
if (!values.conservar) await rm(directorio, { recursive: true, force: true });
else console.log(`Instalación conservada en ${directorio}`);
process.exit(fallas.length ? 1 : 0);

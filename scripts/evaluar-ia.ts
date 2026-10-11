// Mide la precisión de la IA con los casos de evals/cotizacion.json, usando el mismo servicio que la
// aplicación (anclaje de cifras, reintento y resolución contra el catálogo incluidos).
//
//   npm run evaluar:ia                           modelo configurado en Ajustes
//   npm run evaluar:ia -- --modelos a,b          compara modelos
//   npm run evaluar:ia -- --caso voz-coscos      un caso
//   npm run evaluar:ia -- --min 0.95             sale con error bajo esa precisión
//   npm run evaluar:ia -- --repeticiones 3       corre cada caso 3 veces: perfecto solo si las 3 lo son
//   npm run evaluar:ia -- --min-perfectos 0.95   sale con error si menos del 95 % de los casos es perfecto
//   npm run evaluar:ia -- --anclaje corregir,avisar  compara los modos del anclaje por frase (ver ModoAnclaje)
//
// Usa la clave y el catálogo de la base configurada (NELTUME_DATA_DIR). Cada caso corre en una base temporal:
// no crea cotizaciones en la base real. Llama al proveedor de IA: tiene un costo (pequeño) por ejecución.
// La IA no responde siempre igual («No entendí» salía 1 de cada 4 veces con un pedido real): con repeticiones,
// un caso que falla a veces no pasa por perfecto.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { CommandCodeLLM, type ModoAnclaje } from '../src/asistente/llm';
import { casosSchema, resumen, type CasoEvaluacion } from '../src/asistente/evaluacion';
import { leerAjustesIA, leerClaveCommandCode } from '../src/servidor/ajustes-ia';
import { cargarCatalogo } from '../src/servidor/catalogo';
import { correrCaso } from '../src/servidor/evaluar-caso';
import { obtenerCatalogoCommandCode } from '../src/servidor/modelos-commandcode';

const { values } = parseArgs({
  options: {
    modelos: { type: 'string' },
    anclaje: { type: 'string', default: 'corregir' },
    caso: { type: 'string', multiple: true },
    min: { type: 'string' },
    'min-perfectos': { type: 'string' },
    paralelo: { type: 'string', default: '3' },
    repeticiones: { type: 'string', default: '1' },
    casos: { type: 'string', default: 'evals/cotizacion.json' },
  },
});

const casos = casosSchema
  .parse(JSON.parse(await readFile(values.casos!, 'utf8')))
  .filter((c) => !values.caso?.length || values.caso.includes(c.id));
if (!casos.length) throw new Error('Ningún caso coincide con --caso.');
const clave = leerClaveCommandCode();
if (!clave) throw new Error('Falta la clave de CommandCode: configúrala en Ajustes o en CMD_API_KEY.');
const modelos = values.modelos
  ?.split(',')
  .map((m) => m.trim())
  .filter(Boolean) ?? [leerAjustesIA().commandcode.modelo];
const modos = values.anclaje!.split(',').map((m) => m.trim());
for (const m of modos)
  if (m !== 'corregir' && m !== 'avisar') throw new Error(`--anclaje: «${m}» no es corregir ni avisar.`);
const catalogo = await cargarCatalogo();
const repeticiones = Math.max(1, Math.floor(Number(values.repeticiones)) || 1);

const correr = (caso: CasoEvaluacion, modelo: string, anclaje: ModoAnclaje) =>
  correrCaso(caso, new CommandCodeLLM(modelo, clave, { anclaje }), catalogo);

// Consumo de cada corrida, leído del `usage` de cada respuesta del proveedor sin tocar la aplicación.
const consumo = { llamadas: 0, entrada: 0, salida: 0 };
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
  const respuesta = await fetchOriginal(...args);
  const url = String(args[0] instanceof Request ? args[0].url : args[0]);
  if (/api\.commandcode\.ai\/provider\/v1\/(chat\/completions|messages)/.test(url)) {
    consumo.llamadas++;
    try {
      const uso = ((await respuesta.clone().json()) as { usage?: Record<string, number> }).usage;
      consumo.entrada += uso?.prompt_tokens ?? uso?.input_tokens ?? 0;
      consumo.salida += uso?.completion_tokens ?? uso?.output_tokens ?? 0;
    } catch {
      // Sin uso informado: la corrida igual se mide.
    }
  }
  return respuesta;
};
const tarifas = await obtenerCatalogoCommandCode()
  .then((c) => c.modelos)
  .catch(() => []);

/** Corre en paralelo acotado: el proveedor limita las solicitudes simultáneas. */
async function enParalelo<T, R>(lista: T[], limite: number, f: (x: T) => Promise<R>) {
  const salida: R[] = new Array(lista.length);
  let siguiente = 0;
  await Promise.all(
    Array.from({ length: Math.min(limite, lista.length) }, async () => {
      while (siguiente < lista.length) {
        const i = siguiente++;
        salida[i] = await f(lista[i]);
      }
    }),
  );
  return salida;
}

const mostrar = (v: unknown) => (v === null || v === undefined ? '∅' : JSON.stringify(v));
let peor = 1,
  peoresPerfectos = 1;
for (const modelo of modelos)
  for (const anclaje of modos as ModoAnclaje[]) {
    console.log(
      `\n== ${modelo}${modos.length > 1 || anclaje !== 'corregir' ? ` · anclaje ${anclaje}` : ''} (${casos.length} casos${repeticiones > 1 ? ` × ${repeticiones}` : ''}) ==`,
    );
    const inicio = Date.now();
    Object.assign(consumo, { llamadas: 0, entrada: 0, salida: 0 });
    const corridas = casos.flatMap((c) => Array.from({ length: repeticiones }, () => c));
    const resultados = await enParalelo(corridas, Number(values.paralelo) || 1, (c) =>
      correr(c, modelo, anclaje),
    );
    let perfectos = 0;
    for (const [i, caso] of casos.entries()) {
      const delCaso = resultados.slice(i * repeticiones, (i + 1) * repeticiones);
      const buenas = delCaso.filter((r) => !r.diferencias.length && !r.error).length;
      if (buenas === delCaso.length) perfectos++;
      const { aciertos, total } = delCaso.reduce(
        (s, r) => ({ aciertos: s.aciertos + r.aciertos, total: s.total + r.total }),
        {
          aciertos: 0,
          total: 0,
        },
      );
      const consistencia = repeticiones > 1 ? ` · ${buenas}/${repeticiones} corridas perfectas` : '';
      console.log(
        `${buenas === delCaso.length ? '✓' : '✗'} ${caso.id} — ${aciertos}/${total}${consistencia}  ${caso.descripcion}`,
      );
      // Basta el detalle de la primera corrida que falló.
      const r = delCaso.find((x) => x.diferencias.length || x.error);
      if (r?.error) console.log(`    error: ${r.error.mensaje}`);
      else
        for (const d of r?.diferencias ?? [])
          console.log(
            `    ${d.item === null ? '' : `ítem ${d.item} `}${d.campo}: esperado ${mostrar(d.esperado)}, obtenido ${mostrar(d.obtenido)}`,
          );
    }
    const { precision } = resumen(resultados);
    peor = Math.min(peor, precision);
    // Un error del proveedor (caída, límite, plazo) no es una mala interpretación: se dice aparte.
    const conError = resultados.filter((r) => r.error).length;
    if (conError)
      console.log(
        `⚠ ${conError} de ${resultados.length} corridas no obtuvieron respuesta de la IA (proveedor caído, límite o plazo).`,
      );
    peoresPerfectos = Math.min(peoresPerfectos, perfectos / casos.length);
    const tarifa = tarifas.find((t) => t.id === modelo);
    const costo =
      tarifa?.precioEntrada != null && tarifa.precioSalida != null
        ? (consumo.entrada * tarifa.precioEntrada + consumo.salida * tarifa.precioSalida) / 1e6
        : null;
    const ms = resultados.map((r) => r.ms).sort((a, b) => a - b);
    const p90 = ms[Math.min(ms.length - 1, Math.floor(0.9 * ms.length))];
    console.log(
      `→ precisión por campo ${(precision * 100).toFixed(1)} % · casos perfectos ${perfectos}/${casos.length} · ${((Date.now() - inicio) / 1000).toFixed(0)} s`,
    );
    console.log(
      `  ${consumo.llamadas} llamadas · ${consumo.entrada.toLocaleString('es-CL')} + ${consumo.salida.toLocaleString('es-CL')} tokens · ${costo === null ? 'tarifa no disponible' : `≈ US$ ${costo.toFixed(3)} sin caché`} · conversación promedio ${(ms.reduce((s, x) => s + x, 0) / ms.length / 1000).toFixed(1)} s, p90 ${(p90 / 1000).toFixed(1)} s`,
    );
  }
if (values.min && peor < Number(values.min)) {
  console.error(
    `\nPrecisión ${(peor * 100).toFixed(1)} % bajo el mínimo ${(Number(values.min) * 100).toFixed(1)} %.`,
  );
  process.exit(1);
}
if (values['min-perfectos'] && peoresPerfectos < Number(values['min-perfectos'])) {
  console.error(
    `\nCasos perfectos ${(peoresPerfectos * 100).toFixed(1)} % bajo el mínimo ${(Number(values['min-perfectos']) * 100).toFixed(1)} %.`,
  );
  process.exit(1);
}

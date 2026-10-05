// Mide la precisión de la IA con los casos de evals/cotizacion.json, usando el mismo servicio que la
// aplicación (anclaje de cifras, reintento y resolución contra el catálogo incluidos).
//
//   npm run evaluar:ia                           modelo configurado en Ajustes
//   npm run evaluar:ia -- --modelos a,b          compara modelos
//   npm run evaluar:ia -- --caso voz-coscos      un caso
//   npm run evaluar:ia -- --min 0.95             sale con error bajo esa precisión
//
// Usa la clave y el catálogo de la base configurada (NELTUME_DATA_DIR). Cada caso corre en una base temporal:
// no crea cotizaciones en la base real. Llama al proveedor de IA: tiene un costo (pequeño) por ejecución.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { CommandCodeLLM } from '../src/asistente/llm';
import { casosSchema, resumen, type CasoEvaluacion } from '../src/asistente/evaluacion';
import { leerAjustesIA, leerClaveCommandCode } from '../src/servidor/ajustes-ia';
import { cargarCatalogo } from '../src/servidor/catalogo';
import { correrCaso } from '../src/servidor/evaluar-caso';

const { values } = parseArgs({
  options: {
    modelos: { type: 'string' },
    caso: { type: 'string', multiple: true },
    min: { type: 'string' },
    paralelo: { type: 'string', default: '3' },
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
const catalogo = await cargarCatalogo();

const correr = (caso: CasoEvaluacion, modelo: string) =>
  correrCaso(caso, new CommandCodeLLM(modelo, clave), catalogo);

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
let peor = 1;
for (const modelo of modelos) {
  console.log(`\n== ${modelo} (${casos.length} casos) ==`);
  const inicio = Date.now();
  const resultados = await enParalelo(casos, Number(values.paralelo) || 1, (c) => correr(c, modelo));
  for (const [i, r] of resultados.entries()) {
    const ok = !r.diferencias.length && !r.error;
    console.log(`${ok ? '✓' : '✗'} ${r.id} — ${r.aciertos}/${r.total}  ${casos[i].descripcion}`);
    if (r.error) console.log(`    error: ${r.error.mensaje}`);
    else
      for (const d of r.diferencias)
        console.log(
          `    ${d.item === null ? '' : `ítem ${d.item} `}${d.campo}: esperado ${mostrar(d.esperado)}, obtenido ${mostrar(d.obtenido)}`,
        );
  }
  const { precision, perfectos } = resumen(resultados);
  peor = Math.min(peor, precision);
  console.log(
    `→ precisión por campo ${(precision * 100).toFixed(1)} % · casos perfectos ${perfectos}/${casos.length} · ${((Date.now() - inicio) / 1000).toFixed(0)} s`,
  );
}
if (values.min && peor < Number(values.min)) {
  console.error(
    `\nPrecisión ${(peor * 100).toFixed(1)} % bajo el mínimo ${(Number(values.min) * 100).toFixed(1)} %.`,
  );
  process.exit(1);
}

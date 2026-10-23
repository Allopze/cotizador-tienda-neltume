// Evalúa si la IA elige bien `cambiar_numero` (documento, fábrica y número) con los casos de evals/numeros.json. No usa
// el servicio: ese flujo necesita una cotización emitida con sus PDF. Lo que valida el servidor (que los números estén
// escritos, permisos, números libres) lo cubren los tests de Vitest.
//   npm run evaluar:numeros -- [--repeticiones 3] [--min 1]
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { CommandCodeLLM, contextoSeguro, type DocumentosContexto } from '../src/asistente/llm';
import { salidaSchema } from '../src/asistente/esquemas';
import { clienteVacio } from '../src/catalogo/tipos';
import { leerAjustesIA, leerClaveCommandCode } from '../src/servidor/ajustes-ia';

const fabrica = z.enum(['panguipulli', 'santiago']);
const casos = z
  .array(
    z.object({
      id: z.string(),
      descripcion: z.string(),
      mensaje: z.string(),
      documentos: z.object({
        estado: z.enum(['borrador', 'emitida', 'aprobada', 'reemplazada', 'anulada']),
        numero: z.number().nullable(),
        notas: z.array(z.object({ fabrica: fabrica.nullable(), numero: z.number() })),
      }),
      /** null: no debe cambiar ningún número. */
      esperado: z
        .object({ herramienta: z.literal('cambiar_numero'), documento: z.enum(['cotizacion', 'nota']), fabrica: fabrica.nullable(), numero: z.number() })
        .nullable(),
    }),
  )
  .parse(JSON.parse(await readFile('evals/numeros.json', 'utf8')));
const { values } = parseArgs({ options: { repeticiones: { type: 'string', default: '1' }, min: { type: 'string', default: '1' } } });
const clave = leerClaveCommandCode();
if (!clave) throw new Error('Falta la clave de CommandCode: configúrala en Ajustes o en CMD_API_KEY.');
const modelo = leerAjustesIA().commandcode.modelo;
const llm = new CommandCodeLLM(modelo, clave);
const items = [
  { modelo: 'MOLCO', madera: 'LENGA', ancho: 0.8, alto: 2, medida: null, cantidad: 2, fabrica: 'panguipulli' as const },
  { modelo: 'COZ COZ', madera: 'PREPINTADA', ancho: 0.8, alto: 2, medida: null, cantidad: 3, fabrica: 'santiago' as const },
];
const repeticiones = Math.max(1, Number(values.repeticiones) || 1);
console.log(`\n== ${modelo} (${casos.length} casos × ${repeticiones}) ==`);
let buenas = 0,
  total = 0;
for (const caso of casos) {
  let ok = 0;
  let ultimo = '';
  for (let i = 0; i < repeticiones; i++) {
    const documentos: DocumentosContexto = caso.documentos;
    const salida = salidaSchema.safeParse(
      await llm.interpretar(
        contextoSeguro(caso.mensaje, items, clienteVacio(), ['MOLCO', 'COZ COZ'], ['LENGA', 'PREPINTADA'], [], 'cotizacion_nueva', null, { documentos }),
      ),
    );
    const r = salida.success ? salida.data : null;
    const bien = caso.esperado
      ? r?.name === 'cambiar_numero' &&
        r.input.documento === caso.esperado.documento &&
        r.input.fabrica === caso.esperado.fabrica &&
        r.input.numero === caso.esperado.numero
      : r?.name !== 'cambiar_numero';
    if (bien) ok++;
    else ultimo = JSON.stringify(r);
  }
  total += repeticiones;
  buenas += ok;
  console.log(`${ok === repeticiones ? '✓' : '✗'} ${caso.id} — ${ok}/${repeticiones}  ${caso.descripcion}`);
  if (ok < repeticiones) console.log(`    esperado ${JSON.stringify(caso.esperado)}, obtenido ${ultimo}`);
}
const precision = buenas / total;
console.log(`→ ${buenas}/${total} (${(precision * 100).toFixed(1)} %)`);
if (precision < Number(values.min)) {
  console.error(`Por debajo del mínimo (${values.min}).`);
  process.exit(1);
}

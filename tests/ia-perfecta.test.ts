import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { casosSchema, resumen, type CasoEvaluacion } from '../src/asistente/evaluacion';
import { armarInforme, umbralesSuperados } from '../src/asistente/informe-evaluacion';
import type { LLM } from '../src/asistente/llm';
import { INTERMEDIAS, LLMPerfecto, lecturaDelTurno } from '../src/asistente/perfecto';
import type { CatalogoConsultable } from '../src/catalogo/resolver';

// «IA perfecta» (src/asistente/perfecto.ts): la evaluación completa sin gasto. Con una IA que responde la lectura
// esperada, cada caso de evals/cotizacion.json debe quedar perfecto y sin falsas alarmas en los dos modos del
// anclaje; si no, lo que falla es el servidor (anclaje, avisos, pendientes) o el caso, no el modelo. Además, una IA
// que se equivoca a propósito debe verse en el puntaje y en el informe.

const principal = resolve('datos-privados/COTIZADOR_2026.xlsx');
const enchapadas = resolve('datos-privados/VALORES PUERTAS ENCHAPADAS_NELTUME.CO.xlsx');
const hayPlanillas = existsSync(principal) && existsSync(enchapadas);
let casos: CasoEvaluacion[] = [];
let catalogo: CatalogoConsultable;
let correrCaso: typeof import('../src/servidor/evaluar-caso').correrCaso;
let directorio: string | undefined;

describe('IA perfecta: estructura', async () => {
  casos = casosSchema.parse(JSON.parse(await readFile('evals/cotizacion.json', 'utf8')));

  it('cada caso de varios mensajes tiene la lectura de sus turnos anteriores', () => {
    for (const caso of casos.filter((c) => c.mensajes.length > 1))
      for (let turno = 0; turno < caso.mensajes.length - 1; turno++)
        expect(() => lecturaDelTurno(caso, turno), caso.id).not.toThrow();
    // Ninguna entrada huérfana: si un caso cambia de nombre, su lectura intermedia no queda olvidada.
    const ids = new Set(casos.map((c) => c.id));
    expect(Object.keys(INTERMEDIAS).filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe.skipIf(!hayPlanillas)('IA perfecta: evaluación completa con el catálogo real', () => {
  beforeAll(async () => {
    directorio = await mkdtemp(join(tmpdir(), 'neltume-ia-perfecta-'));
    vi.stubEnv('NELTUME_DATA_DIR', directorio);
    vi.stubEnv('NELTUME_DB_PATH', join(directorio, 'cotizador.sqlite'));
    vi.stubEnv('NELTUME_FERIADOS_SYNC', '0');
    vi.resetModules();
    const { importarPlanilla } = await import('../src/catalogo/planilla');
    const { leerConfiguracionCatalogo } = await import('../src/catalogo/configuracion-archivo');
    const { Almacen } = await import('../src/servidor/almacen');
    const { cargarCatalogo } = await import('../src/servidor/catalogo');
    const almacen = new Almacen();
    for (const ruta of [principal, enchapadas]) {
      const r = await importarPlanilla(ruta, await leerConfiguracionCatalogo());
      await almacen.guardarCatalogo(r.catalogo, r.configuracion);
    }
    catalogo = await cargarCatalogo();
    ({ correrCaso } = await import('../src/servidor/evaluar-caso'));
  }, 60_000);
  afterAll(async () => {
    if (!directorio) return;
    (await import('../src/servidor/almacen')).cerrarAlmacen();
    vi.unstubAllEnvs();
    await rm(directorio, { recursive: true, force: true });
  });

  it.each(['avisar', 'corregir'] as const)(
    'anclaje «%s»: 100 % por campo, todos perfectos, sin avisos de revisión',
    async (anclaje) => {
      const corridas = [];
      for (const caso of casos)
        corridas.push(await correrCaso(caso, new LLMPerfecto(caso, anclaje), catalogo));
      const fallidos = corridas.flatMap((r, i) =>
        r.diferencias.length || r.error
          ? [`${casos[i].id}: ${JSON.stringify(r.error ?? r.diferencias)}`]
          : [],
      );
      expect(fallidos).toEqual([]);
      expect(resumen(corridas).precision).toBe(1);
      const informe = armarInforme({
        fecha: new Date(),
        modelo: 'ia-perfecta',
        anclaje,
        casos,
        repeticiones: 1,
        corridas,
        segundos: 1,
        consumo: { llamadas: 0, entrada: 0, salida: 0, costoUSD: null },
      });
      expect(informe.avisos).toMatchObject({ falsas: 0, silenciosas: 0, conErrores: 0 });
      // Los umbrales de `npm run evaluar:regresion` pasan.
      expect(umbralesSuperados(informe, { maxSilenciosos: 0, maxFalsas: 0.05 })).toEqual([]);
    },
    120_000,
  );

  it('una IA que cambia una cantidad sin que nadie la escriba: el caso falla y el error no es silencioso', async () => {
    const caso = casos.find((c) => c.id === 'cambia-cantidad')!;
    const perfecta = new LLMPerfecto(caso);
    const equivocada: LLM = {
      verificarCifras: true,
      anclaje: 'avisar',
      async interpretar(c, o) {
        const salida = (await perfecta.interpretar(c)) as {
          input: { items?: { cantidad: number | null }[] };
        };
        void o;
        // En el último turno anota 7 en vez de 5 (el 7 no está en la conversación).
        if (c.historial.some((m) => m.rol === 'usuario') && salida.input.items)
          salida.input.items[0].cantidad = 7;
        return salida;
      },
    };
    const r = await correrCaso(caso, equivocada, catalogo);
    expect(r.aciertos).toBeLessThan(r.total);
    const informe = armarInforme({
      fecha: new Date(),
      modelo: 'equivocada',
      anclaje: 'avisar',
      casos: [caso],
      repeticiones: 1,
      corridas: [r],
      segundos: 1,
      consumo: { llamadas: 0, entrada: 0, salida: 0, costoUSD: null },
    });
    expect(informe.avisos).toMatchObject({ conErrores: 1, silenciosas: 0 });
  }, 60_000);
});

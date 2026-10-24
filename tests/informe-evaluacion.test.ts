import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { casosSchema } from '../src/asistente/evaluacion';
import {
  armarInforme,
  informeMarkdown,
  leerUmbral,
  medirAvisos,
  nombreInforme,
  umbralesSuperados,
  type CorridaEvaluada,
} from '../src/asistente/informe-evaluacion';

// Evaluación de la IA sin gastar: el informe, los umbrales y la advertencia de --sin-ia se prueban con corridas
// armadas a mano; ninguna prueba llama al proveedor.

const casos = casosSchema.parse([
  { id: 'a', descripcion: 'Caso A', mensajes: ['x'], esperado: { items: [] } },
  { id: 'b', descripcion: 'Caso B', mensajes: ['x'], esperado: { items: [] } },
  { id: 'c', descripcion: 'Caso C', mensajes: ['x'], esperado: { items: [] } },
]);
const corrida = (id: string, extra: Partial<CorridaEvaluada> = {}): CorridaEvaluada => ({
  id,
  aciertos: 9,
  total: 9,
  diferencias: [],
  ms: 1000,
  avisos: [],
  ...extra,
});
const diferencia = { item: 1, campo: 'alto', esperado: 2, obtenido: 2.1 };
const avisoCifras = { categoria: 'cifras', texto: 'El alto 2,1 m no aparece en tu mensaje.' };
const avisoCampo = { categoria: 'campo', texto: 'No pude verificar el ítem 1 contra tu mensaje; revísalo.' };
const informativo = { categoria: 'otros', texto: 'Usé el precio que indicaste para el ítem 1.' };

describe('informe de evaluar:ia', () => {
  // a: perfecto con un aviso informativo · b: perfecto con falsa alarma y con una cifra inventada que quedó
  // pendiente · c: error silencioso y error avisado.
  const corridas = [
    corrida('a', { avisos: [informativo] }),
    corrida('a'),
    corrida('b', { avisos: [avisoCampo] }),
    corrida('b', { avisos: [avisoCifras] }),
    corrida('c', { aciertos: 8, diferencias: [diferencia] }),
    corrida('c', { aciertos: 8, diferencias: [diferencia], avisos: [avisoCifras] }),
  ];
  const informe = armarInforme({
    fecha: new Date('2026-10-14T17:55:12Z'),
    modelo: 'deepseek/deepseek-v4.1-flash',
    anclaje: 'avisar',
    casos,
    repeticiones: 2,
    corridas,
    segundos: 42,
    consumo: { llamadas: 6, entrada: 1200, salida: 300, costoUSD: 0.0123 },
  });

  it('cuenta falsas alarmas, errores silenciosos y casos perfectos; los avisos informativos no cuentan', () => {
    // El aviso de cifras de la corrida perfecta dejó pendiente lo que la IA inventó: no es falsa alarma.
    expect(medirAvisos(corridas)).toEqual({
      perfectas: 4,
      falsas: 1,
      atrapadas: 1,
      conErrores: 2,
      silenciosas: 1,
      porCategoria: { campo: 1 },
      ejemplos: [`[campo] ${avisoCampo.texto}`],
    });
    expect(informe).toMatchObject({
      modelo: 'deepseek/deepseek-v4.1-flash',
      casos: 3,
      repeticiones: 2,
      perfectos: 2,
      sinRespuesta: 0,
      tasaFalsas: 0.25,
      precision: 52 / 54,
    });
    expect(informe.detalle.map((c) => [c.id, c.perfectas, c.diferencias.length])).toEqual([
      ['a', 2, 0],
      ['b', 2, 0],
      ['c', 0, 1],
    ]);
    // El JSON del informe se puede volver a leer tal cual.
    expect(JSON.parse(JSON.stringify(informe))).toEqual(informe);
  });

  it('el aviso que el caso pide en esperado.avisos no es falsa alarma; uno distinto sí', () => {
    const totalPedido = casosSchema.parse([
      {
        id: 'i7',
        descripcion: 'Precio en total',
        mensajes: ['x'],
        esperado: { items: [], avisos: [{ categoria: 'precio', texto: 'precio total' }] },
      },
    ]);
    const avisoTotal = { categoria: 'otros', texto: 'Escribiste un precio total para el ítem 1; indica el valor por unidad.' };
    expect(medirAvisos([corrida('i7', { avisos: [avisoTotal] })], totalPedido)).toMatchObject({ perfectas: 1, falsas: 0 });
    expect(medirAvisos([corrida('i7', { avisos: [avisoTotal, avisoCampo] })], totalPedido)).toMatchObject({
      falsas: 1,
      porCategoria: { campo: 1 },
    });
    // Sin los casos se cuenta como antes.
    expect(medirAvisos([corrida('i7', { avisos: [avisoTotal] })])).toMatchObject({ falsas: 1 });
  });

  it('una corrida sin respuesta de la IA no es silenciosa ni perfecta', () => {
    const caida = corrida('a', { aciertos: 0, diferencias: [diferencia], error: { codigo: 'ia_limite', mensaje: 'Límite.' } });
    expect(medirAvisos([caida])).toMatchObject({ perfectas: 0, conErrores: 0, silenciosas: 0 });
    const inf = armarInforme({
      fecha: new Date(),
      modelo: 'm',
      anclaje: 'avisar',
      casos: casos.slice(0, 1),
      repeticiones: 1,
      corridas: [caida],
      segundos: 1,
    });
    expect(inf).toMatchObject({ sinRespuesta: 1, perfectos: 0, tasaFalsas: 0 });
    expect(inf.detalle[0].error).toEqual({ codigo: 'ia_limite', mensaje: 'Límite.' });
  });

  it('el Markdown resume la corrida y detalla solo los casos con diferencias', () => {
    const md = informeMarkdown(informe);
    expect(md).toContain('# Evaluación de la IA · deepseek/deepseek-v4.1-flash');
    expect(md).toContain('- Casos perfectos: 2/3');
    expect(md).toContain('- Falsas alarmas: 1/4 corridas perfectas (25.0 %)');
    expect(md).toContain('- Datos inventados por la IA que el anclaje dejó pendientes: 1 corridas perfectas');
    expect(md).toContain('- Errores silenciosos: 1 de 2 corridas con errores');
    expect(md).toContain('≈ US$ 0.012');
    expect(md).toContain('## Casos con diferencias (1)');
    expect(md).toContain('### c — 16/18 · 0/2 corridas perfectas');
    expect(md).toContain('- ítem 1 alto: esperado 2, obtenido 2.1');
    expect(md).toContain('- **sin aviso: error silencioso**');
    expect(md).not.toContain('### a');
  });

  it('nombra los archivos con la fecha y el modelo, sin caracteres de ruta', () => {
    const fecha = new Date('2026-10-14T17:55:12Z');
    expect(nombreInforme(fecha, 'deepseek/deepseek-v4.1-flash')).toBe('2026-10-14T17-55-deepseek-deepseek-v4.1-flash');
    expect(nombreInforme(fecha, 'Qwen/Qwen3.7-Flash', 'corregir')).toBe('2026-10-14T17-55-Qwen-Qwen3.7-Flash-corregir');
    expect(nombreInforme(fecha, '../../etc')).not.toMatch(/\//);
  });

  it('los umbrales de regresión: 0 silenciosos y hasta 5 % de falsas alarmas', () => {
    const umbrales = { maxSilenciosos: 0, maxFalsas: 0.05 };
    expect(umbralesSuperados(informe, umbrales)).toEqual([
      'deepseek/deepseek-v4.1-flash: 1 errores silenciosos, sobre el máximo 0.',
      'deepseek/deepseek-v4.1-flash: falsas alarmas 25.0 %, sobre el máximo 5.0 %.',
    ]);
    const limpio = { modelo: 'm', tasaFalsas: 0.05, avisos: { ...informe.avisos, silenciosas: 0 } };
    expect(umbralesSuperados(limpio, umbrales)).toEqual([]);
    expect(umbralesSuperados(informe, {})).toEqual([]);
  });

  it('lee los umbrales como número o porcentaje y rechaza valores inválidos', () => {
    expect(leerUmbral(undefined, 'max-falsas')).toBeUndefined();
    expect(leerUmbral('0', 'max-silenciosos')).toBe(0);
    expect(leerUmbral('0.05', 'max-falsas')).toBe(0.05);
    expect(leerUmbral('0,05', 'max-falsas')).toBe(0.05);
    expect(leerUmbral('5%', 'max-falsas')).toBe(0.05);
    expect(() => leerUmbral('-1', 'max-silenciosos')).toThrow(/--max-silenciosos/);
    expect(() => leerUmbral('mucho', 'max-falsas')).toThrow(/--max-falsas/);
    expect(() => leerUmbral('', 'max-falsas')).toThrow();
  });

  it('evaluar:regresion usa los umbrales y el script escribe el informe en data/test-evaluar-ia', () => {
    const raiz = join(__dirname, '..');
    const paquete = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(paquete.scripts['evaluar:regresion']).toMatch(/--max-silenciosos 0\b/);
    expect(paquete.scripts['evaluar:regresion']).toMatch(/--max-falsas 0\.05\b/);
    const script = readFileSync(join(raiz, 'scripts/evaluar-ia.ts'), 'utf8');
    expect(script).toContain("default: 'data/test-evaluar-ia'");
    expect(readFileSync(join(raiz, '.gitignore'), 'utf8')).toMatch(/^data\/test-\*\/$/m);
  });
});

describe('deploy --sin-ia', () => {
  it('la advertencia es destacada y dice cómo correr la evaluación', async () => {
    // @ts-expect-error: módulo JavaScript sin tipos; importarlo no despliega (solo corre al ejecutarlo).
    const { advertenciaSinIa } = (await import('../scripts/deploy.mjs')) as { advertenciaSinIa: () => string };
    const texto = advertenciaSinIa().replace(/\x1b\[[\d;]*m/g, '');
    expect(texto).toContain('ATENCIÓN: SE OMITIÓ LA EVALUACIÓN DE LA IA (--sin-ia)');
    expect(texto).toContain('npm run evaluar:regresion');
    const lineas = texto.split('\n').filter(Boolean);
    expect(lineas[0]).toMatch(/^\+-+\+$/);
    expect(lineas.at(-1)).toBe(lineas[0]);
    expect(new Set(lineas.map((l) => l.length)).size).toBe(1);
  });
});

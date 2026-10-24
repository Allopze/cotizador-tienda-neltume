import {
  avisoPedido,
  avisosDeRevision,
  resumen,
  type AvisoObtenido,
  type CasoEvaluacion,
  type ResultadoCaso,
} from './evaluacion';

/**
 * Informe de una corrida de `evaluar:ia` (un modelo y un modo de anclaje): el resumen, los avisos y las diferencias
 * de cada caso. Se escribe en data/test-evaluar-ia/ como JSON y como Markdown para comparar corridas sin volver a
 * pagarlas. Todo es cálculo puro: el script solo corre los casos y escribe.
 */
export interface CorridaEvaluada extends ResultadoCaso {
  ms: number;
  avisos: AvisoObtenido[];
  error?: { codigo: string; mensaje: string };
}

export interface MedicionAvisos {
  /** Corridas que respondieron sin diferencias. */
  perfectas: number;
  /** Corridas perfectas con algún aviso de revisión: la vendedora revisa algo que estaba bien. */
  falsas: number;
  /**
   * Corridas perfectas en que el anclaje dejó pendiente una cifra o un nombre que la IA inventó (avisos `cifras` y
   * `nombres`): el aviso era cierto y gracias a él la corrida salió perfecta. No son falsas alarmas.
   */
  atrapadas: number;
  /** Corridas con diferencias. */
  conErrores: number;
  /** Corridas con diferencias y sin ningún aviso de revisión: el error pasa en silencio. */
  silenciosas: number;
  /** Avisos de las falsas alarmas por categoría. */
  porCategoria: Record<string, number>;
  /** Textos distintos de las falsas alarmas (hasta 15). */
  ejemplos: string[];
}

/** Avisos que dejan vacío lo que propuso la IA (ver `anclarCifras` y `anclarNombres`). */
const DEJAN_PENDIENTE = new Set(['cifras', 'nombres']);

/**
 * Avisos de revisión en corridas perfectas (falsas alarmas) y errores sin aviso (silenciosos). Con `casos`, el aviso
 * que el caso pide en `esperado.avisos` no cuenta como falsa alarma: avisar era lo correcto. Tampoco uno de
 * `cifras` o `nombres`: deja el campo vacío, así que en una corrida perfecta lo esperado era vacío (o lo dijo un
 * mensaje posterior) y la IA lo había inventado.
 */
export function medirAvisos(corridas: CorridaEvaluada[], casos: CasoEvaluacion[] = []): MedicionAvisos {
  const porId = new Map(casos.map((c) => [c.id, c]));
  const noPedidos = (r: CorridaEvaluada) => avisosDeRevision(r.avisos).filter((a) => !avisoPedido(porId.get(r.id), a));
  const falsosDe = (r: CorridaEvaluada) => noPedidos(r).filter((a) => !DEJAN_PENDIENTE.has(a.categoria));
  const respondidas = corridas.filter((r) => !r.error);
  const perfectas = respondidas.filter((r) => !r.diferencias.length);
  const falsas = perfectas.filter((r) => falsosDe(r).length);
  const atrapadas = perfectas.filter((r) => noPedidos(r).some((a) => DEJAN_PENDIENTE.has(a.categoria)));
  const conErrores = respondidas.filter((r) => r.diferencias.length);
  const silenciosas = conErrores.filter((r) => !avisosDeRevision(r.avisos).length);
  const porCategoria: Record<string, number> = {};
  const ejemplos = new Set<string>();
  for (const a of falsas.flatMap(falsosDe)) {
    porCategoria[a.categoria] = (porCategoria[a.categoria] ?? 0) + 1;
    ejemplos.add(`[${a.categoria}] ${a.texto}`);
  }
  return {
    perfectas: perfectas.length,
    falsas: falsas.length,
    atrapadas: atrapadas.length,
    conErrores: conErrores.length,
    silenciosas: silenciosas.length,
    porCategoria,
    ejemplos: [...ejemplos].slice(0, 15),
  };
}

export interface InformeCaso {
  id: string;
  descripcion: string;
  /** Corridas sin diferencias ni error, de `repeticiones`. */
  perfectas: number;
  aciertos: number;
  total: number;
  /** De la primera corrida que falló. */
  error?: { codigo: string; mensaje: string };
  diferencias: ResultadoCaso['diferencias'];
  /** Avisos de revisión de la primera corrida que falló (o de la primera, si todas fueron perfectas). */
  avisos: AvisoObtenido[];
}

export interface InformeEvaluacion {
  fecha: string;
  modelo: string;
  anclaje: string;
  repeticiones: number;
  casos: number;
  /** Proporción de campos correctos. */
  precision: number;
  /** Casos perfectos en todas sus repeticiones. */
  perfectos: number;
  /** Corridas sin respuesta de la IA (caída, límite, plazo). */
  sinRespuesta: number;
  avisos: MedicionAvisos;
  /** Falsas alarmas sobre corridas perfectas (0 si no hubo ninguna perfecta). */
  tasaFalsas: number;
  segundos: number;
  consumo?: { llamadas: number; entrada: number; salida: number; costoUSD: number | null };
  detalle: InformeCaso[];
}

/** `corridas`: `repeticiones` corridas seguidas por cada caso, en el orden de `casos`. */
export function armarInforme(datos: {
  fecha: Date;
  modelo: string;
  anclaje: string;
  casos: CasoEvaluacion[];
  repeticiones: number;
  corridas: CorridaEvaluada[];
  segundos: number;
  consumo?: InformeEvaluacion['consumo'];
}): InformeEvaluacion {
  const { casos, repeticiones, corridas } = datos;
  const detalle = casos.map((caso, i): InformeCaso => {
    const delCaso = corridas.slice(i * repeticiones, (i + 1) * repeticiones);
    const fallida = delCaso.find((r) => r.diferencias.length || r.error);
    const muestra = fallida ?? delCaso[0];
    return {
      id: caso.id,
      descripcion: caso.descripcion,
      perfectas: delCaso.filter((r) => !r.diferencias.length && !r.error).length,
      aciertos: delCaso.reduce((s, r) => s + r.aciertos, 0),
      total: delCaso.reduce((s, r) => s + r.total, 0),
      ...(fallida?.error ? { error: fallida.error } : {}),
      diferencias: fallida?.diferencias ?? [],
      avisos: muestra ? avisosDeRevision(muestra.avisos) : [],
    };
  });
  const avisos = medirAvisos(corridas, casos);
  return {
    fecha: datos.fecha.toISOString(),
    modelo: datos.modelo,
    anclaje: datos.anclaje,
    repeticiones,
    casos: casos.length,
    precision: resumen(corridas).precision,
    perfectos: detalle.filter((c) => c.perfectas === repeticiones).length,
    sinRespuesta: corridas.filter((r) => r.error).length,
    avisos,
    tasaFalsas: avisos.perfectas ? avisos.falsas / avisos.perfectas : 0,
    segundos: datos.segundos,
    ...(datos.consumo ? { consumo: datos.consumo } : {}),
    detalle,
  };
}

/** Nombre de los archivos del informe, sin extensión: «2026-10-14T17-55-modelo[-anclaje]». */
export function nombreInforme(fecha: Date, modelo: string, anclaje?: string) {
  const sello = fecha.toISOString().slice(0, 16).replace(/:/g, '-');
  const limpio = (t: string) =>
    t
      .replace(/[^\w.-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  return [sello, limpio(modelo), anclaje ? limpio(anclaje) : ''].filter(Boolean).join('-');
}

const mostrar = (v: unknown) => (v === null || v === undefined ? '∅' : JSON.stringify(v));
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

/** El mismo informe en Markdown, para leerlo o compararlo con un diff. */
export function informeMarkdown(inf: InformeEvaluacion): string {
  const l: string[] = [
    `# Evaluación de la IA · ${inf.modelo}`,
    '',
    `- Fecha: ${inf.fecha}`,
    `- Anclaje: ${inf.anclaje}`,
    `- Casos: ${inf.casos}${inf.repeticiones > 1 ? ` × ${inf.repeticiones} repeticiones` : ''}`,
    `- Precisión por campo: ${pct(inf.precision)}`,
    `- Casos perfectos: ${inf.perfectos}/${inf.casos}`,
    `- Falsas alarmas: ${inf.avisos.falsas}/${inf.avisos.perfectas} corridas perfectas (${pct(inf.tasaFalsas)})`,
    `- Datos inventados por la IA que el anclaje dejó pendientes: ${inf.avisos.atrapadas} corridas perfectas`,
    `- Errores silenciosos: ${inf.avisos.silenciosas} de ${inf.avisos.conErrores} corridas con errores`,
    ...(inf.sinRespuesta ? [`- Sin respuesta de la IA: ${inf.sinRespuesta} corridas`] : []),
    `- Duración: ${inf.segundos.toFixed(0)} s`,
    ...(inf.consumo
      ? [
          `- Consumo: ${inf.consumo.llamadas} llamadas · ${inf.consumo.entrada} + ${inf.consumo.salida} tokens · ${
            inf.consumo.costoUSD === null ? 'tarifa no disponible' : `≈ US$ ${inf.consumo.costoUSD.toFixed(3)}`
          }`,
        ]
      : []),
  ];
  const categorias = Object.entries(inf.avisos.porCategoria);
  if (categorias.length || inf.avisos.ejemplos.length) {
    l.push('', '## Falsas alarmas', '');
    if (categorias.length) l.push(`Por categoría: ${categorias.map(([c, n]) => `${c} ${n}`).join(', ')}`, '');
    for (const e of inf.avisos.ejemplos) l.push(`- ${e}`);
  }
  const fallidos = inf.detalle.filter((c) => c.perfectas < inf.repeticiones);
  l.push('', `## Casos con diferencias (${fallidos.length})`);
  if (!fallidos.length) l.push('', 'Ninguno.');
  for (const c of fallidos) {
    l.push(
      '',
      `### ${c.id} — ${c.aciertos}/${c.total}${inf.repeticiones > 1 ? ` · ${c.perfectas}/${inf.repeticiones} corridas perfectas` : ''}`,
      '',
      c.descripcion,
      '',
    );
    if (c.error) l.push(`- error ${c.error.codigo}: ${c.error.mensaje}`);
    for (const d of c.diferencias)
      l.push(
        `- ${d.item === null ? '' : `ítem ${d.item} `}${d.campo}: esperado ${mostrar(d.esperado)}, obtenido ${mostrar(d.obtenido)}`,
      );
    for (const a of c.avisos) l.push(`- aviso [${a.categoria}]: ${a.texto}`);
    if (!c.error && !c.avisos.length) l.push('- **sin aviso: error silencioso**');
  }
  return `${l.join('\n')}\n`;
}

/**
 * Umbrales de la evaluación de regresión. `maxSilenciosos`: corridas con errores y sin aviso (cantidad);
 * `maxFalsas`: proporción de corridas perfectas con una falsa alarma (0,05 = 5 %). Devuelve un mensaje por
 * umbral superado; vacío si cumple.
 */
export function umbralesSuperados(
  inf: Pick<InformeEvaluacion, 'modelo' | 'avisos' | 'tasaFalsas'>,
  umbrales: { maxSilenciosos?: number; maxFalsas?: number },
): string[] {
  const fallas: string[] = [];
  if (umbrales.maxSilenciosos !== undefined && inf.avisos.silenciosas > umbrales.maxSilenciosos)
    fallas.push(
      `${inf.modelo}: ${inf.avisos.silenciosas} errores silenciosos, sobre el máximo ${umbrales.maxSilenciosos}.`,
    );
  if (umbrales.maxFalsas !== undefined && inf.tasaFalsas > umbrales.maxFalsas)
    fallas.push(`${inf.modelo}: falsas alarmas ${pct(inf.tasaFalsas)}, sobre el máximo ${pct(umbrales.maxFalsas)}.`);
  return fallas;
}

/** Lee un umbral de la línea de comandos: un número ≥ 0; «5%» se lee 0,05. Sin valor, undefined. */
export function leerUmbral(valor: string | undefined, nombre: string): number | undefined {
  if (valor === undefined) return undefined;
  const texto = valor.trim().replace(',', '.');
  const porcentaje = texto.endsWith('%');
  const n = Number(porcentaje ? texto.slice(0, -1) : texto);
  if (!texto || !Number.isFinite(n) || n < 0) throw new Error(`--${nombre}: «${valor}» no es un número válido.`);
  return porcentaje ? n / 100 : n;
}

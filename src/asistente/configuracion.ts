// Plazos de CommandCode. Cada intento tiene su plazo; un mensaje completo (reintento, respaldo y corrección
// incluidos) no excede el plazo total.
export function timeoutIA(): number {
  const valor = Number(process.env.CMD_TIMEOUT_MS ?? 60000);
  return Number.isInteger(valor) && valor >= 1000 && valor <= 120000 ? valor : 60000;
}
/** Plazo de todo el mensaje: por omisión, el de un intento más 30 s para un reintento o el respaldo. */
export function plazoTotalIA(): number {
  const intento = timeoutIA();
  const porOmision = Math.min(intento + 30000, 300000);
  const valor = Number(process.env.CMD_PLAZO_TOTAL_MS ?? porOmision);
  return Number.isInteger(valor) && valor >= intento && valor <= 300000 ? valor : porOmision;
}
/** Espera antes de reintentar un límite o una caída momentánea del proveedor. */
export function esperaReintentoIA(): number {
  const valor = Number(process.env.CMD_REINTENTO_MS ?? 2000);
  return Number.isInteger(valor) && valor >= 0 && valor <= 10000 ? valor : 2000;
}

export const ESFUERZOS_RAZONAMIENTO = ['low', 'medium', 'high', 'max'] as const;
export type EsfuerzoRazonamiento = (typeof ESFUERZOS_RAZONAMIENTO)[number];
/** Lo que se elige junto al chat: «no» pide sin razonamiento. */
export const NIVELES_RAZONAMIENTO = ['no', ...ESFUERZOS_RAZONAMIENTO] as const;
export type NivelRazonamiento = (typeof NIVELES_RAZONAMIENTO)[number];
/** Modelos Claude: van por la API de Anthropic (thinking adaptativo + effort). Los demás, por Chat Completions. */
export const esModeloClaude = (modelo: string | null | undefined) => /^(anthropic\/)?claude-/.test(modelo?.trim() ?? '');

/**
 * El nivel cuando nadie elige otro junto al chat: CMD_RAZONAMIENTO si es válido (vale para cualquier modelo) o,
 * sin él, «high» en los Claude y «no» en los demás.
 * - Claude «high»: con Haiku dio 80/80 casos perfectos sin errores silenciosos, contra 77/80 sin razonar, con la
 *   misma latencia (evaluación del 10 nov 2026).
 * - Los demás (Qwen, DeepSeek, GPT…) quedan como antes del selector: sin `reasoning_effort` y con la herramienta
 *   forzada. Con Qwen eso significa que no razona; pedirle un nivel lo hace razonar, pero tarda 5 a 10 veces más
 *   (prueba directa del 10 nov 2026) y aún no está evaluado.
 */
export function razonamientoPredeterminado(modelo: string | null | undefined): NivelRazonamiento {
  const env = process.env.CMD_RAZONAMIENTO?.trim().toLowerCase();
  if (env && (NIVELES_RAZONAMIENTO as readonly string[]).includes(env)) return env as NivelRazonamiento;
  return esModeloClaude(modelo) ? 'high' : 'no';
}
/**
 * Cuánto razona el modelo antes de responder: el nivel elegido junto al chat o el predeterminado del modelo; null,
 * sin razonar. En Claude va como thinking adaptativo + output_config.effort; en los demás, como
 * `reasoning_effort` de Chat Completions, que el proxy de CommandCode acepta (off, low, medium, high, xhigh, max).
 * Con razonamiento la herramienta queda en «auto» (forzada, ni Claude ni Qwen razonan) y el prompt exige llamarla.
 * Un modelo que rechaza el nivel responde sin él (ver `negociar`).
 */
export function razonamientoIA(
  nivel: NivelRazonamiento | null | undefined,
  modelo: string | null | undefined,
): EsfuerzoRazonamiento | null {
  const valor = nivel ?? razonamientoPredeterminado(modelo);
  return (ESFUERZOS_RAZONAMIENTO as readonly string[]).includes(valor) ? (valor as EsfuerzoRazonamiento) : null;
}

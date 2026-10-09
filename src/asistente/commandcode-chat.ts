import { z } from 'zod';
import { errorProveedor } from './errores';
import { timeoutIA } from './configuracion';
import { negociar, type OpcionesPeticion } from './opciones-peticion';
const respuestaSchema = z.object({
  choices: z.array(
    z.object({
      finish_reason: z.string().nullable(),
      message: z.object({
        tool_calls: z
          .array(
            z.object({
              type: z.literal('function'),
              function: z.object({ name: z.string(), arguments: z.string() }),
            }),
          )
          .optional(),
      }),
    }),
  ),
});
export async function interpretarChat(
  apiKey: string,
  model: string,
  system: string,
  contexto: unknown,
  tools: { name: string; description: string; input_schema: Record<string, unknown> }[],
  plazoMs: number = timeoutIA(),
): Promise<unknown> {
  const pedir = (opciones: OpcionesPeticion) =>
    fetch('https://api.commandcode.ai/provider/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(plazoMs),
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        ...(opciones.temperatura ? { temperature: 0 } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(contexto) },
        ],
        tools: tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.input_schema },
        })),
        tool_choice: opciones.herramientaForzada ? 'required' : 'auto',
        parallel_tool_calls: false,
      }),
    });
  // Un modelo que no acepta temperature o tool_choice «required» se vuelve a pedir sin esa opción.
  const response = await negociar(pedir, async (r) => (r?.status === 400 ? r.clone().text() : null));
  if (!response.ok) throw errorProveedor(response.status);
  const parsed = respuestaSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.choices.length !== 1) return null;
  const choice = parsed.data.choices[0];
  const calls = choice.message.tool_calls;
  // Algunos backends compatibles informan 'stop' aun con una llamada forzada; 'length' sigue siendo truncado.
  if (!['tool_calls', 'stop'].includes(choice.finish_reason ?? '') || calls?.length !== 1) return null;
  const name = calls[0].function.name;
  try {
    const input = JSON.parse(calls[0].function.arguments);
    return { name, input: desenvolver(input, tools.find((t) => t.name === name)?.input_schema) };
  } catch {
    return null;
  }
}

/** ¿La propiedad del esquema JSON admite un objeto o una lista? */
function admiteEstructura(propiedad: unknown): boolean {
  if (!propiedad || typeof propiedad !== 'object') return false;
  const { type, anyOf } = propiedad as { type?: unknown; anyOf?: unknown };
  const tipos = Array.isArray(type) ? type : [type];
  return (
    tipos.includes('object') ||
    tipos.includes('array') ||
    (Array.isArray(anyOf) && anyOf.some(admiteEstructura))
  );
}

/**
 * Algunos modelos (Qwen) devuelven un objeto anidado como texto JSON («"flete": "{\"valor\": 350000}"») y la
 * respuesta entera quedaba inutilizable. Se desenvuelven solo las propiedades que el esquema de la
 * herramienta declara como objeto o lista: un texto que solo parece JSON sigue siendo texto.
 */
function desenvolver(input: unknown, esquema: Record<string, unknown> | undefined) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const propiedades = (esquema?.properties ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(input).map(([clave, valor]) => {
      if (typeof valor !== 'string' || !admiteEstructura(propiedades[clave])) return [clave, valor];
      try {
        const anidado: unknown = JSON.parse(valor);
        return [clave, anidado !== null && typeof anidado === 'object' ? anidado : valor];
      } catch {
        return [clave, valor];
      }
    }),
  );
}

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
  try {
    return { name: calls[0].function.name, input: JSON.parse(calls[0].function.arguments) };
  } catch {
    return null;
  }
}

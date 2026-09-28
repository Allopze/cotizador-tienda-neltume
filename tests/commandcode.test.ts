import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandCodeLLM, contextoSeguro } from '../src/asistente/llm';
import { clienteVacio } from '../src/catalogo/tipos';

const contexto = contextoSeguro('cotiza una Molco', [], clienteVacio(), ['MOLCO'], ['LENGA']);
const llamada = {
  type: 'tool_use',
  id: 'test-call',
  name: 'responder',
  input: { texto: '¿Qué madera necesitas?' },
};
function respuesta(content: unknown[], stop_reason = 'tool_use') {
  return Response.json({
    id: 'test-message',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Proveedor CommandCode', () => {
  it('envía al endpoint de CommandCode con su clave e ignora configuración de Anthropic', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    vi.stubEnv('CMD_MODEL', 'claude-sonnet-4-6');
    vi.stubEnv('ANTHROPIC_API_KEY', 'placeholder-unused-key');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'placeholder-unused-token');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://unused.invalid');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(respuesta([llamada]));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new CommandCodeLLM().interpretar(contexto)).toEqual({
      name: llamada.name,
      input: llamada.input,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.commandcode.ai/provider/v1/messages');
    const headers = new Headers(options?.headers);
    expect(headers.get('x-api-key')).toBe('placeholder-commandcode-key');
    expect(headers.has('authorization')).toBe(false);
    const body = JSON.parse(String(options?.body));
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.tool_choice).toEqual({ type: 'any', disable_parallel_tool_use: true });
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual([
      'actualizar_cotizacion',
      'modificar_cotizacion',
      'aprobar_cotizacion',
      'responder',
    ]);
    expect(JSON.parse(body.messages[0].content)).toEqual(contexto);
    expect(body.messages[0].content).not.toMatch(/precioNeto|montos|lineas/);
  });

  it('sin clave de CommandCode falla sin recurrir a otro proveedor', async () => {
    vi.stubEnv('CMD_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'placeholder-unused-key');
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    // El mensaje para la persona no revela variables de entorno; el detalle técnico queda para el registro.
    await expect(new CommandCodeLLM().interpretar(contexto)).rejects.toMatchObject({
      codigo: 'ia_sin_clave',
      message: expect.not.stringContaining('CMD_API_KEY'),
      tecnico: expect.stringContaining('CMD_API_KEY'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('conserva el modelo predeterminado y rechaza múltiples llamadas o respuesta truncada', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    vi.stubEnv('CMD_MODEL', undefined);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respuesta([llamada, llamada]))
      .mockResolvedValueOnce(respuesta([llamada], 'max_tokens'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new CommandCodeLLM().interpretar(contexto)).toBeNull();
    expect(await new CommandCodeLLM().interpretar(contexto)).toBeNull();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).model).toBe('claude-sonnet-5');
  });
});

describe('Modelos Chat Completions de CommandCode', () => {
  it('envía Laguna a Chat Completions y convierte la llamada a herramienta', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    vi.stubEnv('CMD_MODEL', 'poolside/laguna-s-2.1-free');
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              tool_calls: [
                {
                  type: 'function',
                  function: { name: llamada.name, arguments: JSON.stringify(llamada.input) },
                },
              ],
            },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await new CommandCodeLLM().interpretar(contexto)).toEqual({
      name: llamada.name,
      input: llamada.input,
    });
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.commandcode.ai/provider/v1/chat/completions');
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer placeholder-commandcode-key');
    const body = JSON.parse(String(options?.body));
    expect(body.model).toBe('poolside/laguna-s-2.1-free');
    expect(body.tool_choice).toBe('required');
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.tools[0].function.name).toBe('actualizar_cotizacion');
    expect(JSON.parse(body.messages[1].content)).toEqual(contexto);
  });
  it.each([401, 403, 429, 500])('traduce el error %i sin revelar el cuerpo del proveedor', async (status) => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    vi.stubEnv('CMD_MODEL', 'poolside/laguna-s-2.1-free');
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ error: 'sensitive upstream details' }, { status })),
    );
    try {
      await new CommandCodeLLM().interpretar(contexto);
      throw new Error('Debía fallar');
    } catch (e) {
      expect(e).toHaveProperty('codigo');
      expect((e as Error).message).not.toContain('sensitive');
      expect(e).toHaveProperty('status', status === 429 || status === 500 ? 503 : 502);
    }
  });
  it.each(['{invalid', JSON.stringify(llamada.input)])(
    'rechaza JSON inválido o respuesta truncada',
    async (argumentsValue) => {
      vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
      vi.stubEnv('CMD_MODEL', 'poolside/laguna-s-2.1-free');
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(
          Response.json({
            choices: [
              {
                finish_reason: argumentsValue === '{invalid' ? 'tool_calls' : 'length',
                message: {
                  tool_calls: [
                    { type: 'function', function: { name: 'responder', arguments: argumentsValue } },
                  ],
                },
              },
            ],
          }),
        ),
      );
      expect(await new CommandCodeLLM().interpretar(contexto)).toBeNull();
    },
  );
});

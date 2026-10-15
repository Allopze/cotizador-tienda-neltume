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
    expect(body.temperature).toBe(0);
    // La IA solo informa cambios: la lista completa del pedido ya no se ofrece.
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual([
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
    // El modelo por omisión responde en formato Chat Completions: la respuesta simulada debe tenerlo, o el null
    // vendría del esquema y no de las llamadas múltiples o del truncado.
    const chat = (llamadas: number, finish_reason = 'tool_calls') =>
      Response.json({
        choices: [
          {
            finish_reason,
            message: {
              tool_calls: Array.from({ length: llamadas }, () => ({
                type: 'function',
                function: { name: llamada.name, arguments: JSON.stringify(llamada.input) },
              })),
            },
          },
        ],
      });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(chat(2))
      .mockResolvedValueOnce(chat(2))
      .mockResolvedValueOnce(chat(1, 'length'))
      .mockResolvedValueOnce(chat(1, 'length'))
      .mockResolvedValueOnce(chat(1));
    vi.stubGlobal('fetch', fetchMock);
    // Cada respuesta inutilizable se reintenta una vez antes de rendirse.
    expect(await new CommandCodeLLM().interpretar(contexto)).toBeNull();
    expect(await new CommandCodeLLM().interpretar(contexto)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // La misma respuesta con una sola llamada completa sí sirve.
    expect(await new CommandCodeLLM().interpretar(contexto)).toEqual({
      name: llamada.name,
      input: llamada.input,
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://api.commandcode.ai/provider/v1/chat/completions',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).model).toBe('deepseek/deepseek-v4.1-flash');
  });

  it('con un modelo Claude también rechaza múltiples llamadas o respuesta truncada', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    vi.stubEnv('CMD_MODEL', 'claude-sonnet-5');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respuesta([llamada, llamada]))
      .mockResolvedValueOnce(respuesta([llamada, llamada]))
      .mockResolvedValueOnce(respuesta([llamada], 'max_tokens'))
      .mockResolvedValueOnce(respuesta([llamada], 'max_tokens'))
      .mockResolvedValueOnce(respuesta([llamada]));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new CommandCodeLLM().interpretar(contexto)).toBeNull();
    expect(await new CommandCodeLLM().interpretar(contexto)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(await new CommandCodeLLM().interpretar(contexto)).toEqual({
      name: llamada.name,
      input: llamada.input,
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.commandcode.ai/provider/v1/messages');
  });

  it('reintenta una vez un límite o una caída momentánea del proveedor', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    vi.stubEnv('CMD_MODEL', 'claude-sonnet-5');
    const saturado = () =>
      Response.json({ type: 'error', error: { type: 'rate_limit_error', message: 'x' } }, { status: 429 });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(saturado())
      .mockResolvedValueOnce(respuesta([llamada]));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new CommandCodeLLM().interpretar(contexto)).toEqual({
      name: llamada.name,
      input: llamada.input,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Sin respaldo, dos caídas seguidas se informan.
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => Response.json({ error: 'caído' }, { status: 500 }));
    await expect(new CommandCodeLLM().interpretar(contexto)).rejects.toMatchObject({
      codigo: 'ia_no_disponible',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('usa el modelo de respaldo si el principal no sirve, también para la corrección', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    const retirado = Response.json(
      { error: { message: 'No endpoints found for stealth/x.' } },
      { status: 404 },
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(retirado)
      .mockResolvedValueOnce(respuesta([llamada, llamada]))
      .mockResolvedValueOnce(respuesta([llamada]));
    vi.stubGlobal('fetch', fetchMock);
    const llm = new CommandCodeLLM('stealth/x', undefined, { respaldo: 'claude-sonnet-5' });
    expect(await llm.interpretar(contexto)).toEqual({ name: llamada.name, input: llamada.input });
    const modelos = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1]?.body)).model);
    expect(modelos).toEqual(['stealth/x', 'claude-sonnet-5', 'claude-sonnet-5']);
  });

  it('no usa el respaldo si la clave no sirve, y pasa a él tras un plazo agotado', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    const noAutorizado = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { type: 'error', error: { type: 'authentication_error', message: 'x' } },
          { status: 401 },
        ),
      );
    vi.stubGlobal('fetch', noAutorizado);
    const llm = new CommandCodeLLM('claude-sonnet-5', undefined, { respaldo: 'gpt-6-luna' });
    await expect(llm.interpretar(contexto)).rejects.toMatchObject({ codigo: 'ia_autenticacion' });
    expect(noAutorizado).toHaveBeenCalledTimes(1);
    const lento = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new DOMException('Request timed out', 'TimeoutError'))
      .mockResolvedValueOnce(respuesta([llamada]));
    vi.stubGlobal('fetch', lento);
    const conRespaldo = new CommandCodeLLM('claude-sonnet-5', undefined, { respaldo: 'claude-haiku-4-5' });
    expect(await conRespaldo.interpretar(contexto)).toEqual({ name: llamada.name, input: llamada.input });
    expect(lento.mock.calls.map((c) => JSON.parse(String(c[1]?.body)).model)).toEqual([
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ]);
  });

  it('no inicia otro intento si se agotó el plazo total del mensaje', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    vi.stubEnv('CMD_MODEL', 'claude-sonnet-5');
    vi.stubEnv('CMD_TIMEOUT_MS', '1000');
    vi.stubEnv('CMD_PLAZO_TOTAL_MS', '1000');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ type: 'error', error: { type: 'rate_limit_error', message: 'x' } }, { status: 429 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new CommandCodeLLM(undefined, undefined, { respaldo: 'gpt-6-luna' }).interpretar(contexto),
    ).rejects.toMatchObject({
      codigo: 'ia_limite',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('envía temperature 0 y la quita si el modelo no la acepta', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    vi.stubEnv('CMD_MODEL', 'claude-sonnet-5');
    const rechazo = (mensaje: string) =>
      Response.json(
        { type: 'error', error: { type: 'invalid_request_error', message: mensaje } },
        { status: 400 },
      );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rechazo('tool_choice: type "any" is not supported for this model.'))
      .mockResolvedValueOnce(rechazo('temperature is not supported for this model.'))
      .mockResolvedValueOnce(respuesta([llamada]));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new CommandCodeLLM().interpretar(contexto)).toEqual({
      name: llamada.name,
      input: llamada.input,
    });
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1]?.body)));
    expect(bodies.map((b) => [b.tool_choice.type, b.temperature])).toEqual([
      ['any', 0],
      ['auto', 0],
      ['auto', undefined],
    ]);
  });

  it('un rechazo 400 por otra causa no se reintenta y se informa como configuración', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    vi.stubEnv('CMD_MODEL', 'claude-sonnet-5');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens too large' } },
          { status: 400 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(new CommandCodeLLM().interpretar(contexto)).rejects.toMatchObject({
      codigo: 'ia_configuracion',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reintenta una vez con la corrección de la revisión del servidor', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    vi.stubEnv('CMD_MODEL', 'claude-sonnet-5');
    const parcial = {
      ...llamada,
      name: 'modificar_cotizacion',
      input: { agregar: [] as unknown[], cliente: { nombre: 'Ana' } },
    };
    const completa = {
      ...llamada,
      id: 'otra',
      name: 'modificar_cotizacion',
      input: { cliente: { nombre: 'Ana Soto' } },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respuesta([parcial]))
      .mockResolvedValueOnce(respuesta([completa]));
    vi.stubGlobal('fetch', fetchMock);
    const revisar = vi.fn((s: unknown) =>
      (s as { input: { cliente: { nombre: string } } }).input.cliente.nombre === 'Ana'
        ? 'Falta «2 Molco».'
        : null,
    );
    expect(await new CommandCodeLLM().interpretar(contexto, { revisar })).toEqual({
      name: completa.name,
      input: completa.input,
    });
    expect(
      JSON.parse(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).messages[0].content).correccion,
    ).toBe('Falta «2 Molco».');
    // Si la corrección llega inutilizable, se conserva la primera respuesta, que ya era válida.
    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(respuesta([parcial]))
      .mockResolvedValueOnce(respuesta([llamada, llamada]));
    expect(await new CommandCodeLLM().interpretar(contexto, { revisar })).toEqual({
      name: parcial.name,
      input: parcial.input,
    });
  });

  it('reintenta con tool_choice «auto» si el modelo Claude no acepta «any»', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    vi.stubEnv('CMD_MODEL', 'claude-sonnet-5-5');
    const rechazo = Response.json(
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'tool_choice: type "tool" and "any" are not supported for this model.',
        },
      },
      { status: 400 },
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rechazo)
      .mockResolvedValueOnce(respuesta([llamada]));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new CommandCodeLLM().interpretar(contexto)).toEqual({
      name: llamada.name,
      input: llamada.input,
    });
    const elecciones = fetchMock.mock.calls.map((c) => JSON.parse(String(c[1]?.body)).tool_choice.type);
    expect(elecciones).toEqual(['any', 'auto']);
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
    expect(body.temperature).toBe(0);
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.tools[0].function.name).toBe('modificar_cotizacion');
    expect(JSON.parse(body.messages[1].content)).toEqual(contexto);
  });
  it('desenvuelve un objeto que el modelo mandó como texto JSON, pero no un texto que solo lo parece', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    vi.stubEnv('CMD_MODEL', 'Qwen/Qwen3.7-Flash');
    const llamar = (name: string, input: Record<string, unknown>) =>
      Response.json({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              tool_calls: [{ type: 'function', function: { name, arguments: JSON.stringify(input) } }],
            },
          },
        ],
      });
    const flete = { descripcion: 'Despacho a Riñihue', cantidad: 1, valor: 350000, iva: 'neto' };
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(llamar('modificar_cotizacion', { flete: JSON.stringify(flete) }))
        .mockResolvedValueOnce(llamar('responder', { texto: '[1, 2]' })),
    );
    expect(await new CommandCodeLLM().interpretar(contexto)).toEqual({
      name: 'modificar_cotizacion',
      input: { flete },
    });
    expect(await new CommandCodeLLM().interpretar(contexto)).toEqual({
      name: 'responder',
      input: { texto: '[1, 2]' },
    });
  });
  it('reintenta con tool_choice «auto» si el modelo no acepta «required»', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    vi.stubEnv('CMD_MODEL', 'meta/muse-spark-1.3-contributor');
    const rechazo = Response.json(
      { error: { message: 'only `"auto"` is supported for `tool_choice`.', type: 'invalid_request_error' } },
      { status: 400 },
    );
    const exito = Response.json({
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
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(rechazo).mockResolvedValueOnce(exito);
    vi.stubGlobal('fetch', fetchMock);
    expect(await new CommandCodeLLM().interpretar(contexto)).toEqual({
      name: llamada.name,
      input: llamada.input,
    });
    expect(fetchMock.mock.calls.map((c) => JSON.parse(String(c[1]?.body)).tool_choice)).toEqual([
      'required',
      'auto',
    ]);
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

describe('Reintento con corrección', () => {
  const indiceFuera = {
    type: 'tool_use',
    id: 'test-call',
    name: 'modificar_cotizacion',
    input: { items: [{ indice: 3, cambios: { madera: 'LENGA' } }] },
  };
  it('reintenta una vez diciéndole al modelo qué corregir y usa la segunda respuesta', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respuesta([indiceFuera]))
      .mockResolvedValueOnce(respuesta([llamada]));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new CommandCodeLLM('claude-sonnet-5').interpretar(contexto)).toEqual({
      name: llamada.name,
      input: llamada.input,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const primero = JSON.parse(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).messages[0].content);
    const segundo = JSON.parse(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).messages[0].content);
    expect(primero.correccion).toBeUndefined();
    expect(segundo.correccion).toMatch(/índice 3 no existe/);
  });
  it('con un mensaje acotado, reintenta solo los productos y conserva el flete de la primera respuesta', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    const flete = { descripcion: 'Despacho a Riñihue', cantidad: 1, valor: 350000, iva: 'neto' };
    const soloFlete = {
      ...llamada,
      name: 'modificar_cotizacion',
      input: { flete, cliente: { nombre: 'Verónica' } },
    };
    const molco = {
      modelo: 'MOLCO',
      madera: 'LENGA',
      ancho: 0.8,
      alto: 2,
      medida: null,
      cantidad: 2,
      tipoMedida: null,
      fuente: '2 Molco lenga 80x200',
    };
    const productos = { ...llamada, name: 'modificar_cotizacion', input: { agregar: [molco] } };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(respuesta([soloFlete]))
      .mockResolvedValueOnce(respuesta([productos]));
    vi.stubGlobal('fetch', fetchMock);
    const revisar = vi.fn(() => ({ correccion: 'Faltan los productos.', mensaje: '2 Molco lenga 80x200' }));
    expect(await new CommandCodeLLM('claude-sonnet-5').interpretar(contexto, { revisar })).toEqual({
      name: 'modificar_cotizacion',
      input: { agregar: [molco], flete, cliente: { nombre: 'Verónica' } },
    });
    const segundo = JSON.parse(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).messages[0].content);
    expect(segundo).toMatchObject({ mensaje: '2 Molco lenga 80x200', correccion: 'Faltan los productos.' });
  });
  it('si el reintento falla, devuelve la primera respuesta en vez de un error', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(respuesta([indiceFuera]))
        .mockResolvedValueOnce(Response.json({ error: 'caído' }, { status: 500 })),
    );
    expect(await new CommandCodeLLM('claude-sonnet-5').interpretar(contexto)).toEqual({
      name: indiceFuera.name,
      input: indiceFuera.input,
    });
  });
});

describe('#38 · diagnóstico de los rechazos del proveedor', () => {
  afterEach(() => vi.restoreAllMocks());
  const chatRechazo = (status: number, cuerpo: string) => new Response(cuerpo, { status });

  it('un 4xx de Chat Completions deja el comienzo de su cuerpo como detalle técnico, sin la clave', async () => {
    vi.stubEnv('CMD_API_KEY', 'sk-secreta-123');
    const cuerpo = JSON.stringify({
      error: { message: `No endpoints found for deepseek/mal-escrito. key=sk-secreta-123 ${'x'.repeat(600)}` },
    });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(chatRechazo(404, cuerpo)));
    const error = await new CommandCodeLLM('deepseek/mal-escrito', undefined, { respaldo: null })
      .interpretar(contexto)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'ia_configuracion', status: 502 });
    const { tecnico, message } = error as { tecnico: string; message: string };
    expect(tecnico).toMatch(/^HTTP 404: .*No endpoints found for deepseek\/mal-escrito/);
    expect(tecnico).not.toContain('sk-secreta-123');
    expect(tecnico).toContain('[clave]');
    // Solo los primeros 300 caracteres del cuerpo; el mensaje para la vendedora no lo incluye.
    expect(tecnico.length).toBeLessThanOrEqual('HTTP 404: '.length + 300);
    expect(message).not.toMatch(/endpoints|HTTP/);
  });

  it('un 4xx del camino Anthropic también lleva su cuerpo; un 5xx no tiene detalle', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    vi.stubEnv('CMD_MODEL', 'claude-sonnet-5');
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { type: 'error', error: { type: 'permission_error', message: 'model not in your plan' } },
          { status: 403 },
        ),
      ),
    );
    await expect(new CommandCodeLLM().interpretar(contexto)).rejects.toMatchObject({
      codigo: 'ia_acceso',
      tecnico: expect.stringMatching(/^HTTP 403: .*model not in your plan/),
    });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(chatRechazo(500, 'interno')));
    const error = await new CommandCodeLLM('deepseek/x', undefined, { respaldo: null })
      .interpretar(contexto)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ codigo: 'ia_no_disponible' });
    expect((error as { tecnico?: string }).tecnico).toBeUndefined();
  });

  it('I5: el paso al respaldo deja un console.warn con el detalle y el diagnóstico del modelo', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const exito = Response.json({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            tool_calls: [
              { type: 'function', function: { name: llamada.name, arguments: JSON.stringify(llamada.input) } },
            ],
          },
        },
      ],
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(chatRechazo(404, '{"error":{"message":"No endpoints found for deepseek/mal"}}'))
      .mockResolvedValueOnce(exito);
    vi.stubGlobal('fetch', fetchMock);
    const llm = new CommandCodeLLM('deepseek/mal', undefined, { respaldo: 'Qwen/Qwen3.7-Flash' });
    expect(llm.usoRespaldo).toBe(false);
    expect(await llm.interpretar(contexto)).toEqual({ name: llamada.name, input: llamada.input });
    expect(warn).toHaveBeenCalledWith('[asistente] respaldo', {
      de: 'deepseek/mal',
      a: 'Qwen/Qwen3.7-Flash',
      codigo: 'ia_configuracion',
      tecnico: expect.stringContaining('No endpoints found for deepseek/mal'),
    });
    expect(llm.modeloEfectivo).toBe('Qwen/Qwen3.7-Flash');
    expect(llm.usoRespaldo).toBe(true);
  });
});

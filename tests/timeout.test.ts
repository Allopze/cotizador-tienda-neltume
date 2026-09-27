import { afterEach, expect, it, vi } from 'vitest';
import { timeoutIA } from '../src/asistente/configuracion';
import { CommandCodeLLM, contextoSeguro } from '../src/asistente/llm';
import { clienteVacio } from '../src/catalogo/tipos';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('usa 60 segundos por defecto y respeta un plazo configurado válido', () => {
  vi.stubEnv('CMD_TIMEOUT_MS', undefined);
  expect(timeoutIA()).toBe(60000);
  vi.stubEnv('CMD_TIMEOUT_MS', '90000');
  expect(timeoutIA()).toBe(90000);
});

it.each(['0', '-1', 'NaN', 'Infinity', '120001', '1.5', ''])('descarta el plazo inválido %s', (valor) => {
  vi.stubEnv('CMD_TIMEOUT_MS', valor);
  expect(timeoutIA()).toBe(60000);
});

it('aplica el plazo al transporte y devuelve un timeout 504 sin reintentar', async () => {
  vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
  vi.stubEnv('CMD_MODEL', 'stealth/pixel-canary');
  vi.stubEnv('CMD_TIMEOUT_MS', '90000');
  const signal = vi.spyOn(AbortSignal, 'timeout');
  const request = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new DOMException('Request timed out', 'TimeoutError'));
  vi.stubGlobal('fetch', request);
  await expect(
    new CommandCodeLLM().interpretar(contextoSeguro('cotiza', [], clienteVacio(), ['MOLCO'], ['LENGA'])),
  ).rejects.toMatchObject({
    codigo: 'ia_timeout',
    status: 504,
    message: expect.stringContaining('90 segundos'),
  });
  expect(signal).toHaveBeenCalledWith(90000);
  expect(request).toHaveBeenCalledTimes(1);
});

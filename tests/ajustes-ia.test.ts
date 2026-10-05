import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ajustesPredeterminados,
  MODELO_RESPALDO_PREDETERMINADO,
  modeloRespaldo,
} from '../src/asistente/ajustes';
import { CommandCodeLLM } from '../src/asistente/llm';
import { asistenteConfigurado, crearLLM, guardarAjustesIA, leerAjustesIA } from '../src/servidor/ajustes-ia';
import { abrirBaseDatos } from '../src/servidor/base-datos';

const directorios: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of directorios.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function base() {
  const dir = await mkdtemp(join(tmpdir(), 'cotizador-ajustes-'));
  directorios.push(dir);
  return abrirBaseDatos(join(dir, 'c.sqlite'), { permitirJsonLegado: true, cachear: false });
}

describe('Ajustes del asistente', () => {
  it('usa CMD_MODEL mientras no haya ajustes guardados y persiste los cambios', async () => {
    vi.stubEnv('CMD_MODEL', 'claude-opus-5-5');
    const db = await base();
    expect(leerAjustesIA(db)).toEqual(ajustesPredeterminados('claude-opus-5-5'));
    guardarAjustesIA({ commandcode: { modelo: 'claude-sonnet-5' } }, db);
    expect(leerAjustesIA(db)).toEqual({ commandcode: { modelo: 'claude-sonnet-5' } });
    db.close();
  });

  it('guarda el modelo de respaldo; sin indicarlo usa el predeterminado y null lo desactiva', async () => {
    const db = await base();
    guardarAjustesIA({ commandcode: { modelo: 'Qwen/Qwen3.7-Flash', respaldo: 'gpt-6-luna' } }, db);
    expect(leerAjustesIA(db).commandcode.respaldo).toBe('gpt-6-luna');
    // Lo guardado antes de existir el respaldo sigue valiendo y toma el predeterminado.
    guardarAjustesIA({ commandcode: { modelo: 'Qwen/Qwen3.7-Flash' } }, db);
    expect(modeloRespaldo(leerAjustesIA(db))).toBe(MODELO_RESPALDO_PREDETERMINADO);
    guardarAjustesIA({ commandcode: { modelo: 'Qwen/Qwen3.7-Flash', respaldo: null } }, db);
    expect(modeloRespaldo(leerAjustesIA(db))).toBeNull();
    // El mismo modelo principal no es un respaldo.
    expect(modeloRespaldo({ commandcode: { modelo: 'gpt-6-luna', respaldo: 'gpt-6-luna' } })).toBeNull();
    expect(() => guardarAjustesIA({ commandcode: { modelo: 'x', respaldo: 'no válido' } }, db)).toThrow();
    db.close();
  });

  it('lee ajustes de versiones con modelo local descartando proveedor y local', async () => {
    const db = await base();
    const anterior = {
      proveedor: 'local',
      commandcode: { modelo: 'claude-opus-5-5' },
      local: { modelo: 'qwen3.5-0.8b', contexto: 8192 },
    };
    db.prepare("INSERT INTO ajustes VALUES ('ia', ?, ?)").run(
      JSON.stringify(anterior),
      new Date().toISOString(),
    );
    expect(leerAjustesIA(db)).toEqual({ commandcode: { modelo: 'claude-opus-5-5' } });
    db.close();
  });

  it('crea el adaptador de CommandCode y exige su clave', () => {
    vi.stubEnv('CMD_API_KEY', '');
    expect(crearLLM(ajustesPredeterminados())).toBeInstanceOf(CommandCodeLLM);
    expect(asistenteConfigurado()).toBe(false);
    vi.stubEnv('CMD_API_KEY', 'clave');
    expect(asistenteConfigurado()).toBe(true);
  });
});

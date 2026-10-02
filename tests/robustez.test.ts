import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { resolverItem } from '../src/catalogo/resolver';
import { pregunta } from '../src/asistente/preguntas';
import { rechazoAcceso } from '../src/servidor/acceso';
import { abrirXlsx } from '../src/catalogo/xlsx';
import { CommandCodeLLM, contextoSeguro, TURNOS_HISTORIAL } from '../src/asistente/llm';
import { porcentajeIva } from '../src/negocio/precios';
import { clienteVacio, type Catalogo, type Producto } from '../src/catalogo/tipos';
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const base: Omit<Producto, 'codigo' | 'modelo' | 'familia' | 'madera' | 'medida' | 'largo'> = {
  tipo: null,
  anchoMin: null,
  anchoMax: null,
  precioNeto: 100,
  descripcion: '',
  filaOrigen: 4,
};
const catalogo: Catalogo = {
  fuente: 'test',
  sha256: 'test',
  fecha: '2026-01-01',
  productos: [
    {
      ...base,
      codigo: 'MAR-O-2X4-B',
      modelo: 'MARCO',
      familia: 'MARCO',
      madera: 'PINO OREGON',
      medida: '2X4',
      largo: 2.1,
    },
    {
      ...base,
      codigo: 'MOL-O-3-A',
      modelo: 'MOLCO',
      familia: 'PUERTA',
      madera: 'PINO OREGON',
      medida: '0,80 A 0,85',
      anchoMin: 0.8,
      anchoMax: 0.85,
      largo: 2,
    },
  ],
};
describe('Resolver con catálogo incompleto', () => {
  it.each([
    [{ modelo: 'Marco', madera: 'raulí', medida: '4', alto: 2.1, cantidad: 1 }, 'Marco', 'MARCO'],
    [{ modelo: 'Molco', madera: 'raulí', ancho: 0.8, alto: 2, cantidad: 1 }, 'Molco', 'PUERTA'],
  ])('informa la madera no disponible en vez de fallar o mostrar opciones vacías', (s, nombre, familia) => {
    const r = resolverItem(catalogo, s);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rechazo).toEqual({ tipo: 'madera_no_disponible', valor: 'RAULI', disponibles: ['PINO OREGON'], familia });
    expect(pregunta(r.rechazo, s.modelo)).toBe(
      `${nombre} no viene en Raulí. Maderas disponibles: Pino Oregón.`,
    );
  });
});
describe('Acceso por host', () => {
  const req = (host: string | null, origin?: string) =>
    new Request('http://127.0.0.1:3000/api/accion', {
      headers: { ...(host ? { host } : {}), ...(origin ? { origin } : {}) },
    });
  it('acepta hosts locales y los configurados', () => {
    expect(rechazoAcceso(req('127.0.0.1:3000'))).toBeNull();
    expect(rechazoAcceso(req('localhost:3100'))).toBeNull();
    vi.stubEnv('NELTUME_HOSTS', 'cotizador.neltume.cl');
    expect(rechazoAcceso(req('cotizador.neltume.cl'), { escritura: true })).toBeNull();
  });
  it('rechaza DNS rebinding aunque Origin y Host coincidan', () => {
    expect(
      rechazoAcceso(req('evil.example:3000', 'http://evil.example:3000'), { escritura: true })?.status,
    ).toBe(403);
    expect(rechazoAcceso(req('evil.example:3000'))?.status).toBe(403);
    expect(rechazoAcceso(req(null))?.status).toBe(403);
  });
  it('rechaza escrituras con otro origen', () => {
    expect(rechazoAcceso(req('127.0.0.1:3000', 'http://localhost:3000'), { escritura: true })?.status).toBe(
      403,
    );
    expect(rechazoAcceso(req('127.0.0.1:3000', 'http://127.0.0.1:3000'), { escritura: true })).toBeNull();
  });
});
describe('Contexto e IA', () => {
  it('envía solo los últimos turnos, recortados y sin campos extra', () => {
    const historial = Array.from({ length: 10 }, (_, i) => ({
      rol: 'usuario' as const,
      texto: `m${i}`.padEnd(900, 'x'),
      precio: 1,
    }));
    const c = contextoSeguro('323', [], clienteVacio(), [], [], historial);
    expect(c.historial).toHaveLength(TURNOS_HISTORIAL);
    expect(c.historial[0].texto.startsWith('m4')).toBe(true);
    expect(c.historial[0].texto.length).toBe(500);
    expect(JSON.stringify(c)).not.toContain('precio');
  });
  it('acepta finish_reason stop con una única llamada a herramienta', async () => {
    vi.stubEnv('CMD_API_KEY', 'placeholder-commandcode-key');
    vi.stubEnv('CMD_MODEL', 'qwen/qwen3.7-flash');
    const input = { texto: '¿Qué madera?' };
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                tool_calls: [
                  { type: 'function', function: { name: 'responder', arguments: JSON.stringify(input) } },
                ],
              },
            },
          ],
        }),
      ),
    );
    expect(await new CommandCodeLLM().interpretar(contextoSeguro('x', [], clienteVacio(), [], []))).toEqual({
      name: 'responder',
      input,
    });
  });
  it('formatea el IVA desde las reglas', () => {
    expect(porcentajeIva()).toBe('19 %');
    expect(porcentajeIva(0.105)).toBe('10,5 %');
  });
});
describe('Lector XLSX', () => {
  it('tolera <si/>, celdas sin r y fórmulas compartidas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-xlsx-'));
    try {
      const ruta = join(dir, 'prueba.xlsx');
      const archivos = {
        'xl/workbook.xml':
          '<workbook xmlns:r="r"><sheets><sheet name="Hoja" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels':
          '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        'xl/sharedStrings.xml': '<sst><si/><si><t>uno</t></si><si><r><t>do</t></r><r><t>s</t></r></si></sst>',
        'xl/worksheets/sheet1.xml':
          '<worksheet><sheetData>' +
          '<row r="1"><c r="A1" t="s"><v>1</v></c><c t="s"><v>2</v></c><c><v>7</v></c></row>' +
          '<row r="2"><c r="A2"><f t="shared" si="0" ref="A2:A3">$A$3:$O$603</f><v>1</v></c></row>' +
          '<row r="3"><c r="A3"><f t="shared" si="0"/><v>2</v></c><c r="H3"><v>999</v></c></row>' +
          '</sheetData></worksheet>',
      };
      await writeFile(
        ruta,
        zipSync(Object.fromEntries(Object.entries(archivos).map(([k, v]) => [k, strToU8(v)]))),
      );
      const x = await abrirXlsx(ruta);
      const h = x.leer('Hoja', (c) => c !== 'H');
      expect(h.get('A1')?.valor).toBe('uno');
      expect(h.get('B1')?.valor).toBe('dos');
      expect(h.get('C1')?.valor).toBe(7);
      expect(h.get('A3')?.formula).toContain('$A$3:$O$603');
      expect(h.has('H3')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

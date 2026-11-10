// Líneas repetidas por chat (auditoría 2026-11, N-03, N-10 y N-23). El modelo se simula: se prueba lo que el
// servidor hace con la llamada de herramienta, no lo que el modelo real interpreta.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Catalogo, Producto } from '../src/catalogo/tipos';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { Servicio } from '../src/servidor/servicio';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const fila = (codigo: string, modelo: string, madera: string, anchoMin: number, anchoMax: number, largo: number, precioNeto: number): Producto => ({
  codigo,
  modelo,
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera,
  medida: `${anchoMin} A ${anchoMax}`,
  anchoMin,
  anchoMax,
  largo,
  precioNeto,
  descripcion: modelo,
  filaOrigen: 1,
});
const catalogo: Catalogo = {
  fuente: 'test',
  sha256: 'test',
  fecha: '2026-01-01',
  productos: [
    fila('RAN-O-3-B', 'RANCO', 'PINO OREGON', 0.8, 0.85, 2, 100_000),
    fila('RAN-O-5-B', 'RANCO', 'PINO OREGON', 0.95, 1.05, 2, 120_000),
    fila('MOL-L-3-B', 'MOLCO', 'LENGA', 0.8, 0.85, 2, 90_000),
  ],
};

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-repetidas-'));
  dirs.push(dir);
  const llm = { interpretar: vi.fn(), verificarCifras: true, anclaje: 'avisar' as const };
  const servicio = new Servicio(catalogo, llm as never, new Almacen(dir));
  const chat = async (mensaje: string, respuesta: object, q?: { id: string; actualizada: string }) => {
    llm.interpretar.mockResolvedValueOnce(respuesta);
    return servicio.ejecutar({ tipo: 'chat', mensaje, ...(q ? { id: q.id, actualizada: q.actualizada } : {}) } as never);
  };
  return { chat };
}

const item = (modelo: string, madera: string, ancho: number, alto: number, cantidad: number, fuente: string, extra: object = {}) => ({
  modelo, madera, ancho, alto, medida: null, cantidad, tipoMedida: null, fuente, ...extra,
});
const agregar = (...items: object[]) => ({ name: 'modificar_cotizacion', input: { agregar: items } });
const medidas = (r: Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['chat']>>) =>
  r.cotizacion.solicitudes.map((s) => [s.modelo, s.ancho]);

async function unaRanco(chat: Awaited<ReturnType<typeof setup>>['chat']) {
  const msg = '1 Ranco en pino oregón de 85x200';
  return (await chat(msg, agregar(item('RANCO', 'PINO OREGON', 0.85, 2, 1, msg)))).cotizacion;
}

describe('Líneas repetidas por chat', () => {
  it('cuatro Ranco 0,85 / 1,00 / 0,85 / 1,00 en un mensaje quedan en cuatro líneas, sin avisos de ruido', async () => {
    const { chat } = await setup();
    const msg = 'Cotiza 1 Ranco en pino oregón de 2 m de alto por línea: 0,85; 1,00; 0,85; 1,00';
    const r = await chat(
      msg,
      agregar(
        item('RANCO', 'PINO OREGON', 0.85, 2, 1, '0,85', { fabrica: null }),
        item('RANCO', 'PINO OREGON', 1, 2, 1, '1,00', { fabrica: null }),
        item('RANCO', 'PINO OREGON', 0.85, 2, 1, '0,85', { fabrica: null }),
        item('RANCO', 'PINO OREGON', 1, 2, 1, '1,00', { fabrica: null }),
      ),
    );
    expect(medidas(r)).toEqual([['RANCO', 0.85], ['RANCO', 1], ['RANCO', 0.85], ['RANCO', 1]]);
    expect(new Set(r.cotizacion.solicitudes.map((s) => s.id)).size).toBe(4);
    expect(r.avisos ?? []).not.toContainEqual(expect.stringMatching(/No quité|No dupliqué|ya está en la cotización/));
  });

  it('«agrega otra igual a la primera» agrega una segunda línea', async () => {
    const { chat } = await setup();
    const q = await unaRanco(chat);
    const msg = 'Agrega otra puerta igual a la primera';
    const r = await chat(msg, agregar(item('RANCO', 'PINO OREGON', 0.85, 2, 1, msg)), q);
    expect(medidas(r)).toEqual([['RANCO', 0.85], ['RANCO', 0.85]]);
  });

  it('«tres iguales, pero separadas» agrega tres líneas', async () => {
    const { chat } = await setup();
    const q = await unaRanco(chat);
    const msg = 'Agrega tres puertas iguales, pero separadas';
    const c = item('RANCO', 'PINO OREGON', 0.85, 2, 1, msg);
    const r = await chat(msg, agregar(c, c, c), q);
    expect(r.cotizacion.solicitudes).toHaveLength(4);
  });

  it('el reenvío de la IA de un ítem anterior se descarta en silencio, también con tilde y en centímetros', async () => {
    const msg = 'agrega también 2 Molco lenga 80x200';
    for (const reenvio of [
      item('RANCO', 'PINO OREGON', 0.85, 2, 1, '1 Ranco en pino oregón de 85x200'),
      item('Ranco', 'pino oregón', 85, 200, 1, '1 Ranco en pino oregón de 85x200'),
    ]) {
      const { chat } = await setup();
      const q = await unaRanco(chat);
      const r = await chat(msg, agregar(reenvio, item('MOLCO', 'LENGA', 0.8, 2, 2, '2 Molco lenga 80x200')), q);
      expect(medidas(r)).toEqual([['RANCO', 0.85], ['MOLCO', 0.8]]);
      expect(r.avisos ?? []).not.toContainEqual(expect.stringMatching(/ya está en la cotización/));
    }
  });

  it('BUG-008: la IA repite en el mismo turno un ítem dicho una sola vez; queda una línea', async () => {
    const { chat } = await setup();
    const msg = '2 molco en lenga de 80x200';
    const c = item('MOLCO', 'LENGA', 0.8, 2, 2, msg);
    const r = await chat(msg, agregar(c, c));
    expect(r.cotizacion.solicitudes).toHaveLength(1);
    expect(r.cotizacion.solicitudes[0].cantidad).toBe(2);
  });

  it('sin frase ni pedido de repetir, una línea igual a otra no se agrega y se explica cómo pedirla', async () => {
    const { chat } = await setup();
    const q = await unaRanco(chat);
    const r = await chat('ok', agregar(item('RANCO', 'PINO OREGON', 0.85, 2, 1, '')), q);
    expect(r.cotizacion.solicitudes).toHaveLength(1);
    expect(r.cotizacion.historial.at(-1)?.texto).toMatch(/ya está en la cotización.*agrega otra igual/);
  });

  it('«duplica la Ranco y que la copia sea vidriada» con duplicar: dos líneas, el original intacto', async () => {
    const { chat } = await setup();
    const q = await unaRanco(chat);
    const msg = 'Duplica esta Ranco y haz que la copia sea vidriada';
    const r = await chat(
      msg,
      { name: 'modificar_cotizacion', input: { duplicar: [{ indice: 0, cambios: { observaciones: 'vidriada', fuente: msg } }] } },
      q,
    );
    expect(medidas(r)).toEqual([['RANCO', 0.85], ['RANCO', 0.85]]);
    expect(r.cotizacion.solicitudes[0].observaciones ?? null).toBeNull();
    expect(r.cotizacion.solicitudes[1].observaciones).toBe('vidriada');
    expect(r.cotizacion.solicitudes[1].id).not.toBe(r.cotizacion.solicitudes[0].id);
  });

  it('duplicar con veces: tres copias de la primera, debajo de ella', async () => {
    const { chat } = await setup();
    const q0 = await unaRanco(chat);
    const q = (await chat('agrega 1 Molco lenga 80x200', agregar(item('MOLCO', 'LENGA', 0.8, 2, 1, '1 Molco lenga 80x200')), q0)).cotizacion;
    const msg = 'Agrega tres puertas iguales a la primera, pero separadas';
    const r = await chat(msg, { name: 'modificar_cotizacion', input: { duplicar: [{ indice: 0, veces: 3 }] } }, q);
    expect(r.cotizacion.solicitudes.map((s) => s.modelo)).toEqual(['RANCO', 'RANCO', 'RANCO', 'RANCO', 'MOLCO']);
  });

  it('una copia conserva el precio propio del original', async () => {
    const { chat } = await setup();
    const msg0 = '1 Ranco en pino oregón de 85x200 a $150.000 + IVA';
    const q = (await chat(msg0, agregar(item('RANCO', 'PINO OREGON', 0.85, 2, 1, msg0, { precio: { valor: 150_000, iva: 'neto' } })))).cotizacion;
    expect(q.solicitudes[0].precioUnitario).toBe(150_000);
    const r = await chat('agrega otra igual', { name: 'modificar_cotizacion', input: { duplicar: [{ indice: 0 }] } }, q);
    expect(r.cotizacion.solicitudes.map((s) => s.precioUnitario)).toEqual([150_000, 150_000]);
    expect(r.cotizacion.incompletos).toEqual([]);
  });

  it('«la puerta 2 igual a la Molco» edita la puerta 2 aunque nombre otro modelo (N-24)', async () => {
    const { chat } = await setup();
    const msg0 = '1 Ranco pino oregón 85x200 y 1 Ranco pino oregón 100x200 y 1 Molco lenga 80x200';
    const q = (
      await chat(
        msg0,
        agregar(
          item('RANCO', 'PINO OREGON', 0.85, 2, 1, '1 Ranco pino oregón 85x200'),
          item('RANCO', 'PINO OREGON', 1, 2, 1, '1 Ranco pino oregón 100x200'),
          item('MOLCO', 'LENGA', 0.8, 2, 1, '1 Molco lenga 80x200'),
        ),
      )
    ).cotizacion;
    const msg = 'Quiero la puerta 2 igual a la Molco';
    const r = await chat(
      msg,
      { name: 'modificar_cotizacion', input: { items: [{ indice: 1, cambios: { modelo: 'MOLCO', madera: 'LENGA', ancho: 0.8, fuente: msg } }] } },
      q,
    );
    expect(r.cotizacion.solicitudes.map((s) => s.modelo)).toEqual(['RANCO', 'MOLCO', 'MOLCO']);
  });

  it('un turno con una parte dudosa aplica el resto y explica lo omitido (N-22)', async () => {
    const { chat } = await setup();
    const q = await unaRanco(chat);
    const msg = 'agrega 1 Molco lenga 80x200 y quita la puerta 3';
    const r = await chat(
      msg,
      { name: 'modificar_cotizacion', input: { agregar: [item('MOLCO', 'LENGA', 0.8, 2, 1, '1 Molco lenga 80x200')], quitar: [0] } },
      q,
    );
    expect(r.cotizacion.solicitudes.map((s) => s.modelo)).toEqual(['RANCO', 'MOLCO']);
    expect(r.avisos).toContainEqual(expect.stringMatching(/No quité el ítem 1/));
  });

  it('«una por línea» separa en líneas de 1 lo que la IA agrupó (salida real de Haiku, 2+2)', async () => {
    const { chat } = await setup();
    const msg = '4 Ranco pino oregón de 2,20 de alto, una por línea: 0,85; 1,00; 0,85; 1,00';
    const r = await chat(
      msg,
      agregar(
        item('RANCO', 'PINO OREGON', 0.85, 2.2, 2, '4 Ranco pino oregón de 2,20 de alto, una por línea: 0,85'),
        item('RANCO', 'PINO OREGON', 1, 2.2, 2, '4 Ranco pino oregón de 2,20 de alto, una por línea: 1,00'),
      ),
    );
    expect(r.cotizacion.solicitudes.map((s) => [s.ancho, s.cantidad])).toEqual([
      [0.85, 1],
      [0.85, 1],
      [1, 1],
      [1, 1],
    ]);
    expect(r.cotizacion.historial.at(-1)?.texto ?? '').not.toMatch(/quedó pendiente|No pude verificar/);
  });

  it('«agrega 1 igual pero de 1,00» copia con cantidad 1 aunque el original tenga 2 (salida real de Haiku)', async () => {
    const { chat } = await setup();
    const msg = '2 Ranco en pino oregón de 85x200';
    const q = (await chat(msg, agregar(item('RANCO', 'PINO OREGON', 0.85, 2, 2, msg)))).cotizacion;
    const r = await chat(
      'agrega 1 igual pero de 1,00',
      { name: 'modificar_cotizacion', input: { duplicar: [{ indice: 0, veces: 1, cambios: { ancho: 1, fuente: 'agrega 1 igual pero de 1,00' } }] } },
      q,
    );
    expect(r.cotizacion.solicitudes.map((s) => [s.ancho, s.cantidad])).toEqual([
      [0.85, 2],
      [1, 1],
    ]);
  });

  it('el nivel de razonamiento elegido junto al chat llega a la IA', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'neltume-razonamiento-'));
    dirs.push(dir);
    const llm = { interpretar: vi.fn(), verificarCifras: true, anclaje: 'avisar' as const };
    const servicio = new Servicio(catalogo, llm as never, new Almacen(dir));
    const msg = '1 Ranco en pino oregón de 85x200';
    llm.interpretar.mockResolvedValueOnce(agregar(item('RANCO', 'PINO OREGON', 0.85, 2, 1, msg)));
    await servicio.ejecutar({ tipo: 'chat', mensaje: msg, razonamiento: 'medium' });
    expect(llm.interpretar.mock.calls[0][1]).toMatchObject({ razonamiento: 'medium' });
  });
});


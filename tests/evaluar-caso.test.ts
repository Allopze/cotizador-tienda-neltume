import { describe, expect, it, vi } from 'vitest';
import { ErrorIA } from '../src/asistente/errores';
import type { CasoEvaluacion } from '../src/asistente/evaluacion';
import { CASOS_PRUEBA } from '../src/asistente/prueba-modelo';
import { CAMPOS_ITEM, casosSchema } from '../src/asistente/evaluacion';
import type { Catalogo } from '../src/catalogo/tipos';
import { correrCaso } from '../src/servidor/evaluar-caso';

vi.mock('../src/servidor/pdf', () => ({
  prepararPdf: vi.fn(async () => {}),
  generarPdf: vi.fn(async () => {}),
  plantilla: vi.fn(async () => '<html/>'),
}));

const catalogo: Catalogo = {
  fuente: 'test',
  sha256: 'test',
  fecha: '2026-01-01',
  productos: [
    {
      codigo: 'MOL-M-1',
      modelo: 'MOLCO',
      familia: 'PUERTA',
      tipo: 'PUERTA PANEL',
      madera: 'MARA',
      medida: '0,80 A 0,85',
      anchoMin: 0.8,
      anchoMax: 0.85,
      largo: 2,
      precioNeto: 100_000,
      descripcion: 'MOLCO',
      filaOrigen: 1,
    },
  ],
};
const caso: CasoEvaluacion = {
  id: 'molco',
  descripcion: 'Una Molco',
  mensajes: ['una Molco en mara de 80 x 200'],
  esperado: { items: [{ modelo: 'MOLCO', madera: 'MARA', ancho: 0.8, alto: 2, medida: null, cantidad: 1 }] },
};
const salida = {
  name: 'modificar_cotizacion',
  input: {
    agregar: [
      {
        modelo: 'MOLCO',
        madera: 'MARA',
        ancho: 0.8,
        alto: 2,
        medida: null,
        cantidad: 1,
        tipoMedida: null,
        fuente: 'una Molco en mara de 80 x 200',
      },
    ],
  },
};

describe('correr un caso de evaluación', () => {
  it('puntúa el pedido que queda con el mismo servicio de la aplicación', async () => {
    const r = await correrCaso(
      caso,
      { interpretar: vi.fn().mockResolvedValue(salida), verificarCifras: true },
      catalogo,
    );
    expect(r).toMatchObject({ aciertos: CAMPOS_ITEM.length, total: CAMPOS_ITEM.length, diferencias: [] });
    expect(r.error).toBeUndefined();
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });
  it('informa el error de la IA con su código', async () => {
    const llm = {
      interpretar: vi.fn().mockRejectedValue(new ErrorIA('ia_configuracion', 'Rechazado.')),
      verificarCifras: true,
    };
    const r = await correrCaso(caso, llm, catalogo);
    expect(r).toMatchObject({ aciertos: 0, error: { codigo: 'ia_configuracion', mensaje: 'Rechazado.' } });
  });
  it('una salida inválida no cotiza nada', async () => {
    const r = await correrCaso(
      caso,
      { interpretar: vi.fn().mockResolvedValue(null), verificarCifras: true },
      catalogo,
    );
    expect(r.aciertos).toBe(0);
    expect(r.diferencias.length).toBeGreaterThan(0);
  });
  it('los casos de «Probar modelo» son válidos', () => {
    expect(casosSchema.parse(CASOS_PRUEBA)).toHaveLength(5);
  });
  it('devuelve los avisos de la conversación con su origen', async () => {
    // El mensaje no dice el alto: la IA lo inventó y el anclaje de cifras lo anula.
    const mensaje = 'una Molco en mara de 80';
    const inventado = {
      name: 'modificar_cotizacion',
      input: { agregar: [{ ...salida.input.agregar[0], alto: 2.1, fuente: mensaje }] },
    };
    const r = await correrCaso(
      { ...caso, mensajes: [mensaje] },
      { interpretar: vi.fn().mockResolvedValue(inventado), verificarCifras: true },
      catalogo,
    );
    expect(r.avisos).toEqual([{ categoria: 'cifras', texto: expect.stringMatching(/alto o largo 2,1 m/) }]);
  });
  it('mientras no hay borrador, acumula los intercambios previos como hace la pantalla', async () => {
    const interpretar = vi
      .fn()
      .mockResolvedValueOnce({ name: 'responder', input: { texto: '¿Qué necesitas?' } })
      .mockResolvedValueOnce({ name: 'responder', input: { texto: '¿Qué modelo?' } })
      .mockResolvedValueOnce(salida);
    await correrCaso(
      { ...caso, mensajes: ['hola', 'necesito una puerta', 'una Molco en mara de 80 x 200'] },
      { interpretar, verificarCifras: true },
      catalogo,
    );
    expect(interpretar.mock.calls[2][0].historial.map((m: { texto: string }) => m.texto)).toEqual([
      'hola',
      '¿Qué necesitas?',
      'necesito una puerta',
      '¿Qué modelo?',
    ]);
  });
  it('puntúa el flete pedido y uno que nadie pidió', async () => {
    const mensaje = 'una Molco en mara de 80 x 200 y flete a Temuco $50.000 + iva';
    const conFlete = {
      name: 'modificar_cotizacion',
      input: {
        ...salida.input,
        flete: { descripcion: 'Flete a Temuco', cantidad: 1, valor: 50000, iva: 'neto' },
      },
    };
    const llm = () => ({ interpretar: vi.fn().mockResolvedValue(conFlete), verificarCifras: true });
    const pedido = await correrCaso(
      {
        ...caso,
        mensajes: [mensaje],
        esperado: { ...caso.esperado, flete: { unitario: 50000, cantidad: 1 } },
      },
      llm(),
      catalogo,
    );
    expect(pedido).toMatchObject({ diferencias: [], total: CAMPOS_ITEM.length + 2 });
    const sinPedir = await correrCaso({ ...caso, mensajes: [mensaje] }, llm(), catalogo);
    expect(sinPedir.diferencias).toEqual([
      { item: null, campo: 'flete', esperado: '(sin flete)', obtenido: { unitario: 50000, cantidad: 1 } },
    ]);
  });
});

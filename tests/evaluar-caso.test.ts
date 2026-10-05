import { describe, expect, it, vi } from 'vitest';
import { ErrorIA } from '../src/asistente/errores';
import type { CasoEvaluacion } from '../src/asistente/evaluacion';
import { CASOS_PRUEBA } from '../src/asistente/prueba-modelo';
import { casosSchema } from '../src/asistente/evaluacion';
import type { Catalogo } from '../src/catalogo/tipos';
import { correrCaso } from '../src/servidor/evaluar-caso';

vi.mock('../src/servidor/pdf', () => ({
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
    expect(r).toMatchObject({ aciertos: 7, total: 7, diferencias: [] });
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
});

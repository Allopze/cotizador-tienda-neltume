import { describe, expect, it } from 'vitest';
import { resumenCambios } from '../src/app/formato';
import type { CambiosCotizacion } from '../src/app/contrato';

const sinCambios: CambiosCotizacion = { agregados: [], quitados: [], modificados: [], cliente: [] };

describe('resumen de cambios del chat', () => {
  it('se lee como frase y no repite dos descripciones casi iguales', () => {
    const texto = resumenCambios({
      ...sinCambios,
      agregados: [{ descripcion: 'MARCO PINO OREGON 2X4 PULG KIT' }],
      modificados: [
        {
          antes: { descripcion: 'MARCO PINO OREGON (sin cantidad)' },
          despues: { descripcion: 'MARCO PINO OREGON 2X4 (sin cantidad)' },
        },
      ],
      cliente: ['nombre', 'comuna'],
    } as CambiosCotizacion);
    expect(texto).toBe(
      'Se agregó Marco Pino Oregón 2X4 Pulg Kit · Se actualizó Marco Pino Oregón 2X4 (sin cantidad) · ' +
        'Se actualizó el cliente (nombre y comuna)',
    );
    expect(texto).not.toContain('→');
  });

  it('sin cambios no hay texto', () => {
    expect(resumenCambios(undefined)).toBe('');
    expect(resumenCambios(sinCambios)).toBe('');
  });
});

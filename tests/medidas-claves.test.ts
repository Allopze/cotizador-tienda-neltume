import { describe, expect, it } from 'vitest';
import { claveMedida, fusionarItems } from '../src/negocio/items';
import { casosSchema, puntuar } from '../src/asistente/evaluacion';
import { clienteVacio, type SolicitudItem } from '../src/catalogo/tipos';

// El largo de un accesorio llega a 6 m: «3,6» y «360» son la misma medida al comparar ítems y al evaluar la IA.
const item = (s: Partial<SolicitudItem> = {}): SolicitudItem => ({
  modelo: 'GUARDAPOLVO',
  madera: 'PINO OREGON',
  ancho: null,
  alto: 3.6,
  medida: '1X4',
  cantidad: 2,
  ...s,
});

describe('medidas de accesorios al comparar', () => {
  it('claveMedida lee el largo con el rango de la familia', () => {
    expect(claveMedida(3.6, 'MOLDURA')).toBe('3.6000');
    expect(claveMedida(360, 'MOLDURA')).toBe('3.6000');
    expect(claveMedida(360)).toBe('0.3600');
    expect(claveMedida(3.6)).toBe('?3.6');
  });

  it('un accesorio de «360» se empareja con el de 3,6 m aunque la lista cambie de orden, y conserva lo editado', () => {
    const largo = item({ precioUnitario: 12_000, observaciones: 'pintado' });
    const corto = item({ alto: 2.4, precioUnitario: 9_000 });
    const identidad = (s: SolicitudItem) => ({
      modelo: s.modelo ?? '',
      madera: s.madera ?? '',
      medida: s.medida ?? '',
    });
    const { items } = fusionarItems(
      [largo, corto],
      [item({ alto: 2.4 }), item({ alto: 360 })],
      identidad as never,
    );
    expect(items.map((i) => i.precioUnitario)).toEqual([9_000, 12_000]);
    expect(items[1].observaciones).toBe('pintado');
  });

  it('la evaluación da por iguales 3,6 y 360 en el largo de un accesorio', () => {
    const [caso] = casosSchema.parse([
      {
        id: 'guardapolvo',
        descripcion: 'largo de 3,6 m',
        mensajes: ['2 guardapolvos oregón 1x4 de 3,6 m'],
        esperado: {
          items: [
            {
              modelo: 'GUARDAPOLVO',
              madera: 'PINO OREGON',
              ancho: null,
              alto: 3.6,
              medida: '1X4',
              cantidad: 2,
            },
          ],
        },
      },
    ]);
    const r = puntuar(caso, { items: [item({ alto: 360 })], cliente: clienteVacio() });
    expect(r.diferencias).toEqual([]);
  });
});

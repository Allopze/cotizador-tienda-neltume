import { describe, expect, it } from 'vitest';
import { hablaDeDinero } from '../src/asistente/montos';

// Auditoría 2026-11 (N-04): el filtro de respuestas del asistente bloqueaba cualquier número.
describe('hablaDeDinero', () => {
  it.each([
    'Cuesta $ 120.000',
    'Sale 450 mil más IVA',
    'Son 35 lucas',
    'Queda en 1,2 millones',
    'El valor es 85.000 pesos',
    'Te lo dejo en cien mil',
    'El total es 250.000',
    'Precio: 189990',
  ])('«%s» habla de dinero', (texto) => expect(hablaDeDinero(texto)).toBe(true));

  it.each([
    '¿Te refieres a la de 0,80 × 2,00?',
    'Tienes 2 Molco y 3 Coz Coz en la cotización.',
    '¿Qué medida necesitas: 0,85 o 1,00 de ancho?',
    'La puerta mide 800 x 2.100 mm.',
    'Hay medidas desde 2.000 mm de alto.',
    'Revisé la cotización N° 1234.',
    '¿En qué familia va? Las puertas de 1,10 m o más se cotizan como puerta ancha.',
    '¿Cuál es el total de puertas?',
  ])('«%s» no habla de dinero', (texto) => expect(hablaDeDinero(texto)).toBe(false));
});

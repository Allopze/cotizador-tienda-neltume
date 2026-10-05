import type { CasoEvaluacion } from './evaluacion';

/**
 * Casos con que «Probar modelo» (Ajustes → Asistente) revisa un modelo antes de guardarlo: varios ítems en un
 * mensaje, la sección de un marco, no inventar la madera, milímetros y una edición. Van en el código y no en
 * evals/, que no se copia a la imagen del servidor.
 */
export const CASOS_PRUEBA: CasoEvaluacion[] = [
  {
    id: 'varios-items',
    descripcion: 'Varios ítems en un mensaje',
    mensajes: ['3 Lanco oregón 80x210, 2 Lanco oregón 70x210 y 5 marcos 2x4 oregón de 2,10'],
    esperado: {
      items: [
        { modelo: 'LANCO', madera: 'PINO OREGON', ancho: 0.8, alto: 2.1, medida: null, cantidad: 3 },
        { modelo: 'LANCO', madera: 'PINO OREGON', ancho: 0.7, alto: 2.1, medida: null, cantidad: 2 },
        { modelo: 'MARCO', madera: 'PINO OREGON', ancho: null, alto: 2.1, medida: '2X4', cantidad: 5 },
      ],
    },
  },
  {
    id: 'marcos-de-4',
    descripcion: '«de 4» en marcos es la sección 2x4',
    mensajes: ['6 marcos de 4 en raulí de 2,2'],
    esperado: {
      items: [{ modelo: 'MARCO', madera: 'RAULI', ancho: null, alto: 2.2, medida: '2X4', cantidad: 6 }],
    },
  },
  {
    id: 'sin-madera',
    descripcion: 'Sin madera: no se inventa',
    mensajes: ['4 coscos de 80 por 200'],
    esperado: {
      items: [{ modelo: 'COZ COZ', madera: null, ancho: 0.8, alto: 2, medida: null, cantidad: 4 }],
    },
  },
  {
    id: 'milimetros',
    descripcion: 'Medidas en milímetros',
    mensajes: ['una Molco en mara de 800 x 2000 mm'],
    esperado: {
      items: [{ modelo: 'MOLCO', madera: 'MARA', ancho: 0.8, alto: 2, medida: null, cantidad: 1 }],
    },
  },
  {
    id: 'quita-marcos',
    descripcion: 'Quitar un ítem en un segundo mensaje',
    mensajes: ['2 Molco lenga 80x200 y 4 marcos 2x4 lenga de 2', 'saca los marcos'],
    esperado: {
      items: [{ modelo: 'MOLCO', madera: 'LENGA', ancho: 0.8, alto: 2, medida: null, cantidad: 2 }],
    },
  },
];

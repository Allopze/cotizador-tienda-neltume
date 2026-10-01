import type { Familia } from './tipos';

/** Familias del catálogo con su nombre visible: las claves internas («PIEZAS_T») no se muestran. */
export const FAMILIAS: [Familia, string][] = [
  ['PUERTA', 'Puerta'],
  ['MARCO', 'Marco'],
  ['PIEZAS_T', 'Piezas T'],
  ['MOLDURA', 'Moldura'],
];
export const etiquetaFamilia = (familia: string) => FAMILIAS.find(([f]) => f === familia)?.[1] ?? familia;

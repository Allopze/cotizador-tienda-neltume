import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Recursos de los PDF: fuentes y dibujos de los modelos (ver scripts/dibujos/generar.sh). */
export const RECURSOS = join(/* turbopackIgnore: true */ process.cwd(), 'src/servidor/pdf-recursos');
export interface Dibujo {
  archivo: string;
  /** Tamaño del PNG en píxeles. */
  px: [number, number];
  /** Dónde está la hoja dentro del dibujo, como fracción del ancho y del alto: sus cotas van en la nota. */
  hoja: { izq: number; der: number; arriba: number; abajo: number } | null;
}
let dibujos: Map<string, Dibujo> | null = null;
/** Dibujos por modelo del catálogo (normalizado). Sin el manifiesto, ninguno: las puertas usan el esquema genérico. */
export function dibujosModelos() {
  if (!dibujos) {
    dibujos = new Map();
    try {
      const manifiesto = JSON.parse(readFileSync(join(RECURSOS, 'dibujos', 'dibujos.json'), 'utf8')) as Record<string, Dibujo>;
      for (const [modelo, d] of Object.entries(manifiesto)) dibujos.set(normalizarModelo(modelo), d);
    } catch {
      // Sin dibujos el documento se imprime igual, con el esquema genérico de puerta.
    }
  }
  return dibujos;
}
export const normalizarModelo = (m: string) =>
  m
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

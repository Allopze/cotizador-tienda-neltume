import { cantidadFlete, unitarioFlete, type Cotizacion } from '../negocio/estado';
import { fleteValido, pesos } from '../negocio/precios';
import { cifrasDelTexto, sinTildes } from './anclaje';
import type { FleteChat } from './esquemas';

const MULTIPLICADORES: Record<string, number> = { mil: 1_000, luca: 1_000, lucas: 1_000, k: 1_000 };

/**
 * Montos en pesos escritos en el texto: «$380.000», «380000», «380 mil», «380 lucas», «380k» y
 * «1,2 millones». Con multiplicador solo cuenta el monto completo: «380 mil» no respalda $380.
 */
export function montosDelTexto(texto: string): number[] {
  const montos: number[] = [];
  const t = sinTildes(texto);
  for (const [, cifra, unidad] of t.matchAll(
    /(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*(millon(?:es)?|mil|lucas?|k)?(?![a-zñ])/g,
  )) {
    const base = /^\d{1,3}(\.\d{3})+$/.test(cifra)
      ? Number(cifra.replace(/\./g, ''))
      : Number(cifra.replace(',', '.'));
    if (!Number.isFinite(base)) continue;
    const factor = unidad ? (unidad.startsWith('millon') ? 1_000_000 : MULTIPLICADORES[unidad]) : 1;
    montos.push(Math.round(base * factor));
  }
  return montos;
}

export interface LineaFlete {
  flete: number;
  fleteCantidad: number;
  fleteDescripcion: string | null;
}

/**
 * Línea de flete que resulta de lo que pidió la IA, o null si no cambia. Con `textos` (modelo real) el valor
 * y la cantidad deben estar escritos ahí: una cifra que nadie escribió no se aplica y se avisa. El valor se
 * guarda neto: si la persona dijo «IVA incluido» se descuenta con `iva`.
 */
export function fleteDelChat(
  pedido: FleteChat | null | undefined,
  actual: Pick<Cotizacion, 'flete' | 'fleteCantidad' | 'fleteDescripcion'>,
  { textos, iva }: { textos: string[] | null; iva: number },
): { linea: LineaFlete | null; avisos: string[] } {
  if (pedido === undefined) return { linea: null, avisos: [] };
  if (pedido === null) return { linea: { flete: 0, fleteCantidad: 1, fleteDescripcion: null }, avisos: [] };
  const avisos: string[] = [];
  const existe = actual.flete > 0;
  let unitario: number;
  if (pedido.valor !== null) {
    const valor = pedido.valor;
    const escrito = !textos || textos.some((t) => montosDelTexto(t).includes(valor));
    if (!Number.isFinite(valor) || valor <= 0 || !escrito)
      return {
        linea: null,
        avisos: [
          `No apliqué el flete: su valor no aparece escrito en el mensaje. Escríbelo, por ejemplo «flete a Chillán $380.000 + IVA».`,
        ],
      };
    unitario = Math.round(pedido.iva === 'incluido' ? valor / (1 + iva) : valor);
    if (pedido.iva === null)
      avisos.push(
        `Tomé ${pesos(unitario)} como valor neto del flete (sin IVA). Si lo incluía, escribe «con IVA incluido».`,
      );
  } else if (existe) unitario = unitarioFlete(actual);
  else
    return {
      linea: null,
      avisos: ['Falta el valor del flete: escríbelo, por ejemplo «flete a Chillán $380.000 + IVA».'],
    };

  let fleteCantidad = existe ? cantidadFlete(actual) : 1;
  if (pedido.cantidad !== null) {
    const n = pedido.cantidad;
    const valida =
      Number.isInteger(n) &&
      n >= 1 &&
      n <= 10_000 &&
      (n === 1 || !textos || textos.some((t) => cifrasDelTexto(t).includes(n)));
    if (valida) fleteCantidad = n;
    else avisos.push(`No apliqué la cantidad ${n} del flete: no aparece escrita en el mensaje.`);
  }
  const flete = fleteCantidad * unitario;
  if (!fleteValido(flete))
    return {
      linea: null,
      avisos: [...avisos, 'El flete debe ser un monto neto entero en pesos, hasta $100.000.000.'],
    };
  const descripcion = pedido.descripcion?.replace(/\s+/g, ' ').trim().slice(0, 300) || null;
  return {
    linea: { flete, fleteCantidad, fleteDescripcion: descripcion ?? actual.fleteDescripcion ?? null },
    avisos,
  };
}

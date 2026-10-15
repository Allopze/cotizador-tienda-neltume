import type { Cotizacion } from './estado';

export type TipoMedida = 'hoja' | 'vano' | 'no_especificado' | null | undefined;
/** Puertas con una medida solicitada cuyo significado falta aclarar antes de emitir. */
export function indicesMedidaSinTipo(
  q: Pick<Cotizacion, 'solicitudes' | 'montos' | 'incompletos'>,
): number[] {
  const incompletos = new Set(q.incompletos.map((p) => p.indice));
  return q.montos.lineas.flatMap((linea) => {
    const indice = linea.indice;
    if (indice === null || incompletos.has(indice) || linea.producto.familia !== 'PUERTA')
      return [];
    if (q.solicitudes[indice]?.medidaPorDefecto) return [];
    if (linea.anchoSolicitado == null && linea.altoSolicitado == null) return [];
    const tipo = q.solicitudes[indice]?.tipoMedida ?? linea.tipoMedida;
    return tipo === 'hoja' || tipo === 'vano' ? [] : [indice];
  });
}

const milimetros = (metros: number) =>
  new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0, useGrouping: false }).format(Math.round(metros * 1000));

export const sufijoTipoMedida = (tipo: TipoMedida) =>
  tipo === 'hoja' ? ' (Hoja)' : tipo === 'vano' ? ' (Vano)' : '';

/** Dimensiones resueltas en metros, con el tipo solo cuando fue indicado explícitamente. */
export function dimensionesEnMilimetros(ancho: number | null, alto: number | null, tipo?: TipoMedida) {
  if (ancho === null && alto === null) return null;
  const medidas =
    ancho !== null && alto !== null
      ? `${milimetros(ancho)} × ${milimetros(alto)} mm`
      : `${milimetros(ancho ?? alto!)} mm`;
  return `${medidas}${sufijoTipoMedida(tipo)}`;
}

/**
 * Cuánto sobre el inicio del tramo cobrado puede quedar un vano antes de avisar: 5 cm, lo que suele separar el
 * vano (el hueco del muro) de la hoja que se fabrica para él. Ver docs/reglas-negocio.md.
 */
const MARGEN_VANO = 0.05;
const metrosAviso = (n: number) =>
  n.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const tramoAviso = ({ min, max }: { min: number; max: number }) =>
  Math.abs(max - min) < 1e-9 ? `${metrosAviso(min)} m` : `${metrosAviso(min)}–${metrosAviso(max)} m`;

/**
 * Aviso, sin bloquear, para una puerta pedida por vano cuyo ancho queda a menos de `MARGEN_VANO` sobre el inicio del
 * tramo con que se cobra (o bajo él, si se cobra con la siguiente medida): la hoja real, más angosta que el vano,
 * probablemente cae en el tramo anterior. Sin tramo anterior (`anterior` null) no hay nada que avisar. No convierte
 * el vano en hoja: el precio sigue siendo el del ancho pedido.
 */
export function avisoVano(
  linea: {
    indice: number | null;
    producto: { modelo: string; familia: string; anchoMin: number | null; anchoMax: number | null };
    anchoSolicitado: number | null;
    tipoMedida?: TipoMedida;
  },
  anterior: { min: number; max: number } | null,
  /** Ítems (índices desde 0) con esa misma línea; por omisión, el de `linea`. */
  indices: number[] = linea.indice === null ? [] : [linea.indice],
): string | null {
  const { producto, anchoSolicitado: ancho } = linea;
  if (linea.tipoMedida !== 'vano' || producto.familia !== 'PUERTA' || ancho === null || !anterior) return null;
  if (producto.anchoMin === null || producto.anchoMax === null) return null;
  if (ancho >= producto.anchoMin + MARGEN_VANO - 1e-9) return null;
  const numeros = indices.map((i) => String(i + 1));
  const item = !numeros.length
    ? producto.modelo
    : numeros.length === 1
      ? `el ítem ${numeros[0]} (${producto.modelo})`
      : `los ítems ${numeros.slice(0, -1).join(', ')} y ${numeros.at(-1)} (${producto.modelo})`;
  return `Revisa ${item}: el vano de ${metrosAviso(ancho)} m se cobra en el tramo ${tramoAviso({ min: producto.anchoMin, max: producto.anchoMax })} y queda a menos de ${Math.round(MARGEN_VANO * 100)} cm de su inicio. La hoja es más angosta que el vano: si la medida es del hueco, la puerta podría ser del tramo ${tramoAviso(anterior)}.`;
}

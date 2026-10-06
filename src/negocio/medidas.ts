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

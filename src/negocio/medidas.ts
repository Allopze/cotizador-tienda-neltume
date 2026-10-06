export type TipoMedida = 'hoja' | 'vano' | 'no_especificado' | null | undefined;

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

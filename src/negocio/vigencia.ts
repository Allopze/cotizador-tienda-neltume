import { REGLAS } from './precios';
import { esFeriado } from './feriados';
// Fechas de calendario en la zona de Chile. Días hábiles: lunes a viernes que no sean feriado nacional.
const ZONA = 'America/Santiago';

// Formateadores creados una sola vez: cada `new Intl.DateTimeFormat` con zona horaria reserva memoria nativa de ICU
// que solo se libera con el recolector. Creados por llamada (varias por fila del historial), bajo carga el RSS del
// servidor pasaba de 1 GB.
const FORMATO_FECHA = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const FORMATO_HORA = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** Fecha local (YYYY-MM-DD) de un instante ISO en Santiago. */
export const fechaLocal = (iso: string | Date) => FORMATO_FECHA.format(new Date(iso));

const FORMATO_FECHA_HORA = new Intl.DateTimeFormat('es-CL', {
  timeZone: ZONA,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** «25-10-2026 14:30» (dd-mm-aaaa hh:mm): fecha y hora de un instante en Santiago, igual en las dos aplicaciones. */
export function fechaHoraChile(instante: string | Date) {
  const fecha = new Date(instante);
  if (Number.isNaN(fecha.getTime())) return String(instante);
  const partes = Object.fromEntries(FORMATO_FECHA_HORA.formatToParts(fecha).map(({ type, value }) => [type, value]));
  return `${partes.day}-${partes.month}-${partes.year} ${partes.hour}:${partes.minute}`;
}

export function sumarDiasHabiles(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00.000Z`);
  let restantes = dias;
  while (restantes > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dia = d.getUTCDay();
    if (dia !== 0 && dia !== 6 && !esFeriado(d.toISOString().slice(0, 10))) restantes--;
  }
  return d.toISOString().slice(0, 10);
}

/** Último día válido (inclusive) de una cotización emitida en `fechaEmision`. */
export const calcularVence = (fechaEmision: string, dias = REGLAS.vigenciaDiasHabiles) =>
  sumarDiasHabiles(fechaLocal(fechaEmision), dias);

export const estaVencida = (vence: string | null | undefined, ahora: Date = new Date()) =>
  !!vence && fechaLocal(ahora) > vence;

/** Instante UTC de la medianoche local de Santiago para una fecha YYYY-MM-DD. */
export function inicioDiaSantiago(fecha: string): string {
  const aprox = new Date(`${fecha}T00:00:00.000Z`);
  const partes = FORMATO_HORA.formatToParts(aprox);
  const v = (t: string) => Number(partes.find((p) => p.type === t)!.value);
  const local = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'));
  return new Date(aprox.getTime() - (local - aprox.getTime())).toISOString();
}

export const fechaChilena = (fecha: string) => {
  const [a, m, d] = fecha.slice(0, 10).split('-');
  return `${d}-${m}-${a}`;
};

import type { KeyboardEvent } from 'react';
import type { Cotizacion, ResumenCotizacion } from '@/negocio/estado';
import { pesos, porcentaje, porcentajeIva, type Linea } from '@/negocio/precios';
import { estaVencida } from '@/negocio/vigencia';
import type { CambiosCotizacion } from './contrato';

// Textos y formatos compartidos por todas las vistas: una sola forma de decir cada cosa.
export const SIN_NUMERO = 'Sin número';
export const SIN_CLIENTE = 'Cliente sin nombre';
export const VALIDEZ = 'Validez: 10 días hábiles';

const zona = { timeZone: 'America/Santiago' } as const;
// Una fecha sin hora (YYYY-MM-DD) se lee a mediodía: a medianoche UTC caería el día anterior en Chile.
const leer = (iso: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
/** "12 sept 2026": listas y opciones. */
export const fechaCorta = (iso: string) =>
  leer(iso)
    .toLocaleDateString('es-CL', { ...zona, day: 'numeric', month: 'short', year: 'numeric' })
    .replace(/\./g, '');
/** "12 de septiembre de 2026": panel de la cotización. */
export const fechaLarga = (iso: string) =>
  leer(iso).toLocaleDateString('es-CL', { ...zona, day: 'numeric', month: 'long', year: 'numeric' });
export const mesAnio = (iso: string) => {
  const s = leer(iso).toLocaleDateString('es-CL', { ...zona, month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
/** plural(1, 'ítem') → "1 ítem"; plural(2, 'registro') → "2 registros". */
export const plural = (n: number, singular: string, varios = `${singular}s`) =>
  `${n} ${n === 1 ? singular : varios}`;
export const numeroCotizacion = (numero: number | null | undefined) => (numero ? `N° ${numero}` : SIN_NUMERO);
export const iva = () => porcentajeIva().replace(/\s+%/, '%');

export const pct = (n: number) => porcentaje(n).replace(/\s+%/, '%');

/** Validez: usa la fecha de vencimiento cuando el servidor la informe. */
export function validez(q: Pick<Cotizacion, 'vence'> | null) {
  const vence = q?.vence;
  return vence ? `Válida hasta el ${fechaLarga(vence)}` : VALIDEZ;
}
/** Solo una emitida puede estar «vencida»: las demás ya no esperan aprobación. */
export const vencida = (q: Pick<Cotizacion, 'estado' | 'vence'> | null) =>
  q?.estado === 'emitida' && estaVencida(q.vence);

const MINUSCULAS = new Set(['de', 'del', 'en', 'con', 'y', 'la', 'el']);
const ACENTOS: [RegExp, string][] = [
  [/\bOregon\b/g, 'Oregón'],
  [/\bRauli\b/g, 'Raulí'],
];
/**
 * «HUILO HUILO PINO OREGON 0,80 A 0,85 MT X 2,1 MT» → «Huilo Huilo Pino Oregón 0,80 a 0,85 m × 2,1 m».
 * Solo para mostrar: el PDF y los códigos conservan el texto de la planilla. Lo que no viene en
 * mayúsculas (productos agregados a mano) se deja como está.
 */
export function nombreProducto(s: string): string {
  // Listas del historial («3 × HUILO…, MARCO… (sin cantidad)»): cada producto se decide por separado.
  if (s.includes(', ')) return s.split(', ').map(nombreProducto).join(', ');
  const base = s.replace(/\([^)]*\)/g, '');
  if (base !== base.toUpperCase()) return s;
  let previo = '';
  const texto = s
    .split(/(\s+)/)
    .map((t, i) => {
      if (!t.trim()) return t;
      const numeroAntes = /\d/.test(previo);
      const medidaAntes = numeroAntes || previo === 'MT' || previo === 'MTS';
      previo = t;
      if (/\d/.test(t) || !/\p{L}/u.test(t) || t !== t.toUpperCase()) return t;
      if (t === 'MT' || t === 'MTS') return 'm';
      if (t === 'X' && medidaAntes) return '×';
      if (t === 'A' && numeroAntes) return 'a';
      const bajo = t.toLocaleLowerCase('es-CL');
      if (i > 0 && MINUSCULAS.has(bajo)) return bajo;
      return bajo.charAt(0).toLocaleUpperCase('es-CL') + bajo.slice(1);
    })
    .join('');
  return ACENTOS.reduce((acc, [re, bien]) => acc.replace(re, bien), texto);
}
/** «Calafquén Pino Oregón 1,00 a 1,05 m × 2 m» → «Calafquén Pino Oregón»: la medida va en su columna. */
export const sinMedida = (s: string) => s.replace(/\s+\d[\s\S]*$/, '') || s;

export const ETIQUETA_CAMPO: Record<keyof Cotizacion['cliente'], string> = {
  nombre: 'Cliente',
  rut: 'RUT',
  giro: 'Giro',
  telefono: 'Teléfono',
  direccion: 'Dirección',
  comuna: 'Ciudad / comuna',
  proyecto: 'Proyecto',
};

/** «Pedido: 0,80 × 2,10 m» o «Escuadría 2X4 · 2,10 m». */
export function medidaPedida(l: Linea) {
  const m = (n: number) => n.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (l.medidaSolicitada)
    return `Escuadría ${l.medidaSolicitada}${l.altoSolicitado ? ` · ${m(l.altoSolicitado)} m` : ''}`;
  if (l.anchoSolicitado && l.altoSolicitado)
    return `Pedido: ${m(l.anchoSolicitado)} × ${m(l.altoSolicitado)} m`;
  if (l.altoSolicitado) return `Largo pedido: ${m(l.altoSolicitado)} m`;
  return null;
}

/** «Creada por Ana · Emitida por Luis»: quién hizo cada paso. */
export function autoria(
  q: Pick<ResumenCotizacion, 'creadaPor' | 'emitidaPor' | 'aprobadaPor' | 'anuladaPor'>,
) {
  return [
    q.creadaPor && `Creada por ${q.creadaPor}`,
    q.emitidaPor && `emitida por ${q.emitidaPor}`,
    q.aprobadaPor && `aprobada por ${q.aprobadaPor}`,
    q.anuladaPor && `anulada por ${q.anuladaPor}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Texto breve de lo que cambió: «Agregado: Marco · Cantidad: … → … · Datos del cliente: RUT». */
export function resumenCambios(c: CambiosCotizacion | undefined) {
  if (!c) return '';
  return [
    ...c.agregados.map((x) => `Agregado: ${nombreProducto(x.descripcion)}`),
    ...c.quitados.map((x) => `Quitado: ${nombreProducto(x.descripcion)}`),
    ...c.modificados.map((x) =>
      x.antes.descripcion === x.despues.descripcion
        ? `Modificado: ${nombreProducto(x.despues.descripcion)}`
        : `${nombreProducto(x.antes.descripcion)} → ${nombreProducto(x.despues.descripcion)}`,
    ),
    ...(c.cliente.length
      ? [`Datos del cliente: ${c.cliente.map((k) => ETIQUETA_CAMPO[k].toLowerCase()).join(', ')}`]
      : []),
  ].join(' · ');
}

/** Enter envía; Shift+Enter, composición IME o pantallas táctiles insertan salto de línea. */
export function enterEnvia(e: KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
  if (window.matchMedia?.('(pointer: coarse)').matches) return;
  e.preventDefault();
  e.currentTarget.form?.requestSubmit();
}

/** Resumen en texto plano para pegar en un correo o WhatsApp. */
export function resumenTexto(q: Cotizacion) {
  const c = q.cliente;
  const lineas = q.montos.lineas.map(
    (l) =>
      `• ${l.cantidad} × ${l.producto.descripcion} (${l.producto.codigo}): ${pesos(l.precioUnitario)} c/u = ${pesos(l.total)}`,
  );
  return [
    `Cotización ${numeroCotizacion(q.numero)}`,
    `Cliente: ${c.nombre || SIN_CLIENTE}`,
    ...[
      c.rut && `RUT: ${c.rut}`,
      c.giro && `Giro: ${c.giro}`,
      c.comuna && `Comuna: ${c.comuna}`,
      c.proyecto && `Proyecto: ${c.proyecto}`,
      c.telefono && `Teléfono: ${c.telefono}`,
    ].filter(Boolean),
    '',
    ...lineas,
    ...(q.incompletos.length
      ? [`(${plural(q.incompletos.length, 'ítem pendiente', 'ítems pendientes')} sin valorizar)`]
      : []),
    '',
    ...(q.montos.descuento || q.montos.flete
      ? [
          `Subtotal: ${pesos(q.montos.subtotal)}`,
          ...(q.montos.descuento
            ? [`Descuento ${pct(q.montos.descuentoPorcentaje)}: −${pesos(q.montos.descuento)}`]
            : []),
          ...(q.montos.flete ? [`Flete: ${pesos(q.montos.flete)}`] : []),
        ]
      : []),
    `Neto: ${pesos(q.montos.neto)}`,
    `IVA ${iva()}: ${pesos(q.montos.iva)}`,
    `Total: ${pesos(q.montos.total)}`,
    `Valores puestos en fábrica. ${validez(q)}.`,
  ].join('\n');
}

export async function copiarTexto(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Contexto no seguro o permiso denegado: respaldo con selección.
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/** Respeta "reducir movimiento" del sistema. */
export const comportamientoScroll = (): ScrollBehavior =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

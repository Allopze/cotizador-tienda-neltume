import type { KeyboardEvent } from 'react';
import { ajusteMedida, medidaReferencia, metrosTexto } from '@/catalogo/escalones';
import { etiquetaDescuento } from '@/negocio/descuento-cantidad';
import type { Cotizacion, ResumenCotizacion } from '@/negocio/estado';
import { cantidadFlete, descripcionFlete, unitarioFlete } from '@/negocio/estado';
import {
  ahorroLinea,
  conDescuentoItem,
  descripcionLinea,
  pesos,
  porcentaje,
  porcentajeIva,
  precioConDescuento,
  REGLAS,
  resumenDescuentosItems,
  textoDescuentoItem,
  type Linea,
} from '@/negocio/precios';
import { dimensionesEnMilimetros, sufijoTipoMedida } from '@/negocio/medidas';
import { errorMedida, rangoCampoMedida, textoRangoMedida, type CampoMedida } from '@/negocio/limites';

// Los textos de rango de las medidas viven con sus límites (`limites.ts`), para que el servidor diga lo mismo.
export { errorMedida, textoRangoMedida, type CampoMedida };
import { metros } from '@/catalogo/resolver';
import { estaVencida } from '@/negocio/vigencia';
import type { CambiosCotizacion } from './contrato';

// Textos y formatos compartidos por todas las vistas: una sola forma de decir cada cosa.
export const SIN_NUMERO = 'Sin número';
export const SIN_CLIENTE = 'Cliente sin nombre';

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
export const iva = (valor = REGLAS.iva) => porcentajeIva(valor).replace(/\s+%/, '%');

export const pct = (n: number) => porcentaje(n).replace(/\s+%/, '%');

/** Validez: usa la fecha de vencimiento cuando el servidor la informe. */
export function validez(q: Pick<Cotizacion, 'vence' | 'reglas'> | null) {
  const vence = q?.vence;
  return vence
    ? `Válida hasta el ${fechaLarga(vence)}`
    : `Validez: ${q?.reglas?.vigenciaDiasHabiles ?? REGLAS.vigenciaDiasHabiles} días hábiles`;
}
/** Solo una emitida puede estar «vencida»: las demás ya no esperan aprobación. */
export const vencida = (q: Pick<Cotizacion, 'estado' | 'vence'> | null) =>
  q?.estado === 'emitida' && estaVencida(q.vence);

/**
 * Estado de pago de una fila del listado: «Sin pagos», «Pago 50 %» o «Pagada». Un borrador o una cotización
 * anulada o reemplazada no tiene pagos que mostrar.
 */
export function estadoPago(q: Pick<ResumenCotizacion, 'estado' | 'pagado' | 'total' | 'porcentajePagado'>) {
  if (q.estado !== 'emitida' && q.estado !== 'aprobada') return null;
  const pagado = q.pagado ?? 0;
  if (pagado <= 0) return 'Sin pagos';
  if (q.total > 0 && pagado >= q.total) return 'Pagada';
  return `Pago ${Math.min(99, Math.max(1, Math.round(q.porcentajePagado ?? 0)))} %`;
}

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

const largoTexto = (n: number) => `${n.toLocaleString('es-CL', { maximumFractionDigits: 2 })} m`;
/** Medida de un producto del catálogo: rango de ancho × alto en puertas, escuadría × largo en el resto. */
export function medidaProducto(p: {
  familia: string;
  medida: string;
  largo: number;
  anchoMin?: number | null;
  anchoMax?: number | null;
  altoMin?: number | null;
  altoMax?: number | null;
}) {
  if (p.familia !== 'PUERTA') return `${p.medida} × ${largoTexto(p.largo)}`;
  const ancho =
    p.anchoMin != null && p.anchoMax != null
      ? `${largoTexto(p.anchoMin)}–${largoTexto(p.anchoMax)}`
      : p.medida.replace(' A ', '–');
  const alto =
    p.altoMin != null && p.altoMax != null && p.altoMin !== p.altoMax
      ? `${largoTexto(p.altoMin)}–${largoTexto(p.altoMax)}`
      : largoTexto(p.largo);
  return `${ancho} × ${alto}`;
}

/** Número para un campo editable, con coma decimal y sin separador de miles: 0.8 → «0,8». */
export const decimalCampo = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 4, useGrouping: false });
const DIVISOR_UNIDAD: Record<string, number> = {
  m: 1, mt: 1, mts: 1, metro: 1, metros: 1,
  cm: 100, cms: 100, centimetro: 100, centimetros: 100,
  mm: 1000, milimetro: 1000, milimetros: 1000,
};
/**
 * Lee una medida tal como se escribe, con coma o punto decimal y unidad opcional: «80», «0,80», «0.80», «80 cm»,
 * «2100 mm», «2.100 mm» o «3,6 m». Sin unidad, como en el chat (`metros`): hasta 10 son metros y lo demás
 * centímetros o milímetros según el tope de la familia. Devuelve metros; null si está vacía, no se entiende o queda
 * fuera del rango (`rangoCampoMedida`). El ancho se lee siempre con el rango de puertas.
 */
export function leerMedida(texto: string, familia: string, campo: CampoMedida = 'alto'): number | null {
  const limpio = texto.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const partes = limpio.match(/^(\d+(?:[.,]\d+)*)\s*([a-z]+)?\.?$/);
  if (!partes) return null;
  const [, cifra, unidad] = partes;
  const divisor = unidad ? DIVISOR_UNIDAD[unidad] : 1;
  if (!divisor) return null;
  // «2.100 mm»: en centímetros y milímetros el punto con tres cifras detrás separa miles.
  const miles = divisor > 1 && /^\d{1,3}(\.\d{3})+$/.test(cifra);
  const numero = miles ? cifra.replace(/\./g, '') : cifra.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(numero)) return null;
  const n = Number(numero);
  const rango = rangoCampoMedida(campo, familia);
  const valor = unidad ? n / divisor : metros(n, campo === 'ancho' ? 'PUERTA' : familia);
  if (valor === null || !Number.isFinite(valor)) return null;
  const redondeado = Math.round(valor * 10_000) / 10_000;
  return redondeado >= rango.min - 1e-9 && redondeado <= rango.max + 1e-9 ? redondeado : null;
}
export const ETIQUETA_CAMPO: Record<keyof Cotizacion['cliente'], string> = {
  nombre: 'Cliente',
  rut: 'RUT',
  giro: 'Giro',
  telefono: 'Teléfono',
  direccion: 'Dirección',
  comuna: 'Ciudad / comuna',
  proyecto: 'Proyecto',
};

/** Medida exacta pedida, con (Hoja) o (Vano) solo cuando ese dato se indicó. */
export function medidaPedida(l: Linea) {
  if (l.medidaSolicitada)
    return `Escuadría ${l.medidaSolicitada}${l.altoSolicitado ? ` · ${metrosTexto(l.altoSolicitado)} m` : ''}${sufijoTipoMedida(l.tipoMedida)}`;
  return dimensionesEnMilimetros(l.anchoSolicitado, l.altoSolicitado, l.tipoMedida);
}

/**
 * Referencia de catálogo seleccionada por el resolvedor, para que la cotización sea verificable. Si la
 * medida pedida cae entre dos escalones, lo dice: se cotiza la siguiente medida del catálogo.
 */
export function referenciaCatalogo(l: Linea) {
  const siguiente = [
    l.anchoSolicitado !== null && ajusteMedida(l.anchoSolicitado, l.producto, 'ancho') === 'siguiente' && 'ancho',
    l.altoSolicitado !== null &&
      ajusteMedida(l.altoSolicitado, l.producto, 'alto') === 'siguiente' &&
      (l.producto.familia === 'PUERTA' ? 'alto' : 'largo'),
  ].filter(Boolean);
  return `Referencia ${l.producto.codigo} · ${medidaReferencia(l.producto)}${siguiente.length ? ` · siguiente medida del catálogo en ${siguiente.join(' y ')}` : ''}`;
}

/** «Creada por Ana · emitida por Luis»; si la misma persona hizo varios pasos seguidos, «Creada y emitida por Ana». */
export function autoria(
  q: Pick<ResumenCotizacion, 'creadaPor' | 'emitidaPor' | 'aprobadaPor' | 'anuladaPor'>,
) {
  const pasos: [string, string | null | undefined][] = [
    ['creada', q.creadaPor],
    ['emitida', q.emitidaPor],
    ['aprobada', q.aprobadaPor],
    ['anulada', q.anuladaPor],
  ];
  const grupos: { quien: string; pasos: string[] }[] = [];
  for (const [paso, quien] of pasos) {
    if (!quien) continue;
    const ultimo = grupos.at(-1);
    if (ultimo?.quien === quien) ultimo.pasos.push(paso);
    else grupos.push({ quien, pasos: [paso] });
  }
  const texto = grupos
    .map(
      (g) =>
        `${g.pasos.slice(0, -1).join(', ')}${g.pasos.length > 1 ? ' y ' : ''}${g.pasos.at(-1)} por ${g.quien}`,
    )
    .join(' · ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Nombre de cada dato del cliente dentro de una frase («se actualizó el nombre y la comuna»). */
const DATO_CLIENTE: Record<keyof Cotizacion['cliente'], string> = {
  nombre: 'nombre',
  rut: 'RUT',
  giro: 'giro',
  telefono: 'teléfono',
  direccion: 'dirección',
  comuna: 'comuna',
  proyecto: 'proyecto',
};

/** «a», «a y b», «a, b y c». */
const enumerar = (partes: string[]) =>
  partes.length < 2 ? (partes[0] ?? '') : `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`;

/**
 * Texto breve de lo que cambió, como frase: «Se agregó Marco Pino Oregón · Se actualizó el cliente (RUT)».
 * Un producto que cambió muestra cómo quedó: «antes → después» repetía dos descripciones casi iguales.
 */
export function resumenCambios(c: CambiosCotizacion | undefined) {
  if (!c) return '';
  return [
    ...c.agregados.map((x) => `Se agregó ${nombreProducto(x.descripcion)}`),
    ...c.quitados.map((x) => `Se quitó ${nombreProducto(x.descripcion)}`),
    ...c.modificados.map((x) => `Se actualizó ${nombreProducto(x.despues.descripcion)}`),
    ...(c.cliente.length ? [`Se actualizó el cliente (${enumerar(c.cliente.map((k) => DATO_CLIENTE[k]))})`] : []),
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
  const lineas = q.montos.lineas.map((l) =>
    conDescuentoItem(l) && l.descuentoItem
      ? `• ${l.cantidad} × ${nombreProducto(descripcionLinea(l))} (${l.producto.codigo}): ${pesos(l.precioUnitario)} c/u, descuento especial ${textoDescuentoItem(l.descuentoItem)} → ${pesos(precioConDescuento(l))} c/u = ${pesos(l.total)} (ahorro ${pesos(ahorroLinea(l))})`
      : `• ${l.cantidad} × ${nombreProducto(descripcionLinea(l))} (${l.producto.codigo}): ${pesos(l.precioUnitario)} c/u = ${pesos(l.total)}`,
  );
  const { ahorro, subtotalOriginal } = resumenDescuentosItems(q.montos);
  if (q.montos.flete)
    lineas.push(
      `• ${cantidadFlete(q)} × ${descripcionFlete(q)}: ${pesos(unitarioFlete(q))} c/u = ${pesos(q.montos.flete)}`,
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
    ...(ahorro
      ? [
          `Subtotal original: ${pesos(subtotalOriginal + q.montos.flete)}`,
          `Ahorro por descuentos especiales: −${pesos(ahorro)}`,
        ]
      : []),
    ...(q.montos.descuento || ahorro
      ? [`Subtotal: ${pesos(q.montos.subtotal + q.montos.flete)}`]
      : []),
    ...(q.montos.descuento
      ? [
          `${etiquetaDescuento(q)} ${pct(q.montos.descuentoPorcentaje)}${q.montos.flete ? ' sobre productos' : ''}: −${pesos(q.montos.descuento)}`,
        ]
      : []),
    `Neto: ${pesos(q.montos.neto)}`,
    `IVA ${iva(q.reglas?.iva)}: ${pesos(q.montos.iva)}`,
    `Total: ${pesos(q.montos.total)}`,
    `Valores puestos en fábrica. ${validez(q)}.`,
    ...(q.observaciones ? ['', `Observaciones: ${q.observaciones}`] : []),
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

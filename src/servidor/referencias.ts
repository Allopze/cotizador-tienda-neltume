import type { EstadoCotizacion } from '../negocio/estado';
import type { CandidataReferencia } from './almacen';

export interface OpcionCotizacion {
  id: string;
  actualizada: string;
  numero: number | null;
  estado: EstadoCotizacion;
  cliente: string;
  proyecto: string | null;
  comuna: string | null;
  fecha: string;
  detalle: string;
}

export type ResolucionReferencia =
  | { tipo: 'ninguna' }
  | { tipo: 'unica'; cotizacion: CandidataReferencia }
  | { tipo: 'multiples'; opciones: OpcionCotizacion[] };

const normalizar = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

function contieneFrase(texto: string, frase: string) {
  return frase.length >= 3 && ` ${texto} `.includes(` ${frase} `);
}

const sinTildes = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const DIRECCION =
  /\b(?:calle|pasaje|psje|pje|av|avda|avenida|direccion|despacho|domicilio|block|depto|departamento|villa|poblacion|parcela|km|casa|oficina|of|local)\b[^.;\n]{0,25}$/;
const EXPLICITOS = [
  // «cotización 450», «cotización N° 450», «cotización nro. 450», «cotización #450».
  /\bcotizacion(?:es)?\s*(?:(?:n\s*[°º.]?|nro\.?|num(?:ero)?\.?|#)\s*)?(\d{1,8})\b(?!\s*(?:puertas?|unidades?|marcos?|x|×))/g,
  // «nro de cotización 450», «número de la cotización 450», «N° cotización 450».
  /(?:\bn\s*[°º.]?|\bnro\.?|\bnumero|#)\s*(?:de\s+)?(?:la\s+)?cotizacion\s*(?:(?:n\s*[°º.]?|nro\.?|#)\s*)?(\d{1,8})\b/g,
];
// «la 450» solo cuenta fuera de una dirección («Pasaje la 450» no es una referencia).
const LA_NUMERO =
  /(?:^|[\s,;:¿¡(])la\s+(\d{3,8})\b(?!\s*(?:mm|cm|m|mts?|metros?|x|×|puertas?|unidades?|u)\b)/g;

/**
 * Número de cotización mencionado con palabras explícitas. Un «#450» o «N° 450» suelto se ignora:
 * suele ser parte de una dirección («Los Carrera #450», «Pasaje 3 N° 450»).
 */
export function numeroExplicito(texto: string): number | null {
  const t = sinTildes(texto);
  const valido = (n: string) => {
    const numero = Number(n);
    return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
  };
  for (const patron of EXPLICITOS)
    for (const m of t.matchAll(patron)) {
      const numero = valido(m[1]);
      if (numero !== null) return numero;
    }
  for (const m of t.matchAll(LA_NUMERO)) {
    if (DIRECCION.test(t.slice(0, m.index))) continue;
    const numero = valido(m[1]);
    if (numero !== null) return numero;
  }
  return null;
}

function puntaje(texto: string, q: CandidataReferencia) {
  let resultado = 0;
  const nombre = normalizar(q.cliente.nombre ?? '');
  if (nombre) {
    if (contieneFrase(texto, nombre)) resultado += 100 + nombre.length;
    else {
      const palabras = nombre.split(' ').filter((p) => p.length > 2);
      const encontradas = palabras.filter((p) => contieneFrase(texto, p)).length;
      if (encontradas) resultado += 25 * (encontradas / Math.max(1, palabras.length));
    }
  }
  const proyecto = normalizar(q.cliente.proyecto ?? '');
  if (contieneFrase(texto, proyecto)) resultado += 80 + proyecto.length;
  const comuna = normalizar(q.cliente.comuna ?? '');
  if (contieneFrase(texto, comuna)) resultado += 20 + comuna.length;
  return resultado;
}

function cantidadAnterior(texto: string): number | null {
  const normalizado = normalizar(texto);
  const coincidencia =
    normalizado.match(/\bno\s+(?:era\s+)?de\s+(\d{1,4})\b/) ??
    normalizado.match(/\bla\s+de\s+(\d{1,4})\b/) ??
    normalizado.match(/\b(?:la|cotizacion)\s+de\s+(\d{1,4})\s+puertas?\b/);
  if (!coincidencia) return null;
  const cantidad = Number(coincidencia[1]);
  return Number.isSafeInteger(cantidad) && cantidad > 0 ? cantidad : null;
}

function tieneReferencia(texto: string) {
  const normalizado = normalizar(texto);
  if (/\b(?:nueva|nuevo)\s+cotizacion\b/.test(normalizado)) return false;
  return (
    /\bcotizacion\s+(?:de|nro|numero|n|#)\b/.test(normalizado) ||
    /\b(?:la|esa|esta|anterior|pasada)\s+cotizacion\b/.test(normalizado) ||
    /\b(?:la|esa|esta)\s+de\b/.test(normalizado) ||
    /\b(?:la|esa|esta)\s+del\s+proyecto\b/.test(normalizado)
  );
}

function resumir(q: CandidataReferencia): OpcionCotizacion {
  return {
    id: q.id,
    actualizada: q.actualizada,
    numero: q.numero,
    estado: q.estado,
    cliente: q.cliente.nombre || 'Cliente sin nombre',
    proyecto: q.cliente.proyecto,
    comuna: q.cliente.comuna,
    fecha: q.nota?.fecha ?? q.fechaEmision ?? q.actualizada,
    detalle: q.solicitudes
      .map((item) => `${item.cantidad ?? '—'} × ${item.modelo ?? 'producto por definir'}`)
      .join(', '),
  };
}

/**
 * Resuelve a qué cotización se refiere el mensaje. `activaId` es la cotización de la conversación
 * abierta: si está entre las candidatas por nombre, proyecto o comuna, se prefiere sin preguntar.
 */
export function resolverReferencia(
  mensaje: string,
  cotizaciones: CandidataReferencia[],
  activaId?: string,
): ResolucionReferencia {
  const numero = numeroExplicito(mensaje);
  if (numero !== null) {
    const cotizacion = cotizaciones.find((q) => q.numero === numero);
    return cotizacion ? { tipo: 'unica', cotizacion } : { tipo: 'ninguna' };
  }
  if (!tieneReferencia(mensaje)) return { tipo: 'ninguna' };

  const texto = normalizar(mensaje);
  // Reemplazadas y anuladas no se modifican: solo se alcanzan por número explícito.
  const puntuadas = cotizaciones
    .filter((q) => q.estado !== 'reemplazada' && q.estado !== 'anulada')
    .map((cotizacion) => ({ cotizacion, puntaje: puntaje(texto, cotizacion) }))
    .filter((c) => c.puntaje > 0);
  if (!puntuadas.length) return { tipo: 'ninguna' };

  const maximo = Math.max(...puntuadas.map((c) => c.puntaje));
  let candidatas = puntuadas.filter((c) => c.puntaje === maximo).map((c) => c.cotizacion);
  const anterior = cantidadAnterior(mensaje);
  if (anterior !== null) {
    const conCantidad = candidatas.filter((q) => q.solicitudes.some((item) => item.cantidad === anterior));
    if (conCantidad.length) candidatas = conCantidad;
  }
  const activa = activaId ? candidatas.find((q) => q.id === activaId) : undefined;
  if (activa) return { tipo: 'unica', cotizacion: activa };
  candidatas.sort((a, b) => {
    const fecha = (b.fechaEmision ?? b.actualizada).localeCompare(a.fechaEmision ?? a.actualizada);
    return fecha || (b.numero ?? 0) - (a.numero ?? 0);
  });

  if (candidatas.length === 1) return { tipo: 'unica', cotizacion: candidatas[0] };
  return { tipo: 'multiples', opciones: candidatas.map(resumir) };
}

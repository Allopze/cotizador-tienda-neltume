import type { Cotizacion } from '../negocio/estado';

export interface OpcionCotizacion {
  id: string;
  actualizada: string;
  numero: number | null;
  estado: Cotizacion['estado'];
  cliente: string;
  proyecto: string | null;
  comuna: string | null;
  fecha: string;
  detalle: string;
}

export type ResolucionReferencia =
  | { tipo: 'ninguna' }
  | { tipo: 'unica'; cotizacion: Cotizacion }
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

function numeroExplicito(texto: string): number | null {
  const hash = texto.match(/#\s*(\d{1,8})\b/);
  if (hash) {
    const numero = Number(hash[1]);
    return numero > 0 ? numero : null;
  }
  const normalizado = normalizar(texto);
  const coincidencia = normalizado.match(
    /\b(?:cotizacion\s*(?:(?:nro|numero|n)\s*)?|nro\s*|n\s+|numero\s+(?:de\s+)?cotizacion\s*)(\d{1,8})\b/,
  );
  if (!coincidencia) return null;
  const numero = Number(coincidencia[1]);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

function puntaje(texto: string, q: Cotizacion) {
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

function resumir(q: Cotizacion): OpcionCotizacion {
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

export function resolverReferencia(mensaje: string, cotizaciones: Cotizacion[]): ResolucionReferencia {
  const numero = numeroExplicito(mensaje);
  if (numero !== null) {
    const cotizacion = cotizaciones.find((q) => q.numero === numero);
    return cotizacion ? { tipo: 'unica', cotizacion } : { tipo: 'ninguna' };
  }
  if (!tieneReferencia(mensaje)) return { tipo: 'ninguna' };

  const texto = normalizar(mensaje);
  const puntuadas = cotizaciones
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
  candidatas.sort((a, b) => {
    const fecha = (b.fechaEmision ?? b.actualizada).localeCompare(a.fechaEmision ?? a.actualizada);
    return fecha || (b.numero ?? 0) - (a.numero ?? 0);
  });

  if (candidatas.length === 1) return { tipo: 'unica', cotizacion: candidatas[0] };
  return { tipo: 'multiples', opciones: candidatas.map(resumir) };
}

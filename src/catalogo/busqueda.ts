/**
 * Búsqueda del catálogo con las mismas reglas que entiende el asistente (auditoría 2026-11, N-07): alias y plurales
 * de modelos y maderas («willow», «coscos», «molcos»), errores de una letra («ranko» → «¿Quisiste decir Ranco?»),
 * medidas dentro de un tramo («0,82», «85x210», «1 metro», «100»), el tipo de producto («puertas», «molduras») y
 * palabras vacías («de», «para»). Lo que no se interpreta se busca como texto, igual que antes (códigos, tipos).
 */
import type { Familia, Producto } from './tipos';
import {
  maderaDelCatalogo,
  metros,
  modeloDelCatalogo,
  modelosCatalogo,
  normalizar,
  normalizarMedida,
  type CatalogoConsultable,
} from './resolver';

export interface BusquedaInterpretada {
  /** Modelo canónico reconocido; null si la búsqueda no nombra uno. */
  modelo: string | null;
  madera: string | null;
  familia: Familia | null;
  /** Medidas en metros. */
  ancho: number | null;
  alto: number | null;
  /** Sección de un accesorio, en forma canónica («2X4»). */
  seccion: string | null;
  /** Palabras que quedaron sin interpretar: se buscan como texto. */
  libres: string[];
  /** Modelo parecido a una palabra que no se reconoció («ranko» → «RANCO»). */
  sugerencia: string | null;
}

const VACIAS = new Set([
  'de', 'del', 'la', 'el', 'las', 'los', 'un', 'una', 'en', 'para', 'con', 'por', 'y', 'o', 'a', 'al', 'que',
  'metro', 'metros', 'mt', 'mts', 'm', 'cm', 'mm', 'ancho', 'alto', 'medida', 'medidas', 'tipo',
]);
const FAMILIAS: Record<string, Familia> = {
  puerta: 'PUERTA',
  puertas: 'PUERTA',
  moldura: 'MOLDURA',
  molduras: 'MOLDURA',
  marco: 'MARCO',
  marcos: 'MARCO',
};

const texto = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
const numero = (s: string) => Number(s.replace(',', '.'));

/**
 * Medidas escritas en la búsqueda. Dos cifras unidas por «x» son ancho y alto (o una sección si ambas son enteros
 * chicos: «2x4»); «1 metro» y «100 cm» son una medida; una cifra suelta con decimales o entre 30 y 400 también.
 */
function extraerMedidas(t: string) {
  let resto = t;
  let ancho: number | null = null,
    alto: number | null = null,
    seccion: string | null = null;
  const par = /(\d+(?:[.,]\d+)?)\s*(?:cm|mm|m)?\s*(?:x|×|\*|por)\s*(\d+(?:[.,]\d+)?)\s*(cm|mm|m)?(?![a-z])/;
  const p = resto.match(par);
  if (p) {
    const [a, b] = [numero(p[1]), numero(p[2])];
    if (Number.isInteger(a) && Number.isInteger(b) && a < 10 && b < 10) seccion = normalizarMedida(`${a}x${b}`);
    else {
      ancho = metros(a) ?? null;
      alto = metros(b) ?? null;
    }
    resto = resto.replace(p[0], ' ');
  }
  // «un metro», «1 metro», «1,00 m», «100 cm», «0,82», «100».
  resto = resto.replace(/\b(?:un|uno)\s+metros?\b/g, ' 1 m ');
  const sueltas = [...resto.matchAll(/(?<![\w-])(\d+(?:[.,]\d+)?)\s*(cm|mm|mts?|metros?|m)?(?![\w-])/g)];
  for (const m of sueltas) {
    const n = numero(m[1]);
    const conUnidad = !!m[2];
    const conDecimales = /[.,]/.test(m[1]);
    if (!conUnidad && !conDecimales && (n < 30 || n > 400)) continue; // «4», un código: queda como texto
    const valor = m[2] === 'cm' ? n / 100 : m[2] === 'mm' ? n / 1000 : conUnidad ? n : (metros(n) ?? null);
    if (valor === null || !Number.isFinite(valor) || valor <= 0) continue;
    if (ancho === null && valor <= 1.6) ancho = valor;
    else if (alto === null && valor > 1.6) alto = valor;
    else continue;
    resto = resto.replace(m[0], ' ');
  }
  return { resto, ancho, alto, seccion };
}

/** Lee la búsqueda: qué modelo, madera, tipo de producto y medidas nombra, y lo que queda como texto. */
export function interpretarBusqueda(consulta: string, catalogo: CatalogoConsultable): BusquedaInterpretada {
  const t = texto(consulta).trim();
  const { resto, ancho, alto, seccion } = extraerMedidas(t);
  let palabras = resto
    .replace(/[^a-z0-9ñ\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const modelos = new Map(modelosCatalogo(catalogo).map((m) => [normalizar(m), m]));
  let modelo: string | null = null,
    madera: string | null = null,
    familia: Familia | null = null,
    sugerencia: string | null = null;
  // Frases de hasta tres palabras, de la más larga a la más corta: «huilo huilo», «pino oregon», «coz coz».
  const consumir = (probar: (frase: string) => boolean) => {
    for (let largo = Math.min(3, palabras.length); largo >= 1; largo--)
      for (let i = 0; i + largo <= palabras.length; i++) {
        const frase = palabras.slice(i, i + largo).join(' ');
        if (palabras.slice(i, i + largo).some((p) => VACIAS.has(p) && largo === 1)) continue;
        if (probar(frase)) {
          palabras = [...palabras.slice(0, i), ...palabras.slice(i + largo)];
          return true;
        }
      }
    return false;
  };
  consumir((frase) => {
    const r = modeloDelCatalogo(catalogo, frase);
    const canonico = modelos.get(normalizar(r.modelo));
    if (canonico && (r.canonico || normalizar(r.modelo) !== normalizar(frase) || modelos.has(normalizar(frase)))) {
      modelo = canonico;
      return true;
    }
    return false;
  });
  consumir((frase) => {
    if (/^\d/.test(frase)) return false;
    const m = maderaDelCatalogo(catalogo, frase);
    if (!m) return false;
    madera = m;
    return true;
  });
  palabras = palabras.filter((p) => {
    const f = FAMILIAS[p];
    if (f && !modelo) {
      familia = f;
      return false;
    }
    if (p === 'pieza' || p === 'piezas') {
      familia = 'PIEZAS_T';
      return false;
    }
    return !VACIAS.has(p) && !(p === 't' && familia === 'PIEZAS_T');
  });
  // Una palabra que no es modelo pero se le parece a una letra («ranko»): se sugiere, como en el chat.
  if (!modelo)
    for (const p of palabras) {
      const posible = modeloDelCatalogo(catalogo, p).posible;
      if (posible) {
        sugerencia = posible;
        break;
      }
    }
  return { modelo, madera, familia, ancho, alto, seccion, libres: palabras, sugerencia };
}

const dentro = (m: number, min: number | null | undefined, max: number | null | undefined) =>
  min != null && max != null && m >= min - 1e-9 && m <= max + 1e-9;

/** Los productos que calzan con la búsqueda; una medida entre dos tramos usa el siguiente, como al cotizar. */
export function filtrarCatalogo(
  productos: Producto[],
  b: BusquedaInterpretada,
  coincideTexto: (p: Producto, libres: string[]) => boolean,
): Producto[] {
  const base = productos.filter(
    (p) =>
      (!b.familia || p.familia === b.familia) &&
      (!b.modelo || normalizar(p.modelo) === normalizar(b.modelo)) &&
      (!b.madera || p.madera === b.madera) &&
      (!b.seccion || [b.seccion, normalizarMedida(b.seccion.split('X').reverse().join('X'))].includes(normalizarMedida(p.medida))) &&
      coincideTexto(p, b.libres),
  );
  let resultado = base;
  if (b.ancho !== null) {
    const puertas = resultado.filter((p) => p.anchoMin != null);
    const exactos = puertas.filter((p) => dentro(b.ancho!, p.anchoMin, p.anchoMax));
    // Sin un tramo que la contenga: el siguiente tramo de cada modelo y madera (la medida se cotiza con ese).
    resultado = exactos.length ? exactos : siguienteTramo(puertas, (p) => p.anchoMin!, b.ancho);
  }
  if (b.alto !== null) {
    const altoDe = (p: Producto) => ({ min: p.altoMin ?? p.largo, max: p.altoMax ?? p.largo });
    const exactos = resultado.filter((p) => dentro(b.alto!, altoDe(p).min, altoDe(p).max));
    resultado = exactos.length ? exactos : siguienteTramo(resultado, (p) => altoDe(p).min, b.alto);
  }
  return resultado;
}

function siguienteTramo(productos: Producto[], desde: (p: Producto) => number, medida: number) {
  const mayores = productos.filter((p) => desde(p) > medida + 1e-9);
  const minimo = new Map<string, number>();
  for (const p of mayores) {
    const clave = `${p.modelo}|${p.madera}`;
    minimo.set(clave, Math.min(minimo.get(clave) ?? Infinity, desde(p)));
  }
  return mayores.filter((p) => Math.abs(desde(p) - minimo.get(`${p.modelo}|${p.madera}`)!) < 1e-9);
}

/** Cómo se leyó la búsqueda, en palabras: «Ranco · Pino Oregón · 1,00 × 2,20 m». */
export function describirBusqueda(b: BusquedaInterpretada, nombre: (s: string) => string) {
  const m = (n: number) => n.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  const familias: Record<Familia, string> = { PUERTA: 'Puertas', MARCO: 'Marcos', PIEZAS_T: 'Piezas T', MOLDURA: 'Molduras', OTRO: 'Otros' };
  return [
    b.modelo ? nombre(b.modelo) : b.familia ? familias[b.familia] : null,
    b.madera ? nombre(b.madera) : null,
    b.seccion,
    b.ancho !== null && b.alto !== null
      ? `${m(b.ancho)} × ${m(b.alto)} m`
      : b.ancho !== null
        ? `${m(b.ancho)} m de ancho`
        : b.alto !== null
          ? `${m(b.alto)} m de alto`
          : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

import { claveEscuadria, metros, normalizar, normalizarMedida } from '../catalogo/resolver';
import type { Cotizacion } from '../negocio/estado';
import { preguntasPendientes, type PreguntaPendiente } from '../negocio/pendientes';
import { familiaItem } from '../negocio/personalizados';
import {
  cantidadesDichas,
  nombresDichos,
  PALABRAS_NUMERO,
  sinTildes,
  type ResolverNombre,
} from './anclaje';
import type { ModificacionCotizacion } from './esquemas';

/**
 * Respuesta directa a una pregunta pendiente: «lenga», «son 3» o «de 210 de alto» completan el dato que falta
 * sin consultar a la IA, igual que los botones de la pregunta. Solo se aplica si el mensaje es ese único dato
 * y una sola pregunta lo pide; ante cualquier duda devuelve null y el mensaje sigue a la IA.
 */
type Resolver = Record<'modelo' | 'madera', ResolverNombre>;
type Campo = 'madera' | 'cantidad' | 'alto' | 'ancho' | 'medida';

const MAX_PALABRAS = 8;
/** Palabras que acompañan el dato sin cambiarlo. «no», «y», «o», «pero» u «otra» no están: van a la IA. */
const RELLENO = new Set([
  'en',
  'de',
  'del',
  'la',
  'el',
  'las',
  'los',
  'lo',
  'son',
  'es',
  'sea',
  'sean',
  'que',
  'por',
  'favor',
  'porfa',
  'para',
  'todas',
  'todos',
  'ambas',
  'ambos',
  'madera',
  'alto',
  'ancho',
  'largo',
  'cantidad',
  'unidad',
  'unidades',
  'uds',
  'ud',
  'u',
  'm',
  'cm',
  'mm',
  'mt',
  'mts',
  'mtrs',
  'metro',
  'metros',
  'si',
  'ok',
  'ya',
  'gracias',
  'mejor',
  'medida',
  'mide',
  'miden',
  'pulg',
  'pulgada',
  'pulgadas',
  'escuadria',
  'seccion',
  'necesito',
  'quiero',
  'puerta',
  'puertas',
  'dale',
  'listo',
  'perfecto',
  'x',
]);
const PISTAS: [Campo, RegExp][] = [
  ['alto', /\b(alto|largo)\b/],
  ['ancho', /\bancho\b/],
  ['medida', /\b(pulg|pulgadas?|escuadria|seccion)\b|"/],
  ['cantidad', /\b(unidad|unidades|uds?|son|sean|cantidad|necesito)\b/],
];
const UNIDAD = /\b(m|mt|mts|mtrs|metros?|cm|mm)\b/;
const SECCION = /(?<![\d.,])\d{1,2}\s*[x×*]\s*\d{1,2}(?:[.,]\d)?(?![\d.,]*\d)/g;
const NUMERO = /\d+(?:[.,]\d+)?/g;

const respaldaOpcion = (p: PreguntaPendiente, m: number, familia: string) =>
  p.opciones.some((o) => {
    const valor = metros(Number(String(o.valor).replace(',', '.')), familia);
    return valor !== null && Math.abs(valor - m) < 1e-6;
  });

/**
 * Valor de `campo` que dice el texto para la pregunta `p`, o null si no lo dice sin ambigüedad. Las medidas se
 * leen con el rango de `familia`: el largo de un guardapolvo puede ser 3,6 m.
 */
function leer(
  campo: Exclude<Campo, 'madera'>,
  texto: string,
  p: PreguntaPendiente,
  familia: string,
): string | number | null {
  const secciones = texto.match(SECCION) ?? [];
  const numeros = texto.replace(SECCION, ' ').match(NUMERO) ?? [];
  if (campo === 'medida') {
    let seccion: string | null = null;
    if (secciones.length === 1 && !numeros.length) seccion = normalizarMedida(secciones[0]);
    else if (!secciones.length && numeros.length === 1 && /^\d{1,2}$/.test(numeros[0]))
      seccion = `2X${numeros[0]}`; // En marcos y piezas T, «6» o «6 pulgadas» es la escuadría 2x6.
    if (!seccion) return null;
    const opcion = p.opciones.find((o) => claveEscuadria(String(o.valor)) === claveEscuadria(seccion!));
    return opcion ? String(opcion.valor) : null;
  }
  if (secciones.length) return null;
  if (campo === 'cantidad') {
    const candidatas = cantidadesDichas(texto);
    if (candidatas.length !== 1 || numeros.length > 1 || UNIDAD.test(texto)) return null;
    const n = candidatas[0];
    return Number.isInteger(n) && n >= 1 && n <= 10000 && (!numeros.length || Number(numeros[0]) === n)
      ? n
      : null;
  }
  if (numeros.length !== 1) return null;
  const n = Number(numeros[0].replace(',', '.'));
  const m = metros(n, familia);
  if (m === null) return null;
  // «3» sin unidad ni decimales puede ser una cantidad: solo vale si es una de las opciones.
  if (n <= 10 && Number.isInteger(n) && !UNIDAD.test(texto) && !respaldaOpcion(p, m, familia)) return null;
  if (p.opciones.length) return respaldaOpcion(p, m, familia) ? m : null;
  if (p.entrada && (m < p.entrada.min - 1e-9 || m > p.entrada.max + 1e-9)) return null;
  return m;
}

export function respuestaDirecta(
  q: Pick<Cotizacion, 'solicitudes' | 'incompletos'>,
  mensaje: string,
  resolver: Resolver,
  /** Familia del modelo en el catálogo; sin ella, la dicen su rechazo, su nombre o su forma (ver `familiaItem`). */
  familia: (modelo: string) => string | null = () => null,
): { name: 'modificar_cotizacion'; input: ModificacionCotizacion } | null {
  const texto = sinTildes(mensaje)
    .replace(/(\d)([a-z"])/g, '$1 $2')
    .trim();
  if (!texto || texto.includes('?')) return null;
  if (texto.split(/\s+/).length > MAX_PALABRAS) return null;
  const preguntas = preguntasPendientes(q).filter(
    (p): p is PreguntaPendiente & { campo: Campo } => p.campo !== null && p.campo !== 'modelo',
  );
  if (!preguntas.length) return null;
  // Un modelo en el mensaje es un pedido o un cambio: lo interpreta la IA.
  if (nombresDichos(texto, resolver.modelo, resolver.madera).resueltos.size) return null;
  const palabras = texto.split(/[^a-z]+/).filter(Boolean);

  const maderas = nombresDichos(texto, resolver.madera, resolver.modelo);
  if (maderas.resueltos.size) {
    if (maderas.resueltos.size !== 1 || /\d/.test(texto)) return null;
    if (!maderas.literales.every((p) => !p || RELLENO.has(p.toLowerCase()))) return null;
    const candidatas = preguntas.filter((p) => p.campo === 'madera');
    if (candidatas.length !== 1) return null;
    const madera = [...maderas.resueltos.values()][0];
    const p = candidatas[0];
    if (p.opciones.length && !p.opciones.some((o) => normalizar(String(o.valor)) === normalizar(madera)))
      return null;
    return salida(p, 'madera', madera, mensaje);
  }
  if (!palabras.every((p) => RELLENO.has(p) || PALABRAS_NUMERO.has(p))) return null;
  const pistas = PISTAS.filter(([, re]) => re.test(texto)).map(([c]) => c);
  const lecturas = preguntas
    .filter((p) => p.campo !== 'madera' && (!pistas.length || pistas.includes(p.campo)))
    .flatMap((p) => {
      // El ancho es siempre de puerta; el largo, de la familia de sus ítems, con la misma regla que el botón de la
      // pregunta (`familiaItem`). Una pregunta compartida por ítems de distinta familia se lee con el rango de
      // puerta, el más estrecho.
      const familias = new Set(
        p.indices.map((i) =>
          familiaItem(
            q.solicitudes[i] ?? { modelo: null, ancho: null, medida: null },
            null,
            q.incompletos.find((pendiente) => pendiente.indice === i)?.rechazo,
            familia,
          ),
        ),
      );
      const fam = p.campo === 'ancho' || familias.size !== 1 ? 'PUERTA' : [...familias][0];
      const v = leer(p.campo as Exclude<Campo, 'madera'>, texto, p, fam);
      return v === null ? [] : [{ p, v }];
    });
  if (lecturas.length !== 1) return null;
  return salida(lecturas[0].p, lecturas[0].p.campo, lecturas[0].v, mensaje);
}

function salida(p: PreguntaPendiente, campo: Campo, valor: string | number, mensaje: string) {
  return {
    name: 'modificar_cotizacion' as const,
    input: {
      items: p.indices.map((indice) => ({ indice, cambios: { [campo]: valor, fuente: mensaje.trim() } })),
    },
  };
}

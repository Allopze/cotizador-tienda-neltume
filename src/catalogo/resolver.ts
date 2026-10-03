import type { Catalogo, Familia, Producto, SolicitudItem } from './tipos';
import { ajusteMedida, enEscalon, escalon, esKit, LARGO_PIEZA, vieneEnKit, type AjusteMedida } from './escalones';
import {
  aliasMaderasConfiguradas,
  CONFIGURACION_CATALOGO_BASE,
  nombreCanonicoModelo,
  normalizarCatalogo,
  resolverMaderaConfigurada,
  resolverModeloConfigurado,
  resolverModeloPosibleConfigurado,
} from './configuracion';
export const normalizar = normalizarCatalogo;
/** Rango físico admisible para anchos y altos de puertas y largos de accesorios, en metros. */
export const RANGO_METROS = { min: 0.3, max: 3 } as const;
/**
 * Convierte a metros: hasta 10 se asume metros, hasta 300 centímetros y hasta 3000 milímetros.
 * Devuelve null si el resultado queda fuera de 0,3–3 m (medida implausible: se pregunta).
 */
export const metros = (n: number): number | null => {
  if (!Number.isFinite(n) || n <= 0) return null;
  const m = n <= 10 ? n : n <= 300 ? n / 100 : n <= 3000 ? n / 1000 : NaN;
  return m >= RANGO_METROS.min - 1e-9 && m <= RANGO_METROS.max + 1e-9 ? m : null;
};
/** Forma canónica de una escuadría: «6 x 4.5», «6×4,5» y «6*4.5» → «6X4,5». */
export const normalizarMedida = (s: string) =>
  s.toUpperCase().replace(/[×*]/g, 'X').replace(/\s/g, '').replace(/\./g, ',');
export type Rechazo =
  | { tipo: 'faltan_datos'; campos: string[]; disponibles: Record<string, string[]> }
  | { tipo: 'modelo_desconocido'; valor: string; disponibles: string[] }
  /** El nombre se parece a un modelo, pero no basta para cotizarlo: hay que confirmar `sugerido`. */
  | { tipo: 'modelo_posible'; valor: string; sugerido: string; disponibles: string[] }
  | { tipo: 'madera_desconocida'; valor: string; disponibles: string[]; familia?: Familia }
  | { tipo: 'madera_no_disponible'; valor: string; disponibles: string[]; familia?: Familia }
  | {
      tipo: 'medida_no_disponible';
      familia?: Familia;
      campo: 'ancho' | 'alto' | 'medida';
      valor: number | string;
      disponibles: string[];
      /** Ancho o alto: extremos de los escalones que se cotizan, en metros. */
      rango?: { min: number; max: number };
    }
  | { tipo: 'medida_implausible'; campo: 'ancho' | 'alto'; valor: number; disponibles: string[] }
  | { tipo: 'producto_ambiguo'; valor: string; disponibles: string[] }
  | { tipo: 'cantidad_invalida'; valor: number | null; disponibles: string[] };
export type Resolucion =
  | {
      ok: true;
      producto: Producto;
      cantidad: number;
      /** Indica si el nombre de entrada ya era canónico o se resolvió mediante un alias seguro. */
      coincidenciaModelo: 'canonico' | 'alias';
      /** Medidas pedidas, ya en metros o en forma canónica. */
      anchoSolicitado: number | null;
      altoSolicitado: number | null;
      medidaSolicitada: string | null;
      /** Cómo calzó cada medida con la referencia; null si no se pidió o no aplica. */
      ajusteAncho: AjusteMedida | null;
      ajusteAlto: AjusteMedida | null;
    }
  | { ok: false; rechazo: Rechazo };
export interface FuenteCatalogo {
  modelos(): string[];
  maderas(): string[];
  productosDeModelo(modeloNormalizado: string): Producto[];
  resolverMadera?(valor: string): string | null;
  resolverModelo?(valor: string): string;
  resolverModeloPosible?(valor: string): string | null;
  aliasMaderas?(): Record<string, string[]>;
  aliasModelos?(): Record<string, string[]>;
}
export type CatalogoConsultable = Catalogo | FuenteCatalogo;
export const modelosCatalogo = (catalogo: CatalogoConsultable) =>
  'productos' in catalogo ? [...new Set(catalogo.productos.map((p) => p.modelo))] : catalogo.modelos();
export const maderasCatalogo = (catalogo: CatalogoConsultable) =>
  'productos' in catalogo ? [...new Set(catalogo.productos.map((p) => p.madera))] : catalogo.maderas();
export const aliasMaderasCatalogo = (catalogo: CatalogoConsultable) =>
  'productos' in catalogo
    ? aliasMaderasConfiguradas(CONFIGURACION_CATALOGO_BASE)
    : (catalogo.aliasMaderas?.() ?? {});
export const aliasModelosCatalogo = (catalogo: CatalogoConsultable) =>
  'productos' in catalogo ? CONFIGURACION_CATALOGO_BASE.aliasModelos : (catalogo.aliasModelos?.() ?? {});
/**
 * Cada medida distinta de los candidatos es un escalón. Se usa el que contiene la medida pedida; en el
 * hueco entre dos, el siguiente hacia arriba. Bajo el menor o sobre el mayor no hay precio: no se extrapola.
 * Un kit y una pieza lineal son productos distintos: el siguiente escalón nunca salta de uno a otro.
 * Ancho y alto se resuelven en orden: si el ancho elegido no tiene ese alto, no se prueba otro ancho.
 */
function porEscalon(ps: Producto[], valor: number, campo: 'ancho' | 'alto') {
  const todos = ps.flatMap((p) => {
    const e = escalon(p, campo);
    return e ? [{ p, e }] : [];
  });
  const dentro = todos.filter(({ e }) => enEscalon(valor, e));
  if (dentro.length) return { productos: dentro.map(({ p }) => p), rango: null };
  const candidatos = todos.filter(({ p }) => !vieneEnKit(p.familia) || esKit(p) === (valor < LARGO_PIEZA));
  const minimos = candidatos.map(({ e }) => e.min);
  const rango = candidatos.length
    ? { min: Math.min(...minimos), max: Math.max(...candidatos.map(({ e }) => e.max)) }
    : null;
  if (!rango || valor < rango.min || valor > rango.max) return { productos: [], rango };
  const siguiente = Math.min(...minimos.filter((min) => min > valor));
  const productos = candidatos.filter(({ e }) => Math.abs(e.min - siguiente) < 1e-9).map(({ p }) => p);
  return { productos, rango };
}
/**
 * Un nombre canónico existente siempre gana frente a cualquier alias (p. ej. «Pillo» si fuera un modelo real).
 * Después un alias seguro se normaliza al modelo. Un alias dudoso nunca sustituye: `posible` trae el modelo
 * del catálogo que se sugiere confirmar, y `modelo` queda como vino.
 */
export function modeloDelCatalogo(catalogo: CatalogoConsultable, valor: string) {
  const canonico = modelosCatalogo(catalogo).find((m) => normalizar(m) === normalizar(valor));
  if (canonico !== undefined) return { modelo: canonico, canonico: true, posible: null };
  const modelo =
    'productos' in catalogo
      ? resolverModeloConfigurado(valor, CONFIGURACION_CATALOGO_BASE)
      : (catalogo.resolverModelo?.(valor) ?? valor);
  if (normalizar(modelo) !== normalizar(valor)) return { modelo, canonico: false, posible: null };
  const sugerido =
    'productos' in catalogo
      ? resolverModeloPosibleConfigurado(valor, CONFIGURACION_CATALOGO_BASE)
      : (catalogo.resolverModeloPosible?.(valor) ?? null);
  const posible = sugerido ? (modelosCatalogo(catalogo).find((m) => normalizar(m) === normalizar(sugerido)) ?? null) : null;
  return { modelo, canonico: false, posible };
}
/** Madera canónica para un nombre o alias; null si el catálogo no la conoce. */
export function maderaDelCatalogo(catalogo: CatalogoConsultable, valor: string) {
  const configurada =
    'productos' in catalogo
      ? resolverMaderaConfigurada(valor, CONFIGURACION_CATALOGO_BASE)
      : catalogo.resolverMadera?.(valor);
  return (
    configurada ?? maderasCatalogo(catalogo).find((disponible) => normalizar(disponible) === normalizar(valor)) ?? null
  );
}
export function resolverItem(catalogo: CatalogoConsultable, entrada: Partial<SolicitudItem>): Resolucion {
  const s: SolicitudItem = {
    modelo: entrada.modelo ?? null,
    madera: entrada.madera ?? null,
    ancho: entrada.ancho ?? null,
    alto: entrada.alto ?? null,
    medida: entrada.medida ?? null,
    cantidad: entrada.cantidad ?? null,
    precioUnitario: entrada.precioUnitario ?? null,
  };
  const unicos = (ps: Producto[], campo: 'modelo' | 'madera' | 'medida' | 'largo') => [
    ...new Set(ps.map((p) => String(p[campo]))),
  ];
  const no = (rechazo: Rechazo): Resolucion => ({ ok: false, rechazo });
  if (!s.modelo)
    return no({
      tipo: 'faltan_datos',
      campos: ['modelo'],
      disponibles: { modelo: modelosCatalogo(catalogo) },
    });
  const { modelo, canonico, posible } = modeloDelCatalogo(catalogo, s.modelo);
  if (posible) {
    const sugerido = nombreCanonicoModelo(posible);
    return no({ tipo: 'modelo_posible', valor: s.modelo, sugerido, disponibles: [sugerido] });
  }
  const coincidenciaModelo = canonico ? 'canonico' : 'alias';
  let opciones =
    'productos' in catalogo
      ? catalogo.productos.filter((p) => normalizar(p.modelo) === normalizar(modelo))
      : catalogo.productosDeModelo(normalizar(modelo));
  if (!opciones.length)
    return no({ tipo: 'modelo_desconocido', valor: s.modelo, disponibles: modelosCatalogo(catalogo) });
  const familia = opciones[0].familia,
    puerta = familia === 'PUERTA';
  // Cada madera tiene sus propios escalones: una alternativa debe calzar con todas las medidas pedidas.
  const maderasCompatibles = () => unicos(opciones, 'madera').filter((madera) => {
    let productos = opciones.filter((p) => p.madera === madera);
    if (puerta && s.ancho !== null) {
      const ancho = metros(s.ancho);
      if (ancho === null) return false;
      productos = porEscalon(productos, ancho, 'ancho').productos;
    }
    if (!puerta && s.medida) {
      let medida = normalizarMedida(s.medida);
      if (familia !== 'MOLDURA' && /^\d+$/.test(medida)) medida = `2X${medida}`;
      productos = productos.filter((p) => p.medida === medida);
    }
    if (s.alto !== null) {
      const alto = metros(s.alto);
      if (alto === null) return false;
      productos = porEscalon(productos, alto, 'alto').productos;
    }
    return productos.length > 0;
  });
  const madera = s.madera ? maderaDelCatalogo(catalogo, s.madera) : null;
  if (s.madera && !madera)
    return no({ tipo: 'madera_desconocida', valor: s.madera, disponibles: maderasCompatibles(), familia });
  if (madera) {
    const conMadera = opciones.filter((p) => p.madera === madera);
    if (!conMadera.length)
      return no({ tipo: 'madera_no_disponible', valor: madera, disponibles: maderasCompatibles(), familia });
    opciones = conMadera;
  }
  if (s.cantidad !== null && (!Number.isInteger(s.cantidad) || s.cantidad < 1 || s.cantidad > 10000))
    return no({ tipo: 'cantidad_invalida', valor: s.cantidad, disponibles: ['Entero entre 1 y 10.000'] });
  // Valida también medidas presentes aunque falten otros datos: nunca oculta un ancho imposible.
  const rango = ['0,3 a 3 m (o 30 a 300 cm)'];
  let anchoSolicitado: number | null = null,
    altoSolicitado: number | null = null,
    medidaSolicitada: string | null = null;
  if (puerta && s.ancho !== null) {
    const ancho = metros(s.ancho);
    if (ancho === null)
      return no({ tipo: 'medida_implausible', campo: 'ancho', valor: s.ancho, disponibles: rango });
    anchoSolicitado = ancho;
    const medidas = unicos(opciones, 'medida');
    const { productos, rango: extremos } = porEscalon(opciones, ancho, 'ancho');
    opciones = productos;
    if (!opciones.length)
      return no({
        tipo: 'medida_no_disponible',
        familia,
        campo: 'ancho',
        valor: ancho,
        disponibles: medidas,
        ...(extremos ? { rango: extremos } : {}),
      });
  }
  if (!puerta && s.medida) {
    let medida = normalizarMedida(s.medida);
    if (familia !== 'MOLDURA' && /^\d+$/.test(medida)) medida = `2X${medida}`;
    medidaSolicitada = medida;
    const medidas = unicos(opciones, 'medida');
    opciones = opciones.filter((p) => p.medida === medida);
    if (!opciones.length)
      return no({ tipo: 'medida_no_disponible', campo: 'medida', valor: s.medida, disponibles: medidas, familia });
  }
  if (s.alto !== null) {
    const alto = metros(s.alto),
      disponibles = unicos(opciones, 'largo');
    if (alto === null)
      return no({ tipo: 'medida_implausible', campo: 'alto', valor: s.alto, disponibles: rango });
    altoSolicitado = alto;
    const { productos, rango: extremos } = porEscalon(opciones, alto, 'alto');
    opciones = productos;
    if (!opciones.length)
      return no({
        tipo: 'medida_no_disponible',
        familia,
        campo: 'alto',
        valor: alto,
        disponibles,
        ...(extremos ? { rango: extremos } : {}),
      });
  }
  const campos: string[] = [];
  if (!s.madera) campos.push('madera');
  if (puerta ? s.ancho === null : !s.medida) campos.push(puerta ? 'ancho' : 'medida');
  if (s.alto === null) campos.push('alto');
  if (s.cantidad === null) campos.push('cantidad');
  if (campos.length)
    return no({
      tipo: 'faltan_datos',
      campos,
      disponibles: {
        madera: unicos(opciones, 'madera'),
        ancho: unicos(opciones, 'medida'),
        medida: unicos(opciones, 'medida'),
        alto: unicos(opciones, 'largo'),
        cantidad: ['Entero entre 1 y 10.000'],
      },
    });
  // Rangos manuales superpuestos u otra ambigüedad: se pregunta en vez de elegir en silencio.
  if (opciones.length > 1)
    return no({
      tipo: 'producto_ambiguo',
      valor: modelo,
      disponibles: opciones.map((p) => `${p.codigo}: ${p.descripcion}`),
    });
  const producto = opciones[0];
  return {
    ok: true,
    producto,
    cantidad: s.cantidad!,
    coincidenciaModelo,
    anchoSolicitado,
    altoSolicitado,
    medidaSolicitada,
    ajusteAncho: anchoSolicitado === null ? null : ajusteMedida(anchoSolicitado, producto, 'ancho'),
    ajusteAlto: altoSolicitado === null ? null : ajusteMedida(altoSolicitado, producto, 'alto'),
  };
}

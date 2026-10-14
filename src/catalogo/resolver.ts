import type { Catalogo, Familia, Producto, SolicitudItem } from './tipos';
import { ajusteMedida, enEscalon, escalon, esKit, LARGO_PIEZA, vieneEnKit, type AjusteMedida } from './escalones';
import {
  aliasMaderasConfiguradas,
  CONFIGURACION_CATALOGO_BASE,
  maderaEquivalente,
  modeloParecido,
  nombreCanonicoModelo,
  normalizarCatalogo,
  resolverMaderaConfigurada,
  crearResolverModeloConfigurado,
  type ConfiguracionCatalogo,
  resolverModeloPosibleConfigurado,
} from './configuracion';
import { rangoMedidas } from '../negocio/limites';
export const normalizar = normalizarCatalogo;
/** Rango físico admisible para el ancho y el alto de una puerta, en metros; los accesorios usan `rangoMedidas`. */
export const RANGO_METROS = rangoMedidas('PUERTA');
/**
 * Convierte a metros según la familia (`rangoMedidas`): hasta 10 se asume metros; sobre eso, centímetros hasta
 * el tope de la familia (300 en puertas, 600 en accesorios) y milímetros hasta mil veces el tope. Devuelve null
 * si el resultado queda fuera de su rango, 0,3–3 m en puertas y 0,3–6 m en accesorios (medida implausible: se
 * pregunta). Sin familia se lee como puerta.
 */
export const metros = (n: number, familia: string = 'PUERTA'): number | null => {
  if (!Number.isFinite(n) || n <= 0) return null;
  const rango = rangoMedidas(familia);
  const m = n <= 10 ? n : n <= rango.max * 100 ? n / 100 : n <= rango.max * 1000 ? n / 1000 : NaN;
  return m >= rango.min - 1e-9 && m <= rango.max + 1e-9 ? m : null;
};
/**
 * Forma canónica de una escuadría: «6 x 4.5», «6×4,5» y «6*4.5» → «6X4,5». La unidad se omite: «6 pulgadas» y
 * «2x6"» son «6» y «2X6» (en marcos y piezas T, «6» ya es la sección 2x6), y «30x70 mm» o «30 mm x 70 mm» son
 * «30X70». Conserva el orden escrito, que es el que se muestra; para comparar, `claveEscuadria`.
 */
export const normalizarMedida = (s: string) =>
  s
    .toUpperCase()
    .replace(/[×*]/g, 'X')
    .replace(/\s/g, '')
    .replace(/PULGADAS?|PULG\.?|["”″]|''/g, '')
    .replace(/(\d)(?:MM|CM)\.?(?=X|$)/g, '$1')
    .replace(/\./g, ',');
/**
 * Clave para comparar escuadrías sin importar el orden de los factores: «4x2» y «2X4» son la misma pieza, como
 * «12X1» y «1x12». El catálogo escribe unas de menor a mayor (2X4, 30X70) y otras al revés (12X1, 6X4,5).
 */
export function claveEscuadria(s: string) {
  const m = normalizarMedida(s);
  const factores = m.split('X');
  if (factores.length !== 2 || !factores.every((f) => /^\d+(?:,\d+)?$/.test(f))) return m;
  return factores.sort((a, b) => Number(a.replace(',', '.')) - Number(b.replace(',', '.'))).join('X');
}
export type Rechazo =
  | { tipo: 'faltan_datos'; campos: string[]; disponibles: Record<string, string[]> }
  | { tipo: 'modelo_desconocido'; valor: string; disponibles: string[] }
  /** El nombre se parece a un modelo, pero no basta para cotizarlo: hay que confirmar `sugerido`. */
  | { tipo: 'modelo_posible'; valor: string; sugerido: string; disponibles: string[]; familia?: Familia }
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
  /** `familia` es la del modelo: fija el rango con que se vuelve a preguntar (puertas hasta 3 m, accesorios hasta 6 m). */
  | { tipo: 'medida_implausible'; campo: 'ancho' | 'alto'; valor: number; disponibles: string[]; familia?: Familia }
  /** Una puerta con el ancho mayor que el alto: casi seguro se escribieron al revés. Medidas pedidas, en metros. */
  | { tipo: 'medidas_invertidas'; ancho: number; alto: number; disponibles: string[]; familia?: Familia }
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
  /** Reglas completas para construir el índice seguro del anclaje, incluidos los alias dudosos. */
  readonly configuracion?: ConfiguracionCatalogo;
  modelos(): string[];
  maderas(): string[];
  productosDeModelo(modeloNormalizado: string): Producto[];
  resolverMadera?(valor: string): string | null;
  resolverModelo?(valor: string): string;
  resolverModeloPosible?(valor: string): string | null;
  /** Modelo del catálogo al que `valor` se parece a una letra de distancia; null si no hay o si hay empate. */
  modeloParecido?(valor: string, modelos: string[]): string | null;
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
 * Una puerta algo más angosta o baja que la menor del catálogo se cotiza con esa (la hoja se rebaja): 0,69
 * usa la de 0,70. Desde 5 cm menos, un escalón entero, no hay precio.
 */
const REBAJE_PUERTA = 0.05;
/**
 * Cada medida distinta de los candidatos es un escalón. Se usa el que contiene la medida pedida; en el
 * hueco entre dos, el siguiente hacia arriba. Sobre el mayor no hay precio: no se extrapola. Bajo el menor
 * tampoco, salvo el largo de un marco: un marco para una puerta de 2,27 m se cotiza con el set más corto
 * (2,5 m), porque el marco se corta en obra; y una puerta a menos de REBAJE_PUERTA de su menor medida.
 * Un kit y una pieza lineal son productos distintos: el siguiente escalón nunca salta de uno a otro.
 * Ancho y alto se resuelven en orden: si el ancho elegido no tiene ese alto, no se prueba otro ancho.
 * Cada madera (y, en accesorios, cada sección) tiene sus propios escalones: si todavía falta elegirla, cada
 * alternativa aporta su escalón y ninguna queda oculta por el mínimo de otra.
 */
function porEscalon(ps: Producto[], valor: number, campo: 'ancho' | 'alto') {
  const todos = ps.flatMap((p) => {
    const e = escalon(p, campo);
    return e ? [{ p, e }] : [];
  });
  const esCandidato = ({ p }: (typeof todos)[number]) =>
    !vieneEnKit(p.familia) || esKit(p) === (valor < LARGO_PIEZA);
  const rangoDe = (ts: typeof todos) =>
    ts.length ? { min: Math.min(...ts.map(({ e }) => e.min)), max: Math.max(...ts.map(({ e }) => e.max)) } : null;
  const grupos = new Map<string, typeof todos>();
  for (const t of todos) {
    const clave = `${t.p.madera}|${campo === 'alto' && t.p.familia !== 'PUERTA' ? t.p.medida : ''}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), t]);
  }
  const elegidos = new Set([...grupos.values()].flatMap((grupo) => {
    const dentro = grupo.filter(({ e }) => enEscalon(valor, e));
    if (dentro.length) return dentro;
    const candidatos = grupo.filter(esCandidato);
    const rango = rangoDe(candidatos);
    const subeAlMenor =
      (campo === 'alto' && candidatos.every(({ p }) => p.familia === 'MARCO')) ||
      (!!rango &&
        valor > rango.min - REBAJE_PUERTA + 1e-9 &&
        candidatos.every(({ p }) => p.familia === 'PUERTA'));
    if (!rango || (valor < rango.min && !subeAlMenor) || valor > rango.max) return [];
    const siguiente = Math.min(...candidatos.map(({ e }) => e.min).filter((min) => min > valor));
    return candidatos.filter(({ e }) => Math.abs(e.min - siguiente) < 1e-9);
  }));
  const productos = todos.filter((t) => elegidos.has(t)).map(({ p }) => p);
  return { productos, rango: productos.length ? null : rangoDe(todos.filter(esCandidato)) };
}
/**
 * Un nombre canónico existente siempre gana frente a cualquier alias (p. ej. «Pillo» si fuera un modelo real).
 * Después un alias seguro se normaliza al modelo. Un alias dudoso nunca sustituye: `posible` trae el modelo
 * del catálogo que se sugiere confirmar, y `modelo` queda como vino. Sin alias dudoso, un nombre a una letra
 * de distancia de un modelo conocido se sugiere igual: preguntar es más seguro que reemplazarlo en silencio.
 */
export function modeloDelCatalogo(catalogo: CatalogoConsultable, valor: string) {
  const modelos = modelosCatalogo(catalogo);
  const clave = normalizar(valor);
  const canonico = modelos.find((m) => normalizar(m) === clave);
  if (canonico !== undefined) return { modelo: canonico, canonico: true, posible: null };
  const fuente = 'productos' in catalogo ? null : catalogo;
  const configuracion = fuente ? fuente.configuracion : CONFIGURACION_CATALOGO_BASE;
  const r = crearResolverModeloConfigurado(configuracion ?? {
    aliasModelos: aliasModelosCatalogo(catalogo), aliasPosiblesModelos: {},
  }, modelos)(valor);
  if (r.ambiguo) return { modelo: valor, canonico: false, posible: null };
  const modelo = configuracion || normalizar(r.modelo) !== normalizar(valor)
    ? r.modelo
    : fuente?.resolverModelo?.(valor) ?? r.modelo;
  if (normalizar(modelo) !== normalizar(valor)) return { modelo, canonico: false, posible: null };
  const dudoso = configuracion
    ? resolverModeloPosibleConfigurado(valor, configuracion)
    : fuente?.resolverModeloPosible?.(valor) ?? null;
  const parecido = dudoso === null
    ? configuracion
      ? modeloParecido(valor, configuracion, modelos)
      : fuente?.modeloParecido?.(valor, modelos) ?? null
    : null;
  const sugerido = dudoso ?? parecido;
  const posible = sugerido ? modelos.find((m) => normalizar(m) === normalizar(sugerido)) ?? null : null;
  return { modelo, canonico: false, posible };
}

/**
 * Instantánea para el anclaje: una lectura de modelos y maderas, índices de claves y memoria por secuencia.
 * Solo reconoce canónicos y alias seguros; nunca calcula Damerau ni consulta productos durante el anclaje.
 */
export function resolverNombres(catalogo: CatalogoConsultable) {
  const modelos = modelosCatalogo(catalogo);
  const maderas = maderasCatalogo(catalogo);
  const configuracion = 'productos' in catalogo ? CONFIGURACION_CATALOGO_BASE : catalogo.configuracion;
  const resolverModelo = crearResolverModeloConfigurado(configuracion ?? {
    aliasModelos: aliasModelosCatalogo(catalogo), aliasPosiblesModelos: {},
  }, modelos);
  const canonicos = new Map(modelos.map((m) => [normalizar(m), m]));
  const resolverMadera = crearResolverModeloConfigurado({
    aliasModelos: configuracion
      ? Object.fromEntries(configuracion.maderas.map((m) => [m.nombre, m.alias]))
      : aliasMaderasCatalogo(catalogo),
    aliasPosiblesModelos: {},
  }, [...(configuracion?.maderas.map((m) => m.nombre) ?? []), ...maderas]);
  const memorizar = (resolver: (valor: string) => string | null) => {
    const memoria = new Map<string, string | null>();
    return (valor: string) => {
      if (!memoria.has(valor)) memoria.set(valor, resolver(valor));
      return memoria.get(valor)!;
    };
  };
  return {
    modelo: memorizar((valor) => {
      const r = resolverModelo(valor);
      return r.ambiguo ? null : canonicos.get(normalizar(r.modelo)) ?? null;
    }),
    madera: memorizar((valor) => {
      const r = resolverMadera(valor);
      return r.ambiguo || (!r.canonico && normalizar(r.modelo) === normalizar(valor)) ? null : r.modelo;
    }),
  };
}
/**
 * Madera canónica para un nombre o alias; null si el catálogo no la conoce. Orden: alias exacto, madera real
 * exacta y, al final, la variante tolerante («MARRA» no cambia a MARA si MARRA existe en el catálogo).
 */
export function maderaDelCatalogo(catalogo: CatalogoConsultable, valor: string) {
  if (!('productos' in catalogo))
    return (
      catalogo.resolverMadera?.(valor) ??
      maderasCatalogo(catalogo).find((disponible) => normalizar(disponible) === normalizar(valor)) ??
      null
    );
  return (
    resolverMaderaConfigurada(valor, CONFIGURACION_CATALOGO_BASE, { tolerante: false }) ??
    maderasCatalogo(catalogo).find((disponible) => normalizar(disponible) === normalizar(valor)) ??
    resolverMaderaConfigurada(valor, CONFIGURACION_CATALOGO_BASE)
  );
}
/** La madera pedida o, si el modelo no la tiene, la equivalente de su familia (un marco en Mara Enchapada). */
function conEquivalente(opciones: Producto[], madera: string) {
  if (opciones.some((p) => p.madera === madera)) return madera;
  const equivalente = maderaEquivalente(opciones[0]?.familia, madera);
  return equivalente && opciones.some((p) => p.madera === equivalente) ? equivalente : madera;
}
/**
 * Madera canónica con que se cotiza el ítem, aunque esté incompleto; null si no dice una conocida. Un modelo
 * por confirmar («¿Te refieres a Marco?») solo cuenta con `sugerido`: para comparar, no para guardar.
 */
export function maderaEfectiva(
  catalogo: CatalogoConsultable,
  s: Pick<SolicitudItem, 'modelo' | 'madera'>,
  { sugerido = false }: { sugerido?: boolean } = {},
) {
  const madera = s.madera ? maderaDelCatalogo(catalogo, s.madera) : null;
  if (!madera || !s.modelo) return madera;
  const { modelo, posible } = modeloDelCatalogo(catalogo, s.modelo);
  if (posible && !sugerido) return madera;
  const clave = normalizar(posible ?? modelo);
  const opciones = 'productos' in catalogo
    ? catalogo.productos.filter((p) => normalizar(p.modelo) === clave)
    : catalogo.productosDeModelo(clave);
  return conEquivalente(opciones, madera);
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
    const productos = 'productos' in catalogo
      ? catalogo.productos.filter((p) => normalizar(p.modelo) === normalizar(posible))
      : catalogo.productosDeModelo(normalizar(posible));
    return no({ tipo: 'modelo_posible', valor: s.modelo, sugerido, disponibles: [sugerido], familia: productos[0]?.familia });
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
  // Una puerta más ancha que alta no existe en el catálogo: antes de buscar escalones o maderas, se propone
  // intercambiar las medidas en vez de responder que el ancho no está disponible.
  if (puerta && s.ancho !== null && s.alto !== null) {
    const ancho = metros(s.ancho),
      alto = metros(s.alto);
    if (ancho !== null && alto !== null && ancho > alto + 1e-9)
      return no({ tipo: 'medidas_invertidas', ancho, alto, disponibles: [], familia });
  }
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
      const clave = claveEscuadria(medida);
      productos = productos.filter((p) => claveEscuadria(p.medida) === clave);
    }
    if (s.alto !== null) {
      const alto = metros(s.alto, familia);
      if (alto === null) return false;
      productos = porEscalon(productos, alto, 'alto').productos;
    }
    return productos.length > 0;
  });
  const madera = s.madera ? maderaDelCatalogo(catalogo, s.madera) : null;
  if (s.madera && !madera)
    return no({ tipo: 'madera_desconocida', valor: s.madera, disponibles: maderasCompatibles(), familia });
  if (madera) {
    const efectiva = conEquivalente(opciones, madera);
    const conMadera = opciones.filter((p) => p.madera === efectiva);
    if (!conMadera.length)
      return no({ tipo: 'madera_no_disponible', valor: madera, disponibles: maderasCompatibles(), familia });
    opciones = conMadera;
  }
  if (s.cantidad !== null && (!Number.isInteger(s.cantidad) || s.cantidad < 1 || s.cantidad > 10000))
    return no({ tipo: 'cantidad_invalida', valor: s.cantidad, disponibles: ['Entero entre 1 y 10.000'] });
  // Valida también medidas presentes aunque falten otros datos: nunca oculta un ancho imposible. El ancho es de
  // puerta; el alto o largo, de la familia del modelo (un guardapolvo llega a 6 m).
  const rangoTexto = (f: string) => {
    const { min, max } = rangoMedidas(f);
    return [`${String(min).replace('.', ',')} a ${max} m (o ${Math.round(min * 100)} a ${Math.round(max * 100)} cm)`];
  };
  let anchoSolicitado: number | null = null,
    altoSolicitado: number | null = null,
    medidaSolicitada: string | null = null;
  if (puerta && s.ancho !== null) {
    const ancho = metros(s.ancho);
    if (ancho === null)
      return no({ tipo: 'medida_implausible', campo: 'ancho', valor: s.ancho, disponibles: rangoTexto('PUERTA'), familia });
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
    const medidas = unicos(opciones, 'medida');
    const clave = claveEscuadria(medida);
    opciones = opciones.filter((p) => claveEscuadria(p.medida) === clave);
    if (!opciones.length)
      return no({ tipo: 'medida_no_disponible', campo: 'medida', valor: s.medida, disponibles: medidas, familia });
    // Se muestra como la escribe el catálogo: «4x2» o «30x70 mm» se cotizan y se leen 2X4 y 30X70.
    medidaSolicitada = opciones[0].medida;
  }
  if (s.alto !== null) {
    const alto = metros(s.alto, familia),
      disponibles = unicos(opciones, 'largo');
    if (alto === null)
      return no({ tipo: 'medida_implausible', campo: 'alto', valor: s.alto, disponibles: rangoTexto(familia), familia });
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

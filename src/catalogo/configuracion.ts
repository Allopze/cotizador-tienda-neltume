import { z } from 'zod';
import type { Familia } from './tipos';

export const normalizarCatalogo = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/**
 * Clave tolerante a errores de escritura: además de normalizarCatalogo, junta las palabras repetidas
 * («WILO WILO» → «WILO») y colapsa las letras dobles consecutivas («HUILLO» → «HUILO»,
 * «WILLOW» → «WILOW»). No reemplaza a normalizarCatalogo: la coincidencia exacta siempre gana.
 */
export const claveTolerante = (s: string) => {
  const palabras = s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const propias = palabras.length >= 2 && palabras.every((p) => p === palabras[0]) ? [palabras[0]] : palabras;
  return normalizarCatalogo(propias.join(' ')).replace(/(.)\1+/g, '$1');
};

/** Presentación estable del nombre que se guarda en todos los documentos y consultas. */
export const nombreCanonicoModelo = (s: string) =>
  normalizarCatalogo(s) === 'HUILOHUILO' ? 'Huilo Huilo' : s;

/**
 * Terminación de puerta que una familia no tiene, con la que sí tiene: un «marco enchapado» es el set de
 * Pino Finger enchapado en mara, porque los marcos no vienen en MARA ENCHAPADA. Solo se usa si el modelo no
 * tiene la madera pedida.
 */
const MADERA_EQUIVALENTE: Partial<Record<Familia, Record<string, string>>> = {
  MARCO: { 'MARA ENCHAPADA': 'PINO FINGER ENCHAPADO MARA' },
};
export const maderaEquivalente = (familia: Familia | null | undefined, madera: string) =>
  Object.entries((familia && MADERA_EQUIVALENTE[familia]) ?? {}).find(
    ([pedida]) => normalizarCatalogo(pedida) === normalizarCatalogo(madera),
  )?.[1] ?? null;
/** Las maderas pedidas que la familia cotiza con `madera` (la inversa de `maderaEquivalente`). */
export const maderasConEquivalente = (familia: string | null | undefined, madera: string) =>
  Object.entries((familia && MADERA_EQUIVALENTE[familia as Familia]) ?? {}).flatMap(([pedida, equivalente]) =>
    normalizarCatalogo(equivalente) === normalizarCatalogo(madera) ? [pedida] : [],
  );

const maderaSchema = z.object({
  nombre: z.string().trim().min(1),
  codigo: z.string().trim().regex(/^[A-Z0-9]+$/i),
  alias: z.array(z.string().trim().min(1)).default([]),
});

const configuracionParcialSchema = z
  .object({
    maderas: z.array(maderaSchema).min(1).optional(),
    familiasPorModelo: z.record(z.string(), z.enum(['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA'])).optional(),
    aliasModelos: z.record(z.string(), z.array(z.string().trim().min(1))).optional(),
    aliasPosiblesModelos: z.record(z.string(), z.array(z.string().trim().min(1))).optional(),
  })
  .strict();

export interface MaderaConfigurada {
  nombre: string;
  codigo: string;
  alias: string[];
}

export interface ConfiguracionCatalogo {
  maderas: MaderaConfigurada[];
  familiasPorModelo: Record<string, Familia>;
  /** Alias seguros: se normalizan al modelo canónico sin preguntar. */
  aliasModelos: Record<string, string[]>;
  /** Alias dudosos: nunca se sustituyen solos; el ítem queda pendiente hasta que la persona confirma el modelo. */
  aliasPosiblesModelos: Record<string, string[]>;
}

/**
 * Terminaciones de la planilla de enchapadas, prepintadas y marcos finger. Cada una es una madera propia:
 * «Huilo Huilo en Mara» es la puerta sólida y «enchapada en Mara» es MARA ENCHAPADA. «Pino finger» nunca es
 * PINO OREGON (cuyo alias «pino» solo vale sin «finger»: los alias se comparan enteros).
 */
const MADERAS_ENCHAPADAS: MaderaConfigurada[] = [
  { nombre: 'PREPINTADA', codigo: 'PP', alias: ['PREPINTADO', 'PREPINTADAS', 'PREPINTADOS'] },
  {
    nombre: 'MARA ENCHAPADA',
    codigo: 'EM',
    alias: [
      'ENCHAPADA',
      'ENCHAPADO',
      'MARA ENCHAPADO',
      'ENCHAPADA MARA',
      'ENCHAPADA EN MARA',
      'ENCHAPADO EN MARA',
      'ENCHAPE MARA',
      'ENCHAPE EN MARA',
      'ENCHAPADO MARA',
      'ENCHAP MARA',
      'ENCHAP EN MARA',
      'ENCHA MARA',
      'ENCHA EN MARA',
      'ENCH MARA',
      'ENCH EN MARA',
    ],
  },
  { nombre: 'PINO FINGER', codigo: 'PF', alias: ['FINGER', 'FINGER JOINT', 'PINO FINGER DESNUDO', 'FINGER DESNUDO'] },
  {
    nombre: 'PINO FINGER ENCHAPADO MARA',
    codigo: 'FE',
    alias: [
      'PINO FINGER ENCHAPADO',
      'PINO FINGER ENCHAPADA',
      'PINO FINGER ENCHAPADO EN MARA',
      'FINGER ENCHAPADO',
      'FINGER ENCHAPADA',
      'FINGER ENCHAPADO MARA',
      'FINGER ENCHAPADO EN MARA',
    ],
  },
];

export const CONFIGURACION_CATALOGO_BASE: ConfiguracionCatalogo = {
  maderas: [
    { nombre: 'PINO OREGON', codigo: 'O', alias: ['PINO', 'OREGON'] },
    { nombre: 'LENGA', codigo: 'L', alias: [] },
    { nombre: 'MARA', codigo: 'M', alias: [] },
    { nombre: 'RAULI', codigo: 'R', alias: ['RAULÍ'] },
    ...structuredClone(MADERAS_ENCHAPADAS),
  ],
  familiasPorModelo: {
    MARCO: 'MARCO',
    'PIEZAS T': 'PIEZAS_T',
    ENDOLADO: 'MOLDURA',
    GUARDAPOLVO: 'MOLDURA',
    PILASTRA: 'MOLDURA',
  },
  aliasModelos: {
    'HUILO HUILO': [
      'HUILO',
      'HUILA',
      'WILLO',
      'WILLOW',
      'HUILO HUILA',
      'WILLOW WILLOW',
      'HUILLO HUILLO',
      'HUILLO',
      'WILO WILO',
      'WILLOWO',
    ],
    PANGUIPULLI: ['PANGIPULLI'],
    'COZ COZ': ['COSCOS', 'COS COS', 'COSCO'],
  },
  aliasPosiblesModelos: {
    'HUILO HUILO': ['PILLO'],
  },
};

/** Suma alias por modelo sin duplicar; un modelo con otra grafía (mayúsculas, tildes) conserva la clave original. */
function fusionarAlias(base: Record<string, string[]>, extra: Record<string, string[]> = {}) {
  const fusion: Record<string, string[]> = { ...base };
  for (const [modelo, aliases] of Object.entries(extra)) {
    const existente = Object.keys(fusion).find((clave) => normalizarCatalogo(clave) === normalizarCatalogo(modelo));
    const clave = existente ?? modelo;
    fusion[clave] = [...new Set([...(fusion[clave] ?? []), ...aliases])];
  }
  return fusion;
}

/**
 * Suma a cada madera configurada los alias que la base conoce para ella, como los alias de modelo: una
 * configuración guardada antes de un alias nuevo («encha mara») lo recibe sin editarla. No suma uno que,
 * escrito parecido, ya nombra una madera.
 */
function conAliasBase(maderas: MaderaConfigurada[]): MaderaConfigurada[] {
  const usados = new Set(maderas.flatMap((m) => [m.nombre, ...m.alias].map(claveTolerante)));
  return maderas.map((madera) => {
    const base = CONFIGURACION_CATALOGO_BASE.maderas.find(
      (b) => normalizarCatalogo(b.nombre) === normalizarCatalogo(madera.nombre),
    );
    const nuevos = (base?.alias ?? []).filter((alias) => !usados.has(claveTolerante(alias)));
    return nuevos.length ? { ...madera, alias: [...madera.alias, ...nuevos] } : madera;
  });
}

export function validarConfiguracionCatalogo(valor: unknown): ConfiguracionCatalogo {
  const entrada = configuracionParcialSchema.parse(valor);
  const aliasPosiblesModelos = fusionarAlias(CONFIGURACION_CATALOGO_BASE.aliasPosiblesModelos, entrada.aliasPosiblesModelos);
  // Un alias dudoso manda sobre el seguro del mismo modelo: así una configuración guardada antes de
  // separarlos (con «Pillo» como alias seguro) no vuelve a sustituirlo sin preguntar.
  const aliasModelos = Object.fromEntries(
    Object.entries(fusionarAlias(CONFIGURACION_CATALOGO_BASE.aliasModelos, entrada.aliasModelos)).map(([modelo, aliases]) => {
      const dudosos = new Set(
        Object.entries(aliasPosiblesModelos)
          .filter(([otro]) => normalizarCatalogo(otro) === normalizarCatalogo(modelo))
          .flatMap(([, valores]) => valores.map(normalizarCatalogo)),
      );
      return [modelo, aliases.filter((alias) => !dudosos.has(normalizarCatalogo(alias)))];
    }),
  );
  const configuracion: ConfiguracionCatalogo = {
    maderas: entrada.maderas
      ? conAliasBase(entrada.maderas)
      : structuredClone(CONFIGURACION_CATALOGO_BASE.maderas),
    familiasPorModelo: {
      ...CONFIGURACION_CATALOGO_BASE.familiasPorModelo,
      ...entrada.familiasPorModelo,
    },
    aliasModelos,
    aliasPosiblesModelos,
  };

  const codigos = new Set<string>();
  const nombresYMaderas = new Map<string, string>();
  for (const madera of configuracion.maderas) {
    const codigo = madera.codigo.toUpperCase();
    if (codigos.has(codigo)) throw new Error(`Código de madera duplicado: ${codigo}.`);
    codigos.add(codigo);
    for (const valor of [madera.nombre, ...madera.alias]) {
      const clave = normalizarCatalogo(valor);
      const existente = nombresYMaderas.get(clave);
      if (existente && existente !== madera.nombre)
        throw new Error(`El nombre o alias de madera “${valor}” apunta a más de una madera.`);
      nombresYMaderas.set(clave, madera.nombre);
    }
  }
  const todos = [
    ...Object.entries(configuracion.aliasModelos),
    ...Object.entries(configuracion.aliasPosiblesModelos),
  ];
  for (const [modelo, aliases] of todos) {
    for (const alias of aliases) {
      const conflicto = todos.find(
        ([otro, otros]) =>
          normalizarCatalogo(otro) !== normalizarCatalogo(modelo) &&
          otros.some((valor) => normalizarCatalogo(valor) === normalizarCatalogo(alias)),
      );
      if (conflicto)
        throw new Error(`El alias de modelo “${alias}” apunta a más de un modelo.`);
    }
  }
  return configuracion;
}

/**
 * Choques que solo ve la clave tolerante: «TOLLTEN» en un modelo y «TOLTEN» en otro, o «PILO» seguro y
 * «PILLO» dudoso en el mismo. Se rechazan al guardar; una configuración ya guardada se sigue cargando
 * (los resolvers ignoran la coincidencia tolerante ambigua), para que el editor pueda corregirla.
 */
export function choqueTolerante(configuracion: ConfiguracionCatalogo): string | null {
  const maderas = new Map<string, string>();
  for (const madera of configuracion.maderas)
    for (const valor of [madera.nombre, ...madera.alias]) {
      const clave = claveTolerante(valor);
      const dueno = maderas.get(clave);
      if (dueno && dueno !== madera.nombre) return `El nombre o alias de madera “${valor}” se parece a uno de ${dueno}: el asistente no sabría cuál elegir.`;
      maderas.set(clave, madera.nombre);
    }
  const modelos = new Map<string, string>();
  for (const [modelo, aliases] of [
    ...Object.entries(configuracion.aliasModelos),
    ...Object.entries(configuracion.aliasPosiblesModelos),
  ])
    for (const valor of [modelo, ...aliases]) {
      const clave = claveTolerante(valor);
      const dueno = modelos.get(clave);
      if (dueno && normalizarCatalogo(dueno) !== normalizarCatalogo(modelo))
        return `La palabra de modelo “${valor}” se parece a una de ${dueno}: el asistente no sabría cuál elegir.`;
      modelos.set(clave, modelo);
    }
  for (const [modelo, posibles] of Object.entries(configuracion.aliasPosiblesModelos)) {
    const seguros = Object.entries(configuracion.aliasModelos)
      .filter(([otro]) => normalizarCatalogo(otro) === normalizarCatalogo(modelo))
      .flatMap(([, aliases]) => aliases.map(claveTolerante));
    const repetido = posibles.find((p) => seguros.includes(claveTolerante(p)));
    if (repetido) return `“${repetido}” de ${modelo} está, escrito parecido, en las dos columnas: déjalo solo en una.`;
  }
  return null;
}

/** Dueños (por identidad normalizada) de la clave tolerante de `valor` entre `entradas`. */
function duenosTolerantes(valor: string, entradas: [string, string[]][]) {
  const clave = claveTolerante(valor);
  if (!clave) return new Map<string, string>();
  return new Map(
    entradas.filter(([, palabras]) => palabras.some((p) => claveTolerante(p) === clave)).map(([n]) => [normalizarCatalogo(n), n]),
  );
}

/** Único dueño de la clave tolerante de `valor`; null si nadie la tiene o si la tienen dos (ambigua). */
function duenoTolerante(valor: string, entradas: [string, string[]][]) {
  const duenos = duenosTolerantes(valor, entradas);
  return duenos.size === 1 ? [...duenos.values()][0] : null;
}

/** Con `tolerante: false` solo compara exacto: así una madera real del catálogo gana a una variante. */
export const resolverMaderaConfigurada = (
  valor: string,
  configuracion: ConfiguracionCatalogo,
  { tolerante = true }: { tolerante?: boolean } = {},
) => {
  const clave = normalizarCatalogo(valor);
  const exacta = configuracion.maderas.find(
    (madera) =>
      normalizarCatalogo(madera.nombre) === clave ||
      madera.alias.some((alias) => normalizarCatalogo(alias) === clave),
  );
  if (exacta || !tolerante) return exacta?.nombre ?? null;
  return duenoTolerante(valor, configuracion.maderas.map((m) => [m.nombre, [m.nombre, ...m.alias]]));
};

/**
 * Suma las maderas de la planilla de enchapadas que la configuración aún no tenga: una guardada antes de
 * esa planilla no las trae, y el importador necesita sus códigos. Si chocan con las existentes, falla.
 */
export function conMaderasEnchapadas(configuracion: ConfiguracionCatalogo): ConfiguracionCatalogo {
  const faltan = MADERAS_ENCHAPADAS.filter((m) => resolverMaderaConfigurada(m.nombre, configuracion) !== m.nombre);
  return faltan.length
    ? validarConfiguracionCatalogo({
        ...configuracion,
        maderas: [...configuracion.maderas, ...structuredClone(faltan)],
      })
    : configuracion;
}

/**
 * Índice de nombres seguros: incluye todos los canónicos reales, aunque no tengan alias. Se construye una
 * vez para el anclaje; cada consulta compara claves ya calculadas. Un dudoso nunca habilita tolerancia segura.
 */
/**
 * Claves en singular de una clave de `normalizarCatalogo`: sin la «s» final y, si termina en «es», también sin ella
 * («MARCOS» → «MARCO»; «PANELES» → «PANELE», «PANEL»). Claves cortas no se tocan.
 */
function singularesCatalogo(clave: string) {
  return [
    ...(clave.length > 3 && clave.endsWith('S') ? [clave.slice(0, -1)] : []),
    ...(clave.length > 4 && clave.endsWith('ES') ? [clave.slice(0, -2)] : []),
  ];
}

export function crearResolverModeloConfigurado(
  configuracion: Pick<ConfiguracionCatalogo, 'aliasModelos' | 'aliasPosiblesModelos'>,
  modelos: string[] = [],
  { tolerante = true }: { tolerante?: boolean } = {},
) {
  const canonicos = new Map(modelos.map((m) => [normalizarCatalogo(m), m]));
  const exactos = new Map<string, Map<string, string>>();
  const tolerantes = new Map<string, Map<string, string>>();
  const dudososExactos = new Set<string>();
  const dudososTolerantes = new Set<string>();
  const anotar = (indice: Map<string, Map<string, string>>, clave: string, modelo: string) => {
    if (!clave) return;
    const duenos = indice.get(clave) ?? new Map<string, string>();
    duenos.set(normalizarCatalogo(modelo), modelo);
    indice.set(clave, duenos);
  };
  for (const modelo of modelos) anotar(tolerantes, claveTolerante(modelo), modelo);
  for (const [modelo, aliases] of Object.entries(configuracion.aliasModelos))
    for (const palabra of [modelo, ...aliases]) {
      anotar(exactos, normalizarCatalogo(palabra), modelo);
      anotar(tolerantes, claveTolerante(palabra), modelo);
    }
  for (const [modelo, aliases] of Object.entries(configuracion.aliasPosiblesModelos))
    for (const palabra of aliases) {
      dudososExactos.add(normalizarCatalogo(palabra));
      dudososTolerantes.add(claveTolerante(palabra));
      anotar(tolerantes, claveTolerante(palabra), modelo);
    }
  return (valor: string) => {
    const clave = normalizarCatalogo(valor);
    const canonico = canonicos.get(clave);
    if (canonico !== undefined) return { modelo: canonico, canonico: true, ambiguo: false };
    const exacto = exactos.get(clave);
    if (exacto?.size === 1 && !dudososExactos.has(clave))
      return { modelo: [...exacto.values()][0], canonico: false, ambiguo: false };
    // «marcos» o «molcos» son el plural de un modelo, no otro parecido: el singular se prueba antes de la distancia.
    if (tolerante)
      for (const singular of singularesCatalogo(clave)) {
        const deSingular = canonicos.get(singular);
        if (deSingular !== undefined) return { modelo: deSingular, canonico: false, ambiguo: false };
        const aliasSingular = exactos.get(singular);
        if (aliasSingular?.size === 1 && !dudososExactos.has(singular))
          return { modelo: [...aliasSingular.values()][0], canonico: false, ambiguo: false };
      }
    const parecidos = tolerantes.get(claveTolerante(valor));
    const ambiguo = (exacto?.size ?? 0) > 1 || (parecidos?.size ?? 0) > 1;
    const modelo = tolerante && !ambiguo && !dudososTolerantes.has(claveTolerante(valor)) && parecidos?.size === 1
      ? [...parecidos.values()][0]
      : valor;
    return { modelo, canonico: false, ambiguo };
  };
}

export const resolverModeloConfigurado = (
  valor: string,
  configuracion: ConfiguracionCatalogo,
  modelos: string[] = [],
  opciones: { tolerante?: boolean } = {},
) => crearResolverModeloConfigurado(configuracion, modelos, opciones)(valor).modelo;

/** Modelo al que podría referirse un alias dudoso; null si el valor no figura entre ellos. */
export const resolverModeloPosibleConfigurado = (valor: string, configuracion: ConfiguracionCatalogo) => {
  const clave = normalizarCatalogo(valor);
  const exacta = Object.entries(configuracion.aliasPosiblesModelos).find(([, aliases]) =>
    aliases.some((alias) => normalizarCatalogo(alias) === clave),
  );
  return exacta ? exacta[0] : duenoTolerante(valor, Object.entries(configuracion.aliasPosiblesModelos));
};

/** Distancia de Damerau-Levenshtein con transposición adyacente; basta saber si supera 1. */
function distanciaDamerau(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/**
 * Modelo al que `valor` se parece a lo más a una letra o una transposición, comparando claves tolerantes
 * contra los modelos del catálogo (`modelos`), los configurados y sus alias seguros. Devuelve null si la
 * clave es muy corta (a esa distancia casi cualquier palabra se parecería) o si más de un modelo queda
 * igual de cerca. Las claves iguales se resuelven antes, como coincidencias tolerantes seguras.
 */
export function modeloParecido(valor: string, configuracion: ConfiguracionCatalogo, modelos: string[] = []): string | null {
  // El plural de un modelo o de un alias seguro es ese modelo (`crearResolverModeloConfigurado`), no uno posible.
  const singulares = singularesCatalogo(normalizarCatalogo(valor));
  const conocidos = [...modelos, ...Object.entries(configuracion.aliasModelos).flatMap(([m, a]) => [m, ...a])];
  if (conocidos.some((palabra) => singulares.includes(normalizarCatalogo(palabra)))) return null;
  const clave = claveTolerante(valor);
  if (clave.length < 5) return null;
  const candidatos = new Map<string, string>();
  const probar = (palabra: string, modelo: string) => {
    const otra = claveTolerante(palabra);
    if (clave !== otra && distanciaDamerau(clave, otra) <= 1) candidatos.set(normalizarCatalogo(modelo), modelo);
  };
  for (const modelo of modelos) probar(modelo, modelo);
  for (const [modelo, aliases] of Object.entries(configuracion.aliasModelos)) {
    probar(modelo, modelo);
    for (const alias of aliases) probar(alias, modelo);
  }
  for (const modelo of Object.keys(configuracion.aliasPosiblesModelos)) probar(modelo, modelo);
  return candidatos.size === 1 ? [...candidatos.values()][0] : null;
}

export const aliasMaderasConfiguradas = (configuracion: ConfiguracionCatalogo) =>
  Object.fromEntries(configuracion.maderas.map((madera) => [madera.nombre, madera.alias]));

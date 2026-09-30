import { z } from 'zod';
import type { Familia } from './tipos';

export const normalizarCatalogo = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** Presentación estable del nombre que se guarda en todos los documentos y consultas. */
export const nombreCanonicoModelo = (s: string) =>
  normalizarCatalogo(s) === 'HUILOHUILO' ? 'Huilo Huilo' : s;

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
export const MADERAS_ENCHAPADAS: MaderaConfigurada[] = [
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
    'HUILO HUILO': ['HUILO', 'HUILA', 'WILLO', 'WILLOW', 'HUILO HUILA', 'WILLOW WILLOW'],
    PANGUIPULLI: ['PANGIPULLI'],
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
    maderas: entrada.maderas ?? structuredClone(CONFIGURACION_CATALOGO_BASE.maderas),
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

export const resolverMaderaConfigurada = (valor: string, configuracion: ConfiguracionCatalogo) => {
  const clave = normalizarCatalogo(valor);
  return (
    configuracion.maderas.find(
      (madera) =>
        normalizarCatalogo(madera.nombre) === clave ||
        madera.alias.some((alias) => normalizarCatalogo(alias) === clave),
    )?.nombre ?? null
  );
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

export const resolverModeloConfigurado = (valor: string, configuracion: ConfiguracionCatalogo) => {
  const clave = normalizarCatalogo(valor);
  const entrada = Object.entries(configuracion.aliasModelos).find(
    ([modelo, aliases]) =>
      normalizarCatalogo(modelo) === clave || aliases.some((alias) => normalizarCatalogo(alias) === clave),
  );
  return entrada?.[0] ?? valor;
};

/** Modelo al que podría referirse un alias dudoso; null si el valor no figura entre ellos. */
export const resolverModeloPosibleConfigurado = (valor: string, configuracion: ConfiguracionCatalogo) => {
  const clave = normalizarCatalogo(valor);
  return (
    Object.entries(configuracion.aliasPosiblesModelos).find(([, aliases]) =>
      aliases.some((alias) => normalizarCatalogo(alias) === clave),
    )?.[0] ?? null
  );
};

export const aliasMaderasConfiguradas = (configuracion: ConfiguracionCatalogo) =>
  Object.fromEntries(configuracion.maderas.map((madera) => [madera.nombre, madera.alias]));

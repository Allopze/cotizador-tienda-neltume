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
  aliasModelos: Record<string, string[]>;
}

export const CONFIGURACION_CATALOGO_BASE: ConfiguracionCatalogo = {
  maderas: [
    { nombre: 'PINO OREGON', codigo: 'O', alias: ['PINO', 'OREGON'] },
    { nombre: 'LENGA', codigo: 'L', alias: [] },
    { nombre: 'MARA', codigo: 'M', alias: [] },
    { nombre: 'RAULI', codigo: 'R', alias: ['RAULÍ'] },
  ],
  familiasPorModelo: {
    MARCO: 'MARCO',
    'PIEZAS T': 'PIEZAS_T',
    ENDOLADO: 'MOLDURA',
    GUARDAPOLVO: 'MOLDURA',
    PILASTRA: 'MOLDURA',
  },
  aliasModelos: {
    'HUILO HUILO': ['HUILO', 'HUILA', 'WILLO', 'WILLOW', 'PILLO', 'HUILO HUILA', 'WILLOW WILLOW'],
    PANGUIPULLI: ['PANGIPULLI'],
  },
};

export function validarConfiguracionCatalogo(valor: unknown): ConfiguracionCatalogo {
  const entrada = configuracionParcialSchema.parse(valor);
  const aliasModelos: Record<string, string[]> = { ...CONFIGURACION_CATALOGO_BASE.aliasModelos };
  for (const [modelo, aliases] of Object.entries(entrada.aliasModelos ?? {})) {
    const existente = Object.keys(aliasModelos).find((clave) => normalizarCatalogo(clave) === normalizarCatalogo(modelo));
    const clave = existente ?? modelo;
    aliasModelos[clave] = [...new Set([...(aliasModelos[clave] ?? []), ...aliases])];
  }
  const configuracion: ConfiguracionCatalogo = {
    maderas: entrada.maderas ?? structuredClone(CONFIGURACION_CATALOGO_BASE.maderas),
    familiasPorModelo: {
      ...CONFIGURACION_CATALOGO_BASE.familiasPorModelo,
      ...entrada.familiasPorModelo,
    },
    aliasModelos,
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
  for (const [modelo, aliases] of Object.entries(configuracion.aliasModelos)) {
    for (const alias of aliases) {
      const conflicto = Object.entries(configuracion.aliasModelos).find(
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

export const resolverModeloConfigurado = (valor: string, configuracion: ConfiguracionCatalogo) => {
  const clave = normalizarCatalogo(valor);
  const entrada = Object.entries(configuracion.aliasModelos).find(
    ([modelo, aliases]) =>
      normalizarCatalogo(modelo) === clave || aliases.some((alias) => normalizarCatalogo(alias) === clave),
  );
  return entrada?.[0] ?? valor;
};

export const aliasMaderasConfiguradas = (configuracion: ConfiguracionCatalogo) =>
  Object.fromEntries(configuracion.maderas.map((madera) => [madera.nombre, madera.alias]));

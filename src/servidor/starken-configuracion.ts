import type Database from 'better-sqlite3';
import { z } from 'zod';
import { parametrosVacios, type ConfiguracionStarken } from '../negocio/starken';
import { abrirBaseDatos } from './base-datos';

// Ajustes de Starken que define la empresa: ciudad de origen y, como el catálogo no trae pesos, el peso y el
// grosor por unidad de cada familia. Vacíos de fábrica: no se inventa ningún peso. Las credenciales NO van aquí.

const CLAVE = 'starken';
const medida = (max: number) =>
  z.number({ error: 'Indica un número.' }).finite().positive().max(max).nullable();
const familiaSchema = z
  .object({
    kg: medida(2000).default(null),
    espesorCm: medida(300).default(null),
  })
  .strict();
export const configuracionStarkenSchema = z
  .object({
    origen: z
      .object({
        codigoCiudad: z.number().int().positive(),
        nombre: z.string().trim().min(1).max(120),
      })
      .strict()
      .nullable()
      .default(null),
    paquete: z
      .object({
        PUERTA: familiaSchema.default(() => ({ kg: null, espesorCm: null })),
        MARCO: familiaSchema.default(() => ({ kg: null, espesorCm: null })),
        MOLDURA: familiaSchema.default(() => ({ kg: null, espesorCm: null })),
        PIEZAS_T: familiaSchema.default(() => ({ kg: null, espesorCm: null })),
      })
      .strict()
      .default(parametrosVacios),
  })
  .strict();

export type { ConfiguracionStarken };

export const configuracionStarkenVacia = (): ConfiguracionStarken => ({
  origen: null,
  paquete: parametrosVacios(),
});

export function leerConfiguracionStarken(db: Database.Database = abrirBaseDatos()): ConfiguracionStarken {
  const fila = db.prepare('SELECT valor_json FROM ajustes WHERE clave = ?').get(CLAVE) as
    { valor_json: string } | undefined;
  if (!fila) return configuracionStarkenVacia();
  try {
    return configuracionStarkenSchema.parse(JSON.parse(fila.valor_json));
  } catch {
    return configuracionStarkenVacia();
  }
}

export function guardarConfiguracionStarken(
  configuracion: ConfiguracionStarken,
  db: Database.Database = abrirBaseDatos(),
) {
  const valida = configuracionStarkenSchema.parse(configuracion);
  db.prepare(
    `INSERT INTO ajustes (clave, valor_json, actualizada) VALUES (?, ?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor_json = excluded.valor_json, actualizada = excluded.actualizada`,
  ).run(CLAVE, JSON.stringify(valida), new Date().toISOString());
  return valida;
}

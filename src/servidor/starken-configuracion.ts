import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { FamiliaCatalogo } from '../catalogo/tipos';
import {
  ETIQUETA_FAMILIA,
  MAX_ESPESOR_CM,
  MAX_KG_UNIDAD,
  parametrosVacios,
  type ConfiguracionStarken,
} from '../negocio/starken';
import { abrirBaseDatos } from './base-datos';

// Ajustes de Starken que define la empresa: ciudad de origen y, opcionalmente, el peso y el grosor medidos por
// unidad de cada familia. Vacíos de fábrica: sin ellos se estiman por producto. Las credenciales NO van aquí.

const CLAVE = 'starken';
const pesoKg = z
  .number({ error: 'El peso por unidad debe ser un número.' })
  .positive('El peso por unidad debe ser mayor que cero.')
  .max(MAX_KG_UNIDAD, `El peso por unidad no puede superar ${MAX_KG_UNIDAD.toLocaleString('es-CL')} kg.`)
  .nullable();
const espesorCm = z
  .number({ error: 'El espesor debe ser un número.' })
  .positive('El espesor debe ser mayor que cero.')
  .max(MAX_ESPESOR_CM, `El espesor no puede superar ${MAX_ESPESOR_CM} cm.`)
  .nullable();
const familiaSchema = z
  .object({ kg: pesoKg, espesorCm })
  .strict()
  // Con uno solo de los dos datos el bulto no se puede calcular: se pide completarlos o dejar ambos vacíos.
  .refine(
    (f) => (f.kg === null) === (f.espesorCm === null),
    'Completa el peso y el espesor, o deja ambos vacíos.',
  );
/**
 * Lo que se guarda y lo que acepta la API: siempre completo (origen y las cuatro familias, aunque vayan vacías), para
 * que un cuerpo vacío o a medias no borre la configuración sin querer.
 */
export const configuracionStarkenSchema = z
  .object({
    origen: z
      .object({
        codigoCiudad: z.number().int().positive('El código de la ciudad de origen no es válido.'),
        nombre: z.string().trim().min(1).max(120),
      })
      .strict()
      .nullable(),
    paquete: z
      .object({
        PUERTA: familiaSchema,
        MARCO: familiaSchema,
        MOLDURA: familiaSchema,
        PIEZAS_T: familiaSchema,
      })
      .strict(),
  })
  .strict();

/** Primer problema de una configuración rechazada, con la familia por delante: «Puertas: El espesor debe…». */
export function mensajeErrorConfiguracion(error: z.ZodError) {
  const [problema] = error.issues;
  if (!problema) return 'Configuración inválida.';
  const [, familia] = problema.path;
  const etiqueta = typeof familia === 'string' ? ETIQUETA_FAMILIA[familia as FamiliaCatalogo] : undefined;
  // Un peso o espesor que no es número tiene su mensaje; falta un bloque entero o sobra una clave: está incompleta.
  const esMedida = ['kg', 'espesorCm'].includes(String(problema.path.at(-1)));
  if ((problema.code === 'invalid_type' && !esMedida) || problema.code === 'unrecognized_keys')
    return `Configuración incompleta o inválida${etiqueta ? ` (${etiqueta.toLowerCase()})` : ''}: envía el origen y el peso y el espesor de cada familia, o null si no se definen.`;
  return etiqueta ? `${etiqueta}: ${problema.message}` : problema.message;
}

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

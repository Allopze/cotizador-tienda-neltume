import type Database from 'better-sqlite3';
import { z } from 'zod';
import { REGLAS, type ReglasComerciales } from '../negocio/precios';
import { abrirBaseDatos } from './base-datos';
import type { DatosEmpresa } from './empresa';

const texto = (max: number) => z.string().trim().max(max).nullable();
const logoSvg = z
  .string()
  .max(48_000)
  .refine((valor) => /<svg(?:\s|>)/i.test(valor), 'El logo debe ser un SVG válido.')
  .refine(
    (valor) => !/<script|<foreignObject|\son\w+\s*=|javascript:/i.test(valor),
    'El SVG contiene contenido no permitido.',
  )
  .nullable();

export const configuracionNegocioSchema = z
  .object({
    empresa: z
      .object({
        nombre: texto(200),
        rut: texto(50),
        direccion: texto(300),
        telefono: texto(80),
        correo: z.string().trim().email().max(254),
        web: texto(200),
        condicionesPago: texto(1000),
        plazoEntrega: texto(1000),
        datosBancarios: texto(1200),
        logoSvg,
      })
      .strict(),
    reglas: z
      .object({
        ajuste: z.number().finite().min(-0.5).max(1),
        iva: z.number().finite().min(0).max(1),
        vigenciaDiasHabiles: z.number().int().min(0).max(365),
        descuentoMaximo: z.number().finite().min(0).max(100),
      })
      .strict(),
  })
  .strict();

export interface ConfiguracionNegocio {
  empresa: DatosEmpresa;
  reglas: ReglasComerciales;
}

const leerEntorno = (clave: string) => process.env[clave]?.trim() || null;

export const CORREO_PREDETERMINADO_NEGOCIO = 'Neltume.co@gmail.com';

export function configuracionNegocioPredeterminada(): ConfiguracionNegocio {
  return {
    empresa: {
      nombre: leerEntorno('NELTUME_EMPRESA_NOMBRE'),
      rut: leerEntorno('NELTUME_EMPRESA_RUT'),
      direccion: leerEntorno('NELTUME_EMPRESA_DIRECCION'),
      telefono: leerEntorno('NELTUME_EMPRESA_TELEFONO'),
      correo: leerEntorno('NELTUME_EMPRESA_CORREO') ?? CORREO_PREDETERMINADO_NEGOCIO,
      web: leerEntorno('NELTUME_EMPRESA_WEB'),
      condicionesPago: leerEntorno('NELTUME_CONDICIONES_PAGO'),
      plazoEntrega: leerEntorno('NELTUME_PLAZO_ENTREGA'),
      datosBancarios: leerEntorno('NELTUME_DATOS_BANCARIOS'),
      logoSvg: null,
    },
    reglas: { ...REGLAS },
  };
}

function validarConfiguracion(valor: unknown, respaldo: ConfiguracionNegocio) {
  const parcial = valor as Partial<ConfiguracionNegocio> | null;
  return configuracionNegocioSchema.parse({
    empresa: { ...respaldo.empresa, ...(parcial?.empresa ?? {}) },
    reglas: { ...respaldo.reglas, ...(parcial?.reglas ?? {}) },
  });
}

export function leerConfiguracionNegocio(db: Database.Database = abrirBaseDatos()): ConfiguracionNegocio {
  const respaldo = configuracionNegocioPredeterminada();
  const fila = db.prepare('SELECT valor_json FROM ajustes WHERE clave = ?').get('negocio') as
    | { valor_json: string }
    | undefined;
  if (!fila) return respaldo;
  try {
    return validarConfiguracion(JSON.parse(fila.valor_json), respaldo);
  } catch {
    return respaldo;
  }
}

export function guardarConfiguracionNegocio(
  configuracion: ConfiguracionNegocio,
  db: Database.Database = abrirBaseDatos(),
) {
  const valida = configuracionNegocioSchema.parse(configuracion);
  db.prepare(
    `INSERT INTO ajustes (clave, valor_json, actualizada) VALUES (?, ?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor_json = excluded.valor_json, actualizada = excluded.actualizada`,
  ).run('negocio', JSON.stringify(valida), new Date().toISOString());
  return valida;
}

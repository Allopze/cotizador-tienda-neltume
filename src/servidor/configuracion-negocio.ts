import type Database from 'better-sqlite3';
import { z } from 'zod';
import { errorTramos, MAX_TRAMOS, ordenarTramos } from '../negocio/descuento-cantidad';
import { MARGENES_INICIALES, REGLAS, type ReglasComerciales } from '../negocio/precios';
import { abrirBaseDatos } from './base-datos';
import type { DatosEmpresa } from './empresa';

const texto = (max: number) => z.string().trim().max(max).nullable();
const TRANSPORTISTAS_INICIALES = ['Starken', 'Transportes Paredes', 'Ignacio', 'Otro'];
const tramoDescuento = z
  .object({
    desdePuertas: z.number({ error: '«Desde» debe ser un número entero de puertas.' }),
    porcentaje: z.number({ error: 'El porcentaje del tramo debe ser un número.' }),
  })
  .strict();
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
    transportistas: z.array(z.string().trim().min(1).max(120)).max(30)
      .refine((lista) => new Set(lista.map((x) => x.toLocaleLowerCase())).size === lista.length)
      .default(TRANSPORTISTAS_INICIALES),
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
        // Vacío por omisión: una configuración guardada antes de esta regla no aplica descuento por cantidad.
        // Se guardan de menor a mayor umbral; la validación (umbrales distintos, porcentaje hasta el máximo)
        // se hace abajo porque depende de `descuentoMaximo`.
        descuentosPorCantidad: z
          .array(tramoDescuento)
          .max(MAX_TRAMOS, `Puedes definir hasta ${MAX_TRAMOS} tramos.`)
          .default([])
          .transform(ordenarTramos),
        margenes: z.object({
          puertas_solidas_mara_lenga: z.number().finite().min(0).max(5),
          puertas_solidas_oregon: z.number().finite().min(0).max(5),
          // Categorías posteriores a la primera versión: un ajuste guardado sin ellas recibe su valor inicial.
          puertas_solidas_rauli: z.number().finite().min(0).max(5).default(MARGENES_INICIALES.puertas_solidas_rauli),
          puertas_prepintadas: z.number().finite().min(0).max(5),
          puertas_enchapadas_mara: z.number().finite().min(0).max(5),
          marcos_finger_sin_enchape: z.number().finite().min(0).max(5),
          marcos_finger_enchapados: z.number().finite().min(0).max(5),
          accesorios_madera_solida: z.number().finite().min(0).max(5).default(MARGENES_INICIALES.accesorios_madera_solida),
          otros: z.number().finite().min(0).max(5),
        }).strict(),
      })
      .strict()
      .superRefine((reglas, ctx) => {
        const problema = errorTramos(reglas.descuentosPorCantidad, reglas.descuentoMaximo);
        if (problema) ctx.addIssue({ code: 'custom', message: problema, path: ['descuentosPorCantidad'] });
      }),
  })
  .strict();

export interface ConfiguracionNegocio {
  empresa: DatosEmpresa;
  reglas: ReglasComerciales;
  transportistas: string[];
}

const leerEntorno = (clave: string) => process.env[clave]?.trim() || null;

export const CORREO_PREDETERMINADO_NEGOCIO = 'Neltume.co@gmail.com';

export function configuracionNegocioPredeterminada(): ConfiguracionNegocio {
  return {
    transportistas: [...TRANSPORTISTAS_INICIALES],
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
    reglas: { ...REGLAS, descuentosPorCantidad: [], margenes: { ...MARGENES_INICIALES } },
  };
}

function validarConfiguracion(valor: unknown, respaldo: ConfiguracionNegocio) {
  const parcial = valor as Partial<ConfiguracionNegocio> | null;
  const reglasParciales = parcial?.reglas as Partial<ReglasComerciales> | undefined;
  return configuracionNegocioSchema.parse({
    transportistas: parcial?.transportistas ?? respaldo.transportistas,
    empresa: { ...respaldo.empresa, ...(parcial?.empresa ?? {}) },
    reglas: {
      ...respaldo.reglas,
      ...(reglasParciales ?? {}),
      margenes: { ...respaldo.reglas.margenes, ...(reglasParciales?.margenes ?? {}) },
    },
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

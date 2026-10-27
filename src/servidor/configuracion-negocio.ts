import type Database from 'better-sqlite3';
import { z } from 'zod';
import { errorTramos, MAX_TRAMOS, ordenarTramos } from '../negocio/descuento-cantidad';
import { MARGENES_INICIALES, REGLAS, type ReglasComerciales } from '../negocio/precios';
import { AJUSTE_MAX, AJUSTE_MIN, MARGEN_MAX, DESCUENTO_MAXIMO } from '../negocio/limites';
import { abrirBaseDatos } from './base-datos';
import { ErrorConflicto } from './errores';
import { problemaSvg } from './svg-seguro';
import { tramoDescuentoSchema } from './persistencia-esquemas';
import type { DatosEmpresa } from './empresa';

const texto = (max: number) => z.string().trim().max(max).nullable();
const TRANSPORTISTAS_INICIALES = ['Starken', 'Transportes Paredes', 'Ignacio', 'Otro'];
// El logo se valida con un parser y una lista de elementos y atributos de dibujo permitidos (svg-seguro.ts).
const logoSvg = z
  .string()
  .max(48_000)
  .superRefine((valor, ctx) => {
    const problema = problemaSvg(valor);
    if (problema) ctx.addIssue({ code: 'custom', message: problema });
  })
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
        ajuste: z.number().finite().min(AJUSTE_MIN).max(AJUSTE_MAX),
        // Mensajes propios: la API los devuelve tal cual y el genérico de zod llega en inglés («Too big: …»).
        iva: z.number().finite().min(0, 'El IVA no puede ser negativo.').max(1, 'El IVA no puede superar 100 %.'),
        vigenciaDiasHabiles: z
          .number()
          .int('La vigencia debe ser un número entero de días hábiles.')
          .min(0, 'La vigencia no puede ser negativa.')
          .max(365, 'La vigencia no puede superar 365 días hábiles.'),
        descuentoMaximo: z
          .number()
          .finite()
          .min(0, 'El descuento máximo no puede ser negativo.')
          .max(DESCUENTO_MAXIMO, `El descuento máximo no puede superar ${DESCUENTO_MAXIMO} %.`),
        // Vacío por omisión: una configuración guardada antes de esta regla no aplica descuento por cantidad.
        // Se guardan de menor a mayor umbral; la validación (umbrales distintos, porcentaje hasta el máximo)
        // se hace abajo porque depende de `descuentoMaximo`.
        descuentosPorCantidad: z
          .array(tramoDescuentoSchema.strict())
          .max(MAX_TRAMOS, `Puedes definir hasta ${MAX_TRAMOS} tramos.`)
          .default([])
          .transform(ordenarTramos),
        margenes: z.object({
          puertas_solidas_mara_lenga: z.number().finite().min(0).max(MARGEN_MAX),
          puertas_solidas_oregon: z.number().finite().min(0).max(MARGEN_MAX),
          // Categorías posteriores a la primera versión: un ajuste guardado sin ellas recibe su valor inicial.
          puertas_solidas_rauli: z.number().finite().min(0).max(MARGEN_MAX).default(MARGENES_INICIALES.puertas_solidas_rauli),
          puertas_prepintadas: z.number().finite().min(0).max(MARGEN_MAX),
          puertas_enchapadas_mara: z.number().finite().min(0).max(MARGEN_MAX),
          marcos_finger_sin_enchape: z.number().finite().min(0).max(MARGEN_MAX),
          marcos_finger_enchapados: z.number().finite().min(0).max(MARGEN_MAX),
          marcos_solidos_oregon: z.number().finite().min(0).max(MARGEN_MAX).default(MARGENES_INICIALES.marcos_solidos_oregon),
          marcos_solidos_lenga: z.number().finite().min(0).max(MARGEN_MAX).default(MARGENES_INICIALES.marcos_solidos_lenga),
          accesorios_madera_solida: z.number().finite().min(0).max(MARGEN_MAX).default(MARGENES_INICIALES.accesorios_madera_solida),
          otros: z.number().finite().min(0).max(MARGEN_MAX),
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

const CORREO_PREDETERMINADO_NEGOCIO = 'neltume.co@gmail.com';

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

/**
 * Un logo guardado antes de la validación con parser puede no pasarla: se descarta solo el logo (vuelve el
 * predeterminado) en vez de perder toda la configuración del negocio.
 */
function logoGuardado(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const problema = valor.length > 48_000 ? 'excede el tamaño máximo' : problemaSvg(valor);
  if (!problema) return valor;
  console.error('[configuracion-negocio] se ignora el logo guardado:', problema);
  return null;
}

function validarConfiguracion(valor: unknown, respaldo: ConfiguracionNegocio) {
  const parcial = valor as Partial<ConfiguracionNegocio> | null;
  const reglasParciales = parcial?.reglas as Partial<ReglasComerciales> | undefined;
  return configuracionNegocioSchema.parse({
    transportistas: parcial?.transportistas ?? respaldo.transportistas,
    empresa: { ...respaldo.empresa, ...(parcial?.empresa ?? {}), logoSvg: logoGuardado(parcial?.empresa?.logoSvg) },
    reglas: {
      ...respaldo.reglas,
      ...(reglasParciales ?? {}),
      descuentoMaximo: Math.min(reglasParciales?.descuentoMaximo ?? respaldo.reglas.descuentoMaximo, DESCUENTO_MAXIMO),
      descuentosPorCantidad: (reglasParciales?.descuentosPorCantidad ?? respaldo.reglas.descuentosPorCantidad)?.map((t) => ({ ...t, porcentaje: Math.min(t.porcentaje, reglasParciales?.descuentoMaximo ?? DESCUENTO_MAXIMO, DESCUENTO_MAXIMO) })),
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

/** Versión de la configuración guardada: cambia con cada escritura y sirve para detectar dos guardados a la vez. */
export function versionConfiguracionNegocio(db: Database.Database = abrirBaseDatos()): string | null {
  const fila = db.prepare('SELECT actualizada FROM ajustes WHERE clave = ?').get('negocio') as
    | { actualizada: string }
    | undefined;
  return fila?.actualizada ?? null;
}

/**
 * Guarda la configuración. Con `esperada`, exige que sea la versión que la persona vio: si otra guardó antes,
 * responde 409 en vez de pisar sus cambios (auditoría BUG-023). La comprobación y la escritura van en la misma
 * transacción, así dos guardados simultáneos no pueden pasar los dos.
 */
export function guardarConfiguracionNegocio(
  configuracion: ConfiguracionNegocio,
  db: Database.Database = abrirBaseDatos(),
  esperada?: string | null,
) {
  const valida = configuracionNegocioSchema.parse(configuracion);
  db.transaction(() => {
    const anterior = versionConfiguracionNegocio(db);
    if (esperada !== undefined && esperada !== anterior)
      throw new ErrorConflicto(
        'Otra persona guardó la configuración antes que tú. Recarga y vuelve a aplicar tus cambios.',
        'version_obsoleta',
      );
    // Estrictamente posterior a la anterior, aunque dos guardados caigan en el mismo milisegundo.
    const sello = new Date(Math.max(Date.now(), anterior ? Date.parse(anterior) + 1 : 0)).toISOString();
    db.prepare(
      `INSERT INTO ajustes (clave, valor_json, actualizada) VALUES (?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor_json = excluded.valor_json, actualizada = excluded.actualizada`,
    ).run('negocio', JSON.stringify(valida), sello);
  }).immediate();
  return valida;
}

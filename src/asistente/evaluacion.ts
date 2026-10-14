import { z } from 'zod';
import { metros, normalizar, normalizarMedida } from '../catalogo/resolver';
import type { Cliente, SolicitudItem } from '../catalogo/tipos';

/**
 * Evaluación de la IA con casos reales: cada caso es una conversación (uno o más mensajes) y el pedido que
 * debería quedar. Se mide campo por campo, porque «casi bien» no sirve en una cotización.
 */
const itemEsperado = z
  .object({
    modelo: z.string().nullable(),
    madera: z.string().nullable(),
    ancho: z.number().nullable(),
    alto: z.number().nullable(),
    medida: z.string().nullable(),
    cantidad: z.number().int().nullable(),
    tipoMedida: z.enum(['hoja', 'vano']).nullable().optional(),
    /** Precio neto escrito por la persona; ausente es que no escribió ninguno (y la IA no debe inventarlo). */
    precioUnitario: z.number().int().nullable().optional(),
    /** Descuento especial pedido por la persona; ausente es que no pidió ninguno (y la IA no debe inventarlo). */
    descuento: z
      .object({ tipo: z.enum(['porcentaje', 'monto']), valor: z.number().positive() })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
/** Línea de flete: valor neto de una unidad y unidades. */
const fleteEsperado = z
  .object({ unitario: z.number().int().positive(), cantidad: z.number().int().positive() })
  .strict();
export const casoSchema = z
  .object({
    id: z.string().min(1),
    /** Qué pone a prueba («alias de voz», «no inventar el alto»). */
    descripcion: z.string().min(1),
    mensajes: z.array(z.string().min(1)).min(1),
    esperado: z
      .object({
        items: z.array(itemEsperado),
        /** Ausente es que no se pidió flete (y la IA no debe inventarlo). */
        flete: fleteEsperado.optional(),
        cliente: z
          .object({
            nombre: z.string().nullable().optional(),
            rut: z.string().nullable().optional(),
            giro: z.string().nullable().optional(),
            telefono: z.string().nullable().optional(),
            direccion: z.string().nullable().optional(),
            comuna: z.string().nullable().optional(),
            proyecto: z.string().nullable().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();
export const casosSchema = z.array(casoSchema).min(1);
export type CasoEvaluacion = z.infer<typeof casoSchema>;

export const CAMPOS_ITEM = [
  'modelo',
  'madera',
  'ancho',
  'alto',
  'medida',
  'cantidad',
  'tipoMedida',
  'precioUnitario',
  'descuento',
] as const;
type CampoItem = (typeof CAMPOS_ITEM)[number];

function igual(campo: CampoItem, esperado: unknown, obtenido: unknown) {
  const vacio = (v: unknown) => v === null || v === undefined || v === 'no_especificado';
  if (vacio(esperado) || vacio(obtenido)) return vacio(esperado) && vacio(obtenido);
  if (campo === 'ancho' || campo === 'alto') {
    // El largo de un accesorio llega a 6 m: si como puerta no se lee, se compara con ese rango.
    const comparar = (familia: string) => {
      const a = metros(Number(esperado), familia),
        b = metros(Number(obtenido), familia);
      return a !== null && b !== null && Math.abs(a - b) < 5e-4;
    };
    return comparar('PUERTA') || (campo === 'alto' && comparar('MOLDURA'));
  }
  if (campo === 'medida') return normalizarMedida(String(esperado)) === normalizarMedida(String(obtenido));
  if (campo === 'cantidad' || campo === 'precioUnitario') return Number(esperado) === Number(obtenido);
  if (campo === 'descuento') {
    const [a, b] = [esperado, obtenido] as { tipo: string; valor: number }[];
    return a.tipo === b.tipo && a.valor === b.valor;
  }
  return normalizar(String(esperado)) === normalizar(String(obtenido));
}

export interface Diferencia {
  item: number | null;
  campo: string;
  esperado: unknown;
  obtenido: unknown;
}
export interface ResultadoCaso {
  id: string;
  aciertos: number;
  total: number;
  diferencias: Diferencia[];
}

/**
 * Compara el pedido obtenido con el esperado. Los ítems se comparan en orden; un ítem que sobra o falta
 * cuenta todos sus campos como errores. Del cliente solo se miden los campos que el caso declara. El flete se
 * mide si se entrega el obtenido: el esperado cuenta su valor y su cantidad, y uno que no se pidió es un error.
 */
export function puntuar(
  caso: CasoEvaluacion,
  obtenido: {
    items: SolicitudItem[];
    cliente: Cliente;
    flete?: { unitario: number; cantidad: number } | null;
  },
): ResultadoCaso {
  const diferencias: Diferencia[] = [];
  let aciertos = 0,
    total = 0;
  const largo = Math.max(caso.esperado.items.length, obtenido.items.length);
  for (let i = 0; i < largo; i++) {
    const e = caso.esperado.items[i],
      o = obtenido.items[i];
    for (const campo of CAMPOS_ITEM) {
      total++;
      const ve = e?.[campo] ?? null,
        vo = o?.[campo] ?? null;
      if (e && o && igual(campo, ve, vo)) aciertos++;
      else
        diferencias.push({
          item: i + 1,
          campo,
          esperado: e ? ve : '(no debía existir)',
          obtenido: o ? vo : '(falta)',
        });
    }
  }
  for (const [campo, esperado] of Object.entries(caso.esperado.cliente ?? {})) {
    total++;
    const valor = obtenido.cliente[campo as keyof Cliente];
    const ok =
      (esperado ?? null) === null ? !valor : !!valor && normalizar(valor) === normalizar(String(esperado));
    if (ok) aciertos++;
    else diferencias.push({ item: null, campo: `cliente.${campo}`, esperado, obtenido: valor });
  }
  if (obtenido.flete !== undefined) {
    const e = caso.esperado.flete ?? null,
      o = obtenido.flete;
    if (!e) {
      if (o) {
        total++;
        diferencias.push({ item: null, campo: 'flete', esperado: '(sin flete)', obtenido: o });
      }
    } else
      for (const campo of ['unitario', 'cantidad'] as const) {
        total++;
        if (o?.[campo] === e[campo]) aciertos++;
        else
          diferencias.push({
            item: null,
            campo: `flete.${campo}`,
            esperado: e[campo],
            obtenido: o ? o[campo] : '(falta)',
          });
      }
  }
  return { id: caso.id, aciertos, total, diferencias };
}

/** Precisión de una serie de casos: proporción de campos correctos y casos perfectos. */
export function resumen(resultados: ResultadoCaso[]) {
  const aciertos = resultados.reduce((s, r) => s + r.aciertos, 0),
    total = resultados.reduce((s, r) => s + r.total, 0);
  return {
    precision: total ? aciertos / total : 0,
    perfectos: resultados.filter((r) => !r.diferencias.length).length,
    casos: resultados.length,
  };
}

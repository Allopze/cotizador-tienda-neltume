import { z } from 'zod';
import { metros, normalizar, normalizarMedida } from '../catalogo/resolver';
import type { Cliente, SolicitudItem } from '../catalogo/tipos';
import type { CategoriaAviso } from '../servidor/servicio';
import { FABRICAS } from '../negocio/estado';

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
    /** Fábrica que dijo la persona; ausente es que no la dijo (y la IA no debe deducirla). */
    fabrica: z.enum(FABRICAS).nullable().optional(),
  })
  .strict();
/** Línea de flete: valor neto de una unidad y unidades. */
const fleteEsperado = z
  .object({ unitario: z.number().int().positive(), cantidad: z.number().int().positive() })
  .strict();
/**
 * Categorías de los avisos al evaluar: las del servicio (`CategoriaAviso`) más `precio` y `flete`, que el servicio
 * deja en `otros`. Ver `categoriaEvaluada`.
 */
const CATEGORIAS_AVISO = [
  'campo',
  'palabra',
  'cifras',
  'nombres',
  'noRegistre',
  'responder',
  'precio',
  'flete',
  'otros',
] as const satisfies readonly (CategoriaAviso | 'precio' | 'flete')[];
export type CategoriaEvaluada = (typeof CATEGORIAS_AVISO)[number];
/** Si el servicio agrega una categoría, esta lista debe conocerla: sin ella falla la compilación. */
export const categoriasDelServicio = (c: CategoriaAviso): CategoriaEvaluada => c;

/**
 * Aviso que el chat debe mostrar (o no, con `ausente`): por su categoría, por un texto que contiene (sin tildes ni
 * mayúsculas), o ambos.
 */
const avisoEsperado = z
  .object({
    categoria: z.enum(CATEGORIAS_AVISO).optional(),
    texto: z.string().min(1).optional(),
    /** El aviso no debe aparecer (p. ej. «parece un pedido» ante un mensaje que no lo es). */
    ausente: z.literal(true).optional(),
  })
  .strict()
  .refine((a) => a.categoria !== undefined || a.texto !== undefined, 'Indica la categoría o el texto del aviso.');
/** Pregunta que debe quedar pendiente: el ítem (desde 1) y, si se indica, el campo que pregunta (null: sin dato). */
const pendienteEsperado = z
  .object({
    item: z.number().int().positive(),
    campo: z.enum(['modelo', 'madera', 'ancho', 'alto', 'medida', 'cantidad']).nullable().optional(),
  })
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
        /** Avisos que deben (o no) aparecer en algún mensaje de la conversación. Ausente: no se miden. */
        avisos: z.array(avisoEsperado).optional(),
        /**
         * Preguntas pendientes al final de la conversación. Ausente: no se miden; una lista (incluso vacía) exige
         * exactamente esas: cada una que falta o que sobra es un error.
         */
        pendientes: z.array(pendienteEsperado).optional(),
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
  'fabrica',
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

export interface AvisoObtenido {
  categoria: string;
  texto: string;
}
export interface PendienteObtenido {
  /** Ítem desde 1. */
  item: number;
  campo: string | null;
}

/**
 * Categoría de un aviso para medir. El servicio deja en `otros` los avisos de precio y de flete; aquí los que piden
 * revisar algo («No apliqué el precio…», «revisa si le faltan ceros», «Escribiste un precio total…») pasan a
 * `precio` o `flete`. Los que solo informan («Usé el precio que indicaste…», «Tomé $X como valor sin IVA…», el
 * pedido especial a un precio escrito) siguen en `otros`: no cuentan como falsa alarma.
 */
/** Texto sin tildes, en mayúsculas y con los espacios colapsados (`normalizar` además quita los espacios). */
const plano = (t: string) =>
  t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

export function categoriaEvaluada(aviso: AvisoObtenido): CategoriaEvaluada {
  if (aviso.categoria !== 'otros')
    return (CATEGORIAS_AVISO as readonly string[]).includes(aviso.categoria)
      ? (aviso.categoria as CategoriaEvaluada)
      : 'otros';
  const t = plano(aviso.texto);
  const pideRevisar = /^(NO APLIQUE|ESCRIBISTE UN PRECIO TOTAL)\b|REVISA SI LE FALTAN CEROS|QUEDA BAJO EL COSTO/.test(t);
  if (!pideRevisar) return 'otros';
  if (/\bFLETE\b/.test(t)) return 'flete';
  if (/\bPRECIO\b/.test(t)) return 'precio';
  return 'otros';
}

/** Avisos que piden revisar el pedido; los `otros` solo informan. */
export function avisosDeRevision<T extends AvisoObtenido>(avisos: T[]): (T & { categoria: CategoriaEvaluada })[] {
  return avisos
    .map((a) => ({ ...a, categoria: categoriaEvaluada(a) }))
    .filter((a) => a.categoria !== 'otros');
}

function coincideAviso(e: z.infer<typeof avisoEsperado>, a: AvisoObtenido) {
  return (
    (e.categoria === undefined || categoriaEvaluada(a) === e.categoria) &&
    (e.texto === undefined || plano(a.texto).includes(plano(e.texto)))
  );
}

/** El caso pide este aviso (`esperado.avisos` sin `ausente`): no es una falsa alarma aunque la corrida sea perfecta. */
export function avisoPedido(caso: CasoEvaluacion | undefined, a: AvisoObtenido) {
  return !!caso?.esperado.avisos?.some((e) => !e.ausente && coincideAviso(e, a));
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
    /** Avisos de toda la conversación; sin entregarlos, `esperado.avisos` no se mide. */
    avisos?: AvisoObtenido[];
    /** Preguntas pendientes al final; sin entregarlas, `esperado.pendientes` no se mide. */
    pendientes?: PendienteObtenido[];
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
  if (caso.esperado.avisos && obtenido.avisos)
    for (const e of caso.esperado.avisos) {
      total++;
      const visto = obtenido.avisos.find((a) => coincideAviso(e, a));
      if (e.ausente ? !visto : visto) aciertos++;
      else
        diferencias.push({
          item: null,
          campo: 'aviso',
          esperado: `${e.ausente ? 'sin ' : ''}${[e.categoria && `[${e.categoria}]`, e.texto && `«${e.texto}»`].filter(Boolean).join(' ')}`,
          obtenido: visto ? `[${categoriaEvaluada(visto)}] ${visto.texto}` : '(ninguno)',
        });
    }
  if (caso.esperado.pendientes && obtenido.pendientes) {
    const sinUsar = [...obtenido.pendientes];
    for (const e of caso.esperado.pendientes) {
      total++;
      const i = sinUsar.findIndex((p) => p.item === e.item && (e.campo === undefined || p.campo === e.campo));
      if (i >= 0) {
        aciertos++;
        sinUsar.splice(i, 1);
      } else
        diferencias.push({
          item: e.item,
          campo: 'pendiente',
          esperado: e.campo === undefined ? '(pendiente)' : e.campo,
          obtenido: obtenido.pendientes.filter((p) => p.item === e.item).map((p) => p.campo)[0] ?? '(sin pendiente)',
        });
    }
    for (const p of sinUsar) {
      total++;
      diferencias.push({ item: p.item, campo: 'pendiente', esperado: '(sin pendiente)', obtenido: p.campo });
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

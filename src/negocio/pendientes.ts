import { bonito } from '../asistente/preguntas';
import { metrosTexto } from '../catalogo/escalones';
import { claveEscuadria, metros, normalizar, type Rechazo } from '../catalogo/resolver';
import type { Familia, SolicitudItem } from '../catalogo/tipos';
import type { Cotizacion } from './estado';
import { rangoMedidas } from './limites';
import { familiaEspecial, familiaItem } from './personalizados';

/**
 * Preguntas estructuradas para completar los ítems pendientes. La interfaz las responde con una edición
 * directa (sin volver a pasar por la IA): cada opción ya es un valor válido del campo.
 */
export type CampoPendiente = 'modelo' | 'madera' | 'ancho' | 'alto' | 'medida' | 'cantidad';
export interface OpcionPendiente {
  etiqueta: string;
  valor: string | number;
  /** Por qué se sugiere («Como el ítem 1»): la opción se muestra primero y destacada. */
  sugerencia?: string;
}
export type PrefillAlta = {
  familia: Familia | null;
  modelo: string | null;
  madera: string | null;
  medida: string | null;
  anchoMin: number | null;
  anchoMax: number | null;
  largo: number | null;
};
export interface PreguntaPendiente {
  clave: string;
  /** Ítems (índices desde 0) a los que se aplica la respuesta. */
  indices: number[];
  /**
   * null: no se responde con un dato (producto ambiguo, precio o descuento fuera de regla); queda el texto, el
   * editor del ítem y, si el ítem tiene un precio o un descuento fijado a mano, la opción de quitarlo.
   */
  campo: CampoPendiente | null;
  /** Nombre del campo para estos ítems («Alto» en puertas, «Largo» en marcos); null si no se pide un dato. */
  etiqueta: string | null;
  texto: string;
  /** Explicación del rechazo, sin la lista de opciones («Huilo Huilo no viene en Raulí.»). */
  detalle: string | null;
  opciones: OpcionPendiente[];
  /**
   * Respuesta numérica libre: medidas en metros o cantidad entera. Una medida lleva la familia del ítem, que fija
   * cómo se lee lo escrito y su rango (puertas hasta 3 m, accesorios hasta 6 m).
   */
  entrada: { min: number; max: number; paso: number; unidad: 'm' | null; familia?: Familia } | null;
  alta: PrefillAlta | null;
  /** Permite rechazar una sugerencia y dar de alta el nombre escrito. */
  modeloNuevo?: boolean;
  /** Puerta con el ancho y el alto al revés: medidas que deja la opción «Intercambiar», en metros. */
  intercambio?: { ancho: number; alto: number };
}

/** Valor de la opción que intercambia el ancho y el alto de una puerta (ver `cambiosRespuesta`). */
const INTERCAMBIAR = 'intercambiar';

export const ETIQUETA_PENDIENTE: Record<CampoPendiente, string> = {
  modelo: 'Modelo',
  madera: 'Madera',
  ancho: 'Ancho',
  alto: 'Alto o largo',
  medida: 'Sección o escuadría',
  cantidad: 'Cantidad',
};

/**
 * Nombre del campo para los ítems que lo comparten: una puerta tiene alto y un marco o una moldura, largo. Solo
 * una mezcla de familias (o una familia que no se sabe) dice «Alto o largo».
 */
export function etiquetaPendiente(campo: CampoPendiente, familias: Iterable<Familia | null | undefined> = []) {
  if (campo !== 'alto') return ETIQUETA_PENDIENTE[campo];
  const distintas = new Set([...familias].map((f) => (f === 'PUERTA' ? 'alto' : f ? 'largo' : null)));
  if (distintas.size !== 1 || distintas.has(null)) return ETIQUETA_PENDIENTE.alto;
  return distintas.has('alto') ? 'Alto' : 'Largo';
}

/** Qué es una escuadría, en palabras de quien cotiza: el mismo texto de ayuda de la pantalla de Catálogo. */
const EXPLICA_ESCUADRIA = 'Escuadría: grosor por ancho de la pieza.';

const CANTIDAD = { min: 1, max: 10000, paso: 1, unidad: null } as const;
/** Familia con que se lee cada dimensión: el ancho es siempre de puerta; el alto o largo, de su familia. */
const familiaDe = (campo: 'ancho' | 'alto', familia: Familia): Familia => (campo === 'ancho' ? 'PUERTA' : familia);
/** Medida libre dentro del rango de la familia: puertas de 0,3 a 3 m; largos de accesorios, de 0,3 a 6 m. */
function medidaLibre(familia: Familia, campo: 'ancho' | 'alto') {
  const { min, max } = rangoMedidas(familiaDe(campo, familia));
  return { min, max, paso: 0.005, unidad: 'm' as const, familia };
}

/** «0,80 A 0,85» o «0.8» → [0,8; 0,85]. Ignora lo que no es una cifra. */
function cifras(textos: string[]) {
  return textos.flatMap((t) =>
    [...t.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.'))).filter(Number.isFinite),
  );
}
function rangoDe(textos: string[], familia: Familia, campo: 'ancho' | 'alto', rango?: { min: number; max: number }) {
  const libre = medidaLibre(familia, campo);
  if (rango) return { ...libre, min: rango.min, max: rango.max };
  const valores = cifras(textos)
    .map((n) => metros(n, familiaDe(campo, familia)))
    .filter((n): n is number => n !== null);
  return valores.length ? { ...libre, min: Math.min(...valores), max: Math.max(...valores) } : libre;
}
const opcionesTexto = (valores: string[], formato: (s: string) => string = (s) => s) =>
  valores.map((v) => ({ etiqueta: formato(v), valor: v }));
/**
 * Un ítem con un precio o un descuento fuera de regla no le falta un dato: vuelve a valorizarse quitando lo
 * fijado a mano. La opción nombra el campo que se quita (ver `cambiosRespuesta`). El precio de un pedido
 * especial no está fijado sobre el catálogo: es su dato de origen y no se ofrece quitarlo.
 */
const opcionesFueraDeRegla = (s: SolicitudItem | undefined): OpcionPendiente[] => [
  ...(s?.precioUnitario != null && !s.personalizado
    ? [{ etiqueta: 'Quitar el precio fijado a mano', valor: 'precioUnitario' }]
    : []),
  ...(s?.descuento ? [{ etiqueta: 'Quitar el descuento del ítem', valor: 'descuento' }] : []),
];
const opcionesMetros = (valores: string[]) =>
  [...new Set(cifras(valores))]
    .sort((a, b) => a - b)
    .map((n) => ({ etiqueta: `${metrosTexto(n)} m`, valor: n }));

/** Quita la lista final de opciones de la pregunta del servidor: la interfaz la muestra como botones. */
const sinLista = (pregunta: string) =>
  pregunta
    .replace(/\s*(Opciones disponibles|Opciones|Modelos disponibles|Maderas disponibles):[\s\S]*$/, '')
    .trim() || null;

interface Parte {
  campo: CampoPendiente | null;
  /** Familia del ítem: compara y sugiere medidas con su rango. */
  familia: Familia;
  detalle: string | null;
  opciones: OpcionPendiente[];
  entrada: PreguntaPendiente['entrada'];
  /** Las partes de «faltan datos» iguales se agrupan entre ítems; las demás explican un caso propio. */
  agrupable: boolean;
  intercambio?: PreguntaPendiente['intercambio'];
}

function partes(r: Rechazo, pregunta: string, s?: SolicitudItem): Parte[] {
  const familia = s ? familiaItem(s, null, r) : familiaEspecial(r);
  const parte = (p: Omit<Parte, 'agrupable' | 'detalle' | 'familia'> & Partial<Parte>): Parte => ({
    agrupable: false,
    detalle: sinLista(pregunta),
    familia,
    ...p,
  });
  switch (r.tipo) {
    case 'faltan_datos':
      return r.campos.map((c) => {
        const disponibles = r.disponibles[c] ?? [];
        const base = { agrupable: true, detalle: null };
        switch (c) {
          case 'precio':
            // Precio o descuento fuera de regla (servicio.ts, `recalcular`): se explica, no se pide un dato.
            return parte({ campo: null, opciones: opcionesFueraDeRegla(s), entrada: null });
          case 'modelo':
            return parte({
              ...base,
              campo: 'modelo',
              opciones: opcionesTexto(disponibles, bonito),
              entrada: null,
            });
          case 'madera':
            return parte({
              ...base,
              campo: 'madera',
              opciones: opcionesTexto(disponibles, bonito),
              entrada: null,
            });
          case 'medida':
            // «Escuadría» se explica igual que en Catálogo (alta-producto, gestion-manuales).
            return parte({
              ...base,
              campo: 'medida',
              detalle: EXPLICA_ESCUADRIA,
              opciones: opcionesTexto(disponibles),
              entrada: null,
            });
          case 'alto':
            return parte({ ...base, campo: 'alto', opciones: opcionesMetros(disponibles), entrada: null });
          case 'ancho':
            // Los anchos de puerta son tramos («0,80–0,85»): se pide la medida real, no el tramo.
            return parte({ ...base, campo: 'ancho', opciones: [], entrada: rangoDe(disponibles, familia, 'ancho') });
          case 'cantidad':
          default:
            return parte({ ...base, campo: 'cantidad', opciones: [], entrada: CANTIDAD });
        }
      });
    // Los rechazos siguientes se agrupan solo entre ítems con el mismo problema: la clave del grupo lleva su
    // explicación («Los Lagos no viene en 2,47 m de alto…»), así que una misma respuesta vale para todos.
    case 'modelo_desconocido':
      return [parte({ agrupable: true, campo: 'modelo', opciones: opcionesTexto(r.disponibles, bonito), entrada: null })];
    case 'modelo_posible':
      return [
        parte({
          campo: 'modelo',
          opciones: [{ etiqueta: `Confirmar ${bonito(r.sugerido)}`, valor: r.sugerido }],
          entrada: null,
        }),
      ];
    case 'madera_desconocida':
    case 'madera_no_disponible':
      return [parte({ agrupable: true, campo: 'madera', opciones: opcionesTexto(r.disponibles, bonito), entrada: null })];
    case 'medida_no_disponible':
      if (r.campo === 'medida')
        return [parte({ agrupable: true, campo: 'medida', opciones: opcionesTexto(r.disponibles), entrada: null })];
      return [
        parte({
          agrupable: true,
          campo: r.campo,
          opciones: r.campo === 'alto' && !r.rango ? opcionesMetros(r.disponibles) : [],
          entrada: r.campo === 'alto' && !r.rango ? null : rangoDe(r.disponibles, familia, r.campo, r.rango),
        }),
      ];
    case 'medida_implausible':
      return [parte({ agrupable: true, campo: r.campo, opciones: [], entrada: medidaLibre(familia, r.campo) })];
    case 'cantidad_invalida':
      return [parte({ agrupable: true, campo: 'cantidad', opciones: [], entrada: CANTIDAD })];
    case 'medidas_invertidas':
      return [
        parte({
          campo: null,
          detalle: pregunta,
          opciones: [
            {
              etiqueta: `Intercambiar: ${metrosTexto(r.alto)} m de ancho × ${metrosTexto(r.ancho)} m de alto`,
              valor: INTERCAMBIAR,
            },
          ],
          entrada: null,
          intercambio: { ancho: r.alto, alto: r.ancho },
        }),
      ];
    case 'producto_ambiguo':
      return [parte({ campo: null, detalle: pregunta, opciones: [], entrada: null })];
  }
}

function prefillAlta(s: SolicitudItem | undefined, r: Rechazo | undefined): PrefillAlta | null {
  if (!s || !r || !['modelo_desconocido', 'modelo_posible', 'madera_desconocida', 'madera_no_disponible', 'medida_no_disponible'].includes(r.tipo))
    return null;
  const familia = 'familia' in r ? r.familia ?? null : null;
  const ancho = familia === 'PUERTA' && s.ancho !== null ? metros(s.ancho, 'PUERTA') : null;
  return {
    familia,
    modelo: r.tipo === 'modelo_posible' ? r.valor : s.modelo ?? null,
    madera: s.madera ?? null,
    medida: familia === 'PUERTA' ? null : s.medida ?? null,
    anchoMin: ancho,
    anchoMax: ancho,
    // Un largo de accesorio llega a 6 m: con el rango de puertas, 3,6 m quedaba vacío.
    largo: s.alto !== null ? metros(s.alto, familia ?? familiaItem(s, null, r)) : null,
  };
}

const valorDe = (s: SolicitudItem, campo: CampoPendiente) => s[campo] ?? null;
const igual = (campo: CampoPendiente, a: string | number, b: string | number, familia: Familia) => {
  if (campo === 'ancho' || campo === 'alto') {
    const f = familiaDe(campo, familia);
    return Math.abs((metros(Number(a), f) ?? Number(a)) - (metros(Number(b), f) ?? Number(b))) < 5e-4;
  }
  if (campo === 'medida') return claveEscuadria(String(a)) === claveEscuadria(String(b));
  return normalizar(String(a)) === normalizar(String(b));
};
/** Más ítems que esto se nombran por su cantidad y los primeros («12 ítems: 3, 5, 7, 9, 11 y 7 más»). */
const MAX_ITEMS_NOMBRADOS = 6;
export const listaItems = (indices: number[]) => {
  const n = indices.map((i) => String(i + 1));
  if (n.length === 1) return `el ítem ${n[0]}`;
  if (n.length <= MAX_ITEMS_NOMBRADOS) return `los ítems ${n.slice(0, -1).join(', ')} y ${n.at(-1)}`;
  const primeros = MAX_ITEMS_NOMBRADOS - 1;
  return `${n.length} ítems: ${n.slice(0, primeros).join(', ')} y ${n.length - primeros} más`;
};

/**
 * Sugiere el valor que ya tiene otro ítem del pedido («Como el ítem 1»), si es una respuesta válida. No se
 * aplica sola: la persona lo elige. Las cantidades no se sugieren: rara vez se repiten. Una madera que la
 * persona ya dijo y no se pudo usar tampoco: una Huilo Huilo enchapada no pasa a ser de Lenga porque otra
 * puerta lo sea.
 */
function sugerir(q: Pick<Cotizacion, 'solicitudes'>, indices: number[], parte: Parte): OpcionPendiente[] {
  const campo = parte.campo;
  if (!campo || campo === 'cantidad' || campo === 'modelo') return parte.opciones;
  if (campo === 'madera' && indices.some((i) => q.solicitudes[i]?.madera)) return parte.opciones;
  const primero = Math.min(...indices);
  const otros = q.solicitudes
    .map((s, i) => ({ i, valor: valorDe(s, campo) }))
    .filter(({ i, valor }) => !indices.includes(i) && valor !== null)
    // El ítem anterior más cercano primero: «la siguiente igual que la anterior».
    .sort(
      (a, b) => (a.i < primero ? primero - a.i : 1000 + a.i) - (b.i < primero ? primero - b.i : 1000 + b.i),
    );
  for (const { i, valor } of otros) {
    const sugerencia = `Como el ítem ${i + 1}`;
    if (parte.opciones.length) {
      const opcion = parte.opciones.find((o) => igual(campo, o.valor, valor!, parte.familia));
      if (opcion) return [{ ...opcion, sugerencia }, ...parte.opciones.filter((o) => o !== opcion)];
      continue;
    }
    const m = metros(Number(valor), familiaDe(campo === 'ancho' ? 'ancho' : 'alto', parte.familia));
    if (parte.entrada && m !== null && m >= parte.entrada.min - 1e-9 && m <= parte.entrada.max + 1e-9)
      return [{ etiqueta: `${metrosTexto(m)} m`, valor: m, sugerencia }];
  }
  return parte.opciones;
}

export function preguntasPendientes(q: Pick<Cotizacion, 'solicitudes' | 'incompletos'>): PreguntaPendiente[] {
  const grupos = new Map<string, { indices: number[]; parte: Parte; familias: Familia[] }>();
  const sueltas: { indice: number; parte: Parte; orden: number }[] = [];
  let orden = 0;
  const ordenGrupo = new Map<string, number>();
  for (const pendiente of q.incompletos) {
    for (const parte of partes(pendiente.rechazo, pendiente.pregunta, q.solicitudes[pendiente.indice])) {
      if (parte.agrupable) {
        const clave = `${parte.campo}|${parte.detalle}|${JSON.stringify(parte.opciones)}|${JSON.stringify(parte.entrada)}`;
        const grupo = grupos.get(clave);
        if (grupo) {
          grupo.indices.push(pendiente.indice);
          grupo.familias.push(parte.familia);
        } else {
          grupos.set(clave, { indices: [pendiente.indice], parte, familias: [parte.familia] });
          ordenGrupo.set(clave, orden++);
        }
      } else sueltas.push({ indice: pendiente.indice, parte, orden: orden++ });
    }
  }
  const nombre = (i: number) => {
    const modelo = q.solicitudes[i]?.modelo;
    return modelo ? ` (${bonito(modelo)})` : '';
  };
  const todas = [
    ...[...grupos.entries()].map(([clave, { indices, parte, familias }]) => ({
      orden: ordenGrupo.get(clave)!,
      indices,
      parte,
      familias,
    })),
    ...sueltas.map((s) => ({ orden: s.orden, indices: [s.indice], parte: s.parte, familias: [s.parte.familia] })),
  ].sort((a, b) => a.orden - b.orden);
  return todas.map(({ indices, parte, familias }) => {
    const sujeto = indices.length === 1 ? `${listaItems(indices)}${nombre(indices[0])}` : listaItems(indices);
    const etiqueta = parte.campo ? etiquetaPendiente(parte.campo, familias) : null;
    const texto = etiqueta ? `${etiqueta} para ${sujeto}` : `Revisa ${sujeto}`;
    return {
      clave: `${parte.campo ?? 'texto'}:${indices.join(',')}`,
      indices,
      campo: parte.campo,
      etiqueta,
      texto,
      detalle: parte.detalle,
      opciones: sugerir(q, indices, parte),
      entrada: parte.entrada,
      ...(parte.intercambio ? { intercambio: parte.intercambio } : {}),
      modeloNuevo: indices.length === 1 && q.incompletos.find((p) => p.indice === indices[0])?.rechazo.tipo === 'modelo_posible',
      alta: indices.length === 1
        ? prefillAlta(q.solicitudes[indices[0]], q.incompletos.find((p) => p.indice === indices[0])?.rechazo)
        : null,
    };
  });
}

/** Qué falta en un ítem pendiente, en palabras cortas («madera, alto o largo»); null si el ítem está completo. */
export function faltantesItem(q: Pick<Cotizacion, 'incompletos'>, indice: number): CampoPendiente[] | null {
  const pendiente = q.incompletos.find((p) => p.indice === indice);
  if (!pendiente) return null;
  return partes(pendiente.rechazo, pendiente.pregunta).flatMap((p) => (p.campo ? [p.campo] : []));
}

/**
 * Explicación de un ítem pendiente por un precio o un descuento fuera de regla («El precio $X queda fuera del
 * rango…»); null si el ítem está completo o le falta otra cosa.
 */
export function fueraDeRegla(q: Pick<Cotizacion, 'incompletos'>, indice: number): string | null {
  const pendiente = q.incompletos.find((p) => p.indice === indice);
  return pendiente?.rechazo.tipo === 'faltan_datos' && pendiente.rechazo.campos.includes('precio')
    ? pendiente.pregunta
    : null;
}

/** Cambios de la acción `editar` que responden la pregunta con `valor` en todos sus ítems. */
export function cambiosRespuesta(p: PreguntaPendiente, valor: string | number) {
  if (!p.campo && valor === INTERCAMBIAR && p.intercambio) {
    const { ancho, alto } = p.intercambio;
    return { items: p.indices.map((indice) => ({ indice, cambios: { ancho, alto } })) };
  }
  if (!p.campo) {
    // Única respuesta sin campo: quitar el precio o el descuento que dejó el ítem fuera de regla.
    if (valor !== 'precioUnitario' && valor !== 'descuento') return {};
    return {
      items: p.indices.map((indice) => ({
        indice,
        cambios: valor === 'descuento' ? { descuento: null } : { precioUnitario: null },
      })),
    };
  }
  if (p.campo === 'cantidad')
    return { cantidades: p.indices.map((indice) => ({ indice, cantidad: Number(valor) })) };
  const campo = p.campo;
  const dato = campo === 'ancho' || campo === 'alto' ? Number(valor) : String(valor);
  return { items: p.indices.map((indice) => ({ indice, cambios: { [campo]: dato } })) };
}

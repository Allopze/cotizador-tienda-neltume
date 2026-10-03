import { bonito } from '../asistente/preguntas';
import { metrosTexto } from '../catalogo/escalones';
import { metros, normalizar, normalizarMedida, RANGO_METROS, type Rechazo } from '../catalogo/resolver';
import type { Familia, SolicitudItem } from '../catalogo/tipos';
import type { Cotizacion } from './estado';

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
  /** null: no se responde con un control (p. ej. producto ambiguo); queda el texto y el editor del ítem. */
  campo: CampoPendiente | null;
  texto: string;
  /** Explicación del rechazo, sin la lista de opciones («Huilo Huilo no viene en Raulí.»). */
  detalle: string | null;
  opciones: OpcionPendiente[];
  /** Respuesta numérica libre: medidas en metros o cantidad entera. */
  entrada: { min: number; max: number; paso: number; unidad: 'm' | null } | null;
  alta: PrefillAlta | null;
}

export const ETIQUETA_PENDIENTE: Record<CampoPendiente, string> = {
  modelo: 'Modelo',
  madera: 'Madera',
  ancho: 'Ancho',
  alto: 'Alto o largo',
  medida: 'Sección o escuadría',
  cantidad: 'Cantidad',
};

const CANTIDAD = { min: 1, max: 10000, paso: 1, unidad: null } as const;
const MEDIDA_LIBRE = { min: RANGO_METROS.min, max: RANGO_METROS.max, paso: 0.005, unidad: 'm' } as const;

/** «0,80 A 0,85» o «0.8» → [0,8; 0,85]. Ignora lo que no es una cifra. */
function cifras(textos: string[]) {
  return textos.flatMap((t) =>
    [...t.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.'))).filter(Number.isFinite),
  );
}
function rangoDe(textos: string[], rango?: { min: number; max: number }) {
  if (rango) return { ...MEDIDA_LIBRE, min: rango.min, max: rango.max };
  const valores = cifras(textos)
    .map((n) => metros(n))
    .filter((n): n is number => n !== null);
  return valores.length
    ? { ...MEDIDA_LIBRE, min: Math.min(...valores), max: Math.max(...valores) }
    : MEDIDA_LIBRE;
}
const opcionesTexto = (valores: string[], formato: (s: string) => string = (s) => s) =>
  valores.map((v) => ({ etiqueta: formato(v), valor: v }));
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
  detalle: string | null;
  opciones: OpcionPendiente[];
  entrada: PreguntaPendiente['entrada'];
  /** Las partes de «faltan datos» iguales se agrupan entre ítems; las demás explican un caso propio. */
  agrupable: boolean;
}

function partes(r: Rechazo, pregunta: string): Parte[] {
  const parte = (p: Omit<Parte, 'agrupable' | 'detalle'> & Partial<Parte>): Parte => ({
    agrupable: false,
    detalle: sinLista(pregunta),
    ...p,
  });
  switch (r.tipo) {
    case 'faltan_datos':
      return r.campos.map((c) => {
        const disponibles = r.disponibles[c] ?? [];
        const base = { agrupable: true, detalle: null };
        switch (c) {
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
            return parte({ ...base, campo: 'medida', opciones: opcionesTexto(disponibles), entrada: null });
          case 'alto':
            return parte({ ...base, campo: 'alto', opciones: opcionesMetros(disponibles), entrada: null });
          case 'ancho':
            // Los anchos de puerta son tramos («0,80–0,85»): se pide la medida real, no el tramo.
            return parte({ ...base, campo: 'ancho', opciones: [], entrada: rangoDe(disponibles) });
          default:
            return parte({ ...base, campo: 'cantidad', opciones: [], entrada: CANTIDAD });
        }
      });
    case 'modelo_desconocido':
      return [parte({ campo: 'modelo', opciones: opcionesTexto(r.disponibles, bonito), entrada: null })];
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
      return [parte({ campo: 'madera', opciones: opcionesTexto(r.disponibles, bonito), entrada: null })];
    case 'medida_no_disponible':
      if (r.campo === 'medida')
        return [parte({ campo: 'medida', opciones: opcionesTexto(r.disponibles), entrada: null })];
      return [
        parte({
          campo: r.campo,
          opciones: r.campo === 'alto' && !r.rango ? opcionesMetros(r.disponibles) : [],
          entrada: r.campo === 'alto' && !r.rango ? null : rangoDe(r.disponibles, r.rango),
        }),
      ];
    case 'medida_implausible':
      return [parte({ campo: r.campo, opciones: [], entrada: MEDIDA_LIBRE })];
    case 'cantidad_invalida':
      return [parte({ campo: 'cantidad', opciones: [], entrada: CANTIDAD })];
    case 'producto_ambiguo':
      return [parte({ campo: null, detalle: pregunta, opciones: [], entrada: null })];
  }
}

function prefillAlta(s: SolicitudItem | undefined, r: Rechazo | undefined): PrefillAlta | null {
  if (!s || !r || !['modelo_desconocido', 'madera_desconocida', 'madera_no_disponible', 'medida_no_disponible'].includes(r.tipo))
    return null;
  const familia = 'familia' in r ? r.familia ?? null : null;
  const ancho = familia === 'PUERTA' && s.ancho !== null ? metros(s.ancho) : null;
  return {
    familia,
    modelo: s.modelo ?? null,
    madera: s.madera ?? null,
    medida: familia === 'PUERTA' ? null : s.medida ?? null,
    anchoMin: ancho,
    anchoMax: ancho,
    largo: s.alto !== null ? metros(s.alto) : null,
  };
}

const valorDe = (s: SolicitudItem, campo: CampoPendiente) => s[campo] ?? null;
const igual = (campo: CampoPendiente, a: string | number, b: string | number) => {
  if (campo === 'ancho' || campo === 'alto')
    return Math.abs((metros(Number(a)) ?? Number(a)) - (metros(Number(b)) ?? Number(b))) < 5e-4;
  if (campo === 'medida') return normalizarMedida(String(a)) === normalizarMedida(String(b));
  return normalizar(String(a)) === normalizar(String(b));
};
const listaItems = (indices: number[]) => {
  const n = indices.map((i) => String(i + 1));
  return n.length === 1 ? `el ítem ${n[0]}` : `los ítems ${n.slice(0, -1).join(', ')} y ${n.at(-1)}`;
};

/**
 * Sugiere el valor que ya tiene otro ítem del pedido («Como el ítem 1»), si es una respuesta válida. No se
 * aplica sola: la persona lo elige. Las cantidades no se sugieren: rara vez se repiten.
 */
function sugerir(q: Pick<Cotizacion, 'solicitudes'>, indices: number[], parte: Parte): OpcionPendiente[] {
  const campo = parte.campo;
  if (!campo || campo === 'cantidad' || campo === 'modelo') return parte.opciones;
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
      const opcion = parte.opciones.find((o) => igual(campo, o.valor, valor!));
      if (opcion) return [{ ...opcion, sugerencia }, ...parte.opciones.filter((o) => o !== opcion)];
      continue;
    }
    const m = metros(Number(valor));
    if (parte.entrada && m !== null && m >= parte.entrada.min - 1e-9 && m <= parte.entrada.max + 1e-9)
      return [{ etiqueta: `${metrosTexto(m)} m`, valor: m, sugerencia }];
  }
  return parte.opciones;
}

export function preguntasPendientes(q: Pick<Cotizacion, 'solicitudes' | 'incompletos'>): PreguntaPendiente[] {
  const grupos = new Map<string, { indices: number[]; parte: Parte }>();
  const sueltas: { indice: number; parte: Parte; orden: number }[] = [];
  let orden = 0;
  const ordenGrupo = new Map<string, number>();
  for (const pendiente of q.incompletos) {
    for (const parte of partes(pendiente.rechazo, pendiente.pregunta)) {
      if (parte.agrupable) {
        const clave = `${parte.campo}|${JSON.stringify(parte.opciones)}|${JSON.stringify(parte.entrada)}`;
        const grupo = grupos.get(clave);
        if (grupo) grupo.indices.push(pendiente.indice);
        else {
          grupos.set(clave, { indices: [pendiente.indice], parte });
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
    ...[...grupos.entries()].map(([clave, { indices, parte }]) => ({
      orden: ordenGrupo.get(clave)!,
      indices,
      parte,
    })),
    ...sueltas.map((s) => ({ orden: s.orden, indices: [s.indice], parte: s.parte })),
  ].sort((a, b) => a.orden - b.orden);
  return todas.map(({ indices, parte }) => {
    const sujeto = indices.length === 1 ? `${listaItems(indices)}${nombre(indices[0])}` : listaItems(indices);
    const texto = parte.campo ? `${ETIQUETA_PENDIENTE[parte.campo]} para ${sujeto}` : `Revisa ${sujeto}`;
    return {
      clave: `${parte.campo ?? 'texto'}:${indices.join(',')}`,
      indices,
      campo: parte.campo,
      texto,
      detalle: parte.detalle,
      opciones: sugerir(q, indices, parte),
      entrada: parte.entrada,
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

/** Cambios de la acción `editar` que responden la pregunta con `valor` en todos sus ítems. */
export function cambiosRespuesta(p: PreguntaPendiente, valor: string | number) {
  if (!p.campo) return {};
  if (p.campo === 'cantidad')
    return { cantidades: p.indices.map((indice) => ({ indice, cantidad: Number(valor) })) };
  const campo = p.campo;
  const dato = campo === 'ancho' || campo === 'alto' ? Number(valor) : String(valor);
  return { items: p.indices.map((indice) => ({ indice, cambios: { [campo]: dato } })) };
}

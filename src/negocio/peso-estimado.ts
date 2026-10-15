import { esSetDeMarco } from '../catalogo/escalones';
import type { Producto } from '../catalogo/tipos';

// Estimación del peso y las medidas embaladas de una unidad, para cotizar el despacho cuando la empresa no ha
// pesado sus productos. Sale de las medidas del catálogo (o de las pedidas), la densidad de la madera y un embalaje
// típico. Es una estimación: si en Ajustes se define el peso y el espesor de una familia, mandan esos valores.

/**
 * Densidad de la madera seca (≈12 % de humedad), en kg/m³. Valores de referencia; el primer patrón que calza con el
 * nombre de la madera decide («PINO FINGER ENCHAPADO MARA» es finger, no mara).
 */
const DENSIDADES: readonly [RegExp, number][] = [
  [/FINGER/, 500],
  [/OREGON/, 530],
  [/RAULI/, 530],
  [/LENGA/, 560],
  [/MARA/, 600],
  [/PREPINTAD/, 550],
  [/PINO/, 500],
];
/** Madera desconocida: se toma una densidad alta para no quedarse corto. */
const DENSIDAD_PREDETERMINADA = 600;

/** Espesor de una hoja de puerta terminada, en cm. */
const ESPESOR_PUERTA_CM = 4.5;
/**
 * Fracción maciza del volumen de la hoja: una puerta de tableros tiene paneles más delgados que el bastidor.
 * Las «especiales» (anchos mayores) pueden ser de cualquier diseño: se toma un valor intermedio.
 */
const SOLIDEZ_PUERTA: readonly [RegExp, number][] = [
  [/BLOQUE/, 0.9],
  [/PANEL/, 0.75],
];
const SOLIDEZ_PREDETERMINADA = 0.85;

/** Las escuadrías en pulgadas son nominales: cepilladas quedan cerca de un 90 % de la medida. */
const CEPILLADO = 0.9;
const CM_POR_PULGADA = 2.54;
/** Un kit de marco o de piezas T: dos jambas del largo del producto (con un 5 % de sobrelargo) y un dintel de 1 m. */
const JAMBAS_POR_KIT = 2;
const SOBRELARGO_JAMBA = 1.05;
const DINTEL_M = 1;
/** Escuadrías de respaldo si la medida del catálogo no se puede leer (pulgadas para kits, cm para molduras). */
const SECCION_KIT_PULGADAS: [number, number] = [2, 4];
const SECCION_MOLDURA_CM: [number, number] = [6, 2];

/**
 * Embalaje: holgura que agrega a cada medida (cm) y peso por m² de superficie del paquete. Las puertas van en
 * cartón corrugado con esquineros; marcos, molduras y piezas T, en film y zuncho. Más un peso fijo por unidad
 * (cinta, etiqueta, zuncho).
 */
const EMBALAJE = {
  puerta: { espesorCm: 1, bordeCm: 4, kgPorM2: 0.5 },
  resto: { espesorCm: 1, bordeCm: 4, kgPorM2: 0.2 },
  fijoKg: 0.2,
} as const;

export interface UnidadEmbalada {
  /** Lo que la unidad suma al apilarse (cm). */
  espesor: number;
  /** Ancho y largo de la unidad embalada (cm). */
  ancho: number;
  largo: number;
  /** Peso de la unidad embalada (kg). */
  kg: number;
}

const sinTildes = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase();

const primera = (tabla: readonly [RegExp, number][], texto: string, omision: number) =>
  tabla.find(([patron]) => patron.test(sinTildes(texto)))?.[1] ?? omision;

const densidadMadera = (madera: string) => primera(DENSIDADES, madera, DENSIDAD_PREDETERMINADA);

/** «12X4,5» → [12, 4.5]; «2X4» → [2, 4]. null si no es una escuadría. */
function leerSeccion(medida: string): [number, number] | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*[X×]\s*(\d+(?:[.,]\d+)?)\s*$/i.exec(medida);
  if (!m) return null;
  const [a, b] = [m[1], m[2]].map((n) => Number(n.replace(',', '.')));
  return a > 0 && b > 0 ? [a, b] : null;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

function embalar(
  bruto: { espesor: number; ancho: number; largo: number; kgMadera: number },
  tipo: (typeof EMBALAJE)['puerta' | 'resto'],
): UnidadEmbalada {
  const espesor = bruto.espesor + tipo.espesorCm;
  const ancho = bruto.ancho + tipo.bordeCm;
  const largo = bruto.largo + tipo.bordeCm;
  const superficieM2 = (2 * (espesor * ancho + espesor * largo + ancho * largo)) / 10000;
  return {
    espesor: redondear(espesor),
    ancho: redondear(ancho),
    largo: redondear(largo),
    kg: redondear(bruto.kgMadera + superficieM2 * tipo.kgPorM2 + EMBALAJE.fijoKg),
  };
}

/**
 * Unidad embalada estimada. `anchoCm` y `largoCm` son las medidas ya resueltas de la unidad (la pedida o la de la
 * referencia del catálogo); para marcos, molduras y piezas T solo cuenta el largo.
 */
export function estimarUnidad(
  producto: Pick<Producto, 'familia' | 'tipo' | 'madera' | 'medida'>,
  medidas: { anchoCm: number; largoCm: number },
): UnidadEmbalada {
  const densidad = densidadMadera(producto.madera);
  const { anchoCm, largoCm } = medidas;
  if (producto.familia === 'PUERTA') {
    const solidez = primera(SOLIDEZ_PUERTA, producto.tipo ?? '', SOLIDEZ_PREDETERMINADA);
    const m3 = (anchoCm / 100) * (largoCm / 100) * (ESPESOR_PUERTA_CM / 100) * solidez;
    return embalar(
      { espesor: ESPESOR_PUERTA_CM, ancho: anchoCm, largo: largoCm, kgMadera: m3 * densidad },
      EMBALAJE.puerta,
    );
  }
  if (producto.familia === 'MOLDURA') {
    const [a, b] = leerSeccion(producto.medida) ?? SECCION_MOLDURA_CM;
    const m3 = (a / 100) * (b / 100) * (largoCm / 100);
    // Sección cuadrada equivalente: las molduras se atan en paquete.
    const lado = Math.sqrt(a * b);
    return embalar({ espesor: lado, ancho: lado, largo: largoCm, kgMadera: m3 * densidad }, EMBALAJE.resto);
  }
  // Marcos y piezas T: kit de dos jambas y un dintel, de la escuadría en pulgadas, atados juntos.
  const seccion = leerSeccion(producto.medida) ?? SECCION_KIT_PULGADAS;
  const milimetros = esSetDeMarco(producto) || seccion.every((n) => n > 12);
  const [a, b] = seccion.map((p) => milimetros ? p / 10 : p * CM_POR_PULGADA * CEPILLADO);
  const jamba = largoCm * SOBRELARGO_JAMBA;
  const metros = (JAMBAS_POR_KIT * jamba) / 100 + DINTEL_M;
  const m3 = (a / 100) * (b / 100) * metros;
  const lado = Math.sqrt((JAMBAS_POR_KIT + 1) * a * b);
  return embalar({ espesor: lado, ancho: lado, largo: jamba, kgMadera: m3 * densidad }, EMBALAJE.resto);
}

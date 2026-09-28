import type { Catalogo, Producto, SolicitudItem } from './tipos';
import {
  aliasMaderasConfiguradas,
  CONFIGURACION_CATALOGO_BASE,
  normalizarCatalogo,
  resolverMaderaConfigurada,
  resolverModeloConfigurado,
} from './configuracion';
export const normalizar = normalizarCatalogo;
/** Rango físico admisible para anchos y altos de puertas y largos de accesorios, en metros. */
export const RANGO_METROS = { min: 0.3, max: 3 } as const;
/**
 * Convierte a metros: hasta 10 se asume metros, hasta 300 centímetros y hasta 3000 milímetros.
 * Devuelve null si el resultado queda fuera de 0,3–3 m (medida implausible: se pregunta).
 */
export const metros = (n: number): number | null => {
  if (!Number.isFinite(n) || n <= 0) return null;
  const m = n <= 10 ? n : n <= 300 ? n / 100 : n <= 3000 ? n / 1000 : NaN;
  return m >= RANGO_METROS.min - 1e-9 && m <= RANGO_METROS.max + 1e-9 ? m : null;
};
/** Forma canónica de una escuadría: «6 x 4.5», «6×4,5» y «6*4.5» → «6X4,5». */
export const normalizarMedida = (s: string) =>
  s.toUpperCase().replace(/[×*]/g, 'X').replace(/\s/g, '').replace(/\./g, ',');
export type Rechazo =
  | { tipo: 'faltan_datos'; campos: string[]; disponibles: Record<string, string[]> }
  | { tipo: 'modelo_desconocido'; valor: string; disponibles: string[] }
  | { tipo: 'madera_desconocida'; valor: string; disponibles: string[] }
  | { tipo: 'madera_no_disponible'; valor: string; disponibles: string[] }
  | {
      tipo: 'medida_no_disponible';
      campo: 'ancho' | 'alto' | 'medida';
      valor: number | string;
      disponibles: string[];
    }
  | { tipo: 'medida_implausible'; campo: 'ancho' | 'alto'; valor: number; disponibles: string[] }
  | { tipo: 'producto_ambiguo'; valor: string; disponibles: string[] }
  | { tipo: 'cantidad_invalida'; valor: number | null; disponibles: string[] };
export type Resolucion =
  | {
      ok: true;
      producto: Producto;
      cantidad: number;
      /** Medidas pedidas, ya en metros o en forma canónica. */
      anchoSolicitado: number | null;
      altoSolicitado: number | null;
      medidaSolicitada: string | null;
    }
  | { ok: false; rechazo: Rechazo };
export interface FuenteCatalogo {
  modelos(): string[];
  maderas(): string[];
  productosDeModelo(modeloNormalizado: string): Producto[];
  resolverMadera?(valor: string): string | null;
  resolverModelo?(valor: string): string;
  aliasMaderas?(): Record<string, string[]>;
  aliasModelos?(): Record<string, string[]>;
}
export type CatalogoConsultable = Catalogo | FuenteCatalogo;
export const modelosCatalogo = (catalogo: CatalogoConsultable) =>
  'productos' in catalogo ? [...new Set(catalogo.productos.map((p) => p.modelo))] : catalogo.modelos();
export const maderasCatalogo = (catalogo: CatalogoConsultable) =>
  'productos' in catalogo ? [...new Set(catalogo.productos.map((p) => p.madera))] : catalogo.maderas();
export const aliasMaderasCatalogo = (catalogo: CatalogoConsultable) =>
  'productos' in catalogo
    ? aliasMaderasConfiguradas(CONFIGURACION_CATALOGO_BASE)
    : (catalogo.aliasMaderas?.() ?? {});
export const aliasModelosCatalogo = (catalogo: CatalogoConsultable) =>
  'productos' in catalogo ? CONFIGURACION_CATALOGO_BASE.aliasModelos : (catalogo.aliasModelos?.() ?? {});
export function resolverItem(catalogo: CatalogoConsultable, entrada: Partial<SolicitudItem>): Resolucion {
  const s: SolicitudItem = {
    modelo: entrada.modelo ?? null,
    madera: entrada.madera ?? null,
    ancho: entrada.ancho ?? null,
    alto: entrada.alto ?? null,
    medida: entrada.medida ?? null,
    cantidad: entrada.cantidad ?? null,
  };
  const unicos = (ps: Producto[], campo: 'modelo' | 'madera' | 'medida' | 'largo') => [
    ...new Set(ps.map((p) => String(p[campo]))),
  ];
  const no = (rechazo: Rechazo): Resolucion => ({ ok: false, rechazo });
  if (!s.modelo)
    return no({
      tipo: 'faltan_datos',
      campos: ['modelo'],
      disponibles: { modelo: modelosCatalogo(catalogo) },
    });
  const modelo =
    'productos' in catalogo
      ? resolverModeloConfigurado(s.modelo, CONFIGURACION_CATALOGO_BASE)
      : (catalogo.resolverModelo?.(s.modelo) ?? s.modelo);
  let opciones =
    'productos' in catalogo
      ? catalogo.productos.filter((p) => normalizar(p.modelo) === normalizar(modelo))
      : catalogo.productosDeModelo(normalizar(modelo));
  if (!opciones.length)
    return no({ tipo: 'modelo_desconocido', valor: s.modelo, disponibles: modelosCatalogo(catalogo) });
  const familia = opciones[0].familia,
    puerta = familia === 'PUERTA';
  const madera = s.madera
    ? 'productos' in catalogo
      ? (resolverMaderaConfigurada(s.madera, CONFIGURACION_CATALOGO_BASE) ??
        maderasCatalogo(catalogo).find((disponible) => normalizar(disponible) === normalizar(s.madera!)) ??
        null)
      : (catalogo.resolverMadera?.(s.madera) ??
        maderasCatalogo(catalogo).find((disponible) => normalizar(disponible) === normalizar(s.madera!)) ??
        null)
    : null;
  if (s.madera && !madera)
    return no({ tipo: 'madera_desconocida', valor: s.madera, disponibles: unicos(opciones, 'madera') });
  if (madera) {
    const conMadera = opciones.filter((p) => p.madera === madera);
    if (!conMadera.length)
      return no({ tipo: 'madera_no_disponible', valor: madera, disponibles: unicos(opciones, 'madera') });
    opciones = conMadera;
  }
  if (s.cantidad !== null && (!Number.isInteger(s.cantidad) || s.cantidad < 1 || s.cantidad > 10000))
    return no({ tipo: 'cantidad_invalida', valor: s.cantidad, disponibles: ['Entero entre 1 y 10.000'] });
  // Valida también medidas presentes aunque falten otros datos: nunca oculta un ancho imposible.
  const rango = ['0,3 a 3 m (o 30 a 300 cm)'];
  let anchoSolicitado: number | null = null,
    altoSolicitado: number | null = null,
    medidaSolicitada: string | null = null;
  if (puerta && s.ancho !== null) {
    const ancho = metros(s.ancho);
    if (ancho === null)
      return no({ tipo: 'medida_implausible', campo: 'ancho', valor: s.ancho, disponibles: rango });
    anchoSolicitado = ancho;
    const medidas = unicos(opciones, 'medida');
    opciones = opciones.filter((p) => ancho >= p.anchoMin! - 1e-9 && ancho <= p.anchoMax! + 1e-9);
    if (!opciones.length)
      return no({ tipo: 'medida_no_disponible', campo: 'ancho', valor: ancho, disponibles: medidas });
  }
  if (!puerta && s.medida) {
    let medida = normalizarMedida(s.medida);
    if (familia !== 'MOLDURA' && /^\d+$/.test(medida)) medida = `2X${medida}`;
    medidaSolicitada = medida;
    const medidas = unicos(opciones, 'medida');
    opciones = opciones.filter((p) => p.medida === medida);
    if (!opciones.length)
      return no({ tipo: 'medida_no_disponible', campo: 'medida', valor: s.medida, disponibles: medidas });
  }
  if (s.alto !== null) {
    const alto = metros(s.alto),
      disponibles = unicos(opciones, 'largo');
    if (alto === null)
      return no({ tipo: 'medida_implausible', campo: 'alto', valor: s.alto, disponibles: rango });
    altoSolicitado = alto;
    opciones = opciones.filter((p) => Math.abs(p.largo - alto) <= 0.005 + 1e-9);
    if (!opciones.length)
      return no({ tipo: 'medida_no_disponible', campo: 'alto', valor: alto, disponibles });
  }
  const campos: string[] = [];
  if (!s.madera) campos.push('madera');
  if (puerta ? s.ancho === null : !s.medida) campos.push(puerta ? 'ancho' : 'medida');
  if (s.alto === null) campos.push('alto');
  if (s.cantidad === null) campos.push('cantidad');
  if (campos.length)
    return no({
      tipo: 'faltan_datos',
      campos,
      disponibles: {
        madera: unicos(opciones, 'madera'),
        ancho: unicos(opciones, 'medida'),
        medida: unicos(opciones, 'medida'),
        alto: unicos(opciones, 'largo'),
        cantidad: ['Entero entre 1 y 10.000'],
      },
    });
  // Rangos manuales superpuestos u otra ambigüedad: se pregunta en vez de elegir en silencio.
  if (opciones.length > 1)
    return no({
      tipo: 'producto_ambiguo',
      valor: modelo,
      disponibles: opciones.map((p) => `${p.codigo}: ${p.descripcion}`),
    });
  return {
    ok: true,
    producto: opciones[0],
    cantidad: s.cantidad!,
    anchoSolicitado,
    altoSolicitado,
    medidaSolicitada,
  };
}

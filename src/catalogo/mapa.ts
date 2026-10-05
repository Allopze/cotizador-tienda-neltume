import { escalon, metrosTexto } from './escalones';
import { modelosCatalogo, normalizar, type CatalogoConsultable } from './resolver';
import type { Familia, Producto } from './tipos';

/** Lo que la IA sabe de un modelo para interpretar el pedido: nunca precios, códigos ni márgenes. */
export interface ModeloMapa {
  modelo: string;
  familia: Familia;
  maderas: string[];
  /** Puertas: anchos que se cotizan, en metros («0,60–1,35»). */
  anchos?: string;
  /** Alto de las puertas o largo de los accesorios, en metros. Falta si hay `variantes`. */
  altos?: string;
  /** Accesorios: secciones o escuadrías («2X4»). Falta si hay `variantes`. */
  medidas?: string[];
  /**
   * Accesorios cuyas maderas no comparten secciones: marcos sólidos 2X4–2X8 por un lado y finger 30X70/30X90
   * por otro. Así la IA no lee «marco 2x5 pino» como un marco finger.
   */
  variantes?: { maderas: string[]; medidas: string[]; altos: string }[];
}

/** Hasta este número de valores distintos se listan; con más, se informa el tramo. */
const MAX_VALORES = 8;

function textoValores(valores: number[]) {
  const unicos = [...new Set(valores.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  if (!unicos.length) return '';
  if (unicos.length <= MAX_VALORES) return unicos.map(metrosTexto).join(', ');
  return `${metrosTexto(unicos[0])}–${metrosTexto(unicos.at(-1)!)}`;
}

const altosDe = (productos: Producto[]) =>
  textoValores(
    productos.flatMap((p) => {
      const e = escalon(p, 'alto');
      return e.exacto ? [e.min] : [e.min, e.max];
    }),
  );

function resumir(modelo: string, productos: Producto[]): ModeloMapa {
  const familia = productos[0].familia;
  const maderas = [...new Set(productos.map((p) => p.madera))];
  if (familia === 'PUERTA') {
    const anchos = productos.flatMap((p) => {
      const e = escalon(p, 'ancho');
      return e ? [e.min, e.max] : [];
    });
    const rango = anchos.length
      ? `${metrosTexto(Math.min(...anchos))}–${metrosTexto(Math.max(...anchos))}`
      : undefined;
    return { modelo, familia, maderas, ...(rango ? { anchos: rango } : {}), altos: altosDe(productos) };
  }
  // Maderas agrupadas por el conjunto de secciones en que vienen.
  const grupos = new Map<string, string[]>();
  for (const madera of maderas) {
    const secciones = [...new Set(productos.filter((p) => p.madera === madera).map((p) => p.medida))].sort();
    const clave = secciones.join('|');
    grupos.set(clave, [...(grupos.get(clave) ?? []), madera]);
  }
  if (grupos.size <= 1)
    return { modelo, familia, maderas, medidas: [...new Set(productos.map((p) => p.medida))], altos: altosDe(productos) };
  return {
    modelo,
    familia,
    maderas,
    variantes: [...grupos.values()].map((grupo) => {
      const delGrupo = productos.filter((p) => grupo.includes(p.madera));
      return { maderas: grupo, medidas: [...new Set(delGrupo.map((p) => p.medida))], altos: altosDe(delGrupo) };
    }),
  };
}

/** Un renglón por modelo del catálogo vigente. */
export function mapaCatalogo(catalogo: CatalogoConsultable): ModeloMapa[] {
  return modelosCatalogo(catalogo).flatMap((modelo) => {
    const productos =
      'productos' in catalogo
        ? catalogo.productos.filter((p) => normalizar(p.modelo) === normalizar(modelo))
        : catalogo.productosDeModelo(normalizar(modelo));
    return productos.length ? [resumir(modelo, productos)] : [];
  });
}

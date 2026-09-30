import { importarPlanilla } from '../catalogo/planilla';
import { ETIQUETA_ORIGEN, ORIGENES_CATALOGO, type OrigenCatalogo } from '../catalogo/origenes';
import type { Producto } from '../catalogo/tipos';
import type { RepositorioCatalogoSqlite } from './repositorio-catalogo';

type ProductoComparable = Pick<
  Producto,
  'codigo' | 'modelo' | 'madera' | 'medida' | 'anchoMin' | 'anchoMax' | 'altoMin' | 'altoMax' | 'largo' | 'precioNeto' | 'descripcion' | 'tipo' | 'familia'
>;
function claveProducto(p: ProductoComparable) {
  return JSON.stringify([
    p.modelo, p.familia, p.tipo, p.madera, p.medida, p.anchoMin, p.anchoMax,
    p.altoMin ?? null, p.altoMax ?? null, p.largo, p.precioNeto, p.descripcion,
  ]);
}

/** Compara los productos de una planilla con los que ese mismo origen tiene guardados. */
export function compararCatalogo(actual: Producto[], nueva: Producto[]) {
  const anteriorPorCodigo = new Map(actual.map((p) => [p.codigo, p]));
  const nuevaPorCodigo = new Map(nueva.map((p) => [p.codigo, p]));
  const nuevos = nueva.filter((p) => !anteriorPorCodigo.has(p.codigo));
  const modificados = nueva.flatMap((p) => {
    const previo = anteriorPorCodigo.get(p.codigo);
    return previo && claveProducto(previo) !== claveProducto(p) ? [{ codigo: p.codigo, anterior: previo, nuevo: p }] : [];
  });
  const sinCambios = nueva.filter((p) => {
    const previo = anteriorPorCodigo.get(p.codigo);
    return previo && claveProducto(previo) === claveProducto(p);
  });
  const eliminados = actual.filter((p) => !nuevaPorCodigo.has(p.codigo));
  return {
    conteos: { nuevos: nuevos.length, modificados: modificados.length, sinCambios: sinCambios.length, eliminados: eliminados.length },
    productos: {
      nuevos: nuevos.slice(0, 100).map((p) => ({ codigo: p.codigo, descripcion: p.descripcion, precioNeto: p.precioNeto })),
      modificados: modificados.slice(0, 100),
      sinCambios: sinCambios.slice(0, 100).map((p) => ({ codigo: p.codigo, descripcion: p.descripcion })),
      eliminados: eliminados.slice(0, 100).map((p) => ({ codigo: p.codigo, descripcion: p.descripcion, precioNeto: p.precioNeto })),
    },
  };
}

/**
 * Lee una planilla, detecta cuál es y la compara solo con los productos de su propio origen. No escribe nada:
 * `importado` es lo que después se guarda y `vista` lo que se muestra antes de confirmar.
 */
export async function analizarPlanilla(ruta: string, fuente: string, catalogo: RepositorioCatalogoSqlite) {
  const importado = await importarPlanilla(ruta, catalogo.configuracion);
  importado.catalogo.fuente = fuente;
  const origen: OrigenCatalogo = importado.origen;
  const cambios = compararCatalogo(catalogo.importados(origen), importado.catalogo.productos);
  const conteo = catalogo.conteoPorOrigen();
  const vista = {
    origen,
    etiquetaOrigen: ETIQUETA_ORIGEN[origen],
    sha256: importado.catalogo.sha256,
    // Solo cuenta lo que cambia este origen: importar la otra planilla no invalida esta vista previa.
    baseSha256: catalogo.metadataOrigen(origen)?.sha256 ?? null,
    fuente,
    totalProductos: importado.catalogo.productos.length,
    conteos: cambios.conteos,
    productos: cambios.productos,
    incidencias: importado.incidencias,
    erroresPlantilla: importado.erroresPlantilla,
    sinModificar: ORIGENES_CATALOGO.filter((o) => o !== origen).map((o) => ({
      origen: o,
      etiqueta: ETIQUETA_ORIGEN[o],
      productos: conteo[o] ?? 0,
    })),
  };
  return { importado, vista };
}
export type VistaPreviaImportacion = Awaited<ReturnType<typeof analizarPlanilla>>['vista'];

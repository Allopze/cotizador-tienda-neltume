import { normalizarCatalogo, validarConfiguracionCatalogo, type ConfiguracionCatalogo } from '../catalogo/configuracion';
import { importarPlanilla } from '../catalogo/planilla';
import { ETIQUETA_ORIGEN, ORIGENES_CATALOGO, type OrigenCatalogo } from '../catalogo/origenes';
import type { Producto } from '../catalogo/tipos';
import type { RepositorioCatalogoSqlite } from './repositorio-catalogo';

type ProductoComparable = Pick<
  Producto,
  'codigo' | 'modelo' | 'madera' | 'medida' | 'anchoMin' | 'anchoMax' | 'altoMin' | 'altoMax' | 'largo' | 'precioNeto' | 'tipo' | 'familia'
>;
/** Lo que cotiza un producto: todo menos la descripción, que solo es su texto en el catálogo. */
function claveProducto(p: ProductoComparable) {
  return JSON.stringify([
    p.modelo, p.familia, p.tipo, p.madera, p.medida, p.anchoMin, p.anchoMax,
    p.altoMin ?? null, p.altoMax ?? null, p.largo, p.precioNeto,
  ]);
}

/**
 * Configuración para importar desde la terminal: la del archivo (config/catalogo.json) más la guardada en la
 * base, donde manda la de la base. Cada modelo, madera o familia que la base ya tiene queda como está en la base
 * (un alias agregado o quitado en «Nombres y alias» se respeta); del archivo solo se suma lo que la base no
 * tiene, sin repetir un nombre, código o alias que la base ya usa.
 */
export function fusionarConfiguracion(
  archivo: ConfiguracionCatalogo,
  guardada: ConfiguracionCatalogo | null,
): ConfiguracionCatalogo {
  if (!guardada) return archivo;
  const n = normalizarCatalogo;
  const maderasBase = new Set(guardada.maderas.flatMap((m) => [m.nombre, ...m.alias].map(n)));
  const codigosBase = new Set(guardada.maderas.map((m) => m.codigo.toUpperCase()));
  const maderas = [
    ...guardada.maderas,
    ...archivo.maderas
      .filter((m) => !maderasBase.has(n(m.nombre)) && !codigosBase.has(m.codigo.toUpperCase()))
      .map((m) => ({ ...m, alias: m.alias.filter((a) => !maderasBase.has(n(a))) })),
  ];
  const nombresBase = new Set(
    [guardada.aliasModelos, guardada.aliasPosiblesModelos].flatMap((r) =>
      Object.entries(r).flatMap(([modelo, alias]) => [modelo, ...alias].map(n)),
    ),
  );
  const porModelo = (base: Record<string, string[]>, extra: Record<string, string[]>) => {
    const resultado = { ...base };
    for (const [modelo, alias] of Object.entries(extra)) {
      if (Object.keys(base).some((k) => n(k) === n(modelo))) continue;
      const nuevos = alias.filter((a) => !nombresBase.has(n(a)));
      if (nuevos.length) resultado[modelo] = nuevos;
    }
    return resultado;
  };
  const familiasPorModelo = { ...guardada.familiasPorModelo };
  for (const [modelo, familia] of Object.entries(archivo.familiasPorModelo))
    if (!Object.keys(familiasPorModelo).some((k) => n(k) === n(modelo))) familiasPorModelo[modelo] = familia;
  return validarConfiguracionCatalogo({
    maderas,
    familiasPorModelo,
    aliasModelos: porModelo(guardada.aliasModelos, archivo.aliasModelos),
    aliasPosiblesModelos: porModelo(guardada.aliasPosiblesModelos, archivo.aliasPosiblesModelos),
  });
}

/**
 * Compara los productos de una planilla con los que ese mismo origen tiene guardados. Un producto al que solo
 * le cambia la descripción (p. ej. «0,60» → «0,6» al cambiar el formato) no cuenta como modificado: va aparte,
 * en `soloDescripcion`, porque no cambia ni el precio ni lo que se cotiza.
 */
export function compararCatalogo(actual: Producto[], nueva: Producto[]) {
  const anteriorPorCodigo = new Map(actual.map((p) => [p.codigo, p]));
  const nuevaPorCodigo = new Map(nueva.map((p) => [p.codigo, p]));
  const nuevos: Producto[] = [];
  const modificados: { codigo: string; anterior: Producto; nuevo: Producto }[] = [];
  const soloDescripcion: { codigo: string; anterior: string; nueva: string }[] = [];
  const sinCambios: Producto[] = [];
  for (const p of nueva) {
    const previo = anteriorPorCodigo.get(p.codigo);
    if (!previo) nuevos.push(p);
    else if (claveProducto(previo) !== claveProducto(p)) modificados.push({ codigo: p.codigo, anterior: previo, nuevo: p });
    else if (previo.descripcion !== p.descripcion)
      soloDescripcion.push({ codigo: p.codigo, anterior: previo.descripcion, nueva: p.descripcion });
    else sinCambios.push(p);
  }
  const eliminados = actual.filter((p) => !nuevaPorCodigo.has(p.codigo));
  return {
    conteos: {
      nuevos: nuevos.length,
      modificados: modificados.length,
      soloDescripcion: soloDescripcion.length,
      sinCambios: sinCambios.length,
      eliminados: eliminados.length,
    },
    productos: {
      nuevos: nuevos.slice(0, 100).map((p) => ({ codigo: p.codigo, descripcion: p.descripcion, precioNeto: p.precioNeto })),
      modificados: modificados.slice(0, 100),
      soloDescripcion: soloDescripcion.slice(0, 100),
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
  const actuales = catalogo.importados(origen);
  const cambios = compararCatalogo(actuales, importado.catalogo.productos);
  const conteo = catalogo.conteoPorOrigen();
  const editados = new Set(catalogo.edicionesManuales());
  const vista = {
    origen,
    etiquetaOrigen: ETIQUETA_ORIGEN[origen],
    sha256: importado.catalogo.sha256,
    /**
     * Versión de todo el catálogo, no solo de esta planilla (null si aún no hay). Es global: un alta o una
     * edición manual, o importar la otra planilla, también invalidan esta vista previa y confirmar responde 409.
     */
    versionCatalogo: catalogo.version,
    /** Productos de esta planilla editados a mano en la aplicación: la importación los reemplaza. */
    edicionesManuales: actuales
      .filter((p) => editados.has(p.codigo))
      .map((p) => ({ codigo: p.codigo, descripcion: p.descripcion, precioNeto: p.precioNeto })),
    // Última importación de esta planilla (redundante con la versión global, que ya cambia si se vuelve a importar).
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

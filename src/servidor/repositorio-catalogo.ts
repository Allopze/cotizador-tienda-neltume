import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { normalizar, normalizarMedida, type FuenteCatalogo } from '../catalogo/resolver';
import { escalon, escalonesSeTocan } from '../catalogo/escalones';
import { ETIQUETA_ORIGEN, type OrigenCatalogo } from '../catalogo/origenes';
import {
  aliasMaderasConfiguradas,
  CONFIGURACION_CATALOGO_BASE,
  nombreCanonicoModelo,
  resolverMaderaConfigurada,
  resolverModeloConfigurado,
  resolverModeloPosibleConfigurado,
  validarConfiguracionCatalogo,
  type ConfiguracionCatalogo,
} from '../catalogo/configuracion';
import type { Catalogo, Madera, Producto } from '../catalogo/tipos';
import { ErrorUsuarioCatalogo } from './errores';

/** Producto agregado desde la aplicación (no importado): editable y eliminable. */
export type ProductoManual = Producto & {
  creada: string;
  creadaPor: string | null;
  actualizada: string | null;
};
/** Producto que puede mantenerse desde la aplicación; los importados no se pueden eliminar. */
export type ProductoAdministrable = Producto & {
  fuente: 'planilla' | 'manual';
  creada: string | null;
  creadaPor: string | null;
  actualizada: string | null;
};
export interface CambiosProductoManual {
  modelo?: string;
  familia?: Producto['familia'];
  madera?: string;
  medida?: string;
  anchoMin?: number | null;
  anchoMax?: number | null;
  altoMin?: number | null;
  altoMax?: number | null;
  largo?: number;
  precioNeto?: number;
  descripcion?: string;
  tipo?: string | null;
}
const traslapan = (a: Pick<Producto, 'anchoMin' | 'anchoMax'>, b: Pick<Producto, 'anchoMin' | 'anchoMax'>) =>
  a.anchoMin !== null &&
  a.anchoMax !== null &&
  b.anchoMin !== null &&
  b.anchoMax !== null &&
  a.anchoMin <= b.anchoMax + 1e-9 &&
  a.anchoMax >= b.anchoMin - 1e-9;

type FilaProducto = {
  codigo: string;
  modelo: string;
  familia: Producto['familia'];
  tipo: string | null;
  madera: Madera;
  medida: string;
  ancho_min: number | null;
  ancho_max: number | null;
  alto_min: number | null;
  alto_max: number | null;
  largo: number;
  precio_neto: number;
  descripcion: string;
  fila_origen: number;
};

const convertirProducto = (p: FilaProducto): Producto => ({
  codigo: p.codigo,
  modelo: nombreCanonicoModelo(p.modelo),
  familia: p.familia,
  tipo: p.tipo,
  madera: p.madera,
  medida: p.medida,
  anchoMin: p.ancho_min,
  anchoMax: p.ancho_max,
  ...(p.alto_min !== null ? { altoMin: p.alto_min } : {}),
  ...(p.alto_max !== null ? { altoMax: p.alto_max } : {}),
  largo: p.largo,
  precioNeto: p.precio_neto,
  descripcion: p.descripcion,
  filaOrigen: p.fila_origen,
});

const claveProducto = (producto: Pick<Producto, 'modelo' | 'madera' | 'medida' | 'largo'>) =>
  `${normalizar(producto.modelo)}|${normalizar(producto.madera)}|${normalizarMedida(producto.medida)}|${Math.round(producto.largo * 1_000_000)}`;

/** Una importación que deja menos de esta fracción de los productos anteriores de su origen exige `forzar`. */
export const MINIMO_PRODUCTOS_CONSERVADOS = 0.9;

/**
 * Posición global de un producto al listar: primero la planilla principal, luego las demás planillas y al
 * final los agregados a mano. `orden` es único solo dentro de su origen, así que se combina con el origen.
 */
const POSICION_PLANILLA = `(CASE origen WHEN 'principal' THEN 0 WHEN 'enchapadas' THEN 1 ELSE 2 END) * 1000000000 + orden`;
const POSICION_MANUAL = '3000000000 + rowid';
const COLUMNAS_PRODUCTO = `codigo, modelo, familia, tipo, madera, medida, ancho_min, ancho_max, alto_min, alto_max,
               largo, precio_neto, descripcion, fila_origen`;

const lista = (items: string[], max = 5) =>
  items.slice(0, max).join(', ') + (items.length > max ? ` y ${items.length - max} más` : '');

/** Fecha de la última importación y huella de todas las planillas juntas; se recalculan en cada importación. */
function actualizarMetadata(db: Database.Database, origen: OrigenCatalogo, catalogo: Catalogo, fecha: string) {
  db.prepare(
    `
    INSERT INTO catalogo_origenes (origen, fuente, sha256, fecha, cantidad_productos)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(origen) DO UPDATE SET
      fuente = excluded.fuente,
      sha256 = excluded.sha256,
      fecha = excluded.fecha,
      cantidad_productos = excluded.cantidad_productos
  `,
  ).run(origen, catalogo.fuente, catalogo.sha256, fecha, catalogo.productos.length);
  const origenes = db
    .prepare(
      `SELECT origen, fuente, sha256 FROM catalogo_origenes
       ORDER BY CASE origen WHEN 'principal' THEN 0 ELSE 1 END, origen`,
    )
    .all() as { origen: string; fuente: string; sha256: string }[];
  // Con una sola planilla la huella es la suya (igual que antes de haber varias); con varias, la de todas.
  const sha256 =
    origenes.length === 1
      ? origenes[0].sha256
      : createHash('sha256')
          .update(origenes.map((o) => `${o.origen}:${o.sha256}`).join('\n'))
          .digest('hex');
  const cantidad = db
    .prepare(
      'SELECT (SELECT COUNT(*) FROM productos_catalogo) + (SELECT COUNT(*) FROM productos_adicionales) AS n',
    )
    .get() as { n: number };
  db.prepare(
    `
    INSERT INTO catalogo_meta (id, fuente, sha256, fecha, cantidad_productos)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      fuente = excluded.fuente,
      sha256 = excluded.sha256,
      fecha = excluded.fecha,
      cantidad_productos = excluded.cantidad_productos
  `,
  ).run(origenes.map((o) => o.fuente).join(' + '), sha256, fecha, cantidad.n);
}

/**
 * Guarda los productos de una planilla: reemplaza solo los de su origen (`catalogo.origen`, por defecto la
 * principal) y deja los de otras planillas y los agregados a mano como estaban. El control del 90 % también
 * es por origen. Todo ocurre en una transacción: si algo falla, no cambia nada.
 */
export function guardarCatalogo(
  db: Database.Database,
  catalogo: Catalogo,
  configuracion: ConfiguracionCatalogo = CONFIGURACION_CATALOGO_BASE,
  { forzar = false }: { forzar?: boolean } = {},
) {
  if (!catalogo.productos.length) throw new Error('El catálogo no puede estar vacío.');
  const origen = catalogo.origen ?? 'principal';
  const configuracionValidada = validarConfiguracionCatalogo(configuracion);
  const insertar = db.prepare(`
    INSERT INTO productos_catalogo (
      codigo, origen, orden, modelo, modelo_normalizado, familia, tipo, madera, medida,
      ancho_min, ancho_max, alto_min, alto_max, largo, precio_neto, descripcion, fila_origen
    ) VALUES (
      @codigo, @origen, @orden, @modelo, @modelo_normalizado, @familia, @tipo, @madera, @medida,
      @ancho_min, @ancho_max, @alto_min, @alto_max, @largo, @precio_neto, @descripcion, @fila_origen
    )
  `);
  db.transaction(() => {
    const metaAnterior = db.prepare('SELECT fecha FROM catalogo_meta WHERE id = 1').get() as
      { fecha: string } | undefined;
    const fecha = new Date(
      Math.max(Date.parse(catalogo.fecha), metaAnterior ? Date.parse(metaAnterior.fecha) + 1 : 0),
    ).toISOString();
    const anteriores = (
      db.prepare('SELECT COUNT(*) AS n FROM productos_catalogo WHERE origen = ?').get(origen) as { n: number }
    ).n;
    if (!forzar && catalogo.productos.length < anteriores * MINIMO_PRODUCTOS_CONSERVADOS)
      throw new Error(
        `La planilla trae ${catalogo.productos.length} productos y el catálogo actual tiene ${anteriores}${origen === 'principal' ? '' : ` de la ${ETIQUETA_ORIGEN[origen].toLowerCase()}`}. Si la reducción es intencional, repite la importación con --forzar; el catálogo no se modificó.`,
      );
    db.prepare('DELETE FROM productos_catalogo WHERE origen = ?').run(origen);
    // Un código o producto que ya tiene otra planilla no se puede repetir: se avisa antes de que lo rechace SQLite.
    const deOtras = db
      .prepare('SELECT codigo, modelo, madera, medida, largo FROM productos_catalogo')
      .all() as Pick<Producto, 'codigo' | 'modelo' | 'madera' | 'medida' | 'largo'>[];
    const codigosOtras = new Set(deOtras.map((p) => p.codigo.toUpperCase()));
    const clavesOtras = new Set(deOtras.map(claveProducto));
    const repetidos = catalogo.productos.filter(
      (p) => codigosOtras.has(p.codigo.toUpperCase()) || clavesOtras.has(claveProducto(p)),
    );
    if (repetidos.length)
      throw new Error(
        `La planilla repite ${repetidos.length} código(s) o producto(s) de otra planilla ya importada: ${lista(repetidos.map((p) => p.codigo))}; el catálogo no se modificó.`,
      );
    catalogo.productos.forEach((p, orden) =>
      insertar.run({
        codigo: p.codigo,
        origen,
        orden,
        modelo: nombreCanonicoModelo(p.modelo),
        modelo_normalizado: normalizar(p.modelo),
        familia: p.familia,
        tipo: p.tipo,
        madera: p.madera,
        medida: p.medida,
        ancho_min: p.anchoMin,
        ancho_max: p.anchoMax,
        alto_min: p.altoMin ?? null,
        alto_max: p.altoMax ?? null,
        largo: p.largo,
        precio_neto: p.precioNeto,
        descripcion: p.descripcion,
        fila_origen: p.filaOrigen,
      }),
    );
    const manuales = db
      .prepare('SELECT codigo, modelo, madera, medida, largo FROM productos_adicionales')
      .all() as Pick<Producto, 'codigo' | 'modelo' | 'madera' | 'medida' | 'largo'>[];
    const codigosManuales = new Set(manuales.map((p) => p.codigo.toUpperCase()));
    const clavesManuales = new Set(manuales.map(claveProducto));
    if (
      catalogo.productos.some(
        (p) => codigosManuales.has(p.codigo.toUpperCase()) || clavesManuales.has(claveProducto(p)),
      )
    )
      throw new Error('La planilla repite un código o producto agregado manualmente.');
    actualizarMetadata(db, origen, catalogo, fecha);
    db.prepare(
      `
      INSERT INTO catalogo_configuracion (id, configuracion_json) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET configuracion_json = excluded.configuracion_json
    `,
    ).run(JSON.stringify(configuracionValidada));
  }).immediate();
}

export class RepositorioCatalogoSqlite implements FuenteCatalogo {
  readonly configuracion: ConfiguracionCatalogo;

  constructor(private db: Database.Database) {
    const fila = db.prepare('SELECT configuracion_json FROM catalogo_configuracion WHERE id = 1').get() as
      { configuracion_json: string } | undefined;
    let guardada: unknown = {};
    if (fila) {
      try {
        guardada = JSON.parse(fila.configuracion_json);
      } catch {
        throw new Error('La configuración del catálogo guardada en SQLite no es válida.');
      }
    }
    this.configuracion = validarConfiguracionCatalogo(guardada);
  }

  get metadata(): (Omit<Catalogo, 'productos'> & { cantidadProductos: number }) | null {
    const fila = this.db
      .prepare('SELECT fuente, sha256, fecha, cantidad_productos FROM catalogo_meta WHERE id = 1')
      .get() as { fuente: string; sha256: string; fecha: string; cantidad_productos: number } | undefined;
    return fila
      ? {
          fuente: fila.fuente,
          sha256: fila.sha256,
          fecha: fila.fecha,
          cantidadProductos: fila.cantidad_productos,
        }
      : null;
  }

  /** Última importación de una planilla; null si nunca se importó. */
  metadataOrigen(origen: OrigenCatalogo) {
    const fila = this.db
      .prepare('SELECT fuente, sha256, fecha, cantidad_productos FROM catalogo_origenes WHERE origen = ?')
      .get(origen) as { fuente: string; sha256: string; fecha: string; cantidad_productos: number } | undefined;
    return fila
      ? { fuente: fila.fuente, sha256: fila.sha256, fecha: fila.fecha, cantidadProductos: fila.cantidad_productos }
      : null;
  }

  /** Cuántos productos tiene cada planilla importada. */
  conteoPorOrigen(): Partial<Record<OrigenCatalogo, number>> {
    const filas = this.db
      .prepare('SELECT origen, COUNT(*) AS n FROM productos_catalogo GROUP BY origen')
      .all() as { origen: OrigenCatalogo; n: number }[];
    return Object.fromEntries(filas.map((f) => [f.origen, f.n]));
  }

  get version(): string | null {
    const metadata = this.metadata;
    return metadata ? `${metadata.sha256}:${metadata.fecha}` : null;
  }

  /**
   * ¿La versión corresponde a la misma planilla importada? Editar o agregar productos manuales cambia
   * la fecha de la versión, pero no invalida una propuesta en curso: sus reglas se revalidan al guardar.
   */
  mismaImportacion(version: string) {
    const actual = this.metadata;
    return !!actual && version.split(':')[0] === actual.sha256;
  }

  modelos() {
    return this.db
      .prepare(
        `
        SELECT modelo FROM (
          SELECT modelo, ${POSICION_PLANILLA} AS posicion FROM productos_catalogo
          UNION ALL
          SELECT modelo, ${POSICION_MANUAL} AS posicion FROM productos_adicionales
        ) GROUP BY modelo ORDER BY MIN(posicion)
      `,
      )
      .all()
      .map((r) => (r as { modelo: string }).modelo);
  }

  todos() {
    const filas = this.db
      .prepare(
        `
        SELECT ${COLUMNAS_PRODUCTO}
        FROM (
          SELECT ${POSICION_PLANILLA} AS posicion, ${COLUMNAS_PRODUCTO}
          FROM productos_catalogo
          UNION ALL
          SELECT ${POSICION_MANUAL} AS posicion, ${COLUMNAS_PRODUCTO}
          FROM productos_adicionales
        ) ORDER BY posicion
      `,
      )
      .all() as FilaProducto[];
    return filas.map(convertirProducto);
  }

  /** Productos de la última importación de una planilla; excluye las otras planillas y las altas manuales. */
  importados(origen: OrigenCatalogo) {
    const filas = this.db
      .prepare(`SELECT ${COLUMNAS_PRODUCTO} FROM productos_catalogo WHERE origen = ? ORDER BY orden`)
      .all(origen) as FilaProducto[];
    return filas.map(convertirProducto);
  }

  maderas() {
    return this.db
      .prepare(
        `
        SELECT madera FROM (
          SELECT madera, ${POSICION_PLANILLA} AS posicion FROM productos_catalogo
          UNION ALL
          SELECT madera, ${POSICION_MANUAL} AS posicion FROM productos_adicionales
        ) GROUP BY madera ORDER BY MIN(posicion)
      `,
      )
      .all()
      .map((r) => (r as { madera: Madera }).madera);
  }

  resolverMadera(valor: string) {
    return (
      resolverMaderaConfigurada(valor, this.configuracion) ??
      this.maderas().find((madera) => normalizar(madera) === normalizar(valor)) ??
      null
    );
  }

  resolverModelo(valor: string) {
    return resolverModeloConfigurado(valor, this.configuracion);
  }

  resolverModeloPosible(valor: string) {
    return resolverModeloPosibleConfigurado(valor, this.configuracion);
  }

  aliasMaderas() {
    const disponibles = new Set(this.maderas().map(normalizar));
    return Object.fromEntries(
      Object.entries(aliasMaderasConfiguradas(this.configuracion)).filter(([nombre]) =>
        disponibles.has(normalizar(nombre)),
      ),
    );
  }

  aliasModelos() {
    const disponibles = new Set(this.modelos().map(normalizar));
    return Object.fromEntries(
      Object.entries(this.configuracion.aliasModelos).filter(([nombre]) =>
        disponibles.has(normalizar(nombre)),
      ),
    );
  }

  productosDeModelo(modeloNormalizado: string) {
    const filas = this.db
      .prepare(
        `
        SELECT ${COLUMNAS_PRODUCTO}
        FROM (
          SELECT modelo_normalizado, ${POSICION_PLANILLA} AS posicion, ${COLUMNAS_PRODUCTO}
          FROM productos_catalogo
          UNION ALL
          SELECT modelo_normalizado, ${POSICION_MANUAL} AS posicion, ${COLUMNAS_PRODUCTO}
          FROM productos_adicionales
        ) WHERE modelo_normalizado = ?
        ORDER BY posicion
      `,
      )
      .all(modeloNormalizado) as FilaProducto[];
    return filas.map(convertirProducto);
  }

  buscarPorCodigo(codigo: string) {
    const fila = this.db
      .prepare(
        `
        SELECT codigo, modelo, familia, tipo, madera, medida, ancho_min, ancho_max, alto_min, alto_max,
               largo, precio_neto, descripcion, fila_origen
        FROM productos_catalogo WHERE codigo = ?
        UNION ALL
        SELECT codigo, modelo, familia, tipo, madera, medida, ancho_min, ancho_max, alto_min, alto_max,
               largo, precio_neto, descripcion, fila_origen
        FROM productos_adicionales WHERE codigo = ?
        LIMIT 1
      `,
      )
      .get(codigo, codigo) as FilaProducto | undefined;
    return fila ? convertirProducto(fila) : undefined;
  }

  productoDuplicado(producto: Producto) {
    const porCodigo = this.buscarPorCodigo(producto.codigo);
    if (porCodigo) return porCodigo;
    return (
      this.productosDeModelo(normalizar(producto.modelo)).find(
        (existente) =>
          normalizar(existente.madera) === normalizar(producto.madera) &&
          normalizarMedida(existente.medida) === normalizarMedida(producto.medida) &&
          Math.abs(existente.largo - producto.largo) < 0.000001,
      ) ?? null
    );
  }

  familiaExistente(modelo: string) {
    return this.productosDeModelo(normalizar(modelo))[0]?.familia ?? null;
  }

  /** Puerta del mismo modelo, madera y alto cuyo rango de ancho se cruza con el propuesto. */
  rangoSuperpuesto(producto: Producto, excluirCodigo?: string) {
    if (producto.familia !== 'PUERTA') return null;
    const alto = escalon(producto, 'alto');
    return (
      this.productosDeModelo(normalizar(producto.modelo)).find(
        (p) =>
          p.codigo !== excluirCodigo &&
          normalizar(p.madera) === normalizar(producto.madera) &&
          escalonesSeTocan(escalon(p, 'alto'), alto) &&
          traslapan(p, producto),
      ) ?? null
    );
  }

  /** Precios netos de referencia: mismo modelo o, si es nuevo, misma familia. */
  preciosReferencia(modelo: string, familia: Producto['familia']): number[] {
    const delModelo = this.productosDeModelo(normalizar(modelo)).map((p) => p.precioNeto);
    if (delModelo.length) return delModelo;
    return (
      this.db
        .prepare(
          `
          SELECT precio_neto FROM productos_catalogo WHERE familia = ?
          UNION ALL SELECT precio_neto FROM productos_adicionales WHERE familia = ?
        `,
        )
        .all(familia, familia) as { precio_neto: number }[]
    ).map((f) => f.precio_neto);
  }

  private tocarMetadata() {
    const cantidad = this.db
      .prepare(
        'SELECT (SELECT COUNT(*) FROM productos_catalogo) + (SELECT COUNT(*) FROM productos_adicionales) AS n',
      )
      .get() as { n: number };
    const fechaAnterior = this.metadata?.fecha;
    const fecha = new Date(
      Math.max(Date.now(), fechaAnterior ? Date.parse(fechaAnterior) + 1 : 0),
    ).toISOString();
    this.db
      .prepare('UPDATE catalogo_meta SET fecha = ?, cantidad_productos = ? WHERE id = 1')
      .run(fecha, cantidad.n);
  }

  listarManuales(): ProductoManual[] {
    const filas = this.db
      .prepare(
        `
        SELECT codigo, modelo, familia, tipo, madera, medida, ancho_min, ancho_max, alto_min, alto_max, largo, precio_neto,
               descripcion, fila_origen, creada, creada_por, actualizada
        FROM productos_adicionales ORDER BY creada DESC, rowid DESC
      `,
      )
      .all() as (FilaProducto & { creada: string; creada_por: string | null; actualizada: string | null })[];
    return filas.map((f) => ({
      ...convertirProducto(f),
      creada: f.creada,
      creadaPor: f.creada_por,
      actualizada: f.actualizada,
    }));
  }

  /**
   * Lista productos de ambas fuentes para su mantenimiento. La búsqueda se hace sobre los atributos
   * legibles y el resultado se limita para que una instalación con miles de filas no bloquee la
   * pantalla; `total` es cuántas coincidieron antes del tope, para poder decirlo en la interfaz.
   */
  listarAdministrables(busqueda = '', limite = 300): { productos: ProductoAdministrable[]; total: number } {
    const filas = this.db
      .prepare(
        `
        SELECT 'planilla' AS fuente, NULL AS creada, NULL AS creada_por, NULL AS actualizada,
               codigo, modelo, familia, tipo, madera, medida, ancho_min, ancho_max, alto_min, alto_max, largo, precio_neto,
               descripcion, fila_origen, ${POSICION_PLANILLA} AS orden_fuente
        FROM productos_catalogo
        UNION ALL
        SELECT 'manual' AS fuente, creada, creada_por, actualizada,
               codigo, modelo, familia, tipo, madera, medida, ancho_min, ancho_max, alto_min, alto_max, largo, precio_neto,
               descripcion, fila_origen, rowid AS orden_fuente
        FROM productos_adicionales
        ORDER BY fuente, orden_fuente
      `,
      )
      .all() as (FilaProducto & {
      fuente: 'planilla' | 'manual';
      creada: string | null;
      creada_por: string | null;
      actualizada: string | null;
      orden_fuente: number;
    })[];
    const termino = normalizar(busqueda.trim());
    const coinciden = filas
      .map((f) => ({
        ...convertirProducto(f),
        fuente: f.fuente,
        creada: f.creada,
        creadaPor: f.creada_por,
        actualizada: f.actualizada,
      }))
      .filter((p) =>
        termino
          ? normalizar(`${p.codigo} ${p.modelo} ${p.madera} ${p.medida} ${p.descripcion}`).includes(termino)
          : true,
      );
    return { productos: coinciden.slice(0, Math.max(1, Math.min(limite, 500))), total: coinciden.length };
  }

  private manual(codigo: string) {
    const existe = this.db.prepare('SELECT 1 FROM productos_adicionales WHERE codigo = ?').get(codigo);
    if (existe) return;
    if (this.db.prepare('SELECT 1 FROM productos_catalogo WHERE codigo = ?').get(codigo))
      throw new ErrorUsuarioCatalogo(
        'Solo se pueden modificar productos agregados en la aplicación; los importados se cambian en la planilla.',
        'estado_invalido',
        409,
      );
    throw new ErrorUsuarioCatalogo('No se encontró el producto.', 'no_encontrada', 404);
  }

  /** Cambia cualquier atributo operativo de un producto manual; las cotizaciones emitidas conservan su snapshot. */
  editarProducto(codigo: string, cambios: CambiosProductoManual) {
    return this.db
      .transaction(() => {
        const fuente = this.db.prepare('SELECT 1 FROM productos_adicionales WHERE codigo = ?').get(codigo)
          ? 'manual'
          : this.db.prepare('SELECT 1 FROM productos_catalogo WHERE codigo = ?').get(codigo)
            ? 'planilla'
            : null;
        if (!fuente) throw new ErrorUsuarioCatalogo('No se encontró el producto.', 'no_encontrada', 404);
        const actual = this.buscarPorCodigo(codigo)!;
        const modelo = nombreCanonicoModelo(cambios.modelo?.replace(/\s+/g, ' ').trim() || actual.modelo);
        const familia = cambios.familia ?? actual.familia;
        const madera = cambios.madera?.replace(/\s+/g, ' ').trim() || actual.madera;
        const medida = cambios.medida?.replace(/\s+/g, ' ').trim() || actual.medida;
        const anchoMin = cambios.anchoMin === undefined ? actual.anchoMin : cambios.anchoMin;
        const anchoMax = cambios.anchoMax === undefined ? actual.anchoMax : cambios.anchoMax;
        const altoMin = cambios.altoMin === undefined ? actual.altoMin ?? null : cambios.altoMin;
        const altoMax = cambios.altoMax === undefined ? actual.altoMax ?? null : cambios.altoMax;
        const largo = cambios.largo ?? actual.largo;
        const precioNeto = cambios.precioNeto ?? actual.precioNeto;
        if (!modelo || !madera || !medida || !Number.isFinite(largo) || largo <= 0 || largo > 100)
          throw new ErrorUsuarioCatalogo('Modelo, madera, medida y largo deben tener valores válidos.');
        if (
          (anchoMin !== null && (!Number.isFinite(anchoMin) || anchoMin <= 0)) ||
          (anchoMax !== null && (!Number.isFinite(anchoMax) || anchoMax <= 0)) ||
          (anchoMin !== null && anchoMax !== null && anchoMin > anchoMax)
        )
          throw new ErrorUsuarioCatalogo('El rango de ancho no es válido.');
        if ((altoMin !== null && (altoMin <= 0 || altoMin > 100)) || (altoMax !== null && (altoMax <= 0 || altoMax > 100)) || (altoMin !== null && altoMax !== null && altoMin > altoMax))
          throw new ErrorUsuarioCatalogo('El rango de alto no es válido.');
        if (!Number.isFinite(precioNeto) || precioNeto <= 0 || precioNeto > 100_000_000)
          throw new ErrorUsuarioCatalogo(
            'El precio neto unitario debe ser mayor que $0 y no superar $100.000.000.',
          );
        const descripcion = cambios.descripcion?.replace(/\s+/g, ' ').trim() || actual.descripcion;
        const tipo =
          cambios.tipo === undefined ? actual.tipo : cambios.tipo?.trim().toLocaleUpperCase('es-CL') || null;
        const candidato: Producto = {
          ...actual,
          modelo,
          familia,
          madera,
          medida,
          anchoMin,
          anchoMax,
          altoMin,
          altoMax,
          largo,
          precioNeto,
          descripcion,
          tipo,
        };
        const duplicado = this.productosDeModelo(normalizar(modelo)).find(
          (p) =>
            p.codigo !== codigo &&
            normalizar(p.madera) === normalizar(madera) &&
            normalizarMedida(p.medida) === normalizarMedida(medida) &&
            Math.abs(p.largo - largo) < 0.000001,
        );
        if (duplicado) throw new ErrorUsuarioCatalogo('Ya existe un producto con esos atributos.');
        const superpuesto = this.rangoSuperpuesto(candidato, codigo);
        if (superpuesto)
          throw new ErrorUsuarioCatalogo(
            `El rango de ancho se superpone con ${superpuesto.codigo} (${superpuesto.medida}) para el mismo modelo, madera y alto.`,
          );
        if (fuente === 'manual') {
          this.db
            .prepare(
              `UPDATE productos_adicionales SET
                modelo = ?, modelo_normalizado = ?, familia = ?, madera = ?, medida = ?, ancho_min = ?, ancho_max = ?, alto_min = ?, alto_max = ?,
                largo = ?, precio_neto = ?, descripcion = ?, tipo = ?, actualizada = ? WHERE codigo = ?`,
            )
            .run(
              modelo,
              normalizar(modelo),
              familia,
              madera,
              medida,
              anchoMin,
              anchoMax,
              altoMin,
              altoMax,
              largo,
              precioNeto,
              descripcion.slice(0, 300),
              tipo,
              new Date().toISOString(),
              codigo,
            );
        } else {
          this.db
            .prepare(
              `UPDATE productos_catalogo SET
                modelo = ?, modelo_normalizado = ?, familia = ?, madera = ?, medida = ?, ancho_min = ?, ancho_max = ?, alto_min = ?, alto_max = ?,
                largo = ?, precio_neto = ?, descripcion = ?, tipo = ? WHERE codigo = ?`,
            )
            .run(
              modelo,
              normalizar(modelo),
              familia,
              madera,
              medida,
              anchoMin,
              anchoMax,
              altoMin,
              altoMax,
              largo,
              precioNeto,
              descripcion.slice(0, 300),
              tipo,
              codigo,
            );
        }
        this.tocarMetadata();
        return this.buscarPorCodigo(codigo)!;
      })
      .immediate();
  }

  editarManual(codigo: string, cambios: CambiosProductoManual) {
    this.manual(codigo);
    return this.editarProducto(codigo, cambios);
  }

  guardarConfiguracion(configuracion: ConfiguracionCatalogo) {
    const validada = validarConfiguracionCatalogo(configuracion);
    this.db
      .prepare(
        `INSERT INTO catalogo_configuracion (id, configuracion_json) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET configuracion_json = excluded.configuracion_json`,
      )
      .run(JSON.stringify(validada));
    this.tocarMetadata();
    return validada;
  }

  /** Elimina un producto manual. Los borradores que lo usaban quedan pendientes al recalcular. */
  eliminarManual(codigo: string) {
    this.db
      .transaction(() => {
        this.manual(codigo);
        this.db.prepare('DELETE FROM productos_adicionales WHERE codigo = ?').run(codigo);
        this.tocarMetadata();
      })
      .immediate();
  }

  agregarProductoManual(
    producto: Producto,
    versionEsperada: string,
    pendienteId?: string,
    creadaPor: string | null = null,
  ) {
    return this.db
      .transaction(() => {
        if (!this.mismaImportacion(versionEsperada))
          throw new ErrorUsuarioCatalogo(
            'El catálogo cambió mientras revisabas el producto. Vuelve a generar la propuesta.',
            'version_obsoleta',
            409,
          );
        const familia = this.familiaExistente(producto.modelo);
        if (familia && familia !== producto.familia)
          throw new ErrorUsuarioCatalogo(
            'Ese modelo ya existe con otra familia. Usa un nombre de modelo distinto.',
          );
        if (this.productoDuplicado(producto))
          throw new ErrorUsuarioCatalogo('Ya existe un producto con esos atributos.');
        const superpuesto = this.rangoSuperpuesto(producto);
        if (superpuesto)
          throw new ErrorUsuarioCatalogo(
            `El rango de ancho se superpone con ${superpuesto.codigo} (${superpuesto.medida}) para el mismo modelo, madera y alto.`,
          );
        const creada = new Date().toISOString();
        this.db
          .prepare(
            `
          INSERT INTO productos_adicionales (
            codigo, modelo, modelo_normalizado, familia, tipo, madera, medida, ancho_min, ancho_max, alto_min, alto_max,
            largo, precio_neto, descripcion, fila_origen, creada, creada_por
          ) VALUES (
            @codigo, @modelo, @modelo_normalizado, @familia, @tipo, @madera, @medida, @ancho_min, @ancho_max, @alto_min, @alto_max,
            @largo, @precio_neto, @descripcion, 0, @creada, @creada_por
          )
        `,
          )
          .run({
            codigo: producto.codigo,
            modelo: nombreCanonicoModelo(producto.modelo),
            modelo_normalizado: normalizar(producto.modelo),
            familia: producto.familia,
            tipo: producto.tipo,
            madera: producto.madera,
            medida: producto.medida,
            ancho_min: producto.anchoMin,
            ancho_max: producto.anchoMax,
            alto_min: producto.altoMin ?? null,
            alto_max: producto.altoMax ?? null,
            largo: producto.largo,
            precio_neto: producto.precioNeto,
            descripcion: producto.descripcion,
            creada,
            creada_por: creadaPor,
          });
        this.tocarMetadata();
        if (pendienteId) this.db.prepare('DELETE FROM productos_pendientes WHERE id = ?').run(pendienteId);
        return producto;
      })
      .immediate();
  }
}

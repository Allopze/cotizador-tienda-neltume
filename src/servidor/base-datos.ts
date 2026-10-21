import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CORRELATIVO_COTIZACION, CORRELATIVO_NOTA, CORRELATIVOS_NOTA, FABRICAS } from '../negocio/estado';
import { REGLAS } from '../negocio/precios';
import { registrarFeriadosExternos } from '../negocio/feriados';
import { textoBusqueda } from './busqueda';

/** Versión del esquema que deja `crearEsquema`; las pruebas de migración la comparan con `user_version`. */
export const VERSION_ESQUEMA = 24;
const SQLITE_GLOBAL = '__neltumeSqliteConnections';
const SQLITE_CLEANUP = '__neltumeSqliteCleanup';
type GlobalWithConnections = typeof globalThis & {
  [SQLITE_GLOBAL]?: Map<string, Database.Database>;
  [SQLITE_CLEANUP]?: boolean;
};

/** Mensaje técnico para terminal y registro; las rutas responden un texto genérico. */
export class ErrorMigracionRequerida extends Error {
  constructor() {
    super('Hay archivos JSON anteriores. Ejecuta npm run migrar:sqlite antes de iniciar el cotizador.');
    this.name = 'ErrorMigracionRequerida';
  }
}

export const directorioDatos = () =>
  resolve(/* turbopackIgnore: true */ process.env.NELTUME_DATA_DIR ?? 'data');

export function rutaBaseDatos() {
  return resolve(
    /* turbopackIgnore: true */
    process.env.NELTUME_DB_PATH ?? join(directorioDatos(), 'cotizador.sqlite'),
  );
}

export function rutaCatalogoLegado() {
  return resolve(/* turbopackIgnore: true */ process.env.NELTUME_CATALOGO ?? 'data/catalogo.json');
}

function hayJsonLegado(datos: string, revisarCatalogoPredeterminado: boolean) {
  const directorio = resolve(datos);
  if (existsSync(join(directorio, 'estado.json'))) return true;
  const catalogo = rutaCatalogoLegado();
  const relativo = catalogo === directorio || catalogo.startsWith(`${directorio}/`);
  const catalogoConfigurado = revisarCatalogoPredeterminado && !!process.env.NELTUME_CATALOGO;
  const datosPredeterminados =
    revisarCatalogoPredeterminado && !process.env.NELTUME_DATA_DIR && directorio === resolve('data');
  return existsSync(catalogo) && (relativo || catalogoConfigurado || datosPredeterminados);
}

function crearEsquema(db: Database.Database) {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > VERSION_ESQUEMA)
    throw new Error(`La base SQLite usa una versión de esquema más nueva (${version}).`);
  if (version === VERSION_ESQUEMA) return;
  if (version < 4) crearEsquemaHasta4(db, version);
  if (version < 5)
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ajustes (
          clave TEXT PRIMARY KEY,
          valor_json TEXT NOT NULL,
          actualizada TEXT NOT NULL
        );
        PRAGMA user_version = 5;
      `);
    }).immediate();
  if (version < 6) migrarA6(db);
  if (version < 7)
    db.transaction(() => {
      // v7: registro de actividad por cotización (quién hizo qué y cuándo).
      db.exec(`
        CREATE TABLE IF NOT EXISTS eventos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cotizacion_id TEXT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
          fecha TEXT NOT NULL,
          usuario TEXT,
          tipo TEXT NOT NULL,
          detalle TEXT
        );
        CREATE INDEX IF NOT EXISTS eventos_cotizacion ON eventos(cotizacion_id, id);
        PRAGMA user_version = 7;
      `);
    }).immediate();
  if (version < 8)
    db.transaction(() => {
      // v8: feriados sincronizados desde la fuente pública y estado de la sincronización por año.
      db.exec(`
        CREATE TABLE IF NOT EXISTS feriados (
          fecha TEXT PRIMARY KEY,
          anio INTEGER NOT NULL,
          nombre TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS feriados_sincronizacion (
          anio INTEGER PRIMARY KEY,
          sincronizado TEXT,
          intentado TEXT NOT NULL,
          error TEXT
        );
        PRAGMA user_version = 8;
      `);
    }).immediate();
  if (version < 9)
    db.transaction(() => {
      // v9: precios unitarios excepcionales, observaciones, despacho preparado y reglas por cotización.
      db.exec(`
        ALTER TABLE cotizaciones ADD COLUMN observaciones TEXT;
        ALTER TABLE cotizaciones ADD COLUMN despacho_direccion TEXT;
        ALTER TABLE cotizaciones ADD COLUMN despacho_transporte TEXT;
        ALTER TABLE cotizaciones ADD COLUMN despacho_entrega TEXT;
        ALTER TABLE cotizaciones ADD COLUMN reglas_json TEXT;
        ALTER TABLE solicitudes ADD COLUMN precio_unitario INTEGER;
        ALTER TABLE cotizacion_lineas ADD COLUMN precio_unitario_personalizado INTEGER;
        ALTER TABLE notas_pedido ADD COLUMN despacho_entrega TEXT;
        ALTER TABLE notas_pedido ADD COLUMN observaciones TEXT;
        ALTER TABLE nota_lineas ADD COLUMN precio_unitario_personalizado INTEGER;
      `);
      db.prepare('UPDATE cotizaciones SET reglas_json = ? WHERE reglas_json IS NULL').run(JSON.stringify(REGLAS));
      db.pragma('user_version = 9');
    }).immediate();
  if (version < 10)
    db.transaction(() => {
      // v10: feriados adicionales definidos por la empresa. Ya no se usan (los feriados son solo automáticos);
      // la tabla se conserva para no borrar datos de instalaciones existentes.
      db.exec(`
        CREATE TABLE IF NOT EXISTS feriados_manuales (
          fecha TEXT PRIMARY KEY,
          nombre TEXT NOT NULL,
          creada TEXT NOT NULL
        );
        PRAGMA user_version = 10;
      `);
    }).immediate();
  if (version < 11)
    db.transaction(() => {
      // v11: márgenes por categoría, descripción y tipo de medida editables, pagos y flujo operativo.
      db.exec(`
        ALTER TABLE cotizaciones ADD COLUMN estado_comercial TEXT NOT NULL DEFAULT 'pendiente';
        ALTER TABLE cotizaciones ADD COLUMN estado_operativo TEXT NOT NULL DEFAULT 'sin_pedido';
        ALTER TABLE cotizaciones ADD COLUMN despacho_destino TEXT;
        ALTER TABLE cotizaciones ADD COLUMN despacho_valor INTEGER;
        ALTER TABLE cotizaciones ADD COLUMN facturacion_estado TEXT NOT NULL DEFAULT 'pendiente';
        ALTER TABLE cotizaciones ADD COLUMN facturacion_tipo TEXT;
        ALTER TABLE cotizaciones ADD COLUMN facturacion_id_externo TEXT;
        ALTER TABLE cotizaciones ADD COLUMN facturacion_fecha TEXT;
        ALTER TABLE solicitudes ADD COLUMN margen REAL;
        ALTER TABLE solicitudes ADD COLUMN tipo_medida TEXT;
        ALTER TABLE solicitudes ADD COLUMN descripcion TEXT;
        ALTER TABLE solicitudes ADD COLUMN observaciones TEXT;
        ALTER TABLE solicitudes ADD COLUMN modelo_original TEXT;
        ALTER TABLE solicitudes ADD COLUMN coincidencia_modelo TEXT;
        ALTER TABLE productos_catalogo ADD COLUMN alto_min REAL;
        ALTER TABLE productos_catalogo ADD COLUMN alto_max REAL;
        ALTER TABLE productos_adicionales ADD COLUMN alto_min REAL;
        ALTER TABLE productos_adicionales ADD COLUMN alto_max REAL;
        ALTER TABLE cotizacion_lineas ADD COLUMN alto_min REAL;
        ALTER TABLE cotizacion_lineas ADD COLUMN alto_max REAL;
        ALTER TABLE nota_lineas ADD COLUMN alto_min REAL;
        ALTER TABLE nota_lineas ADD COLUMN alto_max REAL;
        ALTER TABLE cotizacion_lineas ADD COLUMN precio_fabrica REAL;
        ALTER TABLE cotizacion_lineas ADD COLUMN margen REAL;
        ALTER TABLE cotizacion_lineas ADD COLUMN margen_personalizado INTEGER;
        ALTER TABLE cotizacion_lineas ADD COLUMN precio_cliente INTEGER;
        ALTER TABLE cotizacion_lineas ADD COLUMN tipo_medida TEXT;
        ALTER TABLE cotizacion_lineas ADD COLUMN observaciones TEXT;
        ALTER TABLE nota_lineas ADD COLUMN precio_fabrica REAL;
        ALTER TABLE nota_lineas ADD COLUMN margen REAL;
        ALTER TABLE nota_lineas ADD COLUMN margen_personalizado INTEGER;
        ALTER TABLE nota_lineas ADD COLUMN precio_cliente INTEGER;
        ALTER TABLE nota_lineas ADD COLUMN tipo_medida TEXT;
        ALTER TABLE nota_lineas ADD COLUMN observaciones TEXT;
        CREATE TABLE pagos (
          id TEXT PRIMARY KEY,
          cotizacion_id TEXT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
          fecha TEXT NOT NULL,
          monto INTEGER NOT NULL CHECK (monto > 0),
          observacion TEXT,
          usuario TEXT
        );
        CREATE INDEX pagos_cotizacion_fecha ON pagos(cotizacion_id, fecha, id);
        CREATE TABLE comentarios_internos (
          id TEXT PRIMARY KEY,
          cotizacion_id TEXT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
          fecha TEXT NOT NULL,
          texto TEXT NOT NULL,
          usuario TEXT
        );
        CREATE INDEX comentarios_cotizacion_fecha ON comentarios_internos(cotizacion_id, fecha, id);
        UPDATE cotizaciones SET estado_comercial = CASE
          WHEN estado = 'aprobada' THEN 'aprobada'
          WHEN estado = 'emitida' THEN 'enviada'
          WHEN estado = 'anulada' THEN 'rechazada'
          ELSE 'pendiente' END;
        UPDATE cotizaciones SET estado_operativo = 'pedido_generado'
          WHERE EXISTS (SELECT 1 FROM notas_pedido n WHERE n.cotizacion_id = cotizaciones.id);
        UPDATE productos_catalogo SET modelo = 'Huilo Huilo' WHERE modelo_normalizado = 'HUILOHUILO';
        UPDATE productos_adicionales SET modelo = 'Huilo Huilo' WHERE modelo_normalizado = 'HUILOHUILO';
        UPDATE solicitudes SET modelo = 'Huilo Huilo' WHERE UPPER(REPLACE(REPLACE(modelo, ' ', ''), '-', '')) = 'HUILOHUILO';
        UPDATE cotizacion_lineas SET modelo = 'Huilo Huilo', descripcion = REPLACE(descripcion, 'HUILO HUILO', 'Huilo Huilo') WHERE UPPER(REPLACE(REPLACE(modelo, ' ', ''), '-', '')) = 'HUILOHUILO';
        UPDATE nota_lineas SET modelo = 'Huilo Huilo', descripcion = REPLACE(descripcion, 'HUILO HUILO', 'Huilo Huilo') WHERE UPPER(REPLACE(REPLACE(modelo, ' ', ''), '-', '')) = 'HUILOHUILO';
        PRAGMA user_version = 11;
      `);
    }).immediate();
  if (version < 12)
    db.transaction(() => {
      // v12: la descripción del documento va aparte de la del producto de catálogo. Además se deshace el
      // REPLACE de v11 sobre las descripciones (en el catálogo están en mayúsculas), también en el catálogo
      // importado con la versión intermedia del importador; solo donde el resto del texto sigue en mayúsculas,
      // para no tocar lo que alguien escribió a mano. También se borra la observación «Rectificar…» que el
      // sistema agregaba sola: solo si la solicitud de esa línea no tiene observación, es decir, si nadie la escribió.
      const revertirHuiloHuilo = (tabla: string) => `
        UPDATE ${tabla} SET descripcion = REPLACE(descripcion, 'Huilo Huilo', 'HUILO HUILO')
          WHERE modelo = 'Huilo Huilo' AND INSTR(descripcion, 'Huilo Huilo') > 0
            AND REPLACE(descripcion, 'Huilo Huilo', 'HUILO HUILO') = UPPER(descripcion);`;
      const limpiarRectificar = (tabla: string) => `
        UPDATE ${tabla} SET observaciones = NULL
          WHERE observaciones = 'Rectificar si la medida corresponde a hoja o vano.'
            AND EXISTS (
              SELECT 1 FROM solicitudes s
              WHERE s.cotizacion_id = ${tabla}.cotizacion_id AND s.orden = ${tabla}.indice
                AND TRIM(COALESCE(s.observaciones, '')) = ''
            );`;
      db.exec(`
        ALTER TABLE cotizacion_lineas ADD COLUMN descripcion_documento TEXT;
        ALTER TABLE nota_lineas ADD COLUMN descripcion_documento TEXT;
        ${['cotizacion_lineas', 'nota_lineas', 'productos_catalogo', 'productos_adicionales'].map(revertirHuiloHuilo).join('')}
        ${['cotizacion_lineas', 'nota_lineas'].map(limpiarRectificar).join('')}
        PRAGMA user_version = 12;
      `);
    }).immediate();
  if (version < 13)
    db.transaction(() => {
      // v13: margen especial de toda la cotización (fracción; NULL = el de cada categoría). Las reglas
      // congeladas de las cotizaciones existentes quedan como están: sin las categorías nuevas, esas
      // usan su propio `otros`.
      db.exec(`
        ALTER TABLE cotizaciones ADD COLUMN margen_cotizacion REAL;
        PRAGMA user_version = 13;
      `);
    }).immediate();
  if (version < 14)
    db.transaction(() => {
      // v14: cada planilla de precios es un origen del catálogo. Importar una reemplaza solo sus productos,
      // así que `orden` pasa a ser único por origen (se reconstruye la tabla para quitar el UNIQUE global) y
      // los metadatos de la última importación se guardan por origen. Lo existente queda como 'principal'.
      const tieneOrigen = (db.pragma('table_info(productos_catalogo)') as { name: string }[]).some(
        (columna) => columna.name === 'origen',
      );
      if (!tieneOrigen)
        db.exec(`
          CREATE TABLE productos_catalogo_v14 (
            codigo TEXT PRIMARY KEY,
            origen TEXT NOT NULL DEFAULT 'principal',
            orden INTEGER NOT NULL CHECK (orden >= 0),
            modelo TEXT NOT NULL,
            modelo_normalizado TEXT NOT NULL,
            familia TEXT NOT NULL CHECK (familia IN ('PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA')),
            tipo TEXT,
            madera TEXT NOT NULL,
            medida TEXT NOT NULL,
            ancho_min REAL,
            ancho_max REAL,
            alto_min REAL,
            alto_max REAL,
            largo REAL NOT NULL,
            precio_neto REAL NOT NULL CHECK (precio_neto > 0),
            descripcion TEXT NOT NULL,
            fila_origen INTEGER NOT NULL,
            UNIQUE (origen, orden),
            UNIQUE (modelo, madera, medida, largo)
          );
          INSERT INTO productos_catalogo_v14 (
            codigo, origen, orden, modelo, modelo_normalizado, familia, tipo, madera, medida,
            ancho_min, ancho_max, alto_min, alto_max, largo, precio_neto, descripcion, fila_origen
          )
          SELECT codigo, 'principal', orden, modelo, modelo_normalizado, familia, tipo, madera, medida,
                 ancho_min, ancho_max, alto_min, alto_max, largo, precio_neto, descripcion, fila_origen
          FROM productos_catalogo;
          DROP TABLE productos_catalogo;
          ALTER TABLE productos_catalogo_v14 RENAME TO productos_catalogo;
          CREATE INDEX idx_producto_modelo ON productos_catalogo(modelo_normalizado, orden);
          CREATE INDEX idx_producto_modelo_madera ON productos_catalogo(modelo_normalizado, madera, orden);
          CREATE INDEX idx_producto_modelo_medida_largo
            ON productos_catalogo(modelo_normalizado, medida, largo, orden);
        `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS catalogo_origenes (
          origen TEXT PRIMARY KEY,
          fuente TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          fecha TEXT NOT NULL,
          cantidad_productos INTEGER NOT NULL CHECK (cantidad_productos >= 0)
        );
        INSERT OR IGNORE INTO catalogo_origenes (origen, fuente, sha256, fecha, cantidad_productos)
          SELECT 'principal', fuente, sha256, fecha, (SELECT COUNT(*) FROM productos_catalogo)
          FROM catalogo_meta WHERE id = 1;
        PRAGMA user_version = 14;
      `);
    }).immediate();
  if (version < 15)
    db.transaction(() => {
      // v15: descuento por cantidad. `descuento_manual` = la persona fijó el descuento (no cambia con las
      // líneas hasta restaurar el automático). Todo descuento que ya existe lo fijó una persona, así que
      // esas cotizaciones quedan manuales; con descuento 0 quedan automáticas, y sus reglas congeladas no
      // tienen tramos, por lo que siguen en 0. Sin reescribir nada más: los tramos viven en `reglas_json`.
      const tieneColumna = (db.pragma('table_info(cotizaciones)') as { name: string }[]).some(
        (columna) => columna.name === 'descuento_manual',
      );
      if (!tieneColumna)
        db.exec(`
          ALTER TABLE cotizaciones ADD COLUMN descuento_manual INTEGER NOT NULL DEFAULT 0
            CHECK (descuento_manual IN (0, 1));
          UPDATE cotizaciones SET descuento_manual = 1 WHERE descuento > 0;
        `);
      db.exec('PRAGMA user_version = 15;');
    }).immediate();
  if (version < 16)
    db.transaction(() => {
      // v16: frase del pedido de la que salió cada ítem; los ítems existentes quedan sin ella.
      const tieneColumna = (db.pragma('table_info(solicitudes)') as { name: string }[]).some(
        (columna) => columna.name === 'fuente',
      );
      if (!tieneColumna) db.exec('ALTER TABLE solicitudes ADD COLUMN fuente TEXT;');
      db.exec('PRAGMA user_version = 16;');
    }).immediate();
  if (version < 17)
    db.transaction(() => {
      // v17: el flete es una línea más del detalle, con descripción y cantidad propias. Las cotizaciones
      // existentes quedan con una unidad y la descripción automática (destino y transportista).
      const columnas = (db.pragma('table_info(cotizaciones)') as { name: string }[]).map((c) => c.name);
      if (!columnas.includes('flete_descripcion'))
        db.exec('ALTER TABLE cotizaciones ADD COLUMN flete_descripcion TEXT;');
      if (!columnas.includes('flete_cantidad'))
        db.exec(
          'ALTER TABLE cotizaciones ADD COLUMN flete_cantidad INTEGER NOT NULL DEFAULT 1 CHECK (flete_cantidad >= 1);',
        );
      db.exec('PRAGMA user_version = 17;');
    }).immediate();
  if (version < 18)
    db.transaction(() => {
      // v18: distingue las medidas predeterminadas del catálogo de las ingresadas por la persona.
      const tieneColumna = (db.pragma('table_info(solicitudes)') as { name: string }[]).some(
        (columna) => columna.name === 'medida_por_defecto',
      );
      if (!tieneColumna)
        db.exec('ALTER TABLE solicitudes ADD COLUMN medida_por_defecto INTEGER NOT NULL DEFAULT 0 CHECK (medida_por_defecto IN (0, 1));');
      db.exec('PRAGMA user_version = 18;');
    }).immediate();
  if (version < 19)
    db.transaction(() => {
      // v19: productos fuera de catálogo (con la familia con que se cotizan) y referencias del cliente por ítem.
      // Los archivos viven en data/referencias/; aquí solo su relación con cada ítem de cada cotización.
      const tieneColumna = (db.pragma('table_info(solicitudes)') as { name: string }[]).some(
        (columna) => columna.name === 'familia_personalizada',
      );
      if (!tieneColumna)
        db.exec(
          "ALTER TABLE solicitudes ADD COLUMN familia_personalizada TEXT CHECK (familia_personalizada IN ('PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA'));",
        );
      db.exec(`
        CREATE TABLE IF NOT EXISTS referencias_item (
          cotizacion_id TEXT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
          item_orden INTEGER NOT NULL CHECK (item_orden >= 0),
          orden INTEGER NOT NULL CHECK (orden >= 0),
          archivo TEXT NOT NULL,
          nombre TEXT NOT NULL,
          tipo TEXT NOT NULL CHECK (tipo IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
          tamano INTEGER NOT NULL CHECK (tamano > 0),
          fecha TEXT NOT NULL,
          PRIMARY KEY (cotizacion_id, item_orden, orden)
        );
        CREATE INDEX IF NOT EXISTS referencias_item_archivo ON referencias_item(archivo);
        PRAGMA user_version = 19;
      `);
    }).immediate();
  if (version < 20)
    db.transaction(() => {
      // v20: descuento especial por ítem (porcentaje o monto fijo por unidad). Lo pedido vive en `solicitudes`; las
      // líneas guardan además cuánto descontó por unidad. Lo existente queda sin descuento (NULL).
      const columnas = (tabla: string) =>
        (db.pragma(`table_info(${tabla})`) as { name: string }[]).map((c) => c.name);
      const tipo = "TEXT CHECK (descuento_tipo IN ('porcentaje', 'monto'))";
      if (!columnas('solicitudes').includes('descuento_tipo'))
        db.exec(`
          ALTER TABLE solicitudes ADD COLUMN descuento_tipo ${tipo};
          ALTER TABLE solicitudes ADD COLUMN descuento_valor REAL;
        `);
      for (const tabla of ['cotizacion_lineas', 'nota_lineas'])
        if (!columnas(tabla).includes('descuento_tipo'))
          db.exec(`
            ALTER TABLE ${tabla} ADD COLUMN descuento_tipo ${tipo};
            ALTER TABLE ${tabla} ADD COLUMN descuento_valor REAL;
            ALTER TABLE ${tabla} ADD COLUMN descuento_unitario INTEGER CHECK (descuento_unitario >= 0);
          `);
      db.exec('PRAGMA user_version = 20;');
    }).immediate();
  if (version < 21)
    db.transaction(() => {
      // v21: costo de fábrica de un pedido especial (la nota de pedido lo usa). Lo existente queda sin él.
      const tieneColumna = (db.pragma('table_info(solicitudes)') as { name: string }[]).some(
        (columna) => columna.name === 'costo_fabrica',
      );
      if (!tieneColumna)
        db.exec('ALTER TABLE solicitudes ADD COLUMN costo_fabrica INTEGER CHECK (costo_fabrica > 0);');
      db.exec('PRAGMA user_version = 21;');
    }).immediate();
  if (version < 22)
    db.transaction(() => {
      // v22: destino y valor del despacho de la nota, snapshot del HTML de cada PDF, papelera, planilla anterior,
      // ediciones a mano de productos importados y auditoría de cuentas. Se puede repetir sin efecto.
      const columnas = (db.pragma('table_info(notas_pedido)') as { name: string }[]).map((c) => c.name);
      if (!columnas.includes('despacho_destino')) db.exec('ALTER TABLE notas_pedido ADD COLUMN despacho_destino TEXT;');
      if (!columnas.includes('despacho_valor')) db.exec('ALTER TABLE notas_pedido ADD COLUMN despacho_valor INTEGER;');
      db.exec(`
        CREATE TABLE IF NOT EXISTS documentos_snapshot (archivo TEXT PRIMARY KEY, cotizacion_id TEXT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE, html TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS papelera (tipo TEXT NOT NULL, id TEXT NOT NULL, contenido TEXT NOT NULL, eliminada TEXT NOT NULL, PRIMARY KEY(tipo,id));
        CREATE TABLE IF NOT EXISTS catalogo_anterior (origen TEXT PRIMARY KEY, contenido TEXT NOT NULL, version TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS catalogo_ediciones (codigo TEXT PRIMARY KEY, fecha TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS auditoria_cuentas (id INTEGER PRIMARY KEY, fecha TEXT NOT NULL, actor TEXT, objetivo TEXT, accion TEXT NOT NULL);
      `);
      recalcularBusqueda(db);
      db.exec('PRAGMA user_version = 22;');
    }).immediate();
  if (version < 23)
    db.transaction(() => {
      // v23: fecha de aprobación (límite inferior de pagos y facturas), tomada del último evento «aprobada» para lo
      // ya aprobado, y la marca «en emisión» que impide generar dos veces el mismo PDF. Se puede repetir sin efecto.
      const columnas = (db.pragma('table_info(cotizaciones)') as { name: string }[]).map((c) => c.name);
      if (!columnas.includes('fecha_aprobacion')) db.exec('ALTER TABLE cotizaciones ADD COLUMN fecha_aprobacion TEXT;');
      db.exec(`
        UPDATE cotizaciones SET fecha_aprobacion = (
          SELECT e.fecha FROM eventos e WHERE e.cotizacion_id = cotizaciones.id AND e.tipo = 'aprobada' ORDER BY e.id DESC LIMIT 1
        ) WHERE fecha_aprobacion IS NULL AND estado IN ('aprobada', 'anulada');
        CREATE TABLE IF NOT EXISTS emisiones_en_curso (
          cotizacion_id TEXT PRIMARY KEY REFERENCES cotizaciones(id) ON DELETE CASCADE,
          documento TEXT NOT NULL,
          ficha TEXT NOT NULL,
          vence TEXT NOT NULL
        );
        PRAGMA user_version = 23;
      `);
    }).immediate();
  if (version < 24) migrarA24(db);
}

/**
 * v24: dos fábricas, cada una con su correlativo de notas de pedido. El número de nota pasa a ser único por fábrica
 * (reconstruye `notas_pedido` para quitar el UNIQUE de la columna). Las notas existentes quedan sin fábrica: no se
 * sabe a cuál fue cada una, se asigna con `npm run notas`; entre ellas el número sigue siendo único. Cada fábrica
 * parte en su número de `CORRELATIVOS_NOTA`.
 * `correlativos.siguiente_nota` queda sin uso. Se puede repetir sin efecto.
 */
function migrarA24(db: Database.Database) {
  const fabricas = FABRICAS.map((f) => `'${f}'`).join(', ');
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      const columnas = (db.pragma('table_info(notas_pedido)') as { name: string }[]).map((c) => c.name);
      if (!columnas.includes('fabrica'))
        db.exec(`
        CREATE TABLE notas_pedido_v24 (
          cotizacion_id TEXT PRIMARY KEY REFERENCES cotizaciones(id) ON DELETE CASCADE,
          fabrica TEXT CHECK (fabrica IN (${fabricas})),
          numero INTEGER NOT NULL,
          pdf TEXT NOT NULL,
          fecha TEXT NOT NULL,
          neto INTEGER NOT NULL,
          iva INTEGER NOT NULL,
          total INTEGER NOT NULL,
          despacho_direccion TEXT,
          despacho_transporte TEXT,
          anulada INTEGER NOT NULL DEFAULT 0 CHECK (anulada IN (0, 1)),
          despacho_entrega TEXT,
          observaciones TEXT,
          despacho_destino TEXT,
          despacho_valor INTEGER,
          UNIQUE (fabrica, numero)
        );
        INSERT INTO notas_pedido_v24 (
          cotizacion_id, numero, pdf, fecha, neto, iva, total, despacho_direccion, despacho_transporte, anulada,
          despacho_entrega, observaciones, despacho_destino, despacho_valor
        )
        SELECT cotizacion_id, numero, pdf, fecha, neto, iva, total, despacho_direccion, despacho_transporte, anulada,
          despacho_entrega, observaciones, despacho_destino, despacho_valor
        FROM notas_pedido;
        DROP TABLE notas_pedido;
        ALTER TABLE notas_pedido_v24 RENAME TO notas_pedido;
      `);
      db.exec(`
        -- UNIQUE (fabrica, numero) no compara los NULL: las notas sin fábrica siguen sin repetir número entre ellas.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_nota_sin_fabrica ON notas_pedido(numero) WHERE fabrica IS NULL;
        CREATE TABLE IF NOT EXISTS correlativos_nota (
          fabrica TEXT PRIMARY KEY CHECK (fabrica IN (${fabricas})),
          siguiente INTEGER NOT NULL CHECK (siguiente > 0)
        );
        PRAGMA user_version = 24;
      `);
      const insertar = db.prepare('INSERT OR IGNORE INTO correlativos_nota (fabrica, siguiente) VALUES (?, ?)');
      // Una sola vez: si el correlativo ya existe (migración repetida), no se toca.
      for (const f of FABRICAS) insertar.run(f, CORRELATIVOS_NOTA[f]);
      if ((db.pragma('foreign_key_check') as unknown[]).length)
        throw new Error('La migración de notas de pedido dejó referencias inválidas.');
    }).immediate();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/** Rehace la columna `busqueda` de todas las cotizaciones con `textoBusqueda` (v22: suma el teléfono). */
function recalcularBusqueda(db: Database.Database) {
  const filas = db
    .prepare(
      'SELECT id, numero, cliente_nombre, cliente_rut, cliente_comuna, cliente_proyecto, cliente_giro, cliente_telefono FROM cotizaciones',
    )
    .all() as {
    id: string;
    numero: number | null;
    cliente_nombre: string | null;
    cliente_rut: string | null;
    cliente_comuna: string | null;
    cliente_proyecto: string | null;
    cliente_giro: string | null;
    cliente_telefono: string | null;
  }[];
  const productos = db.prepare(`
    SELECT modelo, madera FROM solicitudes WHERE cotizacion_id = ?
    UNION ALL SELECT modelo, madera FROM cotizacion_lineas WHERE cotizacion_id = ?
  `);
  const actualizar = db.prepare('UPDATE cotizaciones SET busqueda = ? WHERE id = ?');
  for (const f of filas) {
    const ps = productos.all(f.id, f.id) as { modelo: string | null; madera: string | null }[];
    actualizar.run(
      textoBusqueda({
        numero: f.numero,
        cliente: {
          nombre: f.cliente_nombre,
          rut: f.cliente_rut,
          comuna: f.cliente_comuna,
          proyecto: f.cliente_proyecto,
          giro: f.cliente_giro,
          telefono: f.cliente_telefono,
        },
        productos: ps.flatMap((p) => [p.modelo, p.madera]),
      }),
      f.id,
    );
  }
}

const COLUMNAS_COTIZACION_V4 = `id, orden, numero, estado, cliente_nombre, cliente_nombre_normalizado, cliente_rut,
  cliente_telefono, cliente_direccion, cliente_comuna, cliente_comuna_normalizada, cliente_proyecto,
  cliente_proyecto_normalizado, creada, actualizada, pdf, fecha_emision, fecha_emision_ausente, origen_id,
  origen_ausente`;

/**
 * v6: estados «reemplazada» y «anulada» (reconstruye cotizaciones para ampliar el CHECK), autoría,
 * vigencia, descuento, flete, giro, medidas pedidas por línea, despacho y anulación de notas,
 * dueño de las altas pendientes y texto de búsqueda. Las filas existentes quedan con null o 0.
 */
function migrarA6(db: Database.Database) {
  // PRAGMA foreign_keys no tiene efecto dentro de una transacción: se desactiva antes de reconstruir.
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE cotizaciones_v6 (
          id TEXT PRIMARY KEY,
          orden INTEGER NOT NULL UNIQUE CHECK (orden >= 0),
          numero INTEGER UNIQUE,
          estado TEXT NOT NULL CHECK (estado IN ('borrador', 'emitida', 'aprobada', 'reemplazada', 'anulada')),
          cliente_nombre TEXT,
          cliente_nombre_normalizado TEXT NOT NULL,
          cliente_rut TEXT,
          cliente_telefono TEXT,
          cliente_direccion TEXT,
          cliente_comuna TEXT,
          cliente_comuna_normalizada TEXT NOT NULL,
          cliente_proyecto TEXT,
          cliente_proyecto_normalizado TEXT NOT NULL,
          creada TEXT NOT NULL,
          actualizada TEXT NOT NULL,
          pdf TEXT,
          fecha_emision TEXT,
          fecha_emision_ausente INTEGER NOT NULL DEFAULT 0 CHECK (fecha_emision_ausente IN (0, 1)),
          origen_id TEXT REFERENCES cotizaciones(id) ON DELETE SET NULL,
          origen_ausente INTEGER NOT NULL DEFAULT 0 CHECK (origen_ausente IN (0, 1)),
          cliente_giro TEXT,
          vence TEXT,
          descuento REAL NOT NULL DEFAULT 0 CHECK (descuento >= 0 AND descuento <= 50),
          flete INTEGER NOT NULL DEFAULT 0 CHECK (flete >= 0),
          creada_por TEXT,
          emitida_por TEXT,
          aprobada_por TEXT,
          anulada_por TEXT,
          fecha_anulacion TEXT,
          motivo_anulacion TEXT,
          reemplazada_por INTEGER,
          version_catalogo TEXT,
          busqueda TEXT NOT NULL DEFAULT ''
        );
        INSERT INTO cotizaciones_v6 (${COLUMNAS_COTIZACION_V4})
          SELECT ${COLUMNAS_COTIZACION_V4} FROM cotizaciones;
        DROP TABLE cotizaciones;
        ALTER TABLE cotizaciones_v6 RENAME TO cotizaciones;
        CREATE INDEX idx_cotizacion_estado ON cotizaciones(estado, orden);
        CREATE INDEX idx_cotizacion_cliente ON cotizaciones(cliente_nombre_normalizado);
        CREATE INDEX idx_cotizacion_proyecto ON cotizaciones(cliente_proyecto_normalizado);
        CREATE INDEX idx_cotizacion_comuna ON cotizaciones(cliente_comuna_normalizada);
        CREATE INDEX idx_cotizacion_origen ON cotizaciones(origen_id, estado);
        CREATE INDEX idx_cotizacion_actualizada ON cotizaciones(actualizada DESC);

        ALTER TABLE cotizacion_lineas ADD COLUMN indice INTEGER;
        ALTER TABLE cotizacion_lineas ADD COLUMN ancho_solicitado REAL;
        ALTER TABLE cotizacion_lineas ADD COLUMN alto_solicitado REAL;
        ALTER TABLE cotizacion_lineas ADD COLUMN medida_solicitada TEXT;
        ALTER TABLE nota_lineas ADD COLUMN indice INTEGER;
        ALTER TABLE nota_lineas ADD COLUMN ancho_solicitado REAL;
        ALTER TABLE nota_lineas ADD COLUMN alto_solicitado REAL;
        ALTER TABLE nota_lineas ADD COLUMN medida_solicitada TEXT;
        ALTER TABLE cotizacion_montos ADD COLUMN subtotal INTEGER;
        ALTER TABLE cotizacion_montos ADD COLUMN descuento_porcentaje REAL NOT NULL DEFAULT 0;
        ALTER TABLE cotizacion_montos ADD COLUMN descuento INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE cotizacion_montos ADD COLUMN flete INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE notas_pedido ADD COLUMN despacho_direccion TEXT;
        ALTER TABLE notas_pedido ADD COLUMN despacho_transporte TEXT;
        ALTER TABLE notas_pedido ADD COLUMN anulada INTEGER NOT NULL DEFAULT 0 CHECK (anulada IN (0, 1));
        ALTER TABLE productos_pendientes ADD COLUMN user_id TEXT;
        ALTER TABLE productos_adicionales ADD COLUMN creada_por TEXT;
        ALTER TABLE productos_adicionales ADD COLUMN actualizada TEXT;
      `);
      const filas = db
        .prepare(
          'SELECT id, numero, cliente_nombre, cliente_rut, cliente_comuna, cliente_proyecto FROM cotizaciones',
        )
        .all() as {
        id: string;
        numero: number | null;
        cliente_nombre: string | null;
        cliente_rut: string | null;
        cliente_comuna: string | null;
        cliente_proyecto: string | null;
      }[];
      const productos = db.prepare(`
        SELECT modelo, madera FROM solicitudes WHERE cotizacion_id = ?
        UNION ALL SELECT modelo, madera FROM cotizacion_lineas WHERE cotizacion_id = ?
      `);
      const actualizar = db.prepare('UPDATE cotizaciones SET busqueda = ? WHERE id = ?');
      for (const f of filas) {
        const ps = productos.all(f.id, f.id) as { modelo: string | null; madera: string | null }[];
        actualizar.run(
          textoBusqueda({
            numero: f.numero,
            cliente: {
              nombre: f.cliente_nombre,
              rut: f.cliente_rut,
              comuna: f.cliente_comuna,
              proyecto: f.cliente_proyecto,
            },
            productos: ps.flatMap((p) => [p.modelo, p.madera]),
          }),
          f.id,
        );
      }
      // Originales cuya revisión ya se emitió: dejan de ser aprobables (evita dos notas de pedido).
      db.exec(`
        UPDATE cotizaciones AS o SET
          estado = 'reemplazada',
          reemplazada_por = (
            SELECT MAX(r.numero) FROM cotizaciones r WHERE r.origen_id = o.id AND r.estado IN ('emitida', 'aprobada')
          )
        WHERE o.estado = 'emitida' AND EXISTS (
          SELECT 1 FROM cotizaciones r WHERE r.origen_id = o.id AND r.estado IN ('emitida', 'aprobada')
        );
      `);
      if ((db.pragma('foreign_key_check') as unknown[]).length)
        throw new Error('La migración del esquema 6 dejó referencias inconsistentes.');
      db.pragma('user_version = 6');
    }).immediate();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function crearEsquemaHasta4(db: Database.Database, version: number) {
  if (version === 1) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS catalogo_configuracion (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          configuracion_json TEXT NOT NULL
        );
        INSERT OR IGNORE INTO catalogo_configuracion (id, configuracion_json) VALUES (1, '{}');
        CREATE TABLE IF NOT EXISTS productos_adicionales (
          codigo TEXT PRIMARY KEY,
          modelo TEXT NOT NULL,
          modelo_normalizado TEXT NOT NULL,
          familia TEXT NOT NULL CHECK (familia IN ('PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA')),
          tipo TEXT,
          madera TEXT NOT NULL,
          medida TEXT NOT NULL,
          ancho_min REAL,
          ancho_max REAL,
          largo REAL NOT NULL,
          precio_neto REAL NOT NULL CHECK (precio_neto > 0),
          descripcion TEXT NOT NULL,
          fila_origen INTEGER NOT NULL DEFAULT 0,
          creada TEXT NOT NULL,
          UNIQUE (modelo_normalizado, madera, medida, largo)
        );
        CREATE INDEX IF NOT EXISTS idx_producto_adicional_modelo
          ON productos_adicionales(modelo_normalizado, creada);
        CREATE TABLE IF NOT EXISTS productos_pendientes (
          id TEXT PRIMARY KEY,
          version INTEGER NOT NULL,
          version_catalogo TEXT NOT NULL,
          borrador_json TEXT NOT NULL,
          mensajes_json TEXT NOT NULL,
          propuesta_json TEXT,
          actualizada TEXT NOT NULL,
          expira TEXT NOT NULL
        );
        PRAGMA user_version = 4;
      `);
    }).immediate();
    return;
  }

  if (version === 2 || version === 3) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS productos_adicionales (
          codigo TEXT PRIMARY KEY,
          modelo TEXT NOT NULL,
          modelo_normalizado TEXT NOT NULL,
          familia TEXT NOT NULL CHECK (familia IN ('PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA')),
          tipo TEXT,
          madera TEXT NOT NULL,
          medida TEXT NOT NULL,
          ancho_min REAL,
          ancho_max REAL,
          largo REAL NOT NULL,
          precio_neto REAL NOT NULL CHECK (precio_neto > 0),
          descripcion TEXT NOT NULL,
          fila_origen INTEGER NOT NULL DEFAULT 0,
          creada TEXT NOT NULL,
          UNIQUE (modelo_normalizado, madera, medida, largo)
        );
        CREATE INDEX IF NOT EXISTS idx_producto_adicional_modelo
          ON productos_adicionales(modelo_normalizado, creada);
        CREATE TABLE IF NOT EXISTS productos_pendientes (
          id TEXT PRIMARY KEY,
          version INTEGER NOT NULL,
          version_catalogo TEXT NOT NULL,
          borrador_json TEXT NOT NULL,
          mensajes_json TEXT NOT NULL,
          propuesta_json TEXT,
          actualizada TEXT NOT NULL,
          expira TEXT NOT NULL
        );
        PRAGMA user_version = 4;
      `);
    }).immediate();
    return;
  }

  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS correlativos (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        siguiente_cotizacion INTEGER NOT NULL CHECK (siguiente_cotizacion > 0),
        siguiente_nota INTEGER NOT NULL CHECK (siguiente_nota > 0)
      );
      INSERT OR IGNORE INTO correlativos (id, siguiente_cotizacion, siguiente_nota)
      VALUES (1, ${CORRELATIVO_COTIZACION}, ${CORRELATIVO_NOTA});

      CREATE TABLE IF NOT EXISTS catalogo_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        fuente TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        fecha TEXT NOT NULL,
        cantidad_productos INTEGER NOT NULL CHECK (cantidad_productos >= 0)
      );

      CREATE TABLE IF NOT EXISTS catalogo_configuracion (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        configuracion_json TEXT NOT NULL
      );
      INSERT OR IGNORE INTO catalogo_configuracion (id, configuracion_json) VALUES (1, '{}');

      CREATE TABLE IF NOT EXISTS productos_adicionales (
        codigo TEXT PRIMARY KEY,
        modelo TEXT NOT NULL,
        modelo_normalizado TEXT NOT NULL,
        familia TEXT NOT NULL CHECK (familia IN ('PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA')),
        tipo TEXT,
        madera TEXT NOT NULL,
        medida TEXT NOT NULL,
        ancho_min REAL,
        ancho_max REAL,
        largo REAL NOT NULL,
        precio_neto REAL NOT NULL CHECK (precio_neto > 0),
        descripcion TEXT NOT NULL,
        fila_origen INTEGER NOT NULL DEFAULT 0,
        creada TEXT NOT NULL,
        UNIQUE (modelo_normalizado, madera, medida, largo)
      );
      CREATE INDEX IF NOT EXISTS idx_producto_adicional_modelo
        ON productos_adicionales(modelo_normalizado, creada);

      CREATE TABLE IF NOT EXISTS productos_pendientes (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        version_catalogo TEXT NOT NULL,
        borrador_json TEXT NOT NULL,
        mensajes_json TEXT NOT NULL,
        propuesta_json TEXT,
        actualizada TEXT NOT NULL,
        expira TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS productos_catalogo (
        codigo TEXT PRIMARY KEY,
        orden INTEGER NOT NULL UNIQUE CHECK (orden >= 0),
        modelo TEXT NOT NULL,
        modelo_normalizado TEXT NOT NULL,
        familia TEXT NOT NULL CHECK (familia IN ('PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA')),
        tipo TEXT,
        madera TEXT NOT NULL,
        medida TEXT NOT NULL,
        ancho_min REAL,
        ancho_max REAL,
        largo REAL NOT NULL,
        precio_neto REAL NOT NULL CHECK (precio_neto > 0),
        descripcion TEXT NOT NULL,
        fila_origen INTEGER NOT NULL,
        UNIQUE (modelo, madera, medida, largo)
      );
      CREATE INDEX IF NOT EXISTS idx_producto_modelo ON productos_catalogo(modelo_normalizado, orden);
      CREATE INDEX IF NOT EXISTS idx_producto_modelo_madera ON productos_catalogo(modelo_normalizado, madera, orden);
      CREATE INDEX IF NOT EXISTS idx_producto_modelo_medida_largo
        ON productos_catalogo(modelo_normalizado, medida, largo, orden);

      CREATE TABLE IF NOT EXISTS cotizaciones (
        id TEXT PRIMARY KEY,
        orden INTEGER NOT NULL UNIQUE CHECK (orden >= 0),
        numero INTEGER UNIQUE,
        estado TEXT NOT NULL CHECK (estado IN ('borrador', 'emitida', 'aprobada')),
        cliente_nombre TEXT,
        cliente_nombre_normalizado TEXT NOT NULL,
        cliente_rut TEXT,
        cliente_telefono TEXT,
        cliente_direccion TEXT,
        cliente_comuna TEXT,
        cliente_comuna_normalizada TEXT NOT NULL,
        cliente_proyecto TEXT,
        cliente_proyecto_normalizado TEXT NOT NULL,
        creada TEXT NOT NULL,
        actualizada TEXT NOT NULL,
        pdf TEXT,
        fecha_emision TEXT,
        fecha_emision_ausente INTEGER NOT NULL DEFAULT 0 CHECK (fecha_emision_ausente IN (0, 1)),
        origen_id TEXT REFERENCES cotizaciones(id) ON DELETE SET NULL,
        origen_ausente INTEGER NOT NULL DEFAULT 0 CHECK (origen_ausente IN (0, 1))
      );
      CREATE INDEX IF NOT EXISTS idx_cotizacion_estado ON cotizaciones(estado, orden);
      CREATE INDEX IF NOT EXISTS idx_cotizacion_cliente ON cotizaciones(cliente_nombre_normalizado);
      CREATE INDEX IF NOT EXISTS idx_cotizacion_proyecto ON cotizaciones(cliente_proyecto_normalizado);
      CREATE INDEX IF NOT EXISTS idx_cotizacion_comuna ON cotizaciones(cliente_comuna_normalizada);

      CREATE TABLE IF NOT EXISTS solicitudes (
        cotizacion_id TEXT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
        orden INTEGER NOT NULL CHECK (orden >= 0),
        modelo TEXT,
        madera TEXT,
        ancho REAL,
        alto REAL,
        medida TEXT,
        cantidad INTEGER,
        PRIMARY KEY (cotizacion_id, orden)
      );

      CREATE TABLE IF NOT EXISTS incompletos (
        cotizacion_id TEXT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
        indice INTEGER NOT NULL CHECK (indice >= 0),
        rechazo_json TEXT NOT NULL,
        pregunta TEXT NOT NULL,
        PRIMARY KEY (cotizacion_id, indice)
      );

      CREATE TABLE IF NOT EXISTS historial (
        cotizacion_id TEXT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
        orden INTEGER NOT NULL CHECK (orden >= 0),
        rol TEXT NOT NULL CHECK (rol IN ('usuario', 'asistente')),
        texto TEXT NOT NULL,
        PRIMARY KEY (cotizacion_id, orden)
      );

      CREATE TABLE IF NOT EXISTS cotizacion_montos (
        cotizacion_id TEXT PRIMARY KEY REFERENCES cotizaciones(id) ON DELETE CASCADE,
        neto INTEGER NOT NULL,
        iva INTEGER NOT NULL,
        total INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cotizacion_lineas (
        cotizacion_id TEXT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
        orden INTEGER NOT NULL CHECK (orden >= 0),
        codigo TEXT NOT NULL,
        modelo TEXT NOT NULL,
        familia TEXT NOT NULL,
        tipo TEXT,
        madera TEXT NOT NULL,
        medida TEXT NOT NULL,
        ancho_min REAL,
        ancho_max REAL,
        largo REAL NOT NULL,
        precio_neto REAL NOT NULL,
        descripcion TEXT NOT NULL,
        fila_origen INTEGER NOT NULL,
        cantidad INTEGER NOT NULL,
        precio_unitario INTEGER NOT NULL,
        total INTEGER NOT NULL,
        PRIMARY KEY (cotizacion_id, orden)
      );

      CREATE TABLE IF NOT EXISTS notas_pedido (
        cotizacion_id TEXT PRIMARY KEY REFERENCES cotizaciones(id) ON DELETE CASCADE,
        numero INTEGER NOT NULL UNIQUE,
        pdf TEXT NOT NULL,
        fecha TEXT NOT NULL,
        neto INTEGER NOT NULL,
        iva INTEGER NOT NULL,
        total INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS nota_lineas (
        cotizacion_id TEXT NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
        orden INTEGER NOT NULL CHECK (orden >= 0),
        codigo TEXT NOT NULL,
        modelo TEXT NOT NULL,
        familia TEXT NOT NULL,
        tipo TEXT,
        madera TEXT NOT NULL,
        medida TEXT NOT NULL,
        ancho_min REAL,
        ancho_max REAL,
        largo REAL NOT NULL,
        precio_neto REAL NOT NULL,
        descripcion TEXT NOT NULL,
        fila_origen INTEGER NOT NULL,
        cantidad INTEGER NOT NULL,
        precio_unitario INTEGER NOT NULL,
        total INTEGER NOT NULL,
        PRIMARY KEY (cotizacion_id, orden)
      );

      CREATE TABLE IF NOT EXISTS migraciones_datos (
        id TEXT PRIMARY KEY,
        fecha TEXT NOT NULL,
        sha256_catalogo TEXT NOT NULL,
        sha256_estado TEXT NOT NULL,
        cantidad_cotizaciones INTEGER NOT NULL
      );
      PRAGMA user_version = 4;
    `);
  }).immediate();
}

export function abrirBaseDatos(
  ruta = rutaBaseDatos(),
  opciones: { permitirJsonLegado?: boolean; cachear?: boolean } = {},
): Database.Database {
  const absoluta = resolve(ruta);
  const global = globalThis as GlobalWithConnections;
  const conexiones = (global[SQLITE_GLOBAL] ??= new Map());
  if (!global[SQLITE_CLEANUP]) {
    global[SQLITE_CLEANUP] = true;
    process.once('exit', () => {
      for (const connection of conexiones.values()) if (connection.open) connection.close();
    });
  }
  const existente = opciones.cachear === false ? undefined : conexiones.get(absoluta);
  if (existente?.open) {
    crearEsquema(existente);
    return existente;
  }

  if (!existsSync(absoluta) && !opciones.permitirJsonLegado) {
    const directorioDb = dirname(absoluta);
    const rutaActiva = absoluta === rutaBaseDatos();
    if (hayJsonLegado(rutaActiva ? directorioDatos() : directorioDb, rutaActiva))
      throw new ErrorMigracionRequerida();
  }

  mkdirSync(dirname(absoluta), { recursive: true, mode: 0o700 });
  const nueva = new Database(absoluta, { timeout: 5000 });
  try {
    nueva.pragma('foreign_keys = ON');
    nueva.pragma('busy_timeout = 5000');
    nueva.pragma('journal_mode = WAL');
    nueva.pragma('synchronous = FULL');
    crearEsquema(nueva);
    chmodSync(absoluta, 0o600);
    // Feriados sincronizados antes: los días hábiles quedan bien desde el primer cálculo tras reiniciar.
    registrarFeriadosExternos(
      (
        nueva
          .prepare('SELECT fecha FROM feriados')
          .all() as { fecha: string }[]
      ).map((f) => f.fecha),
    );
  } catch (error) {
    nueva.close();
    throw error;
  }
  if (opciones.cachear !== false) conexiones.set(absoluta, nueva);
  return nueva;
}

export function cerrarBaseDatos(ruta = rutaBaseDatos()) {
  const absoluta = resolve(ruta);
  const global = globalThis as GlobalWithConnections;
  const conexiones = global[SQLITE_GLOBAL];
  const db = conexiones?.get(absoluta);
  if (db?.open) db.close();
  conexiones?.delete(absoluta);
}

export function rutaEstadoLegado(directorio = directorioDatos()) {
  return join(resolve(directorio), 'estado.json');
}

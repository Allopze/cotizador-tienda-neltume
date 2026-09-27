import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const VERSION_ESQUEMA = 2;
const SQLITE_GLOBAL = '__neltumeSqliteConnections';
const SQLITE_CLEANUP = '__neltumeSqliteCleanup';
type GlobalWithConnections = typeof globalThis & {
  [SQLITE_GLOBAL]?: Map<string, Database.Database>;
  [SQLITE_CLEANUP]?: boolean;
};

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
    revisarCatalogoPredeterminado &&
    !process.env.NELTUME_DATA_DIR &&
    directorio === resolve('data');
  return existsSync(catalogo) && (relativo || catalogoConfigurado || datosPredeterminados);
}

function crearEsquema(db: Database.Database) {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > VERSION_ESQUEMA)
    throw new Error(`La base SQLite usa una versión de esquema más nueva (${version}).`);
  if (version === VERSION_ESQUEMA) return;

  if (version === 1) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS catalogo_configuracion (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          configuracion_json TEXT NOT NULL
        );
        INSERT OR IGNORE INTO catalogo_configuracion (id, configuracion_json) VALUES (1, '{}');
        PRAGMA user_version = 2;
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
      VALUES (1, 323, 1);

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
      PRAGMA user_version = ${VERSION_ESQUEMA};
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

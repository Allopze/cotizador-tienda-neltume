import Database from 'better-sqlite3';
import { closeSync, constants, fsyncSync, openSync } from 'node:fs';
import { chmod, copyFile, cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { ARCHIVO_REFERENCIA } from '../../src/negocio/personalizados';
import { LOCK_ESTADO_VIGENTE_MS } from '../../src/servidor/almacen';
import { carpetaReferencias } from '../../src/servidor/archivos-referencia';
import { directorioDatos, rutaBaseDatos, VERSION_ESQUEMA } from '../../src/servidor/base-datos';

/**
 * Restaura un respaldo de `npm run respaldar` (base, PDF, referencias del cliente y configuración del catálogo de la
 * misma carpeta) sobre la instalación. Exige el servidor detenido. Lo que había antes no se borra: queda en
 * `<datos>/antes-de-restaurar-<fecha>/` para poder deshacer.
 */
export class ErrorRestauracion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorRestauracion';
  }
}

export interface ResultadoRestauracion {
  carpeta: string;
  aparte: string;
  cotizaciones: number;
  cuentas: number | null;
  pdf: number;
  referencias: number;
  config: boolean;
  /** Lo que se conservó de la bandeja de la fábrica para que no retroceda con el respaldo. */
  integracion: { envios: number; correlativos: number };
}

interface Opciones {
  datos?: string;
  rutaDb?: string;
  rutaConfig?: string;
  ahora?: Date;
}

const existe = (ruta: string) =>
  stat(ruta).then(
    () => true,
    () => false,
  );

const archivosDe = async (carpeta: string) => ((await existe(carpeta)) ? (await readdir(carpeta)).length : 0);

/** Revisa que la copia sea una base sana del cotizador y que esta versión pueda abrirla. */
function verificarCopia(ruta: string) {
  let db: Database.Database | undefined;
  try {
    db = new Database(ruta, { readonly: true, fileMustExist: true });
    const integridad = db.pragma('integrity_check', { simple: true });
    if (integridad !== 'ok') throw new ErrorRestauracion(`La copia de la base está dañada (integrity_check: ${integridad}).`);
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version > VERSION_ESQUEMA)
      throw new ErrorRestauracion(
        `El respaldo es de una versión más nueva del cotizador (esquema ${version}; esta versión llega al ${VERSION_ESQUEMA}). Actualiza el cotizador antes de restaurarlo.`,
      );
    const tablas = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name),
    );
    if (!tablas.has('cotizaciones')) throw new ErrorRestauracion('La copia no es una base del cotizador (no tiene cotizaciones).');
    const cotizaciones = (db.prepare('SELECT COUNT(*) AS n FROM cotizaciones').get() as { n: number }).n;
    const cuentas = tablas.has('user') ? (db.prepare('SELECT COUNT(*) AS n FROM "user"').get() as { n: number }).n : null;
    return { cotizaciones, cuentas, version };
  } catch (error) {
    if (error instanceof ErrorRestauracion) throw error;
    throw new ErrorRestauracion(
      `No se pudo leer la copia de la base: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    db?.close();
  }
}

/**
 * Falla si el servidor sigue usando los datos: un bloqueo de escritura reciente (data/.estado.lock) o la base abierta
 * por otro proceso. SQLite en modo WAL mantiene un bloqueo compartido mientras la conexión está abierta, así que
 * pedir el bloqueo exclusivo sin espera falla de inmediato si el cotizador corre (también en otro contenedor que use
 * el mismo volumen). Al cerrar, la conexión exclusiva vuelca el -wal en la base y lo borra.
 */
async function exigirServidorDetenido(datos: string, rutaDb: string, ahora = new Date()) {
  const detenlo =
    'Detén el cotizador antes de restaurar (con Docker: docker compose stop) y vuelve a ejecutar este comando.';
  const lock = join(datos, '.estado.lock');
  const infoLock = await stat(lock).catch(() => null);
  if (infoLock && ahora.getTime() - infoLock.mtimeMs < LOCK_ESTADO_VIGENTE_MS)
    throw new ErrorRestauracion(`El cotizador está guardando cambios en este momento. ${detenlo}`);
  if (!(await existe(rutaDb))) return;
  let db: Database.Database | undefined;
  try {
    db = new Database(rutaDb, { timeout: 0, fileMustExist: true });
    db.pragma('locking_mode = EXCLUSIVE');
    db.exec('BEGIN EXCLUSIVE; COMMIT;');
  } catch (error) {
    const codigo = (error as { code?: string }).code ?? '';
    if (codigo.startsWith('SQLITE_BUSY') || codigo.startsWith('SQLITE_LOCKED'))
      throw new ErrorRestauracion(`La base está en uso: el cotizador sigue en marcha. ${detenlo}`);
    // Una base actual dañada no impide restaurar: se aparta tal cual.
  } finally {
    db?.close();
  }
}

/** Mueve un archivo o carpeta; entre discos distintos (otro volumen) copia y borra. */
async function mover(origen: string, destino: string) {
  try {
    await rename(origen, destino);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await cp(origen, destino, { recursive: true, preserveTimestamps: true });
    await rm(origen, { recursive: true, force: true });
  }
}

function sincronizarArchivo(ruta: string) {
  const fd = openSync(ruta, constants.O_RDONLY);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

interface EstadoIntegracion {
  envios: Record<string, unknown>[];
  correlativos: Record<string, unknown> | undefined;
  notas: Record<string, unknown>[];
}

const tablasDe = (db: Database.Database) =>
  new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name),
  );

/** Foto de la bandeja y los correlativos antes de restaurar, para no hacerlos retroceder (auditoría BUG-020). */
function capturarIntegracion(rutaDb: string): EstadoIntegracion | null {
  let db: Database.Database | undefined;
  try {
    db = new Database(rutaDb, { readonly: true, fileMustExist: true });
    const tablas = tablasDe(db);
    if (!tablas.has('integracion_envios')) return null;
    return {
      envios: db.prepare('SELECT * FROM integracion_envios ORDER BY id').all() as Record<string, unknown>[],
      correlativos: tablas.has('correlativos')
        ? (db.prepare('SELECT * FROM correlativos WHERE id = 1').get() as Record<string, unknown> | undefined)
        : undefined,
      notas: tablas.has('correlativos_nota')
        ? (db.prepare('SELECT * FROM correlativos_nota').all() as Record<string, unknown>[])
        : [],
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/**
 * Vuelve a dejar en la base restaurada los envíos que ya existían y los correlativos más altos. Lo que la fábrica ya
 * recibió no puede desaparecer ni repetirse por volver a un respaldo anterior (auditoría BUG-020).
 */
function preservarIntegracion(rutaDb: string, antes: EstadoIntegracion | null) {
  if (!antes) return { envios: 0, correlativos: 0 };
  let db: Database.Database | undefined;
  let envios = 0;
  let correlativos = 0;
  try {
    db = new Database(rutaDb);
    db.transaction(() => {
      const tablas = tablasDe(db!);
      if (tablas.has('integracion_envios') && antes!.envios.length) {
        const columnas = (db!.pragma('table_info(integracion_envios)') as { name: string }[]).map((c) => c.name);
        const deLaCopia = new Set(Object.keys(antes!.envios[0]));
        // Si el respaldo es de un esquema anterior, no se inventan columnas: se deja como quedó.
        if (columnas.every((c) => deLaCopia.has(c))) {
          const insertar = db!.prepare(
            `INSERT OR IGNORE INTO integracion_envios (${columnas.join(', ')}) VALUES (${columnas.map((c) => `@${c}`).join(', ')})`,
          );
          for (const fila of antes!.envios) {
            const existeCotizacion = db!.prepare('SELECT 1 FROM cotizaciones WHERE id = ?').get(fila.cotizacion_id);
            if (!existeCotizacion) continue;
            try {
              envios += insertar.run(fila).changes;
            } catch {
              // Un envío de un pedido que ya no está: no impide restaurar.
            }
          }
        }
      }
      const c = antes!.correlativos;
      if (tablas.has('correlativos') && typeof c?.siguiente_cotizacion === 'number' && typeof c.siguiente_nota === 'number') {
        correlativos += db!
          .prepare(
            'UPDATE correlativos SET siguiente_cotizacion = MAX(siguiente_cotizacion, ?), siguiente_nota = MAX(siguiente_nota, ?) WHERE id = 1',
          )
          .run(c.siguiente_cotizacion, c.siguiente_nota).changes;
      }
      if (tablas.has('correlativos_nota')) {
        const subir = db!.prepare('UPDATE correlativos_nota SET siguiente = MAX(siguiente, ?) WHERE fabrica = ?');
        for (const nota of antes!.notas)
          if (typeof nota.fabrica === 'string' && typeof nota.siguiente === 'number')
            correlativos += subir.run(nota.siguiente, nota.fabrica).changes;
      }
    }).immediate();
  } catch (error) {
    console.error(
      '[restaurar] no se pudo conservar la bandeja de integración:',
      error instanceof Error ? error.message : error,
    );
  } finally {
    db?.close();
  }
  return { envios, correlativos };
}

/** Busca la base dentro de la carpeta del respaldo: el nombre de la base activa o el único .sqlite que haya. */
async function baseDelRespaldo(carpeta: string, rutaDb: string) {
  const preferida = join(carpeta, basename(rutaDb));
  if (await existe(preferida)) return preferida;
  const candidatas = (await readdir(carpeta)).filter((n) => n.endsWith('.sqlite'));
  if (candidatas.length === 1) return join(carpeta, candidatas[0]);
  throw new ErrorRestauracion(
    `La carpeta ${carpeta} no contiene la base del cotizador (${basename(rutaDb)}). Indica una carpeta cotizador-<fecha> creada por npm run respaldar.`,
  );
}

export async function restaurarRespaldo(carpetaRespaldo: string, opciones: Opciones = {}): Promise<ResultadoRestauracion> {
  const datos = resolve(opciones.datos ?? directorioDatos());
  const rutaDb = resolve(opciones.rutaDb ?? rutaBaseDatos());
  const rutaConfig = resolve(opciones.rutaConfig ?? process.env.NELTUME_CATALOGO_CONFIG ?? 'config/catalogo.json');
  const ahora = opciones.ahora ?? new Date();
  const carpeta = resolve(carpetaRespaldo);

  if (!(await stat(carpeta).then((s) => s.isDirectory(), () => false)))
    throw new ErrorRestauracion(`No existe la carpeta de respaldo ${carpeta}.`);
  const copiaDb = await baseDelRespaldo(carpeta, rutaDb);
  if ((await existe(`${copiaDb}-wal`)) || (await existe(`${copiaDb}-journal`)))
    throw new ErrorRestauracion(
      'La copia de la base tiene un archivo -wal o -journal: no la dejó así npm run respaldar. Usa otra carpeta de respaldo.',
    );
  const { cotizaciones, cuentas } = verificarCopia(copiaDb);
  await exigirServidorDetenido(datos, rutaDb, ahora);
  // Antes de tocar nada: lo que la fábrica ya recibió no puede desaparecer con el respaldo.
  const integracionAntes = capturarIntegracion(rutaDb);

  // 1. Apartar lo actual (solo lo que existe). Se anota cada movimiento para deshacerlo si algo falla después.
  const aparte = join(datos, `antes-de-restaurar-${ahora.toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(aparte, { recursive: true, mode: 0o700 });
  const pdfActual = join(datos, 'pdf');
  const referenciasActual = carpetaReferencias(datos);
  const apartados: [string, string][] = [];
  const restaurados: string[] = [];
  const apartar = async (origen: string, nombre: string) => {
    if (!(await existe(origen))) return;
    const destino = join(aparte, nombre);
    await mover(origen, destino);
    apartados.push([origen, destino]);
  };

  let config = false;
  let integracion = { envios: 0, correlativos: 0 };
  const configAntes = await existe(rutaConfig);
  try {
    for (const sufijo of ['', '-wal', '-shm', '-journal']) await apartar(`${rutaDb}${sufijo}`, `${basename(rutaDb)}${sufijo}`);
    await apartar(pdfActual, 'pdf');
    await apartar(referenciasActual, 'referencias');
    // Órdenes de trabajo y copias congeladas de la integración: sin esto, la bandeja apuntaría a archivos perdidos.
    await apartar(join(datos, 'integracion'), 'integracion');
    if (configAntes) await copyFile(rutaConfig, join(aparte, basename(rutaConfig)));

    // 2. Base: copia a un temporal en la misma carpeta, a disco, y renombre atómico.
    await mkdir(dirname(rutaDb), { recursive: true, mode: 0o700 });
    const temporal = join(dirname(rutaDb), `.${basename(rutaDb)}.restaurando`);
    await copyFile(copiaDb, temporal);
    await chmod(temporal, 0o600);
    sincronizarArchivo(temporal);
    await rename(temporal, rutaDb);
    restaurados.push(rutaDb);

    // 3. PDF y referencias del mismo respaldo (solo archivos completos, como los copia respaldar).
    const copiar = async (origen: string, destino: string, filtro: (nombre: string) => boolean) => {
      await mkdir(destino, { recursive: true, mode: 0o700 });
      restaurados.push(destino);
      if (!(await existe(origen))) return;
      await cp(origen, destino, {
        recursive: true,
        preserveTimestamps: true,
        filter: (ruta) => ruta === origen || filtro(basename(ruta)),
      });
    };
    await copiar(join(carpeta, 'pdf'), pdfActual, (nombre) => !nombre.startsWith('.'));
    await copiar(join(carpeta, 'referencias'), referenciasActual, (nombre) => ARCHIVO_REFERENCIA.test(nombre));
    await copiar(join(carpeta, 'integracion'), join(datos, 'integracion'), (nombre) => !nombre.startsWith('.'));

    // La bandeja y los correlativos no retroceden: los envíos posteriores al respaldo se conservan.
    integracion = preservarIntegracion(rutaDb, integracionAntes);

    // 4. Configuración del catálogo, si el respaldo la trae.
    const copiaConfig = join(carpeta, basename(rutaConfig));
    if (await existe(copiaConfig)) {
      await mkdir(dirname(rutaConfig), { recursive: true });
      await copyFile(copiaConfig, rutaConfig);
      config = true;
    }

    // Un bloqueo abandonado por un cierre brusco no debe frenar la primera escritura tras iniciar.
    await rm(join(datos, '.estado.lock'), { recursive: true, force: true });
    verificarCopia(rutaDb);
  } catch (error) {
    // Deshace: borra lo restaurado a medias y devuelve lo apartado a su lugar.
    for (const ruta of restaurados.reverse()) await rm(ruta, { recursive: true, force: true }).catch(() => undefined);
    for (const [origen, destino] of apartados.reverse()) await mover(destino, origen).catch(() => undefined);
    if (config)
      await (configAntes ? copyFile(join(aparte, basename(rutaConfig)), rutaConfig) : rm(rutaConfig, { force: true })).catch(
        () => undefined,
      );
    await rm(aparte, { recursive: true, force: true }).catch(() => undefined);
    throw error instanceof ErrorRestauracion
      ? error
      : new ErrorRestauracion(
          `La restauración falló y se dejaron los datos como estaban: ${error instanceof Error ? error.message : String(error)}`,
        );
  }

  return {
    carpeta,
    aparte,
    cotizaciones,
    cuentas,
    pdf: await archivosDe(pdfActual),
    referencias: await archivosDe(referenciasActual),
    config,
    integracion,
  };
}

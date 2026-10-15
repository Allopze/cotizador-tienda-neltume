import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { basename, dirname, join, resolve } from 'node:path';
import lockfile from 'proper-lockfile';
import { nombreCanonicoModelo } from '../catalogo/configuracion';
import type { Catalogo } from '../catalogo/tipos';
import { estadoInicial, type Estado } from '../negocio/estado';
import { guardarEstadoCompleto, LOCK_ESTADO_VIGENTE_MS, leerEstadoDeBase } from './almacen';
import {
  abrirBaseDatos,
  directorioDatos,
  rutaBaseDatos,
  rutaCatalogoLegado,
  rutaEstadoLegado,
} from './base-datos';
import {
  catalogoPersistidoSchema,
  completarEstadoLegado,
  estadoPersistidoSchema,
} from './persistencia-esquemas';
import { guardarCatalogo, RepositorioCatalogoSqlite } from './repositorio-catalogo';

const MIGRACION_ID = 'json-v1';

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

async function existe(ruta: string) {
  try {
    await access(ruta);
    return true;
  } catch {
    return false;
  }
}

function verificarEstado(estado: Estado) {
  const ids = new Set<string>();
  const numeros = new Set<number>();
  const notas = new Set<number>();
  for (const q of estado.cotizaciones) {
    if (ids.has(q.id)) throw new Error(`Hay cotizaciones con id duplicado (${q.id}).`);
    ids.add(q.id);
    if (q.numero !== null) {
      if (numeros.has(q.numero)) throw new Error(`El número de cotización ${q.numero} está duplicado.`);
      numeros.add(q.numero);
    }
    if (q.nota) {
      if (notas.has(q.nota.numero)) throw new Error(`El número de nota ${q.nota.numero} está duplicado.`);
      notas.add(q.nota.numero);
    }
    if (q.origen != null && !estado.cotizaciones.some((origen) => origen.numero === q.origen))
      throw new Error(`La cotización de origen ${q.origen} no existe.`);
  }
  if (estado.siguienteCotizacion <= Math.max(0, ...numeros))
    throw new Error('El correlativo siguiente de cotización no supera a los números ya emitidos.');
  if (estado.siguienteNota <= Math.max(0, ...notas))
    throw new Error('El correlativo siguiente de nota no supera a los números ya emitidos.');
}

async function leerCatalogo(ruta: string) {
  const bytes = await readFile(ruta);
  let entrada: unknown;
  try {
    entrada = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`El JSON del catálogo no es válido: ${ruta}`);
  }
  const parsed = catalogoPersistidoSchema.safeParse(entrada);
  if (!parsed.success) throw new Error(`El catálogo no cumple el esquema esperado: ${ruta}`);
  return { catalogo: parsed.data as Catalogo, bytes };
}

async function leerEstado(ruta: string) {
  if (!(await existe(ruta))) return { estado: estadoInicial(), bytes: null as Buffer | null };
  const bytes = await readFile(ruta);
  let entrada: unknown;
  try {
    entrada = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`El JSON del estado no es válido: ${ruta}`);
  }
  const parsed = estadoPersistidoSchema.safeParse(completarEstadoLegado(entrada));
  if (!parsed.success) throw new Error(`El estado no cumple el esquema esperado: ${ruta}`);
  const estado = parsed.data as Estado;
  verificarEstado(estado);
  return { estado, bytes };
}

/**
 * El catálogo como lo deja `guardarCatalogo`: el nombre del modelo en su forma canónica («HUILO HUILO» → «Huilo
 * Huilo») y la fecha en ISO con milisegundos. La verificación compara contra esto, no contra el JSON tal cual.
 */
function comoSeGuarda(catalogo: Catalogo): Catalogo {
  return {
    ...catalogo,
    fecha: new Date(Date.parse(catalogo.fecha)).toISOString(),
    productos: catalogo.productos.map((p) => ({ ...p, modelo: nombreCanonicoModelo(p.modelo) })),
  };
}

async function respaldarYRetirar(
  origenes: { catalogo: string; estado: string },
  hashes: { catalogo: string; estado: string },
  directorioDatosMigracion = directorioDatos(),
) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directorio = join(directorioDatosMigracion, 'respaldo-migracion', `${stamp}-${process.pid}`);
  await mkdir(directorio, { recursive: true, mode: 0o700 });
  const copias: { origen: string; destino: string; esperado: string }[] = [
    { origen: origenes.catalogo, destino: join(directorio, 'catalogo.json'), esperado: hashes.catalogo },
    { origen: origenes.estado, destino: join(directorio, 'estado.json'), esperado: hashes.estado },
  ];
  for (const copia of copias) {
    if (!(await existe(copia.origen))) continue;
    await copyFile(copia.origen, copia.destino);
    const bytes = await readFile(copia.destino);
    if (sha256(bytes) !== copia.esperado)
      throw new Error(`No se pudo verificar la copia de respaldo ${basename(copia.origen)}.`);
  }
  for (const copia of copias) if (await existe(copia.origen)) await rm(copia.origen);
  return directorio;
}

async function verificarMigracionExistente(
  rutaDb: string,
  origenes: { catalogo: string; estado: string },
  directorioRespaldo?: string,
) {
  const db = abrirBaseDatos(rutaDb, { permitirJsonLegado: true, cachear: false });
  try {
    const marcador = db.prepare('SELECT * FROM migraciones_datos WHERE id = ?').get(MIGRACION_ID) as
      { sha256_catalogo: string; sha256_estado: string } | undefined;
    if (!marcador)
      throw new Error(`Ya existe ${rutaDb} y no contiene una migración JSON reconocida; no se modificó.`);
    const integrity = db.pragma('integrity_check', { simple: true });
    const foreignKeys = db.pragma('foreign_key_check') as unknown[];
    if (integrity !== 'ok' || foreignKeys.length)
      throw new Error('La base SQLite migrada no supera la comprobación de integridad.');
    const catalogo = (await existe(origenes.catalogo)) ? await leerCatalogo(origenes.catalogo) : null;
    const estado = (await existe(origenes.estado)) ? await leerEstado(origenes.estado) : null;
    if (catalogo && sha256(catalogo.bytes) !== marcador.sha256_catalogo)
      throw new Error('El JSON del catálogo cambió después de migrarse; se conservaron ambos archivos.');
    if (estado && sha256(estado.bytes!) !== marcador.sha256_estado)
      throw new Error('El JSON del estado cambió después de migrarse; se conservaron ambos archivos.');
    if (catalogo || estado) {
      const archivo = await respaldarYRetirar(
        origenes,
        { catalogo: marcador.sha256_catalogo, estado: marcador.sha256_estado },
        directorioRespaldo,
      );
      return { yaMigrada: true, archivo };
    }
    return { yaMigrada: true, archivo: null as string | null };
  } finally {
    db.close();
  }
}

export async function migrarJsonASqlite(
  opciones: {
    rutaDb?: string;
    catalogo?: string;
    estado?: string;
    directorioRespaldo?: string;
  } = {},
) {
  const rutaDb = resolve(opciones.rutaDb ?? rutaBaseDatos());
  const origenes = {
    catalogo: resolve(opciones.catalogo ?? rutaCatalogoLegado()),
    estado: resolve(opciones.estado ?? rutaEstadoLegado()),
  };
  const directorioEstado = dirname(origenes.estado);
  await mkdir(directorioEstado, { recursive: true, mode: 0o700 });
  let liberar: () => Promise<void>;
  try {
    liberar = await lockfile.lock(directorioEstado, {
      realpath: false,
      lockfilePath: join(directorioEstado, '.estado.lock'),
      stale: LOCK_ESTADO_VIGENTE_MS,
      retries: { retries: 1, minTimeout: 100, maxTimeout: 100 },
    });
  } catch {
    throw new Error('No se pudo bloquear el estado. Detén el cotizador y vuelve a ejecutar la migración.');
  }
  try {
    return await migrarConBloqueo(rutaDb, origenes, opciones.directorioRespaldo);
  } finally {
    await liberar();
  }
}

async function migrarConBloqueo(
  rutaDb: string,
  origenes: { catalogo: string; estado: string },
  directorioRespaldo?: string,
) {
  if (await existe(rutaDb)) return verificarMigracionExistente(rutaDb, origenes, directorioRespaldo);
  if (!(await existe(origenes.catalogo)))
    throw new Error(
      `No se encontró ${origenes.catalogo}. Ejecuta npm run importar si es una instalación nueva.`,
    );

  const [{ catalogo, bytes: bytesCatalogo }, { estado, bytes: bytesEstado }] = await Promise.all([
    leerCatalogo(origenes.catalogo),
    leerEstado(origenes.estado),
  ]);
  const shaCatalogo = sha256(bytesCatalogo);
  const shaEstado = bytesEstado ? sha256(bytesEstado) : '';
  const staging = `${rutaDb}.${process.pid}-${Date.now()}.migrando`;
  await mkdir(dirname(rutaDb), { recursive: true, mode: 0o700 });
  let db: Database.Database | undefined;
  try {
    db = abrirBaseDatos(staging, { permitirJsonLegado: true, cachear: false });
    db.transaction(() => {
      guardarCatalogo(db!, catalogo);
      guardarEstadoCompleto(db!, estado);
      db!
        .prepare(
          `
        INSERT INTO migraciones_datos (id, fecha, sha256_catalogo, sha256_estado, cantidad_cotizaciones)
        VALUES (?, ?, ?, ?, ?)
      `,
        )
        .run(MIGRACION_ID, new Date().toISOString(), shaCatalogo, shaEstado, estado.cotizaciones.length);
    }).immediate();

    const repo = new RepositorioCatalogoSqlite(db);
    const estadoLeido = leerEstadoDeBase(db);
    const metadata = repo.metadata;
    if (!metadata) throw new Error('Faltan los metadatos del catálogo recién importado.');
    const catalogoLeido: Catalogo = {
      fuente: metadata.fuente,
      sha256: metadata.sha256,
      fecha: metadata.fecha,
      productos: repo.todos(),
    };
    if (!isDeepStrictEqual(estadoLeido, estado))
      throw new Error('La verificación detectó diferencias en las cotizaciones migradas.');
    if (!isDeepStrictEqual(catalogoLeido, comoSeGuarda(catalogo)))
      throw new Error('La verificación detectó diferencias en los productos migrados.');
    const integrity = db.pragma('integrity_check', { simple: true });
    const foreignKeys = db.pragma('foreign_key_check') as unknown[];
    if (integrity !== 'ok' || foreignKeys.length)
      throw new Error('La base SQLite migrada no supera la comprobación de integridad.');

    db.pragma('wal_checkpoint(TRUNCATE)');
    db.pragma('journal_mode = DELETE');
    db.close();
    db = undefined;
    await rename(staging, rutaDb);
    const archivo = await respaldarYRetirar(
      origenes,
      { catalogo: shaCatalogo, estado: shaEstado },
      directorioRespaldo,
    );
    return { yaMigrada: false, archivo };
  } catch (error) {
    if (db?.open) db.close();
    await rm(staging, { force: true });
    await rm(`${staging}-wal`, { force: true });
    await rm(`${staging}-shm`, { force: true });
    throw error;
  }
}

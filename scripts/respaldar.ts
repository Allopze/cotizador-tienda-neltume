import Database from 'better-sqlite3';
import { copyFile, cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { abrirBaseDatos, cerrarBaseDatos, directorioDatos, rutaBaseDatos } from '../src/servidor/base-datos';

// Uso: npm run respaldar -- [--destino ruta] [--conservar 30]
// Copia en caliente la base (API de respaldo de SQLite, segura con el servidor en marcha), los PDF
// emitidos y config/catalogo.json a <destino>/<fecha>/. Conviene que el destino esté en otro disco.
const args = process.argv.slice(2);
const valor = (nombre: string) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
};
const destino = resolve(valor('--destino') ?? process.env.NELTUME_RESPALDO_DIR ?? 'respaldos');
const conservar = Number(valor('--conservar') ?? 30);
const PREFIJO = 'cotizador-';

async function main() {
  if (!Number.isInteger(conservar) || conservar < 1)
    throw new Error('--conservar debe ser un entero mayor o igual a 1.');
  const carpeta = join(destino, `${PREFIJO}${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(carpeta, { recursive: true, mode: 0o700 });

  // Primero la base y después los PDF: todo documento que la copia referencia ya existe en disco.
  const rutaDb = rutaBaseDatos();
  const copiaDb = join(carpeta, basename(rutaDb));
  await abrirBaseDatos(rutaDb).backup(copiaDb);
  const verificacion = new Database(copiaDb);
  let cotizaciones: number;
  try {
    // La copia hereda WAL: se deja como un único archivo autocontenido, fácil de restaurar.
    verificacion.pragma('journal_mode = DELETE');
    const integridad = verificacion.pragma('integrity_check', { simple: true });
    if (integridad !== 'ok') throw new Error(`La copia de la base no pasó integrity_check: ${integridad}`);
    cotizaciones = (verificacion.prepare('SELECT COUNT(*) AS n FROM cotizaciones').get() as { n: number }).n;
  } finally {
    verificacion.close();
  }

  // Solo PDF terminados: los temporales de una emisión en curso empiezan con punto.
  const pdf = join(directorioDatos(), 'pdf');
  let documentos = 0;
  if (await existe(pdf))
    await cp(pdf, join(carpeta, 'pdf'), {
      recursive: true,
      filter: (origen) => {
        const nombre = basename(origen);
        if (origen === pdf) return true;
        if (nombre.startsWith('.')) return false;
        documentos++;
        return true;
      },
    });
  const config = resolve(process.env.NELTUME_CATALOGO_CONFIG ?? 'config/catalogo.json');
  if (await existe(config)) await copyFile(config, join(carpeta, basename(config)));

  const anteriores = (await readdir(destino)).filter((n) => n.startsWith(PREFIJO)).sort();
  for (const vieja of anteriores.slice(0, Math.max(anteriores.length - conservar, 0)))
    await rm(join(destino, vieja), { recursive: true, force: true });

  console.log(`Respaldo en ${carpeta}: ${cotizaciones} cotizaciones, ${documentos} PDF.`);
}

const existe = (ruta: string) =>
  stat(ruta).then(
    () => true,
    () => false,
  );

main()
  .catch((error: Error) => {
    console.error(`No se pudo completar el respaldo: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => cerrarBaseDatos());

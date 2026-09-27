import { migrarJsonASqlite } from '../src/servidor/migracion-sqlite';

try {
  const resultado = await migrarJsonASqlite();
  console.log(
    resultado.yaMigrada
      ? `La base ya estaba migrada. Respaldo JSON: ${resultado.archivo ?? 'existente'}.`
      : `Migración SQLite validada. Respaldo JSON: ${resultado.archivo}.`,
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'No se pudo migrar los archivos JSON a SQLite.',
  );
  process.exitCode = 1;
}

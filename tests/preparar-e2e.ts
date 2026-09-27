import { access, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { importar } from '../src/catalogo/importar';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { guardarCatalogo } from '../src/servidor/repositorio-catalogo';
// Todo lo del E2E vive en data/test-e2e: no toca el catálogo, el estado ni el logo reales.
export const DIR_E2E = 'data/test-e2e';
export default async function preparar() {
  await rm(DIR_E2E, { recursive: true, force: true });
  const r = await importar(process.env.NELTUME_PLANILLA ?? 'datos-privados/COTIZADOR_2026.xlsx');
  await mkdir(DIR_E2E, { recursive: true });
  const db = abrirBaseDatos(join(DIR_E2E, 'cotizador.sqlite'), {
    permitirJsonLegado: true,
    cachear: false,
  });
  try {
    guardarCatalogo(db, r.catalogo);
  } finally {
    db.close();
  }
  try {
    await access('public/logo-neltume.svg');
  } catch {
    if (r.logo) await writeFile('public/logo-neltume.svg', r.logo);
  }
}

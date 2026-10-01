import { access, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { importar } from '../src/catalogo/importar';
import { abrirBaseDatos } from '../src/servidor/base-datos';
import { guardarCatalogo } from '../src/servidor/repositorio-catalogo';
import { migrarEsquemaAutenticacion } from '../src/servidor/autenticacion-config';
import { ADMIN_E2E, CLAVE_E2E, DIR_E2E, USUARIO_E2E } from './datos-e2e';
// Todo lo del E2E vive en un directorio aislado: no toca el catálogo ni la base reales.
export default async function preparar() {
  await rm(DIR_E2E, { recursive: true, force: true });
  process.env.NELTUME_DATA_DIR = DIR_E2E;
  process.env.NELTUME_DB_PATH = join(DIR_E2E, 'cotizador.sqlite');
  process.env.BETTER_AUTH_SECRET = 'playwright-secret-neltume-0123456789abcdef';
  process.env.BETTER_AUTH_URL = 'http://127.0.0.1:3100';
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

  const authDb = abrirBaseDatos(join(DIR_E2E, 'cotizador.sqlite'), {
    permitirJsonLegado: true,
    cachear: false,
  });
  try {
    await migrarEsquemaAutenticacion(authDb);
  } finally {
    authDb.close();
  }
  const { auth } = await import('../src/servidor/autenticacion');
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser(
    { email: USUARIO_E2E, name: 'Usuario de prueba', emailVerified: true, role: 'user' },
    { method: 'admin' },
  );
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: await context.password.hash(CLAVE_E2E),
  });
  const admin = await context.internalAdapter.createUser(
    { email: ADMIN_E2E, name: 'Administrador de prueba', emailVerified: true, role: 'admin' },
    { method: 'admin' },
  );
  await context.internalAdapter.linkAccount({
    userId: admin.id,
    providerId: 'credential',
    accountId: admin.id,
    password: await context.password.hash(CLAVE_E2E),
  });

  try {
    await access('public/logo-neltume.svg');
  } catch {
    if (r.logo) await writeFile('public/logo-neltume.svg', r.logo);
  }
}

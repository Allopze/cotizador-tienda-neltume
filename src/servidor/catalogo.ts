import { ErrorMigracionRequerida, abrirBaseDatos } from './base-datos';
import { RepositorioCatalogoSqlite } from './repositorio-catalogo';
export class ErrorCatalogo extends Error {}

export async function cargarCatalogo(): Promise<RepositorioCatalogoSqlite> {
  try {
    const db = abrirBaseDatos();
    const catalogo = new RepositorioCatalogoSqlite(db);
    const metadata = catalogo.metadata;
    const cantidad = (db.prepare('SELECT COUNT(*) AS n FROM productos_catalogo').get() as { n: number }).n;
    if (!metadata || !cantidad || metadata.cantidadProductos !== cantidad)
      throw new Error('catálogo ausente o inconsistente');
    return catalogo;
  } catch (e) {
    if (e instanceof ErrorMigracionRequerida) throw e;
    throw new ErrorCatalogo(
      'Falta el catálogo o la base está dañada. Revisa la importación con npm run importar.',
    );
  }
}

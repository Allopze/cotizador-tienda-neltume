import type Database from 'better-sqlite3';
import { normalizar, type FuenteCatalogo } from '../catalogo/resolver';
import {
  aliasMaderasConfiguradas,
  CONFIGURACION_CATALOGO_BASE,
  resolverMaderaConfigurada,
  resolverModeloConfigurado,
  validarConfiguracionCatalogo,
  type ConfiguracionCatalogo,
} from '../catalogo/configuracion';
import type { Catalogo, Madera, Producto } from '../catalogo/tipos';

type FilaProducto = {
  codigo: string;
  modelo: string;
  familia: Producto['familia'];
  tipo: string | null;
  madera: Madera;
  medida: string;
  ancho_min: number | null;
  ancho_max: number | null;
  largo: number;
  precio_neto: number;
  descripcion: string;
  fila_origen: number;
};

const convertirProducto = (p: FilaProducto): Producto => ({
  codigo: p.codigo,
  modelo: p.modelo,
  familia: p.familia,
  tipo: p.tipo,
  madera: p.madera,
  medida: p.medida,
  anchoMin: p.ancho_min,
  anchoMax: p.ancho_max,
  largo: p.largo,
  precioNeto: p.precio_neto,
  descripcion: p.descripcion,
  filaOrigen: p.fila_origen,
});

export function guardarCatalogo(
  db: Database.Database,
  catalogo: Catalogo,
  configuracion: ConfiguracionCatalogo = CONFIGURACION_CATALOGO_BASE,
) {
  if (!catalogo.productos.length) throw new Error('El catálogo no puede estar vacío.');
  const configuracionValidada = validarConfiguracionCatalogo(configuracion);
  const insertar = db.prepare(`
    INSERT INTO productos_catalogo (
      codigo, orden, modelo, modelo_normalizado, familia, tipo, madera, medida,
      ancho_min, ancho_max, largo, precio_neto, descripcion, fila_origen
    ) VALUES (
      @codigo, @orden, @modelo, @modelo_normalizado, @familia, @tipo, @madera, @medida,
      @ancho_min, @ancho_max, @largo, @precio_neto, @descripcion, @fila_origen
    )
  `);
  db.transaction(() => {
    db.prepare('DELETE FROM productos_catalogo').run();
    catalogo.productos.forEach((p, orden) =>
      insertar.run({
        codigo: p.codigo,
        orden,
        modelo: p.modelo,
        modelo_normalizado: normalizar(p.modelo),
        familia: p.familia,
        tipo: p.tipo,
        madera: p.madera,
        medida: p.medida,
        ancho_min: p.anchoMin,
        ancho_max: p.anchoMax,
        largo: p.largo,
        precio_neto: p.precioNeto,
        descripcion: p.descripcion,
        fila_origen: p.filaOrigen,
      }),
    );
    db.prepare(`
      INSERT INTO catalogo_meta (id, fuente, sha256, fecha, cantidad_productos)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        fuente = excluded.fuente,
        sha256 = excluded.sha256,
        fecha = excluded.fecha,
        cantidad_productos = excluded.cantidad_productos
    `).run(catalogo.fuente, catalogo.sha256, catalogo.fecha, catalogo.productos.length);
    db.prepare(`
      INSERT INTO catalogo_configuracion (id, configuracion_json) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET configuracion_json = excluded.configuracion_json
    `).run(JSON.stringify(configuracionValidada));
  }).immediate();
}

export class RepositorioCatalogoSqlite implements FuenteCatalogo {
  readonly configuracion: ConfiguracionCatalogo;

  constructor(private db: Database.Database) {
    const fila = db
      .prepare('SELECT configuracion_json FROM catalogo_configuracion WHERE id = 1')
      .get() as { configuracion_json: string } | undefined;
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

  get metadata(): Omit<Catalogo, 'productos'> & { cantidadProductos: number } | null {
    const fila = this.db
      .prepare('SELECT fuente, sha256, fecha, cantidad_productos FROM catalogo_meta WHERE id = 1')
      .get() as
      | { fuente: string; sha256: string; fecha: string; cantidad_productos: number }
      | undefined;
    return fila
      ? {
          fuente: fila.fuente,
          sha256: fila.sha256,
          fecha: fila.fecha,
          cantidadProductos: fila.cantidad_productos,
        }
      : null;
  }

  modelos() {
    return this.db
      .prepare('SELECT modelo FROM productos_catalogo GROUP BY modelo ORDER BY MIN(orden)')
      .all()
      .map((r) => (r as { modelo: string }).modelo);
  }

  todos() {
    const filas = this.db
      .prepare(`
        SELECT codigo, modelo, familia, tipo, madera, medida, ancho_min, ancho_max,
               largo, precio_neto, descripcion, fila_origen
        FROM productos_catalogo ORDER BY orden
      `)
      .all() as FilaProducto[];
    return filas.map(convertirProducto);
  }

  maderas() {
    return this.db
      .prepare('SELECT madera FROM productos_catalogo GROUP BY madera ORDER BY MIN(orden)')
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
      Object.entries(this.configuracion.aliasModelos).filter(([nombre]) => disponibles.has(normalizar(nombre))),
    );
  }

  productosDeModelo(modeloNormalizado: string) {
    const filas = this.db
      .prepare(`
        SELECT codigo, modelo, familia, tipo, madera, medida, ancho_min, ancho_max,
               largo, precio_neto, descripcion, fila_origen
        FROM productos_catalogo
        WHERE modelo_normalizado = ?
        ORDER BY orden
      `)
      .all(modeloNormalizado) as FilaProducto[];
    return filas.map(convertirProducto);
  }

  buscarPorCodigo(codigo: string) {
    const fila = this.db
      .prepare(`
        SELECT codigo, modelo, familia, tipo, madera, medida, ancho_min, ancho_max,
               largo, precio_neto, descripcion, fila_origen
        FROM productos_catalogo WHERE codigo = ?
      `)
      .get(codigo) as FilaProducto | undefined;
    return fila ? convertirProducto(fila) : undefined;
  }
}

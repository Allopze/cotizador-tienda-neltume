import type Database from 'better-sqlite3';
import { normalizar, normalizarMedida, type FuenteCatalogo } from '../catalogo/resolver';
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

const claveProducto = (producto: Pick<Producto, 'modelo' | 'madera' | 'medida' | 'largo'>) =>
  `${normalizar(producto.modelo)}|${normalizar(producto.madera)}|${normalizarMedida(producto.medida)}|${Math.round(producto.largo * 1_000_000)}`;

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
    const metaAnterior = db.prepare('SELECT fecha FROM catalogo_meta WHERE id = 1').get() as
      | { fecha: string }
      | undefined;
    const fecha = new Date(
      Math.max(Date.parse(catalogo.fecha), metaAnterior ? Date.parse(metaAnterior.fecha) + 1 : 0),
    ).toISOString();
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
    const manuales = db
      .prepare('SELECT codigo, modelo, madera, medida, largo FROM productos_adicionales')
      .all() as Pick<Producto, 'codigo' | 'modelo' | 'madera' | 'medida' | 'largo'>[];
    const codigosManuales = new Set(manuales.map((p) => p.codigo.toUpperCase()));
    const clavesManuales = new Set(manuales.map(claveProducto));
    if (
      catalogo.productos.some(
        (p) => codigosManuales.has(p.codigo.toUpperCase()) || clavesManuales.has(claveProducto(p)),
      )
    )
      throw new Error('La planilla repite un código o producto agregado manualmente.');
    const cantidad = db
      .prepare('SELECT (SELECT COUNT(*) FROM productos_catalogo) + (SELECT COUNT(*) FROM productos_adicionales) AS n')
      .get() as { n: number };
    db.prepare(`
      INSERT INTO catalogo_meta (id, fuente, sha256, fecha, cantidad_productos)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        fuente = excluded.fuente,
        sha256 = excluded.sha256,
        fecha = excluded.fecha,
        cantidad_productos = excluded.cantidad_productos
    `).run(catalogo.fuente, catalogo.sha256, fecha, cantidad.n);
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

  get version(): string | null {
    const metadata = this.metadata;
    return metadata ? `${metadata.sha256}:${metadata.fecha}` : null;
  }

  modelos() {
    return this.db
      .prepare(`
        SELECT modelo FROM (
          SELECT modelo, orden AS orden, 0 AS fuente FROM productos_catalogo
          UNION ALL
          SELECT modelo, rowid AS orden, 1 AS fuente FROM productos_adicionales
        ) GROUP BY modelo ORDER BY MIN(fuente), MIN(orden)
      `)
      .all()
      .map((r) => (r as { modelo: string }).modelo);
  }

  todos() {
    const filas = this.db
      .prepare(`
        SELECT codigo, modelo, familia, tipo, madera, medida, ancho_min, ancho_max,
               largo, precio_neto, descripcion, fila_origen
        FROM (
          SELECT 0 AS fuente, orden, codigo, modelo, familia, tipo, madera, medida,
                 ancho_min, ancho_max, largo, precio_neto, descripcion, fila_origen
          FROM productos_catalogo
          UNION ALL
          SELECT 1 AS fuente, rowid AS orden, codigo, modelo, familia, tipo, madera, medida,
                 ancho_min, ancho_max, largo, precio_neto, descripcion, fila_origen
          FROM productos_adicionales
        ) ORDER BY fuente, orden
      `)
      .all() as FilaProducto[];
    return filas.map(convertirProducto);
  }

  maderas() {
    return this.db
      .prepare(`
        SELECT madera FROM (
          SELECT madera, orden AS orden, 0 AS fuente FROM productos_catalogo
          UNION ALL
          SELECT madera, rowid AS orden, 1 AS fuente FROM productos_adicionales
        ) GROUP BY madera ORDER BY MIN(fuente), MIN(orden)
      `)
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
        FROM (
          SELECT modelo_normalizado, 0 AS fuente, orden, codigo, modelo, familia, tipo, madera,
                 medida, ancho_min, ancho_max, largo, precio_neto, descripcion, fila_origen
          FROM productos_catalogo
          UNION ALL
          SELECT modelo_normalizado, 1 AS fuente, rowid AS orden, codigo, modelo, familia, tipo, madera,
                 medida, ancho_min, ancho_max, largo, precio_neto, descripcion, fila_origen
          FROM productos_adicionales
        ) WHERE modelo_normalizado = ?
        ORDER BY fuente, orden
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
        UNION ALL
        SELECT codigo, modelo, familia, tipo, madera, medida, ancho_min, ancho_max,
               largo, precio_neto, descripcion, fila_origen
        FROM productos_adicionales WHERE codigo = ?
        LIMIT 1
      `)
      .get(codigo, codigo) as FilaProducto | undefined;
    return fila ? convertirProducto(fila) : undefined;
  }

  productoDuplicado(producto: Producto) {
    const porCodigo = this.buscarPorCodigo(producto.codigo);
    if (porCodigo) return porCodigo;
    return (
      this.productosDeModelo(normalizar(producto.modelo)).find(
        (existente) =>
          normalizar(existente.madera) === normalizar(producto.madera) &&
            normalizarMedida(existente.medida) === normalizarMedida(producto.medida) &&
            Math.abs(existente.largo - producto.largo) < 0.000001,
      ) ?? null
    );
  }

  familiaExistente(modelo: string) {
    return this.productosDeModelo(normalizar(modelo))[0]?.familia ?? null;
  }

  agregarProductoManual(producto: Producto, versionEsperada: string, pendienteId?: string) {
    return this.db.transaction(() => {
      if (!this.version || this.version !== versionEsperada)
        throw new Error('El catálogo cambió mientras revisabas el producto. Vuelve a generar la propuesta.');
      const familia = this.familiaExistente(producto.modelo);
      if (familia && familia !== producto.familia)
        throw new Error('Ese modelo ya existe con otra familia. Usa un nombre de modelo distinto.');
      if (this.productoDuplicado(producto)) throw new Error('Ya existe un producto con esos atributos.');
      const creada = new Date().toISOString();
      this.db
        .prepare(`
          INSERT INTO productos_adicionales (
            codigo, modelo, modelo_normalizado, familia, tipo, madera, medida, ancho_min, ancho_max,
            largo, precio_neto, descripcion, fila_origen, creada
          ) VALUES (
            @codigo, @modelo, @modelo_normalizado, @familia, @tipo, @madera, @medida, @ancho_min, @ancho_max,
            @largo, @precio_neto, @descripcion, 0, @creada
          )
        `)
        .run({
          codigo: producto.codigo,
          modelo: producto.modelo,
          modelo_normalizado: normalizar(producto.modelo),
          familia: producto.familia,
          tipo: producto.tipo,
          madera: producto.madera,
          medida: producto.medida,
          ancho_min: producto.anchoMin,
          ancho_max: producto.anchoMax,
          largo: producto.largo,
          precio_neto: producto.precioNeto,
          descripcion: producto.descripcion,
          creada,
        });
      const cantidad = this.db
        .prepare('SELECT (SELECT COUNT(*) FROM productos_catalogo) + (SELECT COUNT(*) FROM productos_adicionales) AS n')
        .get() as { n: number };
      const fechaAnterior = this.metadata?.fecha;
      const fecha = new Date(Math.max(Date.now(), fechaAnterior ? Date.parse(fechaAnterior) + 1 : 0)).toISOString();
      this.db
        .prepare('UPDATE catalogo_meta SET fecha = ?, cantidad_productos = ? WHERE id = 1')
        .run(fecha, cantidad.n);
      if (pendienteId) this.db.prepare('DELETE FROM productos_pendientes WHERE id = ?').run(pendienteId);
      return producto;
    }).immediate();
  }
}

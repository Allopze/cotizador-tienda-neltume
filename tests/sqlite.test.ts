import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clienteVacio, type Catalogo, type Producto } from '../src/catalogo/tipos';
import { resolverItem } from '../src/catalogo/resolver';
import { estadoInicial, type Cotizacion, type Estado } from '../src/negocio/estado';
import { cotizar } from '../src/negocio/precios';
import { Almacen, guardarEstadoCompleto } from '../src/servidor/almacen';
import { abrirBaseDatos, cerrarBaseDatos } from '../src/servidor/base-datos';
import { migrarJsonASqlite } from '../src/servidor/migracion-sqlite';
import { completarEstadoLegado } from '../src/servidor/persistencia-esquemas';
import { guardarCatalogo, RepositorioCatalogoSqlite } from '../src/servidor/repositorio-catalogo';

const directorios: string[] = [];
async function temp() {
  const dir = await mkdtemp(join(tmpdir(), 'cotizador-sqlite-'));
  directorios.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of directorios.splice(0)) await rm(dir, { recursive: true, force: true });
});

const producto = (overrides: Partial<Producto> = {}): Producto => ({
  codigo: 'MOL-O-3-A',
  modelo: 'MOLCO',
  familia: 'PUERTA',
  tipo: 'PUERTA PANEL',
  madera: 'PINO OREGON',
  medida: '0,80 A 0,85',
  anchoMin: 0.8,
  anchoMax: 0.85,
  largo: 2,
  precioNeto: 100.4,
  descripcion: 'MOLCO PINO OREGON 0,80 A 0,85 MT X 2 MT',
  filaOrigen: 4,
  ...overrides,
});

const catalogoFixture = (): Catalogo => ({
  fuente: 'planilla-test.xlsx',
  sha256: 'sha256-test',
  fecha: '2026-01-01T00:00:00.000Z',
  productos: [producto()],
});

/** Estado JSON con el formato anterior al esquema 6 (sin giro, vigencia, autoría, descuento ni flete). */
function estadoFixture(): Estado {
  const p = producto();
  const montos = cotizar([{ producto: p, cantidad: 3 }]);
  const notaMontos = cotizar([{ producto: p, cantidad: 3 }], { ajuste: 0, iva: 0.19 });
  const emitida = {
    id: 'cotizacion-emitida',
    numero: 323,
    estado: 'aprobada' as const,
    cliente: { ...clienteVacio(), nombre: 'María José', comuna: 'Temuco', proyecto: 'Casa Norte' },
    solicitudes: [{ modelo: 'MOLCO', madera: 'pino', ancho: 80, alto: 2, medida: null, cantidad: 3 }],
    montos,
    incompletos: [],
    historial: [
      { rol: 'usuario', texto: 'Cotiza para María José' },
      { rol: 'asistente', texto: 'Cotización actualizada.' },
    ],
    creada: '2026-01-01T00:00:00.000Z',
    actualizada: '2026-01-02T00:00:00.000Z',
    pdf: 'cotizacion-323.pdf',
    fechaEmision: '2026-01-02T00:00:00.000Z',
    nota: {
      numero: 1,
      pdf: 'nota-pedido-1.pdf',
      montos: notaMontos,
      fecha: '2026-01-03T00:00:00.000Z',
    },
  };
  const revision = {
    id: 'revision-emitida',
    numero: null,
    estado: 'borrador' as const,
    cliente: emitida.cliente,
    solicitudes: [{ ...emitida.solicitudes[0], cantidad: 8 }],
    montos: cotizar([{ producto: { ...p, precioNeto: 119 }, cantidad: 8 }]),
    incompletos: [],
    historial: [],
    creada: '2026-01-04T00:00:00.000Z',
    actualizada: '2026-01-04T00:00:00.000Z',
    pdf: null,
    fechaEmision: null,
    origen: 323,
    nota: null,
  };
  return {
    ...estadoInicial(),
    siguienteCotizacion: 324,
    siguienteNota: 2,
    cotizaciones: [emitida, revision] as unknown as Cotizacion[],
  };
}

describe('Persistencia SQLite', () => {
  it('migra catálogo, cotizaciones y snapshots sin perder datos; archiva los JSON y es idempotente', async () => {
    const dir = await temp();
    const catalogoPath = join(dir, 'catalogo.json');
    const estadoPath = join(dir, 'estado.json');
    const rutaDb = join(dir, 'cotizador.sqlite');
    const backup = join(dir, 'backup');
    const catalogo = catalogoFixture();
    const estado = estadoFixture();
    await writeFile(catalogoPath, JSON.stringify(catalogo));
    await writeFile(estadoPath, JSON.stringify(estado));

    const resultado = await migrarJsonASqlite({
      rutaDb,
      catalogo: catalogoPath,
      estado: estadoPath,
      directorioRespaldo: backup,
    });
    expect(resultado.yaMigrada).toBe(false);
    expect(await new Almacen(dir, rutaDb).leer()).toEqual(completarEstadoLegado(estado));
    const db = abrirBaseDatos(rutaDb);
    expect(new RepositorioCatalogoSqlite(db).todos()).toEqual(catalogo.productos);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.pragma('foreign_key_check')).toEqual([]);
    cerrarBaseDatos(rutaDb);

    await expect(readFile(catalogoPath)).rejects.toThrow();
    await expect(readFile(estadoPath)).rejects.toThrow();
    const archivos = await readdir(resultado.archivo!);
    expect(archivos.sort()).toEqual(['catalogo.json', 'estado.json']);
    expect(JSON.parse(await readFile(join(resultado.archivo!, 'catalogo.json'), 'utf8'))).toEqual(catalogo);
    expect(JSON.parse(await readFile(join(resultado.archivo!, 'estado.json'), 'utf8'))).toEqual(estado);

    const repetida = await migrarJsonASqlite({
      rutaDb,
      catalogo: catalogoPath,
      estado: estadoPath,
      directorioRespaldo: backup,
    });
    expect(repetida.yaMigrada).toBe(true);
    expect(await new Almacen(dir, rutaDb).leer()).toEqual(completarEstadoLegado(estado));
  });

  it('la migración a v12 separa la descripción del documento, deshace el REPLACE de v11 y limpia la observación automática', async () => {
    const dir = await temp();
    const rutaDb = join(dir, 'cotizador.sqlite');
    const db = abrirBaseDatos(rutaDb, { cachear: false, permitirJsonLegado: true });
    guardarEstadoCompleto(db, completarEstadoLegado(estadoFixture()) as Estado);
    const RECTIFICAR = 'Rectificar si la medida corresponde a hoja o vano.';
    const MEZCLADA = 'Huilo Huilo MARA 0,80 A 0,85 MT X 2,4 MT';
    const MAYUSCULAS = 'HUILO HUILO MARA 0,80 A 0,85 MT X 2,4 MT';
    // Copia la primera línea de la cotización emitida como la línea `indice` (y su solicitud con esa observación).
    const agregarLinea = (indice: number, observacionSolicitud: string) => {
      for (const tabla of ['cotizacion_lineas', 'nota_lineas']) {
        const cols = (db.pragma(`table_info(${tabla})`) as { name: string }[]).map((c) => c.name);
        db.exec(`
          INSERT INTO ${tabla} (${cols.join(', ')})
          SELECT ${cols.map((c) => (c === 'orden' || c === 'indice' ? indice : c)).join(', ')}
          FROM ${tabla} WHERE cotizacion_id = 'cotizacion-emitida' AND orden = 0`);
      }
      db.prepare(
        `INSERT INTO solicitudes (cotizacion_id, orden, modelo, madera, ancho, alto, medida, cantidad, observaciones)
         VALUES ('cotizacion-emitida', ?, 'MOLCO', 'pino', 80, 2, NULL, 3, ?)`,
      ).run(indice, observacionSolicitud);
    };
    agregarLinea(1, '   ');
    agregarLinea(2, '');
    // Estado de una base en v11: líneas con el modelo canónico y la descripción ya reemplazada, sin la columna nueva.
    db.exec(`
      UPDATE cotizacion_lineas SET modelo = 'Huilo Huilo', descripcion = '${MEZCLADA}' WHERE cotizacion_id = 'cotizacion-emitida';
      UPDATE nota_lineas SET modelo = 'Huilo Huilo', descripcion = '${MEZCLADA}' WHERE cotizacion_id = 'cotizacion-emitida';
      UPDATE cotizacion_lineas SET modelo = 'Huilo Huilo', descripcion = 'Puerta Huilo Huilo reforzada' WHERE cotizacion_id = 'revision-emitida';
      UPDATE cotizacion_lineas SET indice = orden, observaciones = '${RECTIFICAR}';
      UPDATE nota_lineas SET indice = orden, observaciones = '${RECTIFICAR}';
      UPDATE solicitudes SET observaciones = '${RECTIFICAR}' WHERE cotizacion_id = 'revision-emitida';
      INSERT INTO productos_catalogo (codigo, orden, modelo, modelo_normalizado, familia, madera, medida, ancho_min, ancho_max, largo, precio_neto, descripcion, fila_origen) VALUES
        ('HUIL-M-3-A', 0, 'Huilo Huilo', 'HUILOHUILO', 'PUERTA', 'MARA', '0,80 A 0,85', 0.8, 0.85, 2.4, 100000, '${MEZCLADA}', 1),
        ('HUIL-M-3-B', 1, 'Huilo Huilo', 'HUILOHUILO', 'PUERTA', 'MARA', '0,90 A 0,95', 0.9, 0.95, 2.4, 100000, 'Puerta Huilo Huilo reforzada', 2),
        ('MOL-M-3-A', 2, 'MOLCO', 'MOLCO', 'PUERTA', 'MARA', '0,80 A 0,85', 0.8, 0.85, 2.4, 100000, 'MOLCO MARA 0,80 A 0,85 MT X 2,4 MT', 3);
      INSERT INTO productos_adicionales (codigo, modelo, modelo_normalizado, familia, madera, medida, ancho_min, ancho_max, largo, precio_neto, descripcion, creada)
        VALUES ('IA-1', 'Huilo Huilo', 'HUILOHUILO', 'PUERTA', 'MARA', '1,00 A 1,05', 1, 1.05, 2.4, 100000, 'Huilo Huilo MARA 1,00 A 1,05 MT X 2,4 MT', '2026-01-01T00:00:00.000Z');
      ALTER TABLE cotizacion_lineas DROP COLUMN descripcion_documento;
      ALTER TABLE nota_lineas DROP COLUMN descripcion_documento;
      ALTER TABLE cotizaciones DROP COLUMN margen_cotizacion;
      PRAGMA user_version = 11;
    `);
    db.close();

    const migrada = abrirBaseDatos(rutaDb, { cachear: false });
    try {
      // Llega a la versión vigente del esquema (las migraciones posteriores a v12 tienen sus propias pruebas).
      expect(migrada.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(12);
      const descripciones = (tabla: string) =>
        migrada.prepare(`SELECT cotizacion_id AS id, orden, descripcion, descripcion_documento AS documento FROM ${tabla} ORDER BY cotizacion_id, orden`).all();
      expect(descripciones('cotizacion_lineas')).toEqual([
        ...[0, 1, 2].map((orden) => ({ id: 'cotizacion-emitida', orden, descripcion: MAYUSCULAS, documento: null })),
        // Lo escrito a mano (con minúsculas) no se toca.
        { id: 'revision-emitida', orden: 0, descripcion: 'Puerta Huilo Huilo reforzada', documento: null },
      ]);
      expect(descripciones('nota_lineas').map((l) => (l as { descripcion: string }).descripcion)).toEqual([MAYUSCULAS, MAYUSCULAS, MAYUSCULAS]);
      // El catálogo importado con la versión intermedia del importador también vuelve a mayúsculas.
      const catalogo = (tabla: string) =>
        migrada.prepare(`SELECT codigo, descripcion FROM ${tabla} ORDER BY codigo`).all();
      expect(catalogo('productos_catalogo')).toEqual([
        { codigo: 'HUIL-M-3-A', descripcion: MAYUSCULAS },
        { codigo: 'HUIL-M-3-B', descripcion: 'Puerta Huilo Huilo reforzada' },
        { codigo: 'MOL-M-3-A', descripcion: 'MOLCO MARA 0,80 A 0,85 MT X 2,4 MT' },
      ]);
      expect(catalogo('productos_adicionales')).toEqual([{ codigo: 'IA-1', descripcion: 'HUILO HUILO MARA 1,00 A 1,05 MT X 2,4 MT' }]);
      // La observación que el sistema agregaba sola se borra (solicitud sin observación, vacía o en blanco);
      // la que la persona escribió (está en su solicitud) se conserva.
      const observaciones = (tabla: string) =>
        migrada.prepare(`SELECT cotizacion_id AS id, orden, observaciones FROM ${tabla} ORDER BY cotizacion_id, orden`).all();
      expect(observaciones('cotizacion_lineas')).toEqual([
        ...[0, 1, 2].map((orden) => ({ id: 'cotizacion-emitida', orden, observaciones: null })),
        { id: 'revision-emitida', orden: 0, observaciones: RECTIFICAR },
      ]);
      expect(observaciones('nota_lineas').every((l) => (l as { observaciones: string | null }).observaciones === null)).toBe(true);
      const { cotizaciones } = await new Almacen(dir, rutaDb).leer();
      const lineas = cotizaciones.flatMap((q) => q.montos.lineas);
      expect(lineas.length).toBeGreaterThan(0);
      expect(lineas.every((l) => l.descripcionDocumento === null)).toBe(true);
    } finally {
      migrada.close();
      cerrarBaseDatos(rutaDb);
    }
  });

  it('si un JSON es inválido no publica una base parcial ni retira los archivos originales', async () => {
    const dir = await temp();
    const catalogoPath = join(dir, 'catalogo.json');
    const estadoPath = join(dir, 'estado.json');
    const rutaDb = join(dir, 'cotizador.sqlite');
    await writeFile(catalogoPath, JSON.stringify(catalogoFixture()));
    await writeFile(estadoPath, '{estado roto');

    await expect(
      migrarJsonASqlite({ rutaDb, catalogo: catalogoPath, estado: estadoPath, directorioRespaldo: dir }),
    ).rejects.toThrow(/JSON del estado no es válido/);
    await expect(readFile(catalogoPath)).resolves.toBeTruthy();
    await expect(readFile(estadoPath)).resolves.toBeTruthy();
    await expect(readFile(rutaDb)).rejects.toThrow();
    expect((await readdir(dir)).some((nombre) => nombre.endsWith('.migrando'))).toBe(false);
  });

  it('usa consultas por modelo y conserva el resultado del resolver en memoria', async () => {
    const dir = await temp();
    const rutaDb = join(dir, 'cotizador.sqlite');
    const catalogo = catalogoFixture();
    const db = abrirBaseDatos(rutaDb, { cachear: false });
    try {
      guardarCatalogo(db, catalogo);
      const sql = new RepositorioCatalogoSqlite(db);
      const solicitud = { modelo: 'Molco', madera: 'pino', ancho: 80, alto: 2, medida: null, cantidad: 3 };
      expect(resolverItem(sql, solicitud)).toEqual(resolverItem(catalogo, solicitud));
      expect(sql.productosDeModelo('MOLCO')).toEqual(catalogo.productos);
      expect(sql.buscarPorCodigo('MOL-O-3-A')).toEqual(producto());
    } finally {
      db.close();
    }
  });

  it('una importación con muchos menos productos exige forzar y no toca el catálogo', async () => {
    const dir = await temp();
    const db = abrirBaseDatos(join(dir, 'cotizador.sqlite'), { cachear: false });
    const conProductos = (n: number): Catalogo => ({
      ...catalogoFixture(),
      productos: Array.from({ length: n }, (_, i) =>
        producto({ codigo: `MOL-O-3-${i}`, largo: 2 + i / 100 }),
      ),
    });
    try {
      guardarCatalogo(db, conProductos(10));
      expect(() => guardarCatalogo(db, conProductos(8))).toThrow(/--forzar/);
      const repo = new RepositorioCatalogoSqlite(db);
      expect(repo.todos()).toHaveLength(10);
      guardarCatalogo(db, conProductos(9));
      expect(repo.todos()).toHaveLength(9);
      guardarCatalogo(db, conProductos(3), undefined, { forzar: true });
      expect(repo.todos()).toHaveLength(3);
    } finally {
      db.close();
    }
  });

  it('una importación duplicada falla de forma atómica y mantiene el catálogo previo', async () => {
    const dir = await temp();
    const rutaDb = join(dir, 'cotizador.sqlite');
    const db = abrirBaseDatos(rutaDb, { cachear: false });
    const anterior = catalogoFixture();
    try {
      guardarCatalogo(db, anterior);
      const duplicado: Catalogo = {
        ...anterior,
        sha256: 'nuevo-hash',
        productos: [producto(), producto()],
      };
      expect(() => guardarCatalogo(db, duplicado)).toThrow();
      const repo = new RepositorioCatalogoSqlite(db);
      expect(repo.todos()).toEqual(anterior.productos);
      expect(repo.metadata?.sha256).toBe(anterior.sha256);
    } finally {
      db.close();
    }
  });
});

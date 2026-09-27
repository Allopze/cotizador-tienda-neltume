import type Database from 'better-sqlite3';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import lockfile from 'proper-lockfile';
import { z } from 'zod';
import { normalizar } from '../catalogo/resolver';
import type { Cliente, Producto, SolicitudItem } from '../catalogo/tipos';
import type { Cotizacion, Estado, Mensaje } from '../negocio/estado';
import type { Rechazo } from '../catalogo/resolver';
import type { Montos } from '../negocio/precios';
import { abrirBaseDatos, cerrarBaseDatos, directorioDatos, rutaBaseDatos } from './base-datos';
import { estadoPersistidoSchema } from './persistencia-esquemas';

export { directorioDatos };

export class ErrorOcupado extends Error {
  constructor() {
    super(
      'Otra operación está en curso. Espera unos segundos y vuelve a intentar; tu borrador está guardado.',
    );
    this.name = 'ErrorOcupado';
  }
}

const filaProductoSchema = z.object({
  codigo: z.string(),
  modelo: z.string(),
  familia: z.enum(['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA']),
  tipo: z.string().nullable(),
  madera: z.string().min(1),
  medida: z.string(),
  ancho_min: z.number().nullable(),
  ancho_max: z.number().nullable(),
  largo: z.number(),
  precio_neto: z.number(),
  descripcion: z.string(),
  fila_origen: z.number().int(),
});
type FilaProducto = z.infer<typeof filaProductoSchema>;

type FilaCotizacion = {
  id: string;
  numero: number | null;
  estado: Cotizacion['estado'];
  cliente_nombre: string | null;
  cliente_rut: string | null;
  cliente_telefono: string | null;
  cliente_direccion: string | null;
  cliente_comuna: string | null;
  cliente_proyecto: string | null;
  creada: string;
  actualizada: string;
  pdf: string | null;
  fecha_emision: string | null;
  fecha_emision_ausente: number;
  origen_id: string | null;
  origen_ausente: number;
  origen_numero: number | null;
};

type FilaLinea = FilaProducto & {
  cantidad: number;
  precio_unitario: number;
  total: number;
};

const productoDesdeFila = (p: FilaProducto): Producto => ({
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

function lineaDesdeFila(l: FilaLinea) {
  return {
    producto: productoDesdeFila(l),
    cantidad: l.cantidad,
    precioUnitario: l.precio_unitario,
    total: l.total,
  };
}

function filasProductos(db: Database.Database, tabla: 'cotizacion_lineas' | 'nota_lineas', id: string) {
  return db
    .prepare(`
      SELECT codigo, modelo, familia, tipo, madera, medida, ancho_min, ancho_max, largo,
             precio_neto, descripcion, fila_origen, cantidad, precio_unitario, total
      FROM ${tabla} WHERE cotizacion_id = ? ORDER BY orden
    `)
    .all(id)
    .map((fila) => filaProductoSchema.extend({
      cantidad: z.number().int(),
      precio_unitario: z.number().int(),
      total: z.number().int(),
    }).parse(fila) as FilaLinea)
    .map(lineaDesdeFila);
}

export function leerEstadoDeBase(db: Database.Database): Estado {
  const correlativos = db
    .prepare('SELECT siguiente_cotizacion, siguiente_nota FROM correlativos WHERE id = 1')
    .get() as { siguiente_cotizacion: number; siguiente_nota: number } | undefined;
  if (!correlativos) throw new Error('Faltan los correlativos en la base SQLite.');
  const filas = db
    .prepare(`
      SELECT c.*, origen.numero AS origen_numero
      FROM cotizaciones AS c
      LEFT JOIN cotizaciones AS origen ON origen.id = c.origen_id
      ORDER BY c.orden
    `)
    .all() as FilaCotizacion[];
  const solicitudes = db.prepare(`
    SELECT modelo, madera, ancho, alto, medida, cantidad FROM solicitudes
    WHERE cotizacion_id = ? ORDER BY orden
  `);
  const incompletos = db.prepare(`
    SELECT indice, rechazo_json, pregunta FROM incompletos
    WHERE cotizacion_id = ? ORDER BY indice
  `);
  const historial = db.prepare(`
    SELECT rol, texto FROM historial WHERE cotizacion_id = ? ORDER BY orden
  `);
  const montos = db.prepare('SELECT neto, iva, total FROM cotizacion_montos WHERE cotizacion_id = ?');
  const nota = db.prepare(`
    SELECT numero, pdf, fecha, neto, iva, total FROM notas_pedido WHERE cotizacion_id = ?
  `);

  const cotizaciones: Cotizacion[] = filas.map((f) => {
    const m = montos.get(f.id) as { neto: number; iva: number; total: number } | undefined;
    if (!m) throw new Error(`Faltan los montos guardados de la cotización ${f.id}.`);
    const q: Cotizacion = {
      id: f.id,
      numero: f.numero,
      estado: f.estado,
      cliente: {
        nombre: f.cliente_nombre,
        rut: f.cliente_rut,
        telefono: f.cliente_telefono,
        direccion: f.cliente_direccion,
        comuna: f.cliente_comuna,
        proyecto: f.cliente_proyecto,
      } satisfies Cliente,
      solicitudes: solicitudes.all(f.id) as SolicitudItem[],
      montos: {
        lineas: filasProductos(db, 'cotizacion_lineas', f.id),
        neto: m.neto,
        iva: m.iva,
        total: m.total,
      },
      incompletos: incompletos.all(f.id).map((i) => {
        const row = i as { indice: number; rechazo_json: string; pregunta: string };
        return { indice: row.indice, rechazo: JSON.parse(row.rechazo_json) as Rechazo, pregunta: row.pregunta };
      }),
      historial: historial.all(f.id) as Mensaje[],
      creada: f.creada,
      actualizada: f.actualizada,
      pdf: f.pdf,
      nota: null,
    };
    if (!f.fecha_emision_ausente) q.fechaEmision = f.fecha_emision;
    if (!f.origen_ausente) q.origen = f.origen_id ? f.origen_numero : null;
    const n = nota.get(f.id) as
      | { numero: number; pdf: string; fecha: string; neto: number; iva: number; total: number }
      | undefined;
    if (n) {
      q.nota = {
        numero: n.numero,
        pdf: n.pdf,
        fecha: n.fecha,
        montos: {
          lineas: filasProductos(db, 'nota_lineas', f.id),
          neto: n.neto,
          iva: n.iva,
          total: n.total,
        },
      };
    }
    return q;
  });
  const resultado = estadoPersistidoSchema.safeParse({
    siguienteCotizacion: correlativos.siguiente_cotizacion,
    siguienteNota: correlativos.siguiente_nota,
    cotizaciones,
  });
  if (!resultado.success) throw new Error('La base SQLite contiene una cotización inválida.');
  return resultado.data as Estado;
}

function insertarLineas(db: Database.Database, tabla: 'cotizacion_lineas' | 'nota_lineas', id: string, montos: Montos) {
  const insertar = db.prepare(`
    INSERT INTO ${tabla} (
      cotizacion_id, orden, codigo, modelo, familia, tipo, madera, medida, ancho_min, ancho_max,
      largo, precio_neto, descripcion, fila_origen, cantidad, precio_unitario, total
    ) VALUES (
      @cotizacion_id, @orden, @codigo, @modelo, @familia, @tipo, @madera, @medida,
      @ancho_min, @ancho_max, @largo, @precio_neto, @descripcion, @fila_origen,
      @cantidad, @precio_unitario, @total
    )
  `);
  montos.lineas.forEach((l, orden) =>
    insertar.run({
      cotizacion_id: id,
      orden,
      codigo: l.producto.codigo,
      modelo: l.producto.modelo,
      familia: l.producto.familia,
      tipo: l.producto.tipo,
      madera: l.producto.madera,
      medida: l.producto.medida,
      ancho_min: l.producto.anchoMin,
      ancho_max: l.producto.anchoMax,
      largo: l.producto.largo,
      precio_neto: l.producto.precioNeto,
      descripcion: l.producto.descripcion,
      fila_origen: l.producto.filaOrigen,
      cantidad: l.cantidad,
      precio_unitario: l.precioUnitario,
      total: l.total,
    }),
  );
}

function persistirCotizacion(db: Database.Database, estado: Estado, q: Cotizacion, orden: number) {
  const origenAusente = !Object.hasOwn(q, 'origen');
  const fechaAusente = !Object.hasOwn(q, 'fechaEmision');
  const origen = q.origen == null ? null : estado.cotizaciones.find((c) => c.numero === q.origen);
  if (q.origen != null && !origen)
    throw new Error(`La cotización de origen ${q.origen} no existe en el estado guardado.`);

  db.prepare(`
    INSERT INTO cotizaciones (
      id, orden, numero, estado, cliente_nombre, cliente_nombre_normalizado, cliente_rut,
      cliente_telefono, cliente_direccion, cliente_comuna, cliente_comuna_normalizada,
      cliente_proyecto, cliente_proyecto_normalizado, creada, actualizada, pdf, fecha_emision,
      fecha_emision_ausente, origen_id, origen_ausente
    ) VALUES (
      @id, @orden, @numero, @estado, @cliente_nombre, @cliente_nombre_normalizado, @cliente_rut,
      @cliente_telefono, @cliente_direccion, @cliente_comuna, @cliente_comuna_normalizada,
      @cliente_proyecto, @cliente_proyecto_normalizado, @creada, @actualizada, @pdf, @fecha_emision,
      @fecha_emision_ausente, @origen_id, @origen_ausente
    ) ON CONFLICT(id) DO UPDATE SET
      orden = excluded.orden,
      numero = excluded.numero,
      estado = excluded.estado,
      cliente_nombre = excluded.cliente_nombre,
      cliente_nombre_normalizado = excluded.cliente_nombre_normalizado,
      cliente_rut = excluded.cliente_rut,
      cliente_telefono = excluded.cliente_telefono,
      cliente_direccion = excluded.cliente_direccion,
      cliente_comuna = excluded.cliente_comuna,
      cliente_comuna_normalizada = excluded.cliente_comuna_normalizada,
      cliente_proyecto = excluded.cliente_proyecto,
      cliente_proyecto_normalizado = excluded.cliente_proyecto_normalizado,
      creada = excluded.creada,
      actualizada = excluded.actualizada,
      pdf = excluded.pdf,
      fecha_emision = excluded.fecha_emision,
      fecha_emision_ausente = excluded.fecha_emision_ausente,
      origen_id = excluded.origen_id,
      origen_ausente = excluded.origen_ausente
  `).run({
    id: q.id,
    orden,
    numero: q.numero,
    estado: q.estado,
    cliente_nombre: q.cliente.nombre,
    cliente_nombre_normalizado: normalizarTexto(q.cliente.nombre),
    cliente_rut: q.cliente.rut,
    cliente_telefono: q.cliente.telefono,
    cliente_direccion: q.cliente.direccion,
    cliente_comuna: q.cliente.comuna,
    cliente_comuna_normalizada: normalizarTexto(q.cliente.comuna),
    cliente_proyecto: q.cliente.proyecto,
    cliente_proyecto_normalizado: normalizarTexto(q.cliente.proyecto),
    creada: q.creada,
    actualizada: q.actualizada,
    pdf: q.pdf,
    fecha_emision: q.fechaEmision ?? null,
    fecha_emision_ausente: Number(fechaAusente),
    origen_id: origen?.id ?? null,
    origen_ausente: Number(origenAusente),
  });

  const borrar = (tabla: string) => db.prepare(`DELETE FROM ${tabla} WHERE cotizacion_id = ?`).run(q.id);
  borrar('solicitudes');
  borrar('incompletos');
  borrar('historial');
  borrar('cotizacion_montos');
  borrar('cotizacion_lineas');
  borrar('notas_pedido');
  borrar('nota_lineas');

  const insSolicitud = db.prepare(`
    INSERT INTO solicitudes (cotizacion_id, orden, modelo, madera, ancho, alto, medida, cantidad)
    VALUES (@cotizacion_id, @orden, @modelo, @madera, @ancho, @alto, @medida, @cantidad)
  `);
  q.solicitudes.forEach((s, i) => insSolicitud.run({ cotizacion_id: q.id, orden: i, ...s }));
  const insIncompleto = db.prepare(`
    INSERT INTO incompletos (cotizacion_id, indice, rechazo_json, pregunta) VALUES (?, ?, ?, ?)
  `);
  q.incompletos.forEach((i) =>
    insIncompleto.run(q.id, i.indice, JSON.stringify(i.rechazo), i.pregunta),
  );
  const insMensaje = db.prepare(`
    INSERT INTO historial (cotizacion_id, orden, rol, texto) VALUES (?, ?, ?, ?)
  `);
  q.historial.forEach((m, i) => insMensaje.run(q.id, i, m.rol, m.texto));
  db.prepare('INSERT INTO cotizacion_montos (cotizacion_id, neto, iva, total) VALUES (?, ?, ?, ?)').run(
    q.id,
    q.montos.neto,
    q.montos.iva,
    q.montos.total,
  );
  insertarLineas(db, 'cotizacion_lineas', q.id, q.montos);
  if (q.nota) {
    db.prepare(`
      INSERT INTO notas_pedido (cotizacion_id, numero, pdf, fecha, neto, iva, total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(q.id, q.nota.numero, q.nota.pdf, q.nota.fecha, q.nota.montos.neto, q.nota.montos.iva, q.nota.montos.total);
    insertarLineas(db, 'nota_lineas', q.id, q.nota.montos);
  }
}

function normalizarTexto(texto: string | null) {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function guardarDiferencias(db: Database.Database, estado: Estado, anterior: Estado | null) {
  db.transaction(() => {
    db.prepare(`
      UPDATE correlativos SET siguiente_cotizacion = ?, siguiente_nota = ? WHERE id = 1
    `).run(estado.siguienteCotizacion, estado.siguienteNota);
    const previas = new Map((anterior?.cotizaciones ?? []).map((q) => [q.id, JSON.stringify(q)]));
    const actuales = new Set(estado.cotizaciones.map((q) => q.id));
    for (const [id] of previas) if (!actuales.has(id)) db.prepare('DELETE FROM cotizaciones WHERE id = ?').run(id);
    const ordenActual = db.prepare('SELECT orden FROM cotizaciones WHERE id = ?');
    const siguienteOrden = db.prepare('SELECT COALESCE(MAX(orden) + 1, 0) AS n FROM cotizaciones');
    estado.cotizaciones.forEach((q, indice) => {
      if (previas.get(q.id) !== JSON.stringify(q)) {
        const existente = ordenActual.get(q.id) as { orden: number } | undefined;
        const orden = existente?.orden ?? (siguienteOrden.get() as { n: number }).n ?? indice;
        persistirCotizacion(db, estado, q, orden);
      }
    });
  }).immediate();
}

export function guardarEstadoCompleto(db: Database.Database, estado: Estado) {
  const parsed = estadoPersistidoSchema.safeParse(estado);
  if (!parsed.success) throw new Error('El estado JSON no tiene una estructura válida.');
  db.transaction(() => {
    db.prepare('DELETE FROM cotizaciones').run();
    db.prepare(`
      UPDATE correlativos SET siguiente_cotizacion = ?, siguiente_nota = ? WHERE id = 1
    `).run(estado.siguienteCotizacion, estado.siguienteNota);
    estado.cotizaciones.forEach((q, orden) => persistirCotizacion(db, estado, q, orden));
  }).immediate();
}

export class Almacen {
  public readonly directorio: string;
  private readonly rutaDb: string;

  constructor(directorio?: string, rutaDb?: string) {
    this.directorio = resolve(directorio ?? directorioDatos());
    this.rutaDb = resolve(rutaDb ?? (directorio ? join(this.directorio, 'cotizador.sqlite') : rutaBaseDatos()));
  }

  async leer(): Promise<Estado> {
    try {
      return leerEstadoDeBase(abrirBaseDatos(this.rutaDb));
    } catch (e) {
      if (e instanceof Error) throw e;
      throw new Error('No se pudo leer la base SQLite. El archivo y sus contadores se conservaron.');
    }
  }

  async guardar(estado: Estado) {
    const db = abrirBaseDatos(this.rutaDb);
    guardarDiferencias(db, estado, null);
  }

  async transaccion<T>(fn: (estado: Estado, guardar: () => Promise<void>) => Promise<T>): Promise<T> {
    await mkdir(this.directorio, { recursive: true, mode: 0o700 });
    let release: () => Promise<void>;
    try {
      release = await lockfile.lock(this.directorio, {
        realpath: false,
        lockfilePath: join(this.directorio, '.estado.lock'),
        stale: 30000,
        retries: { retries: 60, minTimeout: 100, maxTimeout: 500 },
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ELOCKED') throw new ErrorOcupado();
      throw e;
    }
    try {
      const estado = await this.leer();
      let anterior = structuredClone(estado);
      const guardar = async () => {
        guardarDiferencias(abrirBaseDatos(this.rutaDb), estado, anterior);
        anterior = structuredClone(estado);
      };
      const resultado = await fn(estado, guardar);
      await guardar();
      return resultado;
    } finally {
      await release();
    }
  }
}

export async function validarBase(ruta = rutaBaseDatos()) {
  const db = abrirBaseDatos(ruta);
  const integrity = db.pragma('integrity_check', { simple: true });
  const foreignKeys = db.pragma('foreign_key_check') as unknown[];
  return { integrity, foreignKeys };
}

export function cerrarAlmacen(ruta?: string) {
  cerrarBaseDatos(ruta);
}

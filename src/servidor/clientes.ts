import type Database from 'better-sqlite3';
import type { Cliente } from '../catalogo/tipos';
import { rutCompacto } from '../negocio/cliente';
import type { EstadoCotizacion } from '../negocio/estado';
import type { ReceptorFacturacion, TipoDocumentoTributario } from '../negocio/facturacion';
import { normalizarTexto } from './busqueda';
import { listarClientesActivos } from './repositorio-clientes';

/** Cliente de una cotización anterior o del registro frecuente, para completar otra cotización. */
export type ClienteAnterior = Omit<Cliente, 'proyecto'> & {
  id?: string;
  registrado?: boolean;
  correo?: string | null;
  documentoHabitual?: TipoDocumentoTributario | null;
  receptorFacturacion?: ReceptorFacturacion | null;
};

/** Sugerencias que muestra el autocompletar del cliente. */
export const MAX_CLIENTES = 8;
/** Cotizaciones que se revisan, de la más reciente hacia atrás, para juntar los clientes distintos. */
const MAX_FILAS = 400;

const conLike = (termino: string) => `%${termino.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const RUT_COMPACTO_SQL =
  "LOWER(REPLACE(REPLACE(REPLACE(COALESCE(c.cliente_rut, ''), '.', ''), '-', ''), ' ', ''))";
const pareceRut = (texto: string) => /^[\d.\s‐-]+[kK]?$/.test(texto.trim());
const CON_CLIENTE = "(COALESCE(TRIM(c.cliente_nombre), '') <> '' OR COALESCE(TRIM(c.cliente_rut), '') <> '')";
const limpio = (s: string | null) => s?.trim() || null;

/** Mismo cliente: con RUT en ambos, decide el RUT; si falta en alguno, decide el nombre normalizado. */
export function mismoCliente(a: Pick<ClienteAnterior, 'nombre' | 'rut'>, b: Pick<ClienteAnterior, 'nombre' | 'rut'>) {
  const rutA = rutCompacto(a.rut);
  const rutB = rutCompacto(b.rut);
  if (rutA && rutB) return rutA === rutB;
  const nombreA = normalizarTexto(a.nombre);
  return !!nombreA && nombreA === normalizarTexto(b.nombre);
}

interface Fila {
  cliente_nombre: string | null;
  cliente_rut: string | null;
  cliente_giro: string | null;
  cliente_telefono: string | null;
  cliente_direccion: string | null;
  cliente_comuna: string | null;
}

interface CriteriosBusqueda {
  terminos: string[];
  rut: string;
}

function analizarConsulta(consulta: string): CriteriosBusqueda | null {
  const terminos = normalizarTexto(consulta).split(' ').filter(Boolean).slice(0, 8);
  const rut = pareceRut(consulta) ? rutCompacto(consulta) : '';
  if (terminos.join('').length < 2 && rut.length < 2) return null;
  return { terminos, rut };
}

function sqlCotizaciones(crit: CriteriosBusqueda): { sql: string; params: unknown[] } {
  const alternativas: string[] = [];
  const params: unknown[] = [];
  if (crit.terminos.length) {
    alternativas.push(`(${crit.terminos.map(() => "c.cliente_nombre_normalizado LIKE ? ESCAPE '\\'").join(' AND ')})`);
    params.push(...crit.terminos.map(conLike));
  }
  if (crit.rut.length >= 2) {
    alternativas.push(`${RUT_COMPACTO_SQL} LIKE ? ESCAPE '\\'`);
    params.push(conLike(crit.rut));
  }
  return { sql: `(${alternativas.join(' OR ')})`, params };
}

function coincideCrit(cliente: Pick<ClienteAnterior, 'nombre' | 'rut'>, crit: CriteriosBusqueda): boolean {
  const nom = normalizarTexto(cliente.nombre);
  const rut = rutCompacto(cliente.rut);
  const matchNombre = crit.terminos.length > 0 && crit.terminos.every((t) => nom.includes(t));
  const matchRut = crit.rut.length >= 2 && rut.includes(crit.rut);
  return matchNombre || matchRut;
}

/** Prioriza fichas frecuentes activas y completa con cotizaciones anteriores sin duplicados (`mismoCliente`). */
export function buscarClientes(
  db: Database.Database,
  consulta: string,
  opciones: { excluir?: string | null } = {},
): ClienteAnterior[] {
  const crit = analizarConsulta(consulta);
  if (!crit) return [];

  const clientes: ClienteAnterior[] = listarClientesActivos(db)
    .filter((r) => coincideCrit(r, crit))
    .slice(0, MAX_CLIENTES)
    .map((r) => ({
      id: r.id,
      registrado: true,
      nombre: r.nombre,
      rut: r.rut,
      giro: r.giro,
      telefono: r.telefono,
      direccion: r.direccion,
      comuna: r.comuna,
      correo: r.correo,
      documentoHabitual: r.documentoHabitual,
      receptorFacturacion: r.receptorFacturacion,
    }));
  if (clientes.length >= MAX_CLIENTES) return clientes;

  const busqueda = sqlCotizaciones(crit);
  const condiciones = [busqueda.sql, CON_CLIENTE];
  const params = [...busqueda.params];
  if (opciones.excluir) {
    condiciones.push('c.id <> ?');
    params.push(opciones.excluir);
  }
  const filas = db
    .prepare(
      `SELECT c.cliente_nombre, c.cliente_rut, c.cliente_giro, c.cliente_telefono, c.cliente_direccion, c.cliente_comuna
       FROM cotizaciones c
       WHERE ${condiciones.join(' AND ')}
       ORDER BY c.actualizada DESC, c.orden DESC
       LIMIT ${MAX_FILAS}`,
    )
    .all(...params) as Fila[];
  for (const f of filas) {
    const cliente = clienteDe(f);
    const previo = clientes.find((c) => mismoCliente(c, cliente));
    if (previo) {
      if (!previo.registrado) completar(previo, cliente);
    } else if (clientes.length < MAX_CLIENTES) {
      clientes.push(cliente);
    }
  }
  return clientes;
}

function clienteDe(f: Fila): ClienteAnterior {
  return {
    nombre: limpio(f.cliente_nombre),
    rut: limpio(f.cliente_rut),
    giro: limpio(f.cliente_giro),
    telefono: limpio(f.cliente_telefono),
    direccion: limpio(f.cliente_direccion),
    comuna: limpio(f.cliente_comuna),
  };
}

const CAMPOS_COTIZACION: (keyof Omit<Cliente, 'proyecto'>)[] = [
  'nombre', 'rut', 'giro', 'telefono', 'direccion', 'comuna',
];

function completar(previo: ClienteAnterior, anterior: ClienteAnterior) {
  for (const campo of CAMPOS_COTIZACION) previo[campo] ??= anterior[campo];
}

export interface CotizacionDeCliente {
  id: string;
  numero: number | null;
  estado: EstadoCotizacion;
  actualizada: string;
  proyecto: string | null;
  total: number;
}

export interface ClienteDirectorio extends ClienteAnterior {
  notas?: string | null;
  actualizado?: string;
  cantidad: number;
  cotizaciones: CotizacionDeCliente[];
}

const POR_PAGINA_DIRECTORIO = 30;
export const MAX_COTIZACIONES_CLIENTE = 10;

interface EntradaGrupoInterna {
  grupo: ClienteDirectorio;
  ultimaFecha: string;
  seq: number;
}

function indexarGrupo(
  porRut: Map<string, EntradaGrupoInterna>,
  porNombre: Map<string, EntradaGrupoInterna[]>,
  entrada: EntradaGrupoInterna,
) {
  const r = rutCompacto(entrada.grupo.rut);
  const n = normalizarTexto(entrada.grupo.nombre);
  if (r && !porRut.has(r)) porRut.set(r, entrada);
  if (n && !(porNombre.get(n) ?? []).includes(entrada)) porNombre.set(n, [...(porNombre.get(n) ?? []), entrada]);
}

/** Agrupa clientes del historial de cotizaciones (reutilizado por `/clientes` y el script de importación). */
export function agruparClientesDeCotizaciones(db: Database.Database): ClienteDirectorio[] {
  return construirDirectorio(db, { incluirRegistrados: false }).map((e) => e.grupo);
}

function construirDirectorio(db: Database.Database, opts: { incluirRegistrados: boolean }): EntradaGrupoInterna[] {
  const entradas: EntradaGrupoInterna[] = [];
  const porRut = new Map<string, EntradaGrupoInterna>();
  const porNombre = new Map<string, EntradaGrupoInterna[]>();
  let seq = 0;

  if (opts.incluirRegistrados) {
    for (const r of listarClientesActivos(db)) {
      const grupo: ClienteDirectorio = {
        id: r.id, registrado: true, nombre: r.nombre, rut: r.rut, giro: r.giro,
        telefono: r.telefono, direccion: r.direccion, comuna: r.comuna,
        correo: r.correo, notas: r.notas, documentoHabitual: r.documentoHabitual,
        receptorFacturacion: r.receptorFacturacion, actualizado: r.actualizado,
        cantidad: 0, cotizaciones: [],
      };
      const entrada: EntradaGrupoInterna = { grupo, ultimaFecha: r.actualizado, seq: seq++ };
      entradas.push(entrada);
      indexarGrupo(porRut, porNombre, entrada);
    }
  }

  const filas = db
    .prepare(
      `SELECT c.id, c.numero, c.estado, c.actualizada, c.cliente_proyecto, COALESCE(m.total, 0) AS total,
              c.cliente_nombre, c.cliente_rut, c.cliente_giro, c.cliente_telefono, c.cliente_direccion, c.cliente_comuna
       FROM cotizaciones c
       LEFT JOIN cotizacion_montos m ON m.cotizacion_id = c.id
       WHERE ${CON_CLIENTE}
       ORDER BY c.actualizada DESC, c.orden DESC`,
    )
    .iterate() as Iterable<
    Fila & { id: string; numero: number | null; estado: EstadoCotizacion; actualizada: string; cliente_proyecto: string | null; total: number }
  >;

  for (const f of filas) {
    const cliente = clienteDe(f);
    const rut = rutCompacto(cliente.rut);
    const nombre = normalizarTexto(cliente.nombre);
    let encontrada = rut ? porRut.get(rut) : undefined;
    encontrada ??= (porNombre.get(nombre) ?? []).find((e) => mismoCliente(e.grupo, cliente));
    if (!encontrada) {
      encontrada = { grupo: { ...cliente, registrado: false, cantidad: 0, cotizaciones: [] }, ultimaFecha: f.actualizada, seq: seq++ };
      entradas.push(encontrada);
    } else if (!encontrada.grupo.registrado) {
      completar(encontrada.grupo, cliente);
    }
    if (f.actualizada > encontrada.ultimaFecha) encontrada.ultimaFecha = f.actualizada;
    indexarGrupo(porRut, porNombre, encontrada);
    encontrada.grupo.cantidad++;
    if (encontrada.grupo.cotizaciones.length < MAX_COTIZACIONES_CLIENTE) {
      encontrada.grupo.cotizaciones.push({
        id: f.id, numero: f.numero, estado: f.estado, actualizada: f.actualizada,
        proyecto: limpio(f.cliente_proyecto), total: f.total,
      });
    }
  }
  return entradas;
}

/** Directorio combinado: clientes frecuentes activos (aunque tengan 0 cotizaciones) + historial agrupado. */
export function directorioClientes(
  db: Database.Database,
  filtros: { q?: string; pagina?: number; porPagina?: number } = {},
): { clientes: ClienteDirectorio[]; total: number; pagina: number; porPagina: number } {
  const porPagina = Math.min(Math.max(Math.trunc(filtros.porPagina ?? POR_PAGINA_DIRECTORIO), 1), 100);
  const pagina = Math.max(Math.trunc(filtros.pagina ?? 1), 1);
  const crit = filtros.q?.trim() ? analizarConsulta(filtros.q) : null;
  if (filtros.q?.trim() && !crit) return { clientes: [], total: 0, pagina, porPagina };

  let entradas = construirDirectorio(db, { incluirRegistrados: true });
  if (crit) entradas = entradas.filter((e) => coincideCrit(e.grupo, crit));
  entradas.sort((a, b) => b.ultimaFecha.localeCompare(a.ultimaFecha) || a.seq - b.seq);

  const clientes = entradas.map((e) => e.grupo);
  return {
    clientes: clientes.slice((pagina - 1) * porPagina, pagina * porPagina),
    total: clientes.length,
    pagina,
    porPagina,
  };
}

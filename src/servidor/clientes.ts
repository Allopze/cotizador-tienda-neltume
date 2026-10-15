import type Database from 'better-sqlite3';
import type { Cliente } from '../catalogo/tipos';
import type { EstadoCotizacion } from '../negocio/estado';
import { rutCompacto } from '../negocio/cliente';
import { normalizarTexto } from './busqueda';

/** Cliente de una cotización anterior, para completar otra: sin el proyecto, que es de cada cotización. */
export type ClienteAnterior = Omit<Cliente, 'proyecto'>;

/** Sugerencias que muestra el autocompletar del cliente. */
export const MAX_CLIENTES = 8;
/** Cotizaciones que se revisan, de la más reciente hacia atrás, para juntar los clientes distintos. */
const MAX_FILAS = 400;

const conLike = (termino: string) => `%${termino.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
/** RUT de la columna sin puntos, guion ni espacios y en minúsculas, como `rutCompacto`. */
const RUT_COMPACTO_SQL =
  "LOWER(REPLACE(REPLACE(REPLACE(COALESCE(c.cliente_rut, ''), '.', ''), '-', ''), ' ', ''))";
/** Lo escrito parece un RUT (cifras con puntos, guion y quizá la K final), no un nombre. */
const pareceRut = (texto: string) => /^[\d.\s‐-]+[kK]?$/.test(texto.trim());

/**
 * Mismo cliente: con RUT en ambos, el RUT decide (dos «Juan Pérez» con RUT distinto son dos clientes); si falta
 * en alguno, el nombre normalizado (sin tildes, mayúsculas ni espacios de más).
 */
function mismoCliente(a: ClienteAnterior, b: ClienteAnterior) {
  const rutA = rutCompacto(a.rut),
    rutB = rutCompacto(b.rut);
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
const limpio = (s: string | null) => s?.trim() || null;

/**
 * Clientes de cotizaciones anteriores cuyo nombre contiene todas las palabras escritas, o cuyo RUT contiene las
 * cifras escritas. Más recientes primero, hasta 8 y sin duplicados: un mismo cliente aparece una vez, con lo más
 * reciente que se sabe de él y completado con lo que dicen sus cotizaciones anteriores. Solo lectura.
 */
export function buscarClientes(
  db: Database.Database,
  consulta: string,
  opciones: { excluir?: string | null } = {},
): ClienteAnterior[] {
  const busqueda = condicionBusqueda(consulta);
  if (!busqueda) return [];
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
  const clientes: ClienteAnterior[] = [];
  for (const f of filas) {
    const cliente = clienteDe(f);
    const previo = clientes.find((c) => mismoCliente(c, cliente));
    if (previo) completar(previo, cliente);
    else if (clientes.length < MAX_CLIENTES) clientes.push(cliente);
  }
  return clientes;
}

/** Cotización con nombre o RUT del cliente: las demás no dicen de quién son. */
const CON_CLIENTE = "(COALESCE(TRIM(c.cliente_nombre), '') <> '' OR COALESCE(TRIM(c.cliente_rut), '') <> '')";

/**
 * Condición SQL de la búsqueda: el nombre contiene todas las palabras escritas o el RUT contiene las cifras
 * escritas. Null si lo escrito es demasiado corto para buscar.
 */
function condicionBusqueda(consulta: string): { sql: string; params: unknown[] } | null {
  const terminos = normalizarTexto(consulta).split(' ').filter(Boolean).slice(0, 8);
  const rut = pareceRut(consulta) ? rutCompacto(consulta) : '';
  if (terminos.join('').length < 2 && rut.length < 2) return null;
  const alternativas: string[] = [];
  const params: unknown[] = [];
  if (terminos.length) {
    alternativas.push(`(${terminos.map(() => "c.cliente_nombre_normalizado LIKE ? ESCAPE '\\'").join(' AND ')})`);
    params.push(...terminos.map(conLike));
  }
  if (rut.length >= 2) {
    alternativas.push(`${RUT_COMPACTO_SQL} LIKE ? ESCAPE '\\'`);
    params.push(conLike(rut));
  }
  return { sql: `(${alternativas.join(' OR ')})`, params };
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

/** Lo más reciente manda; una cotización anterior solo completa lo que falta. */
function completar(previo: ClienteAnterior, anterior: ClienteAnterior) {
  for (const campo of Object.keys(previo) as (keyof ClienteAnterior)[]) previo[campo] ??= anterior[campo];
}

/** Cotización de un cliente en el directorio: lo justo para reconocerla y abrirla. */
export interface CotizacionDeCliente {
  id: string;
  numero: number | null;
  estado: EstadoCotizacion;
  /** Última actualización (ISO). */
  actualizada: string;
  proyecto: string | null;
  total: number;
}
export interface ClienteDirectorio extends ClienteAnterior {
  /** Cuántas cotizaciones tiene; `cotizaciones` trae las más recientes, hasta `MAX_COTIZACIONES_CLIENTE`. */
  cantidad: number;
  cotizaciones: CotizacionDeCliente[];
}

/** Clientes por página del directorio. */
const POR_PAGINA_DIRECTORIO = 30;
/** Cotizaciones que se muestran por cliente; el resto se busca en el Historial. */
export const MAX_COTIZACIONES_CLIENTE = 10;

/**
 * Directorio de clientes: los de todas las cotizaciones, agrupados como en el autocompletar (`mismoCliente`), del
 * que tuvo movimiento más reciente al más antiguo, con sus cotizaciones. Con `q`, solo los que coinciden por
 * nombre o RUT. Solo lectura.
 */
export function directorioClientes(
  db: Database.Database,
  filtros: { q?: string; pagina?: number; porPagina?: number } = {},
): { clientes: ClienteDirectorio[]; total: number; pagina: number; porPagina: number } {
  const porPagina = Math.min(Math.max(Math.trunc(filtros.porPagina ?? POR_PAGINA_DIRECTORIO), 1), 100);
  const pagina = Math.max(Math.trunc(filtros.pagina ?? 1), 1);
  const busqueda = filtros.q?.trim() ? condicionBusqueda(filtros.q) : null;
  if (filtros.q?.trim() && !busqueda) return { clientes: [], total: 0, pagina, porPagina };
  const filas = db
    .prepare(
      `SELECT c.id, c.numero, c.estado, c.actualizada, c.cliente_proyecto, COALESCE(m.total, 0) AS total,
              c.cliente_nombre, c.cliente_rut, c.cliente_giro, c.cliente_telefono, c.cliente_direccion, c.cliente_comuna
       FROM cotizaciones c
       LEFT JOIN cotizacion_montos m ON m.cotizacion_id = c.id
       WHERE ${[CON_CLIENTE, ...(busqueda ? [busqueda.sql] : [])].join(' AND ')}
       ORDER BY c.actualizada DESC, c.orden DESC`,
    )
    .iterate(...(busqueda?.params ?? [])) as Iterable<
    Fila & { id: string; numero: number | null; estado: EstadoCotizacion; actualizada: string; cliente_proyecto: string | null; total: number }
  >;
  const clientes: ClienteDirectorio[] = [];
  // Índices para agrupar sin recorrer la lista en cada fila: por RUT compacto y por nombre normalizado.
  const porRut = new Map<string, ClienteDirectorio>();
  const porNombre = new Map<string, ClienteDirectorio[]>();
  for (const f of filas) {
    const cliente = clienteDe(f);
    const rut = rutCompacto(cliente.rut);
    const nombre = normalizarTexto(cliente.nombre);
    let grupo = rut ? porRut.get(rut) : undefined;
    // Sin RUT en uno de los dos, decide el nombre (`mismoCliente`).
    grupo ??= (porNombre.get(nombre) ?? []).find((g) => mismoCliente(g, cliente));
    if (!grupo) {
      grupo = { ...cliente, cantidad: 0, cotizaciones: [] };
      clientes.push(grupo);
    } else completar(grupo, cliente);
    if (rut && !porRut.has(rut) && rutCompacto(grupo.rut) === rut) porRut.set(rut, grupo);
    if (nombre && !(porNombre.get(nombre) ?? []).includes(grupo))
      porNombre.set(nombre, [...(porNombre.get(nombre) ?? []), grupo]);
    grupo.cantidad++;
    if (grupo.cotizaciones.length < MAX_COTIZACIONES_CLIENTE)
      grupo.cotizaciones.push({
        id: f.id,
        numero: f.numero,
        estado: f.estado,
        actualizada: f.actualizada,
        proyecto: limpio(f.cliente_proyecto),
        total: f.total,
      });
  }
  return {
    clientes: clientes.slice((pagina - 1) * porPagina, pagina * porPagina),
    total: clientes.length,
    pagina,
    porPagina,
  };
}

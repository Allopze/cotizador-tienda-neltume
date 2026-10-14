import type Database from 'better-sqlite3';
import type { Cliente } from '../catalogo/tipos';
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
  const terminos = normalizarTexto(consulta).split(' ').filter(Boolean).slice(0, 8);
  const rut = pareceRut(consulta) ? rutCompacto(consulta) : '';
  if (terminos.join('').length < 2 && rut.length < 2) return [];
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
  const condiciones = [
    `(${alternativas.join(' OR ')})`,
    "(COALESCE(TRIM(c.cliente_nombre), '') <> '' OR COALESCE(TRIM(c.cliente_rut), '') <> '')",
  ];
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
    const cliente: ClienteAnterior = {
      nombre: limpio(f.cliente_nombre),
      rut: limpio(f.cliente_rut),
      giro: limpio(f.cliente_giro),
      telefono: limpio(f.cliente_telefono),
      direccion: limpio(f.cliente_direccion),
      comuna: limpio(f.cliente_comuna),
    };
    const previo = clientes.find((c) => mismoCliente(c, cliente));
    if (previo) {
      // Lo más reciente manda; una cotización anterior solo completa lo que falta.
      for (const campo of Object.keys(previo) as (keyof ClienteAnterior)[]) previo[campo] ??= cliente[campo];
    } else if (clientes.length < MAX_CLIENTES) clientes.push(cliente);
  }
  return clientes;
}

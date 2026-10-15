import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { abrirBaseDatos, directorioDatos } from './base-datos';

/**
 * Primer arranque: con la base sin ninguna cuenta, la página de inicio de sesión ofrece crear la primera. Para que
 * no la cree cualquiera que llegue antes, pide un código de un solo uso que solo ve quien administra el servidor: se
 * escribe en el registro (docker compose logs) y en disco queda únicamente su hash, con vencimiento y un tope de
 * intentos. Con al menos una cuenta, nada de esto existe (la ruta responde 404 y el archivo se borra).
 */
export const ARCHIVO_CODIGO = 'primer-arranque.json';
export const VIGENCIA_CODIGO_MS = 24 * 60 * 60 * 1000;
/** Tras estos intentos fallidos el código se invalida y se escribe uno nuevo en el registro. */
export const MAX_INTENTOS_CODIGO = 10;
// Sin 0/O ni 1/I/L para que se copie sin errores desde el registro: 31^12 ≈ 2^59 combinaciones.
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LARGO = 12;

const archivoSchema = z.object({
  version: z.literal(1),
  sal: z.string().regex(/^[0-9a-f]{32}$/),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  vence: z.iso.datetime(),
  intentos: z.number().int().min(0),
});
type ArchivoCodigo = z.infer<typeof archivoSchema>;

interface Opciones {
  dir?: string;
  db?: Database.Database;
  ahora?: Date;
  /** Dónde se anuncia un código nuevo; por omisión, el registro del servidor. */
  registrar?: (texto: string) => void;
}

const rutaArchivo = (dir = directorioDatos()) => join(dir, ARCHIVO_CODIGO);
const normalizar = (codigo: string) => codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashDe = (sal: string, codigo: string) =>
  createHash('sha256').update(sal).update(normalizar(codigo)).digest('hex');

/** true si la base ya tiene alguna cuenta. Sin la tabla de cuentas (esquema sin migrar) no se ofrece crear una. */
export function hayCuentas(db: Database.Database = abrirBaseDatos()): boolean {
  try {
    return !!db.prepare('SELECT 1 FROM "user" LIMIT 1').get();
  } catch {
    return true;
  }
}

function leerArchivo(dir?: string): ArchivoCodigo | null {
  try {
    const leido = archivoSchema.safeParse(JSON.parse(readFileSync(rutaArchivo(dir), 'utf8')));
    return leido.success ? leido.data : null;
  } catch {
    return null;
  }
}

function escribirArchivo(contenido: ArchivoCodigo, dir = directorioDatos()) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temporal = join(dir, `.${ARCHIVO_CODIGO}.${process.pid}.tmp`);
  writeFileSync(temporal, JSON.stringify(contenido), { mode: 0o600 });
  renameSync(temporal, rutaArchivo(dir));
}

export function borrarCodigoPrimerArranque(dir?: string) {
  rmSync(rutaArchivo(dir), { force: true });
}

function generarCodigo() {
  let codigo = '';
  for (let i = 0; i < LARGO; i++) codigo += ALFABETO[randomInt(ALFABETO.length)];
  return codigo.match(/.{4}/g)!.join('-');
}

const fechaChile = (fecha: Date) =>
  fecha.toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'short' });

function nuevoCodigo({ dir, ahora = new Date(), registrar = console.log }: Opciones) {
  const codigo = generarCodigo();
  const sal = randomBytes(16).toString('hex');
  const vence = new Date(ahora.getTime() + VIGENCIA_CODIGO_MS);
  escribirArchivo({ version: 1, sal, hash: hashDe(sal, codigo), vence: vence.toISOString(), intentos: 0 }, dir);
  const linea = '─'.repeat(72);
  registrar(
    [
      linea,
      'Cotizador sin cuentas: crea la primera en la página de inicio de sesión.',
      `Código de un solo uso: ${codigo}`,
      `Vence el ${fechaChile(vence)} (hora de Chile). Vale el último código de este registro.`,
      linea,
    ].join('\n'),
  );
  return { generado: true as const, vence: vence.toISOString() };
}

/**
 * Deja un código vigente si la base no tiene cuentas. Con `renovar` lo reemplaza siempre (al iniciar el contenedor:
 * así el último código del registro es el que vale); sin él, solo si falta, venció o agotó sus intentos.
 * Con cuentas borra el archivo y devuelve null.
 */
export function asegurarCodigoPrimerArranque(opciones: Opciones & { renovar?: boolean } = {}) {
  const { dir, db, ahora = new Date(), renovar = false } = opciones;
  if (hayCuentas(db)) {
    borrarCodigoPrimerArranque(dir);
    return null;
  }
  const actual = leerArchivo(dir);
  if (
    !renovar &&
    actual &&
    Date.parse(actual.vence) > ahora.getTime() &&
    actual.intentos < MAX_INTENTOS_CODIGO
  )
    return { generado: false as const, vence: actual.vence };
  return nuevoCodigo(opciones);
}

/**
 * Comprueba el código sin consumirlo (se borra al crear la cuenta). Un intento fallido se cuenta; al llegar al
 * tope se escribe un código nuevo en el registro y el anterior deja de servir.
 */
export function codigoPrimerArranqueValido(codigo: string, opciones: Opciones = {}): boolean {
  const { dir, ahora = new Date() } = opciones;
  const actual = leerArchivo(dir);
  if (!actual || Date.parse(actual.vence) <= ahora.getTime() || actual.intentos >= MAX_INTENTOS_CODIGO)
    return false;
  const esperado = Buffer.from(actual.hash, 'hex');
  const recibido = Buffer.from(hashDe(actual.sal, codigo), 'hex');
  if (normalizar(codigo).length === LARGO && timingSafeEqual(esperado, recibido)) return true;
  const intentos = actual.intentos + 1;
  if (intentos >= MAX_INTENTOS_CODIGO) nuevoCodigo(opciones);
  else escribirArchivo({ ...actual, intentos }, dir);
  return false;
}

let cola: Promise<unknown> = Promise.resolve();

/**
 * `next start` atiende en un solo proceso: encadenar las creaciones basta para que dos solicitudes simultáneas con
 * el mismo código no creen dos cuentas (la segunda ve que ya hay una y recibe 404).
 */
export function enExclusiva<T>(fn: () => Promise<T>): Promise<T> {
  const resultado = cola.then(fn, fn);
  cola = resultado.catch(() => undefined);
  return resultado;
}

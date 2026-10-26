import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  ajustesIAGuardadosSchema,
  ajustesIASchema,
  ajustesPredeterminados,
  modeloRespaldo,
  type AjustesIA,
} from '../asistente/ajustes';
import { CommandCodeLLM, type LLM } from '../asistente/llm';
import { abrirBaseDatos } from './base-datos';

import { ErrorIA } from '../asistente/errores';

const CLAVE = 'ia';
const CLAVE_API = 'commandcode-api-key';
const cifradoSchema = z.discriminatedUnion('desactivada', [
  z.object({ version: z.literal(1), desactivada: z.literal(true) }).strict(),
  z
    .object({
      version: z.literal(1),
      desactivada: z.literal(false),
      sal: z.string().regex(/^[\w-]{22}$/),
      iv: z.string().regex(/^[\w-]{16}$/),
      etiqueta: z.string().regex(/^[\w-]{22}$/),
      datos: z
        .string()
        .min(1)
        .regex(/^[\w-]+$/),
    })
    .strict(),
]);

export type FuenteClaveCommandCode = 'ajustes' | 'entorno' | 'ninguna' | 'ilegible';
export interface EstadoClaveCommandCode {
  configurada: boolean;
  fuente: FuenteClaveCommandCode;
}

export class ErrorProteccionClave extends Error {
  constructor() {
    super('Configura BETTER_AUTH_SECRET con al menos 32 caracteres antes de guardar la clave API.');
    this.name = 'ErrorProteccionClave';
  }
}

function secretoCifrado() {
  const secreto = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secreto || secreto.length < 32) throw new ErrorProteccionClave();
  return secreto;
}

function leerFilaClave(db: Database.Database) {
  return db.prepare('SELECT valor_json FROM ajustes WHERE clave = ?').get(CLAVE_API) as
    { valor_json: string } | undefined;
}

function descifrarClave(clave: Extract<z.infer<typeof cifradoSchema>, { desactivada: false }>) {
  const sal = Buffer.from(clave.sal, 'base64url');
  const llave = Buffer.from(
    hkdfSync('sha256', secretoCifrado(), sal, 'neltume:commandcode-api-key:v1', 32),
  );
  const descifrador = createDecipheriv('aes-256-gcm', llave, Buffer.from(clave.iv, 'base64url'));
  descifrador.setAuthTag(Buffer.from(clave.etiqueta, 'base64url'));
  return Buffer.concat([
    descifrador.update(Buffer.from(clave.datos, 'base64url')),
    descifrador.final(),
  ]).toString('utf8');
}

function cifrarClave(apiKey: string) {
  const sal = randomBytes(16);
  const iv = randomBytes(12);
  const llave = Buffer.from(
    hkdfSync('sha256', secretoCifrado(), sal, 'neltume:commandcode-api-key:v1', 32),
  );
  const cifrador = createCipheriv('aes-256-gcm', llave, iv);
  const datos = Buffer.concat([cifrador.update(apiKey, 'utf8'), cifrador.final()]);
  return JSON.stringify({
    version: 1,
    desactivada: false,
    sal: sal.toString('base64url'),
    iv: iv.toString('base64url'),
    etiqueta: cifrador.getAuthTag().toString('base64url'),
    datos: datos.toString('base64url'),
  });
}

function guardarValorClave(valor: string, db: Database.Database) {
  db.prepare(
    `INSERT INTO ajustes (clave, valor_json, actualizada) VALUES (?, ?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor_json = excluded.valor_json, actualizada = excluded.actualizada`,
  ).run(CLAVE_API, valor, new Date().toISOString());
}

export function leerAjustesIA(db: Database.Database = abrirBaseDatos()): AjustesIA {
  const predeterminados = ajustesPredeterminados(process.env.CMD_MODEL);
  const fila = db.prepare('SELECT valor_json FROM ajustes WHERE clave = ?').get(CLAVE) as
    { valor_json: string } | undefined;
  if (!fila) return predeterminados;
  try {
    const guardados = ajustesIAGuardadosSchema.safeParse(JSON.parse(fila.valor_json));
    return guardados.success ? guardados.data : predeterminados;
  } catch {
    return predeterminados;
  }
}

export function guardarAjustesIA(ajustes: AjustesIA, db: Database.Database = abrirBaseDatos()): AjustesIA {
  const validos = ajustesIASchema.parse(ajustes);
  db.prepare(
    `INSERT INTO ajustes (clave, valor_json, actualizada) VALUES (?, ?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor_json = excluded.valor_json, actualizada = excluded.actualizada`,
  ).run(CLAVE, JSON.stringify(validos), new Date().toISOString());
  return validos;
}

export function estadoClaveCommandCode(db: Database.Database = abrirBaseDatos()): EstadoClaveCommandCode {
  const fila = leerFilaClave(db);
  if (fila) {
    try {
      const guardada = cifradoSchema.parse(JSON.parse(fila.valor_json));
      if (guardada.desactivada) return { configurada: false, fuente: 'ninguna' };
      descifrarClave(guardada);
      return { configurada: true, fuente: 'ajustes' };
    } catch {
      return { configurada: false, fuente: 'ilegible' };
    }
  }
  const configurada = !!process.env.CMD_API_KEY?.trim();
  return { configurada, fuente: configurada ? 'entorno' : 'ninguna' };
}

export function leerClaveCommandCode(db: Database.Database = abrirBaseDatos()): string {
  const fila = leerFilaClave(db);
  if (!fila) return process.env.CMD_API_KEY?.trim() ?? '';
  try {
    const guardada = cifradoSchema.parse(JSON.parse(fila.valor_json));
    return guardada.desactivada ? '' : descifrarClave(guardada);
  } catch {
    throw new ErrorIA('ia_clave_ilegible', 'La clave de IA guardada ya no se puede leer. Vuelve a ingresarla en Ajustes.', 503);
  }
}

export function guardarClaveCommandCode(apiKey: string, db: Database.Database = abrirBaseDatos()) {
  const normalizada = apiKey.trim();
  if (!normalizada) throw new Error('La clave API no puede estar vacía.');
  guardarValorClave(cifrarClave(normalizada), db);
}

export function quitarClaveCommandCode(db: Database.Database = abrirBaseDatos()) {
  // El registro desactivado evita que CMD_API_KEY reaparezca como fallback tras quitarla en Ajustes.
  guardarValorClave(JSON.stringify({ version: 1, desactivada: true }), db);
}

/** Solo en pruebas (Playwright): el chat responde con el adaptador fijo, sin IA ni clave. */
export const llmFijoDePrueba = () => process.env.NELTUME_LLM === 'fijo' && process.env.NELTUME_TEST_MODE === '1';

/**
 * El chat está disponible: hay clave de CommandCode o corre el adaptador fijo de las pruebas. Lo usan la ruta del
 * chat y Ajustes, que la pantalla consulta para habilitar el pedido: las dos deben responder lo mismo.
 */
export function asistenteConfigurado(): boolean {
  return llmFijoDePrueba() || estadoClaveCommandCode().configurada;
}

export function crearLLM(ajustes: AjustesIA = leerAjustesIA()): LLM {
  return new CommandCodeLLM(ajustes.commandcode.modelo, leerClaveCommandCode(), {
    respaldo: modeloRespaldo(ajustes),
  });
}

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validarConfiguracionCatalogo } from './configuracion';

export async function leerConfiguracionCatalogo(ruta = process.env.NELTUME_CATALOGO_CONFIG ?? 'config/catalogo.json') {
  const archivo = resolve(ruta);
  let contenido: string;
  try {
    contenido = await readFile(archivo, 'utf8');
  } catch {
    throw new Error(`No se pudo leer la configuración del catálogo: ${archivo}.`);
  }
  let valor: unknown;
  try {
    valor = JSON.parse(contenido);
  } catch {
    throw new Error(`La configuración del catálogo no contiene JSON válido: ${archivo}.`);
  }
  try {
    return validarConfiguracionCatalogo(valor);
  } catch (error) {
    throw new Error(
      `La configuración del catálogo es inválida: ${error instanceof Error ? error.message : 'revisa sus campos.'}`,
    );
  }
}

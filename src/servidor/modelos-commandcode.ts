import { z } from 'zod';
import type { ModeloCommandCode } from '@/asistente/modelos-commandcode';

const URL_MODELOS = 'https://api.commandcode.ai/provider/v1/models';
const URL_PRECIOS = 'https://commandcode.ai/models';
const VIGENCIA_MS = 5 * 60_000;
const respuestaModelos = z.object({
  data: z.array(
    z.object({
      id: z.string().trim().min(1),
      name: z.string().trim().nullable().optional(),
      context_length: z.number().nullable().optional(),
      supported_endpoints: z.array(z.string()).nullable().optional(),
    }),
  ),
});

interface PrecioModelo {
  entrada: number | null;
  salida: number | null;
}
interface CacheCatalogo {
  modelos: ModeloCommandCode[];
  vence: number;
}
export interface CatalogoCommandCode {
  modelos: ModeloCommandCode[];
  desactualizado: boolean;
}

let cache: CacheCatalogo | null = null;
let cargaEnCurso: Promise<CatalogoCommandCode> | null = null;

function textoHtml(html: string) {
  return html
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function claveNombre(nombre: string) {
  return nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]/g, '');
}

function precioDeCelda(html: string): number | null {
  const texto = textoHtml(html);
  if (/\bfree\b/i.test(texto)) return 0;
  const monto = texto.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  if (!monto) return null;
  const valor = Number(monto[1].replace(/,/g, ''));
  return Number.isFinite(valor) ? valor : null;
}

/** Extrae los dos precios principales de la tabla pública (por millón de tokens). */
function leerPrecios(html: string): Map<string, PrecioModelo> {
  const precios = new Map<string, PrecioModelo>();
  for (const [, fila] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const celdas = [...fila.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(([, celda]) => celda);
    if (celdas.length < 5) continue;
    const enlace = celdas[0].match(/<a\b[^>]*href=["']\/models\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!enlace) continue;
    const nombre = textoHtml(enlace[1]);
    if (!nombre) continue;
    precios.set(claveNombre(nombre), {
      entrada: precioDeCelda(celdas[3]),
      salida: precioDeCelda(celdas[4]),
    });
  }
  return precios;
}

async function descargarModelos() {
  const respuesta = await fetch(URL_MODELOS, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  });
  if (!respuesta.ok) throw new Error(`CommandCode respondió ${respuesta.status} al listar modelos.`);
  const datos = respuestaModelos.safeParse(await respuesta.json());
  if (!datos.success) throw new Error('CommandCode devolvió un catálogo de modelos inválido.');
  return datos.data.data.filter((modelo) =>
    modelo.supported_endpoints?.some((endpoint) => ['/messages', '/chat/completions'].includes(endpoint)),
  );
}

async function descargarPrecios() {
  const respuesta = await fetch(URL_PRECIOS, {
    headers: { Accept: 'text/html' },
    cache: 'no-store',
    signal: AbortSignal.timeout(8_000),
  });
  if (!respuesta.ok) throw new Error(`CommandCode respondió ${respuesta.status} al listar precios.`);
  return leerPrecios(await respuesta.text());
}

function compararModelos(a: ModeloCommandCode, b: ModeloCommandCode) {
  if (a.gratis !== b.gratis) return a.gratis ? -1 : 1;
  const costoA = a.precioEntrada === null || a.precioSalida === null ? null : a.precioEntrada + a.precioSalida;
  const costoB = b.precioEntrada === null || b.precioSalida === null ? null : b.precioEntrada + b.precioSalida;
  if (costoA !== null && costoB === null) return -1;
  if (costoA === null && costoB !== null) return 1;
  if (costoA !== null && costoB !== null && costoA !== costoB) return costoA - costoB;
  return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
}

async function consultarCatalogo(): Promise<ModeloCommandCode[]> {
  const [modelos, precios] = await Promise.all([
    descargarModelos(),
    descargarPrecios().catch(() => new Map<string, PrecioModelo>()),
  ]);
  const lista = modelos.map((modelo) => {
    const precio = precios.get(claveNombre(modelo.name?.trim() || modelo.id));
    const precioEntrada = precio?.entrada ?? null;
    const precioSalida = precio?.salida ?? null;
    return {
      id: modelo.id,
      nombre: modelo.name?.trim() || modelo.id,
      contexto: modelo.context_length ?? null,
      precioEntrada,
      precioSalida,
      gratis: precioEntrada === 0 && precioSalida === 0,
    };
  });
  return lista.sort(compararModelos);
}

/** Mantiene el catálogo fresco y, si CommandCode falla temporalmente, sirve el último válido. */
export async function obtenerCatalogoCommandCode(): Promise<CatalogoCommandCode> {
  if (cache && cache.vence > Date.now()) return { modelos: cache.modelos, desactualizado: false };
  if (cargaEnCurso) return cargaEnCurso;

  const catalogoAnterior = cache;
  cargaEnCurso = consultarCatalogo()
    .then((modelos) => {
      cache = { modelos, vence: Date.now() + VIGENCIA_MS };
      return { modelos, desactualizado: false };
    })
    .catch((error: unknown) => {
      if (catalogoAnterior) return { modelos: catalogoAnterior.modelos, desactualizado: true };
      throw error;
    })
    .finally(() => {
      cargaEnCurso = null;
    });
  return cargaEnCurso;
}

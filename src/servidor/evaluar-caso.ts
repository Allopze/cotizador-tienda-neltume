import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorIA } from '../asistente/errores';
import { puntuar, type CasoEvaluacion, type ResultadoCaso } from '../asistente/evaluacion';
import type { LLM } from '../asistente/llm';
import type { CatalogoConsultable } from '../catalogo/resolver';
import { clienteVacio } from '../catalogo/tipos';
import type { Cotizacion, Mensaje } from '../negocio/estado';
import { Almacen, cerrarAlmacen } from './almacen';
import { Servicio } from './servicio';

export interface ResultadoEjecucion extends ResultadoCaso {
  /** Milisegundos de toda la conversación del caso. */
  ms: number;
  error?: { codigo: string; mensaje: string };
}

/**
 * Corre un caso de evaluación con el mismo Servicio que la aplicación (anclaje, reintentos y resolución contra
 * el catálogo incluidos), en una base temporal: no crea cotizaciones en la base real.
 */
export async function correrCaso(
  caso: CasoEvaluacion,
  llm: LLM,
  catalogo: CatalogoConsultable,
): Promise<ResultadoEjecucion> {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-eval-'));
  const almacen = new Almacen(dir);
  const inicio = Date.now();
  try {
    const servicio = new Servicio(catalogo, llm, almacen);
    let q: Cotizacion | null = null;
    // Mientras no hay borrador, el intercambio previo viaja como contexto, igual que en la interfaz.
    let charla: Mensaje[] = [];
    for (const mensaje of caso.mensajes) {
      const r = await servicio.ejecutar(
        q
          ? { tipo: 'chat', id: q.id, actualizada: q.actualizada, mensaje }
          : { tipo: 'chat', mensaje, nuevoId: randomUUID(), contexto: charla },
      );
      if (r.efimera) charla = r.cotizacion.historial;
      else q = r.cotizacion;
    }
    return {
      ...puntuar(caso, { items: q?.solicitudes ?? [], cliente: q?.cliente ?? clienteVacio() }),
      ms: Date.now() - inicio,
    };
  } catch (e) {
    return {
      ...puntuar(caso, { items: [], cliente: clienteVacio() }),
      aciertos: 0,
      ms: Date.now() - inicio,
      error: {
        codigo: e instanceof ErrorIA ? e.codigo : 'error',
        mensaje: e instanceof Error ? e.message : String(e),
      },
    };
  } finally {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
}

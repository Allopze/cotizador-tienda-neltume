import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErrorIA } from '../asistente/errores';
import { puntuar, type CasoEvaluacion, type ResultadoCaso } from '../asistente/evaluacion';
import type { LLM } from '../asistente/llm';
import type { CatalogoConsultable } from '../catalogo/resolver';
import { clienteVacio } from '../catalogo/tipos';
import { preguntasPendientes } from '../negocio/pendientes';
import { cantidadFlete, sumarCharla, unitarioFlete, type Cotizacion, type Mensaje } from '../negocio/estado';
import { Almacen, cerrarAlmacen } from './almacen';
import { Servicio, type DiagnosticoTurno } from './servicio';

export interface ResultadoEjecucion extends ResultadoCaso {
  /** Milisegundos de toda la conversación del caso. */
  ms: number;
  /** Avisos que mostró el chat en toda la conversación, con su origen. */
  avisos: DiagnosticoTurno['avisos'];
  error?: { codigo: string; mensaje: string };
}

/** Un intercambio del caso, apenas responde la IA: el mensaje del cliente y lo que contestó el chat. */
export interface TurnoEvaluado {
  /** 1 para el primer mensaje del caso. */
  numero: number;
  total: number;
  mensaje: string;
  /** Lo que el chat le mostró al usuario en ese turno (vacío si no dijo nada). */
  respuesta: string;
  ms: number;
}

/**
 * Corre un caso de evaluación con el mismo Servicio que la aplicación (anclaje, reintentos y resolución contra
 * el catálogo incluidos), en una base temporal: no crea cotizaciones en la base real.
 */
export async function correrCaso(
  caso: CasoEvaluacion,
  llm: LLM,
  catalogo: CatalogoConsultable,
  opciones: { alTurno?: (turno: TurnoEvaluado) => void } = {},
): Promise<ResultadoEjecucion> {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-eval-'));
  const almacen = new Almacen(dir);
  const inicio = Date.now();
  const avisos: ResultadoEjecucion['avisos'] = [];
  try {
    const servicio = new Servicio(catalogo, llm, almacen, null, (d) => avisos.push(...d.avisos));
    let q: Cotizacion | null = null;
    // Mientras no hay borrador, el intercambio previo viaja como contexto, igual que en la interfaz.
    let charla: Mensaje[] = [];
    for (const [i, mensaje] of caso.mensajes.entries()) {
      const inicioTurno = Date.now();
      const r = await servicio.ejecutar(
        q
          ? { tipo: 'chat', id: q.id, actualizada: q.actualizada, mensaje }
          : { tipo: 'chat', mensaje, nuevoId: randomUUID(), contexto: charla },
      );
      if (opciones.alTurno) {
        // Los mensajes del asistente que dejó este turno (puede sumar un aviso aparte de la respuesta).
        const historial = r.cotizacion.historial;
        let desde = historial.length;
        while (desde > 0 && historial[desde - 1].rol === 'asistente') desde--;
        opciones.alTurno({
          numero: i + 1,
          total: caso.mensajes.length,
          mensaje,
          respuesta: historial
            .slice(desde)
            .map((m) => m.texto)
            .join('\n'),
          ms: Date.now() - inicioTurno,
        });
      }
      if (r.efimera) charla = sumarCharla(charla, r.cotizacion.historial);
      else q = r.cotizacion;
    }
    return {
      ...puntuar(caso, {
        items: q?.solicitudes ?? [],
        cliente: q?.cliente ?? clienteVacio(),
        flete: q && q.flete > 0 ? { unitario: unitarioFlete(q), cantidad: cantidadFlete(q) } : null,
        avisos,
        pendientes: q
          ? preguntasPendientes(q).flatMap((p) => p.indices.map((i) => ({ item: i + 1, campo: p.campo })))
          : [],
      }),
      ms: Date.now() - inicio,
      avisos,
    };
  } catch (e) {
    return {
      // Con avisos y pendientes vacíos: el total del caso es el mismo que en una corrida que sí respondió.
      ...puntuar(caso, { items: [], cliente: clienteVacio(), flete: null, avisos: [], pendientes: [] }),
      aciertos: 0,
      ms: Date.now() - inicio,
      avisos,
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

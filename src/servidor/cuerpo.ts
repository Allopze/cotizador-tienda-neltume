// Los route handlers de Next no limitan el cuerpo: se lee con tope antes de parsear.
export const MAX_CUERPO_BYTES = 64 * 1024;

export type LecturaCuerpo = { ok: true; valor: unknown } | { ok: false; respuesta: Response };

const rechazo = (error: string, status: number): LecturaCuerpo => ({
  ok: false,
  respuesta: Response.json({ error }, { status }),
});

/** El cuerpo no llegó completo dentro del plazo de `leerBytes`: quien lo manda va muy lento o se quedó callado. */
export class ErrorLecturaVencida extends Error {
  constructor() {
    super('El cuerpo de la solicitud no llegó dentro del plazo.');
    this.name = 'ErrorLecturaVencida';
  }
}

/**
 * Lee el cuerpo entero como bytes, hasta `max`: si lo pasa corta la lectura y devuelve null. Con `plazoMs`, un cuerpo
 * que no termina de llegar a tiempo se corta y lanza `ErrorLecturaVencida`; sin plazo espera lo que tarde la conexión.
 * Una conexión que se corta a medias hace fallar la lectura (quien llama decide qué responder).
 */
export async function leerBytes(cuerpo: ReadableStream<Uint8Array>, max: number, plazoMs?: number): Promise<Buffer | null> {
  const lector = cuerpo.getReader();
  let vencido = false;
  const temporizador =
    plazoMs === undefined
      ? undefined
      : setTimeout(() => {
          vencido = true;
          lector.cancel().catch(() => {});
        }, plazoMs);
  try {
    const partes: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await lector.cancel();
        return null;
      }
      partes.push(value);
    }
    // Al cancelar por el plazo, la lectura en curso termina como si el cuerpo hubiera acabado: no es un cuerpo completo.
    if (vencido) throw new ErrorLecturaVencida();
    return Buffer.concat(partes);
  } finally {
    clearTimeout(temporizador);
  }
}

export async function leerJson(req: Request, max = MAX_CUERPO_BYTES): Promise<LecturaCuerpo> {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json'))
    return rechazo('La solicitud debe enviarse como JSON.', 415);
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (declarado > max) return rechazo('La solicitud es demasiado grande.', 413);
  if (!req.body) return rechazo('Solicitud inválida.', 400);
  const bytes = await leerBytes(req.body, max);
  if (!bytes) return rechazo('La solicitud es demasiado grande.', 413);
  try {
    return { ok: true, valor: JSON.parse(bytes.toString('utf8')) };
  } catch {
    return rechazo('Solicitud inválida.', 400);
  }
}

// Los route handlers de Next no limitan el cuerpo: se lee con tope antes de parsear.
export const MAX_CUERPO_BYTES = 64 * 1024;

export type LecturaCuerpo = { ok: true; valor: unknown } | { ok: false; respuesta: Response };

const rechazo = (error: string, status: number): LecturaCuerpo => ({
  ok: false,
  respuesta: Response.json({ error }, { status }),
});

export async function leerJson(req: Request, max = MAX_CUERPO_BYTES): Promise<LecturaCuerpo> {
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json'))
    return rechazo('La solicitud debe enviarse como JSON.', 415);
  const declarado = Number(req.headers.get('content-length') ?? '0');
  if (declarado > max) return rechazo('La solicitud es demasiado grande.', 413);
  if (!req.body) return rechazo('Solicitud inválida.', 400);
  const lector = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await lector.cancel();
      return rechazo('La solicitud es demasiado grande.', 413);
    }
    partes.push(value);
  }
  try {
    return { ok: true, valor: JSON.parse(Buffer.concat(partes).toString('utf8')) };
  } catch {
    return rechazo('Solicitud inválida.', 400);
  }
}

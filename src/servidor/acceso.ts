// Defensa contra DNS rebinding: un sitio externo puede apuntar su dominio a 127.0.0.1, y entonces
// Origin y Host coinciden entre sí. Por eso el Host se valida contra una lista explícita.
const LOCALES = ['127.0.0.1', 'localhost', '[::1]'];
function hostnamesPermitidos() {
  const extra = (process.env.NELTUME_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...LOCALES, ...extra]);
}
const hostname = (host: string) =>
  URL.canParse(`http://${host}`) ? new URL(`http://${host}`).hostname : null;
export function rechazoAcceso(req: Request, { escritura = false } = {}): Response | null {
  const host = req.headers.get('host');
  const nombre = host ? hostname(host.toLowerCase()) : null;
  if (!host || !nombre || !hostnamesPermitidos().has(nombre))
    return Response.json({ error: 'Host no permitido.' }, { status: 403 });
  const origen = req.headers.get('origin');
  if (
    escritura &&
    origen &&
    (!URL.canParse(origen) || new URL(origen).host.toLowerCase() !== host.toLowerCase())
  )
    return Response.json({ error: 'Origen no permitido.' }, { status: 403 });
  return null;
}

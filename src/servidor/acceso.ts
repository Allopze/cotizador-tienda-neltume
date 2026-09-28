// Defensa contra DNS rebinding: un sitio externo puede apuntar su dominio a 127.0.0.1, y entonces
// Origin y Host coinciden entre sí. Por eso el Host se valida contra una lista explícita.
export const HOSTNAMES_LOOPBACK: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface HostConfigurado {
  hostname: string;
  /** Origen HTTPS (o el esquema indicado) que Better Auth acepta como confiable. */
  origen: string;
}

/** Acepta "host", "host:puerto" o "https://host[:puerto]"; devuelve null si no es válido. */
export function interpretarHost(valor: string): HostConfigurado | null {
  const limpio = valor.trim().toLowerCase();
  if (!limpio) return null;
  const conEsquema = limpio.includes('://') ? limpio : `https://${limpio}`;
  if (!URL.canParse(conEsquema)) return null;
  const url = new URL(conEsquema);
  if (!url.hostname || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null;
  return { hostname: url.hostname, origen: url.origin };
}

/** Lista única de NELTUME_HOSTS, compartida por el filtro de Host y los orígenes de Better Auth. */
export function hostsConfigurados(valor = process.env.NELTUME_HOSTS ?? ''): HostConfigurado[] {
  return valor
    .split(',')
    .map(interpretarHost)
    .filter((h): h is HostConfigurado => h !== null);
}

function hostnamesPermitidos() {
  return new Set([...HOSTNAMES_LOOPBACK, ...hostsConfigurados().map((h) => h.hostname)]);
}

const hostname = (host: string) =>
  URL.canParse(`http://${host}`) ? new URL(`http://${host}`).hostname : null;

export function hostPermitido(host: string | null): boolean {
  const nombre = host ? hostname(host.toLowerCase()) : null;
  return !!nombre && hostnamesPermitidos().has(nombre);
}

export function rechazoAcceso(req: Request, { escritura = false } = {}): Response | null {
  const host = req.headers.get('host');
  if (!host || !hostPermitido(host)) return Response.json({ error: 'Host no permitido.' }, { status: 403 });
  const origen = req.headers.get('origin');
  if (
    escritura &&
    origen &&
    (!URL.canParse(origen) || new URL(origen).host.toLowerCase() !== host.toLowerCase())
  )
    return Response.json({ error: 'Origen no permitido.' }, { status: 403 });
  return null;
}

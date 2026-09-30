import { z } from 'zod';
import type { Familia } from '../catalogo/tipos';
import type { CotizacionEnvio, ProductoDespacho, ShippingProvider } from '../negocio/envios';
import {
  calcularBulto,
  netoDesdeIva,
  resolverDestino,
  type Bulto,
  type CiudadRef,
  type CiudadStarken,
  type ParametrosFamilia,
  type TarifaStarken,
} from '../negocio/starken';

// Cliente del servicio REST de tarifas de Starken y proveedor de despacho. Las credenciales salen solo del
// entorno del servidor: no se guardan en la base, no viajan al navegador ni aparecen en mensajes de error.

export type CodigoErrorStarken =
  'no_configurado' | 'timeout' | 'red' | 'http' | 'respuesta' | 'rechazado' | 'destino' | 'paquete';

/** Error de la integración con un mensaje apto para mostrar a quien cotiza (nunca con credenciales). */
export class ErrorStarken extends Error {
  constructor(
    mensaje: string,
    public codigo: CodigoErrorStarken,
  ) {
    super(mensaje);
    this.name = 'ErrorStarken';
  }
}

export const MENSAJE_NO_CONFIGURADO = 'Starken no está configurado';
export const TIMEOUT_STARKEN_MS = 10_000;
export const TTL_CIUDADES_MS = 24 * 60 * 60 * 1000;

export interface EntornoStarken {
  /** Base del servicio, sin la ruta del método: …/starkenservices/rest */
  url: string;
  rut: string;
  clave: string;
  /** Con cuenta corriente se envía esta y no el RUT del cliente. */
  cuentaCorriente: string | null;
  cuentaCorrienteDV: string | null;
  rutCliente: string | null;
}

/**
 * Configuración del entorno, o null si falta algo: URL, RUT y clave de la integración, y la cuenta corriente
 * (con su dígito verificador) o, sin ella, el RUT del cliente. Una URL inválida también cuenta como falta.
 */
export function leerEntornoStarken(
  env: Record<string, string | undefined> = process.env,
): EntornoStarken | null {
  const leer = (clave: string) => env[clave]?.trim() || null;
  const url = leer('STARKEN_URL')?.replace(/\/+$/, '') ?? null;
  const rut = leer('STARKEN_RUT');
  const clave = leer('STARKEN_CLAVE');
  const cuentaCorriente = leer('STARKEN_CUENTA_CORRIENTE');
  const cuentaCorrienteDV = leer('STARKEN_CUENTA_CORRIENTE_DV');
  const rutCliente = leer('STARKEN_RUT_CLIENTE');
  if (!url || !rut || !clave || !URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) return null;
  const conCuenta = !!cuentaCorriente && !!cuentaCorrienteDV;
  if (!conCuenta && !rutCliente) return null;
  return {
    url,
    rut,
    clave,
    cuentaCorriente: conCuenta ? cuentaCorriente : null,
    cuentaCorrienteDV: conCuenta ? cuentaCorrienteDV : null,
    rutCliente: conCuenta ? null : rutCliente,
  };
}

const ciudadSchema = z.object({
  codigoCiudad: z.number().int(),
  nombreCiudad: z.string(),
  listaComunas: z.array(z.object({ nombreComuna: z.string() })).nullish(),
});
const base = { codigoRespuesta: z.number(), mensajeRespuesta: z.string().nullish() };
const respuestaOrigen = z.object({ ...base, listaCiudadesOrigen: z.array(ciudadSchema).nullish() });
const respuestaDestino = z.object({ ...base, listaCiudadesDestino: z.array(ciudadSchema).nullish() });
const respuestaTarifas = z.object({
  ...base,
  listaTarifas: z
    .array(
      z.object({
        costoTotal: z.number(),
        diasEntrega: z.number(),
        tipoEntrega: z.object({ descripcionTipoEntrega: z.string() }),
        tipoServicio: z.object({ descripcionTipoServicio: z.string() }).nullish(),
      }),
    )
    .nullish(),
});

export type TipoListaCiudades = 'origen' | 'destino';
interface EntradaCache {
  vence: number;
  ciudades: CiudadStarken[];
}
/** Listas de ciudades ya descargadas (por servicio) y descargas en curso, para no repetirlas en paralelo. */
export interface CacheCiudades {
  listas: Map<string, EntradaCache>;
  pendientes: Map<string, Promise<CiudadStarken[]>>;
}
const global = globalThis as typeof globalThis & { __neltumeStarkenCache?: CacheCiudades };
/** Cache del proceso: en desarrollo Next compila cada ruta por separado, por eso vive en globalThis. */
const cacheDelProceso = (): CacheCiudades =>
  (global.__neltumeStarkenCache ??= { listas: new Map(), pendientes: new Map() });
export const nuevoCacheCiudades = (): CacheCiudades => ({ listas: new Map(), pendientes: new Map() });
export function limpiarCacheStarken() {
  const c = cacheDelProceso();
  c.listas.clear();
  c.pendientes.clear();
}

export interface OpcionesClienteStarken {
  /** Solo pruebas: la respuesta simulada de Starken. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  cache?: CacheCiudades;
  ahora?: () => number;
}

export interface ConsultaTarifas {
  origen: number;
  destino: number;
  bulto: Pick<Bulto, 'alto' | 'ancho' | 'largo' | 'kilos'>;
}

const texto = (valor: string | null | undefined, max = 300) =>
  (valor ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export class ClienteStarken {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly cache: CacheCiudades;
  private readonly ahora: () => number;

  constructor(
    private readonly entorno: EntornoStarken,
    opciones: OpcionesClienteStarken = {},
  ) {
    this.fetchFn = opciones.fetch ?? ((...args) => fetch(...args));
    this.timeoutMs = opciones.timeoutMs ?? TIMEOUT_STARKEN_MS;
    this.cache = opciones.cache ?? cacheDelProceso();
    this.ahora = opciones.ahora ?? Date.now;
  }

  /** Llama a un método del servicio y devuelve el JSON ya validado con `esquema`; el error es siempre un ErrorStarken. */
  private async llamar<T extends z.ZodType<{ codigoRespuesta: number; mensajeRespuesta?: string | null }>>(
    metodo: string,
    init: { method: 'GET' } | { method: 'POST'; cuerpo: unknown },
    esquema: T,
  ): Promise<z.infer<T>> {
    let respuesta: Response;
    let cuerpo: unknown;
    try {
      respuesta = await this.fetchFn(`${this.entorno.url}/${metodo}`, {
        method: init.method,
        headers: {
          Accept: 'application/json',
          rut: this.entorno.rut,
          clave: this.entorno.clave,
          ...(init.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init.method === 'POST' ? { body: JSON.stringify(init.cuerpo) } : {}),
        cache: 'no-store',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const crudo = await respuesta.text();
      try {
        cuerpo = crudo ? JSON.parse(crudo) : null;
      } catch {
        cuerpo = null;
      }
    } catch (e) {
      const nombre = e instanceof Error ? e.name : '';
      if (nombre === 'TimeoutError' || nombre === 'AbortError')
        throw new ErrorStarken('Starken no respondió a tiempo. Reintenta en un momento.', 'timeout');
      throw new ErrorStarken('No se pudo conectar con Starken. Reintenta en un momento.', 'red');
    }
    if (!respuesta.ok) {
      const mensaje = (cuerpo as { mensajeRespuesta?: unknown } | null)?.mensajeRespuesta;
      throw new ErrorStarken(
        `Starken respondió con un error (HTTP ${respuesta.status})${typeof mensaje === 'string' && texto(mensaje) ? `: ${texto(mensaje).replace(/[.\s]+$/, '')}` : ''}.`,
        'http',
      );
    }
    const valido = esquema.safeParse(cuerpo);
    if (!valido.success)
      throw new ErrorStarken('Starken devolvió una respuesta que no se pudo interpretar.', 'respuesta');
    if (valido.data.codigoRespuesta !== 1) {
      const mensaje = texto(valido.data.mensajeRespuesta);
      throw new ErrorStarken(mensaje ? `Starken: ${mensaje}` : 'Starken rechazó la consulta.', 'rechazado');
    }
    return valido.data;
  }

  private async descargarCiudades(tipo: TipoListaCiudades): Promise<CiudadStarken[]> {
    const lista =
      tipo === 'origen'
        ? (await this.llamar('listarCiudadesOrigen', { method: 'GET' }, respuestaOrigen)).listaCiudadesOrigen
        : (await this.llamar('listarCiudadesDestino', { method: 'GET' }, respuestaDestino))
            .listaCiudadesDestino;
    return (lista ?? []).map((c) => ({
      codigoCiudad: c.codigoCiudad,
      nombre: texto(c.nombreCiudad, 120),
      comunas: (c.listaComunas ?? []).map((m) => texto(m.nombreComuna, 120)).filter(Boolean),
    }));
  }

  /** Ciudades de origen o destino; se descargan una vez cada 24 horas. Si la descarga falla, sirve la anterior. */
  async listarCiudades(tipo: TipoListaCiudades): Promise<CiudadStarken[]> {
    const clave = `${this.entorno.url}|${tipo}`;
    const { listas, pendientes } = this.cache;
    const guardada = listas.get(clave);
    if (guardada && guardada.vence > this.ahora()) return guardada.ciudades;
    let descarga = pendientes.get(clave);
    if (!descarga) {
      descarga = this.descargarCiudades(tipo)
        .then((ciudades) => {
          if (!ciudades.length) throw new ErrorStarken('Starken no informó ciudades.', 'respuesta');
          listas.set(clave, { vence: this.ahora() + TTL_CIUDADES_MS, ciudades });
          return ciudades;
        })
        .finally(() => pendientes.delete(clave));
      pendientes.set(clave, descarga);
    }
    try {
      return await descarga;
    } catch (e) {
      if (guardada) return guardada.ciudades;
      throw e;
    }
  }

  /** Tarifas del envío, de menor a mayor costo. Las dimensiones son totales del bulto equivalente (cm y kg). */
  async consultarTarifas({ origen, destino, bulto }: ConsultaTarifas): Promise<TarifaStarken[]> {
    const { cuentaCorriente, cuentaCorrienteDV, rutCliente } = this.entorno;
    const r = await this.llamar(
      'consultarTarifas',
      {
        method: 'POST',
        cuerpo: {
          codigoCiudadOrigen: origen,
          codigoCiudadDestino: destino,
          codigoAgenciaOrigen: 0,
          codigoAgenciaDestino: 0,
          alto: bulto.alto,
          ancho: bulto.ancho,
          largo: bulto.largo,
          kilos: bulto.kilos,
          cuentaCorriente: cuentaCorriente ?? '',
          cuentaCorrienteDV: cuentaCorrienteDV ?? '',
          // Con cuenta corriente el RUT del cliente no se envía.
          ...(cuentaCorriente ? {} : { rutCliente: rutCliente ?? '' }),
        },
      },
      respuestaTarifas,
    );
    const tarifas = (r.listaTarifas ?? [])
      .filter((t) => Number.isFinite(t.costoTotal) && t.costoTotal > 0)
      .map((t) => ({
        tipoEntrega: texto(t.tipoEntrega.descripcionTipoEntrega, 40).toUpperCase(),
        servicio: texto(t.tipoServicio?.descripcionTipoServicio, 40).toUpperCase(),
        dias: Math.max(0, Math.round(t.diasEntrega)),
        costoTotal: Math.round(t.costoTotal),
        neto: netoDesdeIva(t.costoTotal),
      }));
    if (!tarifas.length) throw new ErrorStarken('Starken no informó tarifas para este envío.', 'rechazado');
    return tarifas.sort((a, b) => a.costoTotal - b.costoTotal || a.tipoEntrega.localeCompare(b.tipoEntrega));
  }
}

export interface ContextoEnvioStarken {
  cliente: ClienteStarken;
  origen: CiudadRef | null;
  paquete: Partial<Record<Familia, Partial<ParametrosFamilia>>>;
}

/** Destino de una consulta: la ciudad de Starken que corresponde a los textos de la cotización. */
export async function ciudadDeDestino(
  cliente: ClienteStarken,
  textos: readonly (string | null | undefined)[],
): Promise<CiudadStarken> {
  const r = resolverDestino(textos, await cliente.listarCiudades('destino'));
  if (r.estado === 'unica') return r.ciudad;
  throw new ErrorStarken(
    r.estado === 'ambigua'
      ? `El destino coincide con varias ciudades de Starken (${r.candidatas.map((c) => c.nombre).join(', ')}). Elige una.`
      : 'No se encontró el destino en las ciudades de Starken. Elige una.',
    'destino',
  );
}

/**
 * Proveedor de despacho con Starken. Devuelve la tarifa más baja y en neto (lo que se guarda como valor de
 * despacho); para ver las opciones de agencia y domicilio se usa `ClienteStarken.consultarTarifas`.
 */
export class ProveedorStarken implements ShippingProvider {
  readonly id = 'starken';
  readonly nombre = 'Starken';
  constructor(private readonly contexto: ContextoEnvioStarken) {}

  async calculateShipping(
    destination: string,
    products: readonly ProductoDespacho[],
  ): Promise<CotizacionEnvio | null> {
    const { cliente, origen, paquete } = this.contexto;
    if (!origen) throw new ErrorStarken('Configura la ciudad de origen de Starken en Ajustes.', 'paquete');
    const bulto = calcularBulto(products, paquete);
    if (!bulto.ok) throw new ErrorStarken(bulto.mensaje, 'paquete');
    const ciudad = await ciudadDeDestino(cliente, [destination]);
    const [tarifa] = await cliente.consultarTarifas({
      origen: origen.codigoCiudad,
      destino: ciudad.codigoCiudad,
      bulto: bulto.bulto,
    });
    return {
      transportista: this.nombre,
      valor: tarifa.neto,
      plazoEstimado: `${tarifa.dias} ${tarifa.dias === 1 ? 'día' : 'días'}`,
      referenciaExterna: `${tarifa.tipoEntrega} · ciudad ${ciudad.codigoCiudad}`,
    };
  }
}

import { z } from 'zod';
import type { Familia } from '../catalogo/tipos';
import type { CotizacionEnvio, ProductoDespacho, ShippingProvider } from '../negocio/envios';
import {
  calcularBulto,
  netoDesdeIva,
  resolverDestino,
  textoBulto,
  type Bulto,
  type CiudadRef,
  type CiudadStarken,
  type ParametrosFamilia,
  type ResultadoEnvioStarken,
  type TarifaStarken,
} from '../negocio/starken';
import { HOSTNAMES_LOOPBACK } from './acceso';

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
const TIMEOUT_STARKEN_MS = 10_000;
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

/** https, salvo http hacia esta misma máquina (desarrollo y pruebas): las credenciales no viajan en claro. */
function urlSegura(url: string) {
  if (!URL.canParse(url)) return false;
  const { protocol, hostname } = new URL(url);
  return protocol === 'https:' || (protocol === 'http:' && HOSTNAMES_LOOPBACK.has(hostname));
}

/**
 * Configuración del entorno, o null si falta algo: URL https, RUT y clave de la integración, y la cuenta
 * corriente (con su dígito verificador) o, sin ella, el RUT del cliente. Una URL inválida o http cuenta como falta.
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
  if (!url || !rut || !clave || !urlSegura(url)) return null;
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
const tarifaSchema = z.object({
  costoTotal: z.number(),
  diasEntrega: z.number(),
  tipoEntrega: z.object({ descripcionTipoEntrega: z.string() }),
  tipoServicio: z.object({ descripcionTipoServicio: z.string() }).nullish(),
});
const base = { codigoRespuesta: z.number(), mensajeRespuesta: z.string().nullish() };
// Las filas se validan una a una: una fila mal formada se descarta sin perder las demás.
const respuestaOrigen = z.object({ ...base, listaCiudadesOrigen: z.array(z.unknown()).nullish() });
const respuestaDestino = z.object({ ...base, listaCiudadesDestino: z.array(z.unknown()).nullish() });
const respuestaTarifas = z.object({ ...base, listaTarifas: z.array(z.unknown()).nullish() });
const filasValidas = <T extends z.ZodType>(esquema: T, filas: unknown[] | null | undefined) =>
  (filas ?? []).flatMap((fila) => {
    const r = esquema.safeParse(fila);
    return r.success ? [r.data as z.infer<T>] : [];
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
        // Una redirección no se sigue: reenviaría las credenciales (cabeceras rut y clave) a otro destino.
        redirect: 'error',
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
    const filas =
      tipo === 'origen'
        ? (await this.llamar('listarCiudadesOrigen', { method: 'GET' }, respuestaOrigen)).listaCiudadesOrigen
        : (await this.llamar('listarCiudadesDestino', { method: 'GET' }, respuestaDestino))
            .listaCiudadesDestino;
    return filasValidas(ciudadSchema, filas).map((c) => ({
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
    const tarifas = filasValidas(tarifaSchema, r.listaTarifas)
      .filter((t) => Number.isFinite(t.costoTotal) && Math.round(t.costoTotal) > 0)
      .map((t) => ({
        tipoEntrega: texto(t.tipoEntrega.descripcionTipoEntrega, 40).toUpperCase(),
        servicio: texto(t.tipoServicio?.descripcionTipoServicio, 40).toUpperCase(),
        dias: Math.max(0, Math.round(t.diasEntrega)),
        costoTotal: Math.round(t.costoTotal),
        // Del valor ya redondeado: es el que el servicio vuelve a convertir al aplicar la tarifa.
        neto: netoDesdeIva(Math.round(t.costoTotal)),
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

/** Destino de una consulta: ciudad elegida a mano o textos de la cotización (del más al menos específico). */
export interface DestinoEnvio {
  codigoCiudad?: number;
  textos?: readonly (string | null | undefined)[];
}

/**
 * Proveedor de despacho con Starken. `cotizar` arma el bulto, fija el destino y consulta las tarifas de agencia y
 * domicilio; `calculateShipping` (la interfaz ShippingProvider) devuelve la más baja, en neto.
 */
export class ProveedorStarken implements ShippingProvider {
  readonly id = 'starken';
  readonly nombre = 'Starken';
  constructor(private readonly contexto: ContextoEnvioStarken) {}

  async cotizar(
    products: readonly ProductoDespacho[],
    destino: DestinoEnvio,
  ): Promise<ResultadoEnvioStarken<TarifaStarken>> {
    const { cliente, origen, paquete } = this.contexto;
    if (!origen) throw new ErrorStarken('Configura la ciudad de origen de Starken en Ajustes.', 'paquete');
    const bulto = calcularBulto(products, paquete);
    if (!bulto.ok) throw new ErrorStarken(bulto.mensaje, 'paquete');
    const ciudades = await cliente.listarCiudades('destino');
    let ciudad: CiudadStarken;
    let descartado: string | undefined;
    if (destino.codigoCiudad !== undefined) {
      const elegida = ciudades.find((c) => c.codigoCiudad === destino.codigoCiudad);
      if (!elegida)
        throw new ErrorStarken('La ciudad elegida no está entre las ciudades de Starken.', 'destino');
      ciudad = elegida;
    } else {
      const r = resolverDestino(destino.textos ?? [], ciudades);
      if (r.estado !== 'unica')
        return {
          estado: 'elegir_ciudad',
          motivo: r.estado,
          candidatas: r.estado === 'ambigua' ? r.candidatas : [],
        };
      ciudad = r.ciudad;
      descartado = r.descartado;
    }
    const tarifas = await cliente.consultarTarifas({
      origen: origen.codigoCiudad,
      destino: ciudad.codigoCiudad,
      bulto: bulto.bulto,
    });
    return {
      estado: 'tarifas',
      bulto: bulto.bulto,
      textoBulto: textoBulto(bulto.bulto),
      destino: { codigoCiudad: ciudad.codigoCiudad, nombre: ciudad.nombre },
      ...(descartado ? { destinoDescartado: descartado } : {}),
      tarifas,
    };
  }

  async calculateShipping(
    destination: string,
    products: readonly ProductoDespacho[],
  ): Promise<CotizacionEnvio | null> {
    const r = await this.cotizar(products, { textos: [destination] });
    if (r.estado === 'elegir_ciudad')
      throw new ErrorStarken(
        r.motivo === 'ambigua'
          ? `El destino coincide con varias ciudades de Starken (${r.candidatas.map((c) => c.nombre).join(', ')}). Elige una.`
          : 'No se encontró el destino en las ciudades de Starken. Elige una.',
        'destino',
      );
    const [tarifa] = r.tarifas;
    return {
      transportista: this.nombre,
      valor: tarifa.neto,
      plazoEstimado: `${tarifa.dias} ${tarifa.dias === 1 ? 'día' : 'días'}`,
      referenciaExterna: `${tarifa.tipoEntrega} · ciudad ${r.destino.codigoCiudad}`,
    };
  }
}

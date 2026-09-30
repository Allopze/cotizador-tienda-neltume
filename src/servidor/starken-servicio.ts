import type Database from 'better-sqlite3';
import type { Cotizacion } from '../negocio/estado';
import {
  calcularBulto,
  resolverDestino,
  textoBulto,
  type CiudadStarken,
  type EstadoStarken,
  type ResultadoEnvioStarken,
} from '../negocio/starken';
import { ErrorUsuario } from './errores';
import { ClienteStarken, ErrorStarken, leerEntornoStarken, MENSAJE_NO_CONFIGURADO } from './starken';
import { leerConfiguracionStarken, type ConfiguracionStarken } from './starken-configuracion';

/** Solo pruebas: Starken simulado (ver starken-fijo.ts). Nunca se elige desde la petición del navegador. */
export const modoStarkenFijo = () =>
  process.env.NELTUME_STARKEN === 'fijo' && process.env.NELTUME_TEST_MODE === '1';

/** Cliente de Starken con las credenciales del entorno; null si el entorno no está completo. */
export async function crearClienteStarken(): Promise<ClienteStarken | null> {
  if (modoStarkenFijo()) {
    const { ENTORNO_FIJO, fetchFijo } = await import('./starken-fijo');
    return new ClienteStarken(ENTORNO_FIJO, { fetch: fetchFijo });
  }
  const entorno = leerEntornoStarken();
  return entorno ? new ClienteStarken(entorno) : null;
}

export function estadoStarken(db?: Database.Database): EstadoStarken {
  const disponible = modoStarkenFijo() || leerEntornoStarken() !== null;
  return {
    disponible,
    mensaje: disponible ? null : MENSAJE_NO_CONFIGURADO,
    configuracion: leerConfiguracionStarken(db),
  };
}

/**
 * Tarifas de Starken para el bulto de una cotización. El bulto se calcula aquí con las líneas guardadas (el
 * navegador no envía medidas ni pesos). `codigoCiudad` es la ciudad elegida a mano; sin ella el destino sale del
 * despacho de la cotización y, si no, de la comuna del cliente.
 */
export async function cotizarEnvioStarken(
  cotizacion: Cotizacion,
  codigoCiudad: number | undefined,
  configuracion: ConfiguracionStarken,
  cliente: ClienteStarken | null,
): Promise<ResultadoEnvioStarken> {
  if (!cliente) throw new ErrorStarken(MENSAJE_NO_CONFIGURADO, 'no_configurado');
  if (!configuracion.origen)
    throw new ErrorStarken('Configura la ciudad de origen de Starken en Ajustes.', 'paquete');
  if (cotizacion.incompletos.length)
    throw new ErrorUsuario('Completa o quita los ítems pendientes antes de cotizar el despacho.');
  const resultado = calcularBulto(cotizacion.montos.lineas, configuracion.paquete);
  if (!resultado.ok) throw new ErrorStarken(resultado.mensaje, 'paquete');
  const destinos = await cliente.listarCiudades('destino');
  let ciudad: CiudadStarken;
  if (codigoCiudad !== undefined) {
    const elegida = destinos.find((c) => c.codigoCiudad === codigoCiudad);
    if (!elegida)
      throw new ErrorStarken('La ciudad elegida no está entre las ciudades de Starken.', 'destino');
    ciudad = elegida;
  } else {
    const r = resolverDestino([cotizacion.despacho?.destino, cotizacion.cliente.comuna], destinos);
    if (r.estado !== 'unica')
      return {
        estado: 'elegir_ciudad',
        motivo: r.estado,
        candidatas: r.estado === 'ambigua' ? r.candidatas : [],
      };
    ciudad = r.ciudad;
  }
  const tarifas = await cliente.consultarTarifas({
    origen: configuracion.origen.codigoCiudad,
    destino: ciudad.codigoCiudad,
    bulto: resultado.bulto,
  });
  return {
    estado: 'tarifas',
    bulto: resultado.bulto,
    textoBulto: textoBulto(resultado.bulto),
    destino: { codigoCiudad: ciudad.codigoCiudad, nombre: ciudad.nombre },
    tarifas,
  };
}

/**
 * Deja constancia de las fallas del servicio (sin conexión, tiempo agotado, respuestas inválidas) en una línea,
 * sin credenciales ni rastro de pila. Los rechazos normales (sin cobertura, sin pesos, destino por elegir) no son fallas.
 */
export function registrarFallaStarken(origen: string, e: ErrorStarken) {
  if (['timeout', 'red', 'http', 'respuesta'].includes(e.codigo))
    console.error(`[${origen}] Starken (${e.codigo}): ${e.message}`);
}

/** Respuesta HTTP de un error de la integración: mensaje seguro y código estable, sin credenciales. */
export function respuestaErrorStarken(e: ErrorStarken) {
  const cabeceras = { 'Cache-Control': 'no-store' };
  // 502 y 504 los reemplaza la interfaz por mensajes genéricos del asistente: los fallos de Starken van en 503.
  const [status, codigo] =
    e.codigo === 'no_configurado'
      ? [503, 'starken_no_configurado']
      : e.codigo === 'paquete'
        ? [400, 'starken_sin_parametros']
        : e.codigo === 'rechazado' || e.codigo === 'destino'
          ? [422, 'starken_rechazado']
          : [503, 'starken_no_disponible'];
  return Response.json({ error: e.message, codigo }, { status, headers: cabeceras });
}

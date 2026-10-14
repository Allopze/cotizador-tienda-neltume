import type Database from 'better-sqlite3';
import type { CatalogoConsultable } from '../catalogo/resolver';
import type { Cotizacion } from '../negocio/estado';
import { descripcionLinea } from '../negocio/precios';
import type { EstadoStarken, LineaPedido, ResultadoEnvioStarken } from '../negocio/starken';
import { ErrorUsuario } from './errores';
import { itemsVigentes, type ItemVigente } from './items-vigentes';
import {
  ClienteStarken,
  ErrorStarken,
  leerEntornoStarken,
  MENSAJE_NO_CONFIGURADO,
  ProveedorStarken,
} from './starken';
import {
  guardarConfiguracionStarken,
  leerConfiguracionStarken,
  type ConfiguracionStarken,
} from './starken-configuracion';
import { firmarTarifa, huellaBulto } from './starken-firma';

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

const aLinea = ({
  producto,
  cantidad,
  anchoSolicitado,
  altoSolicitado,
  medidaSolicitada,
}: ItemVigente): LineaPedido => ({
  producto,
  cantidad,
  anchoSolicitado,
  altoSolicitado,
  medidaSolicitada,
});
/**
 * Líneas del pedido con el catálogo vigente, con la misma regla que `editar` al aplicar la tarifa (`itemsVigentes`,
 * que usa Servicio.recalcular): así el bulto y la huella que se firman son los que se comprueban al aplicarla, aunque
 * el catálogo haya cambiado desde el último guardado. Un ítem que quedaría pendiente no tiene línea.
 */
export const lineasVigentes = (q: Cotizacion, catalogo: CatalogoConsultable): LineaPedido[] =>
  itemsVigentes(catalogo, q).validos.map(aLinea);

export const MENSAJE_CATALOGO_CAMBIO =
  'El catálogo cambió desde que guardaste esta cotización: revisa el pedido antes de cotizar el despacho.';

/** Ítem que la cotización guardada valoriza, pero que el catálogo vigente deja pendiente. */
export interface ItemCatalogoCambio {
  /** Número del ítem en el pedido (desde 1). */
  numero: number;
  descripcion: string;
  /** Qué le falta con el catálogo vigente (la misma pregunta que mostraría el pedido al guardarlo). */
  motivo: string;
}

/**
 * La cotización guardada no tiene pendientes, pero con el catálogo vigente alguno de sus ítems queda sin valorizar.
 * La pantalla solo ve los pendientes guardados: sin este error específico, pediría completar ítems que no muestra.
 */
export class ErrorCatalogoCambio extends Error {
  readonly codigo = 'catalogo_cambio';
  constructor(public items: ItemCatalogoCambio[]) {
    super(MENSAJE_CATALOGO_CAMBIO);
    this.name = 'ErrorCatalogoCambio';
  }
}

/** Respuesta HTTP del error: 409 (la cotización guardada quedó atrás del catálogo) con los ítems afectados. */
export const respuestaCatalogoCambio = (e: ErrorCatalogoCambio) =>
  Response.json(
    { error: e.message, codigo: e.codigo, detalle: { items: e.items } },
    { status: 409, headers: { 'Cache-Control': 'no-store' } },
  );

/**
 * Tarifas de Starken para el bulto de una cotización. El bulto se calcula aquí con las líneas recalculadas con el
 * catálogo vigente, las mismas que comprueba `editar` (el navegador no envía medidas ni pesos). `codigoCiudad` es la
 * ciudad elegida a mano; sin ella el destino sale del despacho de la cotización y, si no, de la comuna del cliente.
 * Cada tarifa sale firmada para esa cotización, ese pedido y ese destino: sin la firma, `editar` no la aplica.
 */
export async function cotizarEnvioStarken(
  cotizacion: Cotizacion,
  catalogo: CatalogoConsultable,
  codigoCiudad: number | undefined,
  configuracion: ConfiguracionStarken,
  cliente: ClienteStarken | null,
  ahora = Date.now(),
): Promise<ResultadoEnvioStarken> {
  if (!cliente) throw new ErrorStarken(MENSAJE_NO_CONFIGURADO, 'no_configurado');
  if (cotizacion.incompletos.length)
    throw new ErrorUsuario('Completa o quita los ítems pendientes antes de cotizar el despacho.');
  const vigentes = itemsVigentes(catalogo, cotizacion);
  // También cuenta un ítem que el catálogo vigente deja pendiente (como al emitir): el bulto quedaría incompleto.
  // La cotización guardada no lo muestra como pendiente: se dice que cambió el catálogo y qué ítems tocó.
  if (vigentes.incompletos.length || vigentes.validos.length < cotizacion.solicitudes.length)
    throw new ErrorCatalogoCambio(
      vigentes.incompletos.map(({ indice, pregunta }) => {
        const linea = cotizacion.montos.lineas.find((l) => l.indice === indice);
        const solicitud = cotizacion.solicitudes[indice];
        return {
          numero: indice + 1,
          descripcion:
            (linea && descripcionLinea(linea)) ||
            solicitud?.descripcion ||
            solicitud?.modelo ||
            'Producto por definir',
          motivo: pregunta,
        };
      }),
    );
  const lineas = vigentes.validos.map(aLinea);
  const proveedor = new ProveedorStarken({
    cliente,
    origen: configuracion.origen,
    paquete: configuracion.paquete,
  });
  const r = await proveedor.cotizar(lineas, {
    codigoCiudad,
    textos: [cotizacion.despacho?.destino, cotizacion.cliente.comuna],
  });
  if (r.estado !== 'tarifas') return r;
  const huella = huellaBulto(lineas);
  return {
    ...r,
    tarifas: r.tarifas.map((t) => ({
      ...t,
      huellaBulto: huella,
      ...firmarTarifa(
        cotizacion.id,
        {
          huellaBulto: huella,
          tipoEntrega: t.tipoEntrega,
          ...(t.servicio ? { servicio: t.servicio } : {}),
          dias: t.dias,
          costoTotal: t.costoTotal,
          ciudadDestino: r.destino.nombre,
          codigoCiudadDestino: r.destino.codigoCiudad,
        },
        ahora,
      ),
    })),
  };
}

/**
 * Guarda los ajustes de Starken. La ciudad de origen nunca es el texto que mandó el navegador: si cambió, se busca
 * por código en la lista de Starken y se guarda su nombre; si es la ya guardada, se conserva la entrada guardada.
 */
export async function guardarAjustesStarken(
  solicitud: ConfiguracionStarken,
  db: Database.Database,
  cliente: ClienteStarken | null,
) {
  const guardada = leerConfiguracionStarken(db).origen;
  let origen = solicitud.origen;
  if (origen && guardada?.codigoCiudad === origen.codigoCiudad) origen = guardada;
  else if (origen) {
    if (!cliente) throw new ErrorStarken(MENSAJE_NO_CONFIGURADO, 'no_configurado');
    const codigo = origen.codigoCiudad;
    const ciudad = (await cliente.listarCiudades('origen')).find((c) => c.codigoCiudad === codigo);
    if (!ciudad) throw new ErrorUsuario('La ciudad de origen no está entre las ciudades de Starken.');
    origen = { codigoCiudad: ciudad.codigoCiudad, nombre: ciudad.nombre };
  }
  return guardarConfiguracionStarken({ ...solicitud, origen }, db);
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

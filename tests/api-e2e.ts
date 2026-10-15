import { expect, type APIRequestContext } from '@playwright/test';
import { digitoVerificador } from '../src/negocio/cliente';

// Atajos de la E2E para preparar cotizaciones por la API, como las habría dejado otra vendedora, sin recorrer la
// interfaz: las pruebas de pantalla parten del estado que necesitan y revisan solo lo que miden.

export interface CotizacionApi {
  id: string;
  actualizada: string;
  numero: number | null;
  estado: string;
  estadoOperativo?: string | null;
  [clave: string]: unknown;
}

export const rut = (cuerpo: string) =>
  `${cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${digitoVerificador(cuerpo)}`;

/** POST /api/accion; falla la prueba con el mensaje del servidor si no responde 2xx. */
export async function accion(request: APIRequestContext, data: Record<string, unknown>): Promise<CotizacionApi> {
  const r = await request.post('/api/accion', { data });
  expect(r.ok(), `${String(data.tipo)}: ${r.status()} ${r.ok() ? '' : await r.text()}`).toBe(true);
  return ((await r.json()) as { cotizacion: CotizacionApi }).cotizacion;
}

export async function leer(request: APIRequestContext, id: string): Promise<CotizacionApi> {
  const r = await request.get(`/api/accion?id=${encodeURIComponent(id)}`);
  expect(r.ok()).toBe(true);
  return ((await r.json()) as { cotizacion: CotizacionApi }).cotizacion;
}

interface OpcionesBorrador {
  cliente?: string;
  comuna?: string;
  proyecto?: string;
  cantidad?: number;
  rutCuerpo?: string;
}

/** Borrador con una Huilo Huilo de 0,80 × 2,10 (hoja) y un cliente completo. */
export async function crearBorrador(request: APIRequestContext, o: OpcionesBorrador = {}) {
  const creada = await accion(request, {
    tipo: 'agregar_producto',
    codigo: 'HUIL-O-3-B',
    cantidad: o.cantidad ?? 1,
    ancho: 0.8,
    alto: 2.1,
    tipoMedida: 'hoja',
  });
  return accion(request, {
    tipo: 'editar',
    id: creada.id,
    actualizada: creada.actualizada,
    cliente: {
      nombre: o.cliente ?? 'Cliente de prueba',
      rut: rut(o.rutCuerpo ?? '76543210'),
      giro: 'Construcción',
      telefono: '+56 9 1234 5678',
      direccion: 'Los Robles 123',
      comuna: o.comuna ?? 'Temuco',
      proyecto: o.proyecto ?? 'Casa de prueba',
    },
  });
}

/** Borrador emitido (con su PDF y su número) y, si se pide, aprobado. */
export async function crearEmitida(request: APIRequestContext, o: OpcionesBorrador & { aprobar?: boolean } = {}) {
  const borrador = await crearBorrador(request, o);
  const emitida = await accion(request, { tipo: 'emitir', id: borrador.id, actualizada: borrador.actualizada });
  if (!o.aprobar) return emitida;
  return accion(request, { tipo: 'aprobar', id: emitida.id, actualizada: emitida.actualizada });
}

/** Total con IVA de la cotización, como lo muestra el listado. */
export async function totalDe(request: APIRequestContext, id: string) {
  const r = await request.get('/api/accion?porPagina=50');
  const { cotizaciones } = (await r.json()) as { cotizaciones: { id: string; total: number }[] };
  const fila = cotizaciones.find((q) => q.id === id);
  expect(fila, 'la cotización figura en el listado').toBeDefined();
  return fila!.total;
}

/**
 * Lleva una cotización aprobada hasta «Completada»: paga el total, genera la nota, recorre la producción, fija el
 * transportista y la despacha.
 */
export async function completarOperacion(request: APIRequestContext, aprobada: CotizacionApi) {
  let q = aprobada;
  const total = await totalDe(request, q.id);
  q = await accion(request, { tipo: 'pago', id: q.id, actualizada: q.actualizada, monto: total });
  q = await accion(request, { tipo: 'generar_nota', id: q.id, actualizada: q.actualizada });
  for (const paso of ['iniciar_produccion', 'produccion_terminada', 'lista_despacho'])
    q = await accion(request, { tipo: 'operacion', id: q.id, actualizada: q.actualizada, paso });
  q = await accion(request, {
    tipo: 'operacion',
    id: q.id,
    actualizada: q.actualizada,
    paso: 'despachada',
    despacho: { transporte: 'Starken', destino: 'Temuco' },
  });
  return accion(request, { tipo: 'operacion', id: q.id, actualizada: q.actualizada, paso: 'completada' });
}

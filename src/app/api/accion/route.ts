import { ErrorIA } from '@/asistente/errores';
import { z } from 'zod';
import { Servicio, type DiagnosticoTurno } from '@/servidor/servicio';
import { Almacen, DIAS_PAPELERA, type FiltrosListado } from '@/servidor/almacen';
import { csvCotizaciones, MAX_EXPORTACION, partesExportacion } from '@/servidor/exportar';
import { fechaLocal } from '@/negocio/vigencia';
import { cargarCatalogo, ErrorCatalogo } from '@/servidor/catalogo';
import { exigirSesion } from '@/servidor/acceso-autenticado';
import { accionSchema } from '@/servidor/esquema-accion';
import { leerJson } from '@/servidor/cuerpo';
import type { LLM } from '@/asistente/llm';
import { asistenteConfigurado, crearLLM, llmFijoDePrueba } from '@/servidor/ajustes-ia';
import { ErrorMigracionRequerida } from '@/servidor/base-datos';
import { ErrorPdf, ErrorUsuario, registrarError } from '@/servidor/errores';
import { ErrorPrecio } from '@/negocio/precios';
import {
  ESTADOS,
  etiquetaComercial,
  etiquetaOperativo,
  type EstadoComercial,
  type EstadoCotizacion,
  type EstadoOperativo,
  type ResumenCotizacion,
} from '@/negocio/estado';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// El esquema de las acciones vive en src/servidor/esquema-accion.ts: la app de Android valida sus solicitudes
// contra su JSON Schema (tests/esquema-movil.test.ts).
const fecha = z.iso.date();
const listadoSchema = z.object({
  vencenPronto: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  saldoPendiente: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  porFacturar: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  q: z.string().max(200).optional(),
  estado: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(ESTADOS as [string, ...string[]])))
    .optional(),
  desde: fecha.optional(),
  hasta: fecha.optional(),
  comercial: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(Object.keys(etiquetaComercial) as [EstadoComercial, ...EstadoComercial[]])))
    .optional(),
  operativo: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(Object.keys(etiquetaOperativo) as [EstadoOperativo, ...EstadoOperativo[]])))
    .optional(),
  vendedora: z.string().trim().min(1).max(200).optional(),
  pagina: z.coerce.number().int().min(1).max(10000).optional(),
  porPagina: z.coerce.number().int().min(1).max(200).optional(),
  formato: z.literal('csv').optional(),
  /** Parte del CSV (1, 2…) cuando el listado pasa de `MAX_EXPORTACION` filas. */
  parte: z.coerce.number().int().min(1).max(1000).optional(),
});
const papeleraSchema = z.object({
  papelera: z.literal('1'),
  q: z.string().max(200).optional(),
  pagina: z.coerce.number().int().min(1).max(10000).optional(),
  porPagina: z.coerce.number().int().min(1).max(200).optional(),
});
const sinCache = { 'Cache-Control': 'no-store' };

/** Acción reservada a una cuenta administradora: mismo cuerpo y cabeceras que los demás errores. */
const sinPermiso = () =>
  Response.json(
    { error: 'Esta acción requiere una cuenta administradora.', codigo: 'sin_permiso' },
    { status: 403, headers: sinCache },
  );

const NO_CONFIGURADO = 'El cotizador no está listo. Pide a quien administra el cotizador que lo revise.';

function responderError(e: unknown) {
  if (e instanceof ErrorMigracionRequerida || e instanceof ErrorCatalogo) {
    registrarError('api/accion', e);
    return Response.json(
      { error: NO_CONFIGURADO, codigo: 'no_configurado' },
      { status: 503, headers: sinCache },
    );
  }
  if (e instanceof ErrorIA) {
    if (e.tecnico) registrarError('api/accion', `${e.codigo}: ${e.tecnico}`);
    return Response.json({ error: e.message, codigo: e.codigo }, { status: e.status, headers: sinCache });
  }
  if (e instanceof ErrorPdf) registrarError('api/accion', e.tecnico);
  if (e instanceof ErrorUsuario)
    return Response.json(
      { error: e.message, codigo: e.codigo, ...(e.detalle ? { detalle: e.detalle } : {}) },
      { status: e.status, headers: sinCache },
    );
  if (e instanceof ErrorPrecio)
    return Response.json(
      { error: 'Los datos de la cotización no son válidos para calcular montos.', codigo: e.codigo },
      { status: 400, headers: sinCache },
    );
  registrarError('api/accion', e);
  return Response.json(
    { error: 'No se pudo completar la operación. El estado guardado se conserva.', codigo: 'error_interno' },
    { status: 500, headers: sinCache },
  );
}

export async function GET(req: Request) {
  const sesion = await exigirSesion(req);
  if (!sesion.ok) return sesion.respuesta;
  const url = new URL(req.url);
  try {
    const almacen = new Almacen();
    const id = url.searchParams.get('id');
    if (id !== null) {
      if (!z.uuid().safeParse(id).success)
        return Response.json({ error: 'Solicitud inválida.', codigo: 'solicitud_invalida' }, { status: 400 });
      const cotizacion = almacen.obtener(id);
      if (!cotizacion)
        return Response.json(
          { error: 'No se encontró la cotización.', codigo: 'no_encontrada' },
          { status: 404, headers: sinCache },
        );
      return Response.json(
        { cotizacion, eventos: almacen.eventos(cotizacion.id), asistenteConfigurado: asistenteConfigurado() },
        { headers: sinCache },
      );
    }
    // Papelera del historial: borradores eliminados que se pueden restaurar con `restaurar_borrador`. Paginada y
    // con búsqueda en el servidor, como el listado; dice en cuántos días se vacía.
    if (url.searchParams.has('papelera')) {
      const consulta = papeleraSchema.safeParse(Object.fromEntries(url.searchParams));
      if (!consulta.success)
        return Response.json({ error: 'Solicitud inválida.', codigo: 'solicitud_invalida' }, { status: 400, headers: sinCache });
      const { q, pagina, porPagina } = consulta.data;
      return Response.json(
        { ...almacen.listarPapelera({ q, pagina, porPagina }), plazoDias: DIAS_PAPELERA },
        { headers: sinCache },
      );
    }
    // Número manual al emitir: el diálogo muestra el último usado y el tope antes de enviar. Solo administración,
    // como el número manual mismo.
    if (url.searchParams.has('numeracion')) {
      if (url.searchParams.get('numeracion') !== '1')
        return Response.json({ error: 'Solicitud inválida.', codigo: 'solicitud_invalida' }, { status: 400, headers: sinCache });
      if (sesion.usuario.rol !== 'admin') return sinPermiso();
      return Response.json(almacen.numeracion(), { headers: sinCache });
    }
    // Quienes crearon cotizaciones, para el filtro «Vendedora» del historial.
    if (url.searchParams.has('vendedoras')) {
      if (url.searchParams.get('vendedoras') !== '1')
        return Response.json({ error: 'Solicitud inválida.', codigo: 'solicitud_invalida' }, { status: 400, headers: sinCache });
      return Response.json({ vendedoras: almacen.vendedoras() }, { headers: sinCache });
    }
    const filtros = listadoSchema.safeParse(Object.fromEntries(url.searchParams));
    if (!filtros.success)
      return Response.json({ error: 'Filtros inválidos.', codigo: 'solicitud_invalida' }, { status: 400 });
    const { estado, comercial, operativo, formato, parte, ...resto } = filtros.data;
    const estados = estado as EstadoCotizacion[] | undefined;
    const filtrosListado: FiltrosListado = { ...resto, estados, comerciales: comercial, operativos: operativo };
    if (formato === 'csv') return exportarCsv(almacen, filtrosListado, parte);
    const pagina = almacen.listar(filtrosListado);
    return Response.json({ ...pagina, asistenteConfigurado: asistenteConfigurado() }, { headers: sinCache });
  } catch (e) {
    return responderError(e);
  }
}

/**
 * Listado completo con los filtros vigentes, en CSV (separador «;» y BOM para Excel en español). Hasta
 * `MAX_EXPORTACION` filas por archivo: si el listado es más largo, sin `parte` responde 409 `exportacion_por_partes`
 * con el total y las partes (nunca corta en silencio), y con `parte` entrega ese tramo, en el orden del historial.
 */
function exportarCsv(almacen: Almacen, filtros: FiltrosListado, parte?: number) {
  const porParte = MAX_EXPORTACION;
  const { total } = almacen.listar({ ...filtros, pagina: 1, porPagina: 1 });
  const partes = partesExportacion(total, porParte);
  const detalle = { total, partes, porParte };
  if (parte === undefined && partes > 1)
    return Response.json(
      {
        error: `Hay ${total.toLocaleString('es-CL')} cotizaciones con estos filtros y un archivo admite ${porParte.toLocaleString('es-CL')}. Descárgalas en ${partes} partes o acota las fechas.`,
        codigo: 'exportacion_por_partes',
        detalle,
      },
      { status: 409, headers: sinCache },
    );
  const numeroParte = parte ?? 1;
  if (numeroParte > partes)
    return Response.json(
      { error: `El listado tiene ${partes === 1 ? 'una parte' : `${partes} partes`}.`, codigo: 'solicitud_invalida', detalle },
      { status: 400, headers: sinCache },
    );
  // Páginas que dividen exacto la parte: la parte N empieza en la fila (N − 1) × porParte.
  const porPagina = Math.min(200, porParte);
  const filas: ResumenCotizacion[] = [];
  for (let pagina = ((numeroParte - 1) * porParte) / porPagina + 1; filas.length < porParte; pagina++) {
    const p = almacen.listar({ ...filtros, pagina, porPagina });
    filas.push(...p.cotizaciones);
    if (p.cotizaciones.length < porPagina) break;
  }
  const hoy = fechaLocal(new Date());
  const sufijo = partes > 1 ? `-parte-${numeroParte}-de-${partes}` : '';
  return new Response(`\uFEFF${csvCotizaciones(filas.slice(0, porParte))}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cotizaciones-${hoy}${sufijo}.csv"`,
      'X-Total-Cotizaciones': String(total),
      ...sinCache,
    },
  });
}

export async function POST(req: Request) {
  const sesion = await exigirSesion(req, { escritura: true });
  if (!sesion.ok) return sesion.respuesta;
  const cuerpo = await leerJson(req);
  if (!cuerpo.ok) return cuerpo.respuesta;
  const parsed = accionSchema.safeParse(cuerpo.valor);
  if (!parsed.success)
    return Response.json({ error: 'Solicitud inválida.', codigo: 'solicitud_invalida' }, { status: 400 });
  // Elegir números a mano (al emitir o después, desde el documento) y regenerar PDF es de cuentas administradoras.
  if ((parsed.data.tipo === 'regenerar_pdf' || parsed.data.tipo === 'cambiar_numero' || (parsed.data.tipo === 'emitir' && parsed.data.numero !== undefined)) && sesion.usuario.rol !== 'admin')
    return sinPermiso();
  try {
    const catalogo = await cargarCatalogo();
    let llm: LLM;
    if (parsed.data.tipo !== 'chat') {
      llm = { interpretar: async () => { throw new Error('Esta acción no utiliza el asistente.'); } };
    } else if (llmFijoDePrueba()) {
      const { LLMFijo } = await import('@/asistente/fijo');
      llm = new LLMFijo();
    } else llm = crearLLM();
    const { nombre, email } = sesion.usuario;
    const admin = sesion.usuario.rol === 'admin';
    const inicio = Date.now();
    // Cada mensaje del chat deja en el registro del servidor solo conteos y tiempo, nunca el texto: sirve para
    // observar el asistente en uso (cuántos avisos y de qué tipo).
    const registrarTurno = (d: DiagnosticoTurno) => {
      const avisos: Record<string, number> = {};
      for (const a of d.avisos) avisos[a.categoria] = (avisos[a.categoria] ?? 0) + 1;
      const razonamiento = parsed.data.tipo === 'chat' ? (parsed.data.razonamiento ?? null) : null;
      console.info('[asistente]', JSON.stringify({ herramienta: d.herramienta, modelo: d.modelo, respaldo: d.respaldo, razonamiento, avisos, ms: Date.now() - inicio }));
    };
    return Response.json(
      { ...await new Servicio(catalogo, llm, new Almacen(), { nombre, email, admin }, registrarTurno).ejecutar(parsed.data),
        ...(parsed.data.tipo === 'chat' ? { diagnostico: { modelo: llm.modeloEfectivo ?? null, respaldo: llm.usoRespaldo ?? false, ms: Date.now() - inicio } } : {}) },
      {
        headers: sinCache,
      },
    );
  } catch (e) {
    return responderError(e);
  }
}

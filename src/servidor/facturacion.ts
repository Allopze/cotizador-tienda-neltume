import { normalizarRut } from '../negocio/cliente';
import {
  etiquetaFacturacion,
  facturacionPendiente,
  type Cotizacion,
  type Facturacion,
} from '../negocio/estado';
import {
  correoElectronicoValido,
  faltanDatosFactura,
  receptorTieneContenido,
  receptorVacio,
  type ReceptorFacturacion,
  type TipoDocumentoTributario,
} from '../negocio/facturacion';
import type { Accion, Resultado } from './acciones';
import type { Almacen, Unidad } from './almacen';
import { limpiarTexto, marca } from './edicion';
import { ErrorConflicto, ErrorUsuario } from './errores';

/** Contexto mínimo del servicio para ejecutar acciones de facturación dentro de su transacción. */
export interface ContextoFacturacion {
  almacen: Almacen;
  autor: string | null;
  obtener: (u: Unidad, id: string, mensaje?: string) => Cotizacion;
  exigirAprobada: (q: Cotizacion, sinAprobar?: string) => void;
  verificarVersion: (q: Cotizacion, actualizada: string | undefined) => void;
  fechaOperacion: (q: Cotizacion, u: Unidad, elegida: string | null | undefined, de: string) => string;
}

interface DatosFacturacionNormalizados {
  documento: TipoDocumentoTributario | null;
  receptor: ReceptorFacturacion | null;
}

const CAMPOS_ETIQUETA: [keyof ReceptorFacturacion, string][] = [
  ['razonSocial', 'Razón social'],
  ['rut', 'RUT'],
  ['giro', 'Giro'],
  ['direccion', 'Dirección'],
  ['comuna', 'Comuna'],
  ['correo', 'Correo'],
];

/** Limpia los campos del receptor (máx. 300) y valida el RUT y el correo cuando vienen informados. */
export function sanearReceptorFacturacion(
  entrada: Partial<ReceptorFacturacion> | null | undefined,
): ReceptorFacturacion | null {
  if (!entrada) return null;
  const limpio: ReceptorFacturacion = {
    razonSocial: limpiarTexto(entrada.razonSocial, 300),
    rut: limpiarTexto(entrada.rut, 300),
    giro: limpiarTexto(entrada.giro, 300),
    direccion: limpiarTexto(entrada.direccion, 300),
    comuna: limpiarTexto(entrada.comuna, 300),
    correo: limpiarTexto(entrada.correo, 300),
  };
  if (limpio.rut) {
    const normalizado = normalizarRut(limpio.rut);
    if (!normalizado) {
      throw new ErrorUsuario(`El RUT «${limpio.rut}» no es válido. Revísalo antes de guardar.`, 'rut_invalido');
    }
    limpio.rut = normalizado;
  }
  if (limpio.correo && !correoElectronicoValido(limpio.correo)) {
    throw new ErrorUsuario(`El correo «${limpio.correo}» no es válido. Revísalo o déjalo vacío.`);
  }
  return receptorTieneContenido(limpio) ? limpio : null;
}

export function normalizarDatosFacturacion(
  documento: TipoDocumentoTributario | null | undefined,
  receptor: Partial<ReceptorFacturacion> | null | undefined,
): DatosFacturacionNormalizados {
  const doc = documento ?? null;
  if (doc !== 'factura') return { documento: doc, receptor: null };
  return { documento: 'factura', receptor: sanearReceptorFacturacion(receptor) };
}

function normalizarActual(facturacion: Facturacion | undefined): DatosFacturacionNormalizados {
  const rec = facturacion?.receptor;
  if (!rec || !receptorTieneContenido(rec)) {
    return { documento: facturacion?.documento ?? null, receptor: null };
  }
  return {
    documento: facturacion?.documento ?? null,
    receptor: { ...receptorVacio(), ...rec },
  };
}

function mismosDatos(a: DatosFacturacionNormalizados, b: DatosFacturacionNormalizados): boolean {
  if (a.documento !== b.documento) return false;
  if (!a.receptor && !b.receptor) return true;
  if (!a.receptor || !b.receptor) return false;
  return CAMPOS_ETIQUETA.every(([k]) => (a.receptor![k] ?? null) === (b.receptor![k] ?? null));
}

function resumenDatos(d: DatosFacturacionNormalizados): string {
  if (!d.documento) return 'Sin definir';
  if (d.documento === 'boleta') return 'Boleta';
  if (d.receptor?.razonSocial && d.receptor?.rut) return `Factura · ${d.receptor.razonSocial} (${d.receptor.rut})`;
  if (d.receptor?.razonSocial) return `Factura · ${d.receptor.razonSocial}`;
  if (d.receptor?.rut) return `Factura · (${d.receptor.rut})`;
  return 'Factura (sin receptor)';
}

function detalleCambioFacturacion(antes: DatosFacturacionNormalizados, despues: DatosFacturacionNormalizados): string {
  const previo = resumenDatos(antes);
  const siguiente = resumenDatos(despues);
  if (previo !== siguiente) return `Datos de facturación: ${previo} → ${siguiente}`;
  const cambios: string[] = [];
  for (const [clave, etiqueta] of CAMPOS_ETIQUETA) {
    const a = antes.receptor?.[clave] ?? null;
    const d = despues.receptor?.[clave] ?? null;
    if (a !== d) cambios.push(`${etiqueta}: ${a ?? 'vacío'} → ${d ?? 'vacío'}`);
  }
  return `Datos de facturación: ${siguiente}${cambios.length ? ` · ${cambios.join(' · ')}` : ''}`;
}

/** Valida y aplica `aprobar.facturacion` sobre `q`; devuelve el detalle para registrar evento si hubo cambios. */
export function prepararFacturacionEnAprobacion(
  q: Cotizacion,
  facturacionAccion: { documento: TipoDocumentoTributario | null; receptor?: Partial<ReceptorFacturacion> | null } | undefined,
): string | null {
  if (facturacionAccion === undefined) return null;
  const actual = q.facturacion ?? facturacionPendiente();
  const antes = normalizarActual(actual);
  const despues = normalizarDatosFacturacion(facturacionAccion.documento, facturacionAccion.receptor);
  if (mismosDatos(antes, despues)) return null;
  q.facturacion = { ...actual, documento: despues.documento, receptor: despues.receptor };
  return detalleCambioFacturacion(antes, despues);
}

/** Guarda el documento elegido por el cliente y los datos del receptor mientras esté pendiente de facturar. */
export function ejecutarDatosFacturacion(
  ctx: ContextoFacturacion,
  accion: Extract<Accion, { tipo: 'datos_facturacion' }>,
): Promise<Resultado> {
  return ctx.almacen.transaccion((u): Resultado => {
    const q = ctx.obtener(u, accion.id);
    ctx.exigirAprobada(q);
    ctx.verificarVersion(q, accion.actualizada);
    const actual = q.facturacion ?? facturacionPendiente();
    if (actual.estado === 'facturada') {
      throw new ErrorConflicto(
        'La cotización ya está marcada como facturada. Para cambiar los datos de facturación, primero vuelve a pendiente.',
        'estado_invalido',
      );
    }
    const antes = normalizarActual(actual);
    const despues = normalizarDatosFacturacion(accion.documento, accion.receptor);
    if (mismosDatos(antes, despues)) return { cotizacion: q };
    q.facturacion = { ...actual, documento: despues.documento, receptor: despues.receptor };
    q.actualizada = marca(q.actualizada);
    u.guardar(q);
    u.registrarEvento(q.id, 'facturacion_actualizada', ctx.autor, detalleCambioFacturacion(antes, despues));
    return { cotizacion: q };
  });
}

/** Marca la cotización como facturada (exigiendo receptor completo para factura) o vuelve a pendiente. */
export function actualizarFacturacionCotizacion(
  ctx: ContextoFacturacion,
  accion: Extract<Accion, { tipo: 'facturacion' }>,
): Promise<Resultado> {
  return ctx.almacen.transaccion((u): Resultado => {
    const q = ctx.obtener(u, accion.id);
    ctx.exigirAprobada(q);
    ctx.verificarVersion(q, accion.actualizada);
    const actual = q.facturacion;
    const documento = actual?.documento ?? null;
    const receptor = actual?.receptor ?? null;
    let facturacion: Facturacion = {
      estado: 'pendiente',
      documento,
      receptor,
      tipo: null,
      identificadorExterno: null,
      fecha: null,
    };
    if (accion.estado === 'facturada') {
      if (accion.tipoDocumento !== 'factura' && accion.tipoDocumento !== 'boleta') {
        throw new ErrorUsuario('Indica si se emitió una factura o una boleta.');
      }
      const fecha = ctx.fechaOperacion(q, u, accion.fecha, 'de la factura');
      if (accion.tipoDocumento === 'factura') {
        const faltantes = faltanDatosFactura(receptor);
        if (faltantes.length) {
          throw new ErrorUsuario(`Faltan datos para facturar: ${faltantes.join(', ')}.`, 'datos_facturacion_incompletos');
        }
      }
      facturacion = {
        estado: 'facturada',
        documento,
        receptor,
        tipo: accion.tipoDocumento,
        identificadorExterno: limpiarTexto(accion.identificadorExterno, 120),
        fecha,
      };
    }
    if (actual && JSON.stringify(actual) === JSON.stringify(facturacion)) return { cotizacion: q };
    q.facturacion = facturacion;
    q.actualizada = marca(q.actualizada);
    u.guardar(q);
    u.registrarEvento(
      q.id,
      'facturada',
      ctx.autor,
      facturacion.estado === 'facturada'
        ? `${etiquetaFacturacion(facturacion)} · ${facturacion.fecha!.slice(0, 10)}`
        : 'Vuelve a pendiente de facturación',
    );
    return { cotizacion: q };
  });
}

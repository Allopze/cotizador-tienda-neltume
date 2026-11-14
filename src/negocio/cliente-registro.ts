import { normalizarRut, rutCompacto } from './cliente';
import {
  correoElectronicoValido,
  receptorTieneContenido,
  type ReceptorFacturacion,
  type TipoDocumentoTributario,
} from './facturacion';

export interface ClienteRegistrado {
  id: string;
  nombre: string;
  rut: string | null;
  giro: string | null;
  telefono: string | null;
  direccion: string | null;
  comuna: string | null;
  correo: string | null;
  notas: string | null;
  documentoHabitual: TipoDocumentoTributario | null;
  receptorFacturacion: ReceptorFacturacion | null;
  creado: string;
  actualizado: string;
  creadoPor: string | null;
  actualizadoPor: string | null;
}

export interface EntradaClienteRegistrado {
  nombre: string;
  rut?: string | null;
  giro?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  comuna?: string | null;
  correo?: string | null;
  notas?: string | null;
  documentoHabitual?: TipoDocumentoTributario | null;
  receptorFacturacion?: Partial<ReceptorFacturacion> | null;
}

export interface DatosClienteSaneados {
  nombre: string;
  rut: string | null;
  rutCompacto: string | null;
  giro: string | null;
  telefono: string | null;
  direccion: string | null;
  comuna: string | null;
  correo: string | null;
  notas: string | null;
  documentoHabitual: TipoDocumentoTributario | null;
  receptorFacturacion: ReceptorFacturacion | null;
}

export type ResultadoSaneoCliente =
  | { ok: true; datos: DatosClienteSaneados }
  | { ok: false; mensaje: string; codigo: 'solicitud_invalida' | 'rut_invalido' };

const MAX_CAMPO = 300;
const MAX_NOTAS = 1000;

function limpiar(valor: string | null | undefined, max = MAX_CAMPO): string | null {
  if (typeof valor !== 'string') return null;
  const texto = valor.replace(/\s+/g, ' ').trim().slice(0, max);
  return texto || null;
}

function limpiarNotas(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string') return null;
  const texto = valor.replace(/\r\n/g, '\n').trim().slice(0, MAX_NOTAS);
  return texto || null;
}

/**
 * Valida y sanea los datos de un cliente frecuente para el registro maestro.
 * Exige `nombre` no vacío, RUT válido módulo 11 si viene informado, y correos electrónicos válidos.
 */
export function sanearClienteRegistrado(entrada: EntradaClienteRegistrado): ResultadoSaneoCliente {
  const nombre = limpiar(entrada.nombre);
  if (!nombre) return { ok: false, mensaje: 'El nombre del cliente es obligatorio.', codigo: 'solicitud_invalida' };

  const rutBruto = limpiar(entrada.rut);
  let rut: string | null = null;
  let compacto: string | null = null;
  if (rutBruto) {
    rut = normalizarRut(rutBruto);
    if (!rut) {
      return { ok: false, mensaje: `El RUT «${rutBruto}» no es válido. Revísalo antes de guardar.`, codigo: 'rut_invalido' };
    }
    compacto = rutCompacto(rut) || null;
  }

  const correo = limpiar(entrada.correo);
  if (correo && !correoElectronicoValido(correo)) {
    return {
      ok: false,
      mensaje: `El correo «${correo}» no es válido. Revísalo o déjalo vacío.`,
      codigo: 'solicitud_invalida',
    };
  }

  const documentoHabitual: TipoDocumentoTributario | null = entrada.documentoHabitual ?? null;
  let receptorFacturacion: ReceptorFacturacion | null = null;

  if (documentoHabitual !== 'boleta' && entrada.receptorFacturacion) {
    const recRutBruto = limpiar(entrada.receptorFacturacion.rut);
    let recRut: string | null = null;
    if (recRutBruto) {
      recRut = normalizarRut(recRutBruto);
      if (!recRut) {
        return {
          ok: false,
          mensaje: `El RUT de facturación «${recRutBruto}» no es válido. Revísalo antes de guardar.`,
          codigo: 'rut_invalido',
        };
      }
    }
    const recCorreo = limpiar(entrada.receptorFacturacion.correo);
    if (recCorreo && !correoElectronicoValido(recCorreo)) {
      return {
        ok: false,
        mensaje: `El correo de facturación «${recCorreo}» no es válido. Revísalo o déjalo vacío.`,
        codigo: 'solicitud_invalida',
      };
    }
    const receptor: ReceptorFacturacion = {
      razonSocial: limpiar(entrada.receptorFacturacion.razonSocial),
      rut: recRut,
      giro: limpiar(entrada.receptorFacturacion.giro),
      direccion: limpiar(entrada.receptorFacturacion.direccion),
      comuna: limpiar(entrada.receptorFacturacion.comuna),
      correo: recCorreo,
    };
    if (receptorTieneContenido(receptor)) receptorFacturacion = receptor;
  }

  return {
    ok: true,
    datos: {
      nombre,
      rut,
      rutCompacto: compacto,
      giro: limpiar(entrada.giro),
      telefono: limpiar(entrada.telefono),
      direccion: limpiar(entrada.direccion),
      comuna: limpiar(entrada.comuna),
      correo,
      notas: limpiarNotas(entrada.notas),
      documentoHabitual,
      receptorFacturacion,
    },
  };
}

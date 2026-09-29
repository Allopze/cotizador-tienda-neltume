// Datos de Neltume que se imprimen en los documentos. Se configuran por entorno para no fijarlos en
// el código; sin configuración solo se imprime el correo de contacto histórico.
export interface DatosEmpresa {
  nombre: string | null;
  rut: string | null;
  direccion: string | null;
  telefono: string | null;
  correo: string;
  web: string | null;
  /** Condiciones comerciales impresas en la cotización; se omiten si no están configuradas. */
  condicionesPago: string | null;
  plazoEntrega: string | null;
  datosBancarios: string | null;
}

export const CORREO_PREDETERMINADO = 'Neltume.co@gmail.com';

const leer = (clave: string) => process.env[clave]?.trim() || null;

export function datosEmpresa(): DatosEmpresa {
  return {
    nombre: leer('NELTUME_EMPRESA_NOMBRE'),
    rut: leer('NELTUME_EMPRESA_RUT'),
    direccion: leer('NELTUME_EMPRESA_DIRECCION'),
    telefono: leer('NELTUME_EMPRESA_TELEFONO'),
    correo: leer('NELTUME_EMPRESA_CORREO') ?? CORREO_PREDETERMINADO,
    web: leer('NELTUME_EMPRESA_WEB'),
    condicionesPago: leer('NELTUME_CONDICIONES_PAGO'),
    plazoEntrega: leer('NELTUME_PLAZO_ENTREGA'),
    datosBancarios: leer('NELTUME_DATOS_BANCARIOS'),
  };
}

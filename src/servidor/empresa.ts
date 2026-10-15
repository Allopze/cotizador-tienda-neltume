// Datos de Neltume que se imprimen en los documentos. Se pueden definir por entorno o desde Ajustes;
// la configuración guardada en SQLite tiene prioridad cuando se genera un documento.
import type Database from 'better-sqlite3';
import {
  configuracionNegocioPredeterminada,
  leerConfiguracionNegocio,
} from './configuracion-negocio';

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
  /** SVG administrable usado en la cabecera del PDF y de la aplicación; null usa el logo publicado. */
  logoSvg: string | null;
}

export function datosEmpresa(db?: Database.Database): DatosEmpresa {
  return db ? leerConfiguracionNegocio(db).empresa : configuracionNegocioPredeterminada().empresa;
}

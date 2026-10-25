// Textos y formatos de Ajustes → Conexión con la fábrica, sin React: se prueban en tests/integracion-prueba.test.ts.
import { fechaHoraChile } from '@/negocio/vigencia';
import type { DetalleConfiguracion } from '@/servidor/integracion-configuracion';
import type { PruebaListada } from '@/servidor/integracion-prueba';
import type { ResultadoEnvioPrueba } from '@/servidor/integracion-prueba-envio';

export interface FabricaConexion {
  fabrica: string;
  nombre: string;
  configuracion: DetalleConfiguracion;
  pruebas: PruebaListada[];
}
export interface EstadoConexion {
  fabricas: FabricaConexion[];
}
export interface RespuestaPrueba {
  prueba: ResultadoEnvioPrueba;
  pruebas: PruebaListada[];
}

/** «25-10-2026 14:30» en la hora de Chile, igual que en la otra aplicación. */
export const fechaPrueba = fechaHoraChile;

/** Código corto de la prueba: el que lleva el PDF. Con él se cruza lo enviado con lo que ve la otra aplicación. */
export const codigoPrueba = (eventoId: string) => eventoId.slice(0, 8);

export const textoDireccion = (direccion: PruebaListada['direccion']) =>
  direccion === 'enviada' ? 'Enviada a la fábrica' : 'Recibida de la fábrica';

/** El resultado de una prueba como se lee en la lista; el de un fallo es el diagnóstico que se mostró al enviarla. */
export function textoResultadoPrueba(p: Pick<PruebaListada, 'resultado' | 'latenciaMs' | 'detalle'>) {
  switch (p.resultado) {
    case 'recibida':
      return 'Recibida';
    case 'aceptada':
      return `Aceptada${p.latenciaMs === null ? '' : ` en ${p.latenciaMs} ms`}`;
    case 'duplicada':
      return 'Duplicada: la otra app ya la tenía';
    case 'sin_respuesta':
      return p.detalle ?? 'Sin respuesta';
    default:
      return p.detalle ?? 'Rechazada';
  }
}

/** Qué hay de la configuración, sin mostrar nunca el secreto. */
export function textoConfiguracion(c: DetalleConfiguracion) {
  return {
    url: c.urlValida ? 'Configurada' : c.urlPresente ? 'No sirve: debe ser HTTPS' : 'Falta',
    secreto: c.secretoValido ? 'Configurado' : c.secretoPresente ? 'No sirve: debe tener al menos 32 caracteres' : 'Falta',
  };
}

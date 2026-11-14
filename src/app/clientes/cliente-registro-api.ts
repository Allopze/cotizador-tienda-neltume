import type { Cliente } from '@/catalogo/tipos';
import { rutCompacto } from '@/negocio/cliente';
import type { ClienteRegistrado } from '@/negocio/cliente-registro';
import {
  receptorDesdeCliente,
  receptorTieneContenido,
  type ReceptorFacturacion,
} from '@/negocio/facturacion';
import { pedirJSON } from '../solicitud';

/**
 * Consulta si existe un cliente frecuente activo con ese RUT compacto.
 * Si no hay RUT válido/no vacío, devuelve `null` sin consultar (la precarga automática es solo por RUT).
 */
export async function buscarRegistroPorRut(
  rut: string | null | undefined,
  signal?: AbortSignal,
): Promise<ClienteRegistrado | null> {
  if (!rutCompacto(rut ?? null)) return null;
  const { cliente } = await pedirJSON<{ cliente: ClienteRegistrado | null }>(
    `/api/clientes?${new URLSearchParams({ rut: rut! })}`,
    { signal, cache: 'no-store' },
  );
  return cliente ?? null;
}

/**
 * Combina los datos propios de la cotización con la ficha registrada encontrada por RUT.
 * Si la ficha tiene un receptor de facturación configurado, respeta sus campos y completa `correo` desde la ficha.
 * Si no tiene receptor específico, precarga desde los datos de la cotización (completados con la ficha) y `correo`.
 */
export function combinarReceptorConRegistro(
  clienteCotizacion: Partial<Pick<Cliente, 'nombre' | 'rut' | 'giro' | 'direccion' | 'comuna'>> | null | undefined,
  registro: ClienteRegistrado,
): ReceptorFacturacion {
  const regReceptor = registro.receptorFacturacion;
  if (receptorTieneContenido(regReceptor)) {
    return {
      razonSocial: regReceptor!.razonSocial ?? null,
      rut: regReceptor!.rut ?? null,
      giro: regReceptor!.giro ?? null,
      direccion: regReceptor!.direccion ?? null,
      comuna: regReceptor!.comuna ?? null,
      correo: regReceptor!.correo ?? registro.correo ?? null,
    };
  }
  return receptorDesdeCliente(
    {
      nombre: clienteCotizacion?.nombre ?? registro.nombre,
      rut: clienteCotizacion?.rut ?? registro.rut,
      giro: clienteCotizacion?.giro ?? registro.giro,
      direccion: clienteCotizacion?.direccion ?? registro.direccion,
      comuna: clienteCotizacion?.comuna ?? registro.comuna,
    },
    registro.correo ?? null,
  );
}

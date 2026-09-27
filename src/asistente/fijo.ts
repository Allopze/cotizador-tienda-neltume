// Adaptador exclusivo de pruebas. No se selecciona desde la petición del navegador.
import type { LLM, ContextoLLM } from './llm';
import { clienteVacio, type SolicitudItem } from '../catalogo/tipos';
export class LLMFijo implements LLM {
  async interpretar(c: ContextoLLM) {
    const items = structuredClone(c.borrador.items);
    const inicial: SolicitudItem = {
      modelo: 'HUILO HUILO',
      madera: 'PINO OREGON',
      ancho: 0.8,
      alto: 2.1,
      medida: null,
      cantidad: 3,
    };
    if (/se aprobó la 323/i.test(c.mensaje)) return { name: 'aprobar_cotizacion', input: { numero: 323 } };
    if (/agrega marcos/i.test(c.mensaje))
      items.push({
        modelo: 'MARCO',
        madera: /oregón/i.test(c.mensaje) ? 'PINO OREGON' : null,
        ancho: null,
        alto: null,
        medida: null,
        cantidad: null,
      });
    else if (c.mensaje === '3 de 2x4 de 2,1')
      items[items.length - 1] = {
        modelo: 'MARCO',
        madera: 'PINO OREGON',
        ancho: null,
        alto: 2.1,
        medida: '2x4',
        cantidad: 3,
      };
    else if (/Huilo Huilo/i.test(c.mensaje))
      return {
        name: 'actualizar_cotizacion',
        input: { items: [inicial], cliente: { ...clienteVacio(), nombre: 'Juan Pérez', comuna: 'Temuco' } },
      };
    else return null;
    return { name: 'actualizar_cotizacion', input: { items, cliente: c.borrador.cliente } };
  }
}

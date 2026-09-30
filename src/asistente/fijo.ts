// Adaptador exclusivo de pruebas. No se selecciona desde la petición del navegador.
import type { LLM, ContextoLLM } from './llm';
import { clienteVacio, type SolicitudItem } from '../catalogo/tipos';
export class LLMFijo implements LLM {
  async interpretar(c: ContextoLLM) {
    const items = structuredClone(c.borrador.items);
    if (c.modo === 'modificacion_anterior') {
      const cambio = c.mensaje.match(
        /\b(?:ahora(?:\s+debe\s+ser)?|pasa\s+a|cambia\s+a|sube\s+a)\s+(?:de\s+)?(\d{1,4})\b/i,
      );
      if (cambio && items.length === 1)
        return {
          name: 'modificar_cotizacion',
          input: { items: [{ indice: 0, cambios: { cantidad: Number(cambio[1]) } }] },
        };
      return { name: 'responder', input: { texto: '¿Qué cambio quieres hacer en la cotización?' } };
    }
    const inicial: SolicitudItem = {
      modelo: 'HUILO HUILO',
      madera: 'PINO OREGON',
      ancho: 0.8,
      alto: 2.1,
      medida: null,
      cantidad: 3,
    };
    const aprobada = c.mensaje.match(/se aprob[oó] la (\d+)/i);
    if (aprobada) return { name: 'aprobar_cotizacion', input: { numero: Number(aprobada[1]) } };
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
    else if (/\bPillo\b/i.test(c.mensaje))
      // Como la IA real: un nombre dudoso se conserva tal cual; el servidor decide si pide confirmarlo.
      return {
        name: 'actualizar_cotizacion',
        input: {
          items: [{ ...inicial, modelo: 'Pillo' }],
          cliente: { ...clienteVacio(), nombre: 'Juan Pérez', comuna: 'Temuco' },
        },
      };
    else if (/Huilo Huilo/i.test(c.mensaje))
      return {
        name: 'actualizar_cotizacion',
        input: {
          items: [inicial],
          cliente: {
            ...clienteVacio(),
            nombre: /Mar[ií]a\s+Jos[eé]/i.test(c.mensaje) ? 'María José' : 'Juan Pérez',
            comuna: 'Temuco',
          },
        },
      };
    else return null;
    return { name: 'actualizar_cotizacion', input: { items, cliente: c.borrador.cliente } };
  }
}

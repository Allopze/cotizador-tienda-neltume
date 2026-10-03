import type { Rechazo } from '../catalogo/resolver';
import { metrosTexto } from '../catalogo/escalones';
export const bonito = (s: string) =>
  s
    .toLocaleLowerCase('es-CL')
    .replace(/(^|\s)\S/g, (l) => l.toUpperCase())
    .replace('Rauli', 'Raulí')
    .replace('Oregon', 'Oregón');
/** Máximo de opciones por pregunta: una lista más larga no se lee; el resto está en «Catálogo». */
export const MAX_OPCIONES = 15;
const listar = (a: string[]) =>
  a.length > MAX_OPCIONES
    ? `${a.slice(0, MAX_OPCIONES).join(', ')} y ${a.length - MAX_OPCIONES} más (revisa «Catálogo»)`
    : a.join(', ');
const opciones = (a: string[]) =>
  listar(a.map((s) => (/^\d+\.\d+$/.test(s) ? s.replace('.', ',') : s.replace(' A ', '–'))));
export function pregunta(r: Rechazo, modelo: string | null) {
  const nombre = bonito(modelo ?? 'producto');
  switch (r.tipo) {
    case 'faltan_datos':
      return r.campos
        .map((c) => {
          const campo = c === 'medida' ? 'sección o escuadría' : c === 'alto' ? 'alto o largo' : c;
          return `¿Qué ${campo} necesitas para ${nombre}? Opciones: ${opciones((r.disponibles[c] ?? []).map((s) => (['madera', 'modelo'].includes(c) ? bonito(s) : s)))}.`;
        })
        .join('\n');
    case 'modelo_desconocido':
      return `No encontré el modelo “${r.valor}” en puertas sólidas. Modelos disponibles: ${opciones(r.disponibles.map(bonito))}.`;
    case 'modelo_posible':
      return `¿Te refieres a ${bonito(r.sugerido)}? Confírmalo para cotizar.`;
    case 'madera_desconocida':
      if (!r.disponibles.length)
        return `No trabajamos “${r.valor}” en este catálogo, y ninguna madera de ${nombre} es compatible con las medidas pedidas.`;
      return `No trabajamos “${r.valor}” en este catálogo. Maderas disponibles: ${listar(r.disponibles.map(bonito))}.`;
    case 'madera_no_disponible':
      if (!r.disponibles.length)
        return `${nombre} no viene en ${bonito(r.valor)}, y ninguna madera de ${nombre} es compatible con las medidas pedidas.`;
      return `${nombre} no viene en ${bonito(r.valor)}. Maderas disponibles: ${listar(r.disponibles.map(bonito))}.`;
    case 'cantidad_invalida':
      return `La cantidad de ${nombre} debe ser un entero entre 1 y 10.000. ¿Cuántas unidades necesitas?`;
    case 'medida_implausible':
      return `No entendí la medida ${String(r.valor).replace('.', ',')} de ${r.campo === 'alto' ? 'alto o largo' : 'ancho'} para ${nombre}. Indícala en metros (por ejemplo 0,80) o centímetros (80); admito ${r.disponibles.join(', ')}.`;
    case 'producto_ambiguo':
      return `Hay más de un producto de ${nombre} que coincide con esas medidas: ${r.disponibles.join('; ')}. ¿Cuál necesitas?`;
    case 'medida_no_disponible': {
      const valor = typeof r.valor === 'number' ? `${metrosTexto(r.valor)} m` : r.valor;
      const campo = r.campo === 'alto' ? 'alto o largo' : r.campo;
      const inicio = `${nombre} no viene en ${valor} de ${campo}.`;
      // Con una sola medida no hay tramo que describir.
      if (r.rango && Math.abs(r.rango.max - r.rango.min) < 1e-9)
        return `${inicio} Solo se cotiza ${metrosTexto(r.rango.min)} m de ${campo}.`;
      if (r.rango && typeof r.valor === 'number' && (r.valor < r.rango.min || r.valor > r.rango.max))
        return `${inicio} Se cotizan ${r.campo === 'ancho' ? 'anchos' : 'altos o largos'} entre ${metrosTexto(r.rango.min)} y ${metrosTexto(r.rango.max)} m.`;
      // Entre escalones se cotiza la siguiente medida: se informa el tramo, no una lista cerrada.
      return r.rango
        ? `${inicio} Se cotizan ${r.campo === 'ancho' ? 'anchos' : 'altos o largos'} entre ${metrosTexto(r.rango.min)} y ${metrosTexto(r.rango.max)} m; las medidas intermedias usan la siguiente medida del catálogo.`
        : `${inicio} Opciones disponibles: ${opciones(r.disponibles)}.`;
    }
  }
}

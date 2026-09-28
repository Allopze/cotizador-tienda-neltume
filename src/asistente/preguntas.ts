import type { Rechazo } from '../catalogo/resolver';
const bonito = (s: string) =>
  s
    .toLocaleLowerCase('es-CL')
    .replace(/(^|\s)\S/g, (l) => l.toUpperCase())
    .replace('Rauli', 'Raulí')
    .replace('Oregon', 'Oregón');
const opciones = (a: string[]) =>
  a.map((s) => (/^\d+\.\d+$/.test(s) ? s.replace('.', ',') : s.replace(' A ', '–'))).join(', ');
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
    case 'madera_desconocida':
      return `No trabajamos “${r.valor}” en este catálogo. Maderas disponibles: ${r.disponibles.map(bonito).join(', ')}.`;
    case 'madera_no_disponible':
      return `${nombre} no viene en ${bonito(r.valor)}. Maderas disponibles: ${r.disponibles.map(bonito).join(', ')}.`;
    case 'cantidad_invalida':
      return `La cantidad de ${nombre} debe ser un entero entre 1 y 10.000. ¿Cuántas unidades necesitas?`;
    case 'medida_implausible':
      return `No entendí la medida ${String(r.valor).replace('.', ',')} de ${r.campo === 'alto' ? 'alto o largo' : 'ancho'} para ${nombre}. Indícala en metros (por ejemplo 0,80) o centímetros (80); admito ${r.disponibles.join(', ')}.`;
    case 'producto_ambiguo':
      return `Hay más de un producto de ${nombre} que coincide con esas medidas: ${r.disponibles.join('; ')}. ¿Cuál necesitas?`;
    case 'medida_no_disponible':
      return `${nombre} no viene en ${String(r.valor).replace('.', ',')}${r.campo === 'medida' ? '' : ' m'} de ${r.campo === 'alto' ? 'alto o largo' : r.campo}. Opciones disponibles: ${opciones(r.disponibles)}.`;
  }
}

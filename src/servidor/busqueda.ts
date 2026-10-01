import { rutCompacto } from '../negocio/cliente';

export function normalizarTexto(texto: string | null | undefined) {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Decimales en forma canónica antes de normalizar, que convertiría la coma en espacio y separaría «0,8»
 * en «0» y «8»: «0,80», «0.80» y «0,8» quedan como «0d8»; «2,00», como «2».
 */
const numerosCanonicos = (texto: string) =>
  texto.replace(/(\d+)[.,](\d+)/g, (_, entero: string, decimales: string) => {
    const resto = decimales.replace(/0+$/, '');
    return resto ? `${Number(entero)}d${resto}` : String(Number(entero));
  });
const esNumero = (termino: string) => /^\d+(d\d+)?$/.test(termino);

/** Texto del producto para buscar en el catálogo, con espacios en los bordes para comparar números enteros. */
export const textoBusquedaCatalogo = (partes: (string | null | undefined)[]) =>
  ` ${normalizarTexto(numerosCanonicos(partes.filter(Boolean).join(' ')))} `;

/**
 * Términos de una búsqueda del catálogo; cada uno es una lista de alternativas. Un entero entre 30 y 400
 * también se lee en centímetros, como en el alta: «80» busca «80» o «0,8»; «210», «210» o «2,1».
 */
export function terminosBusquedaCatalogo(consulta: string): string[][] {
  return normalizarTexto(numerosCanonicos(consulta))
    .split(' ')
    .filter(Boolean)
    .map((termino) => {
      const n = Number(termino);
      if (!/^\d+$/.test(termino) || n < 30 || n > 400) return [termino];
      return [termino, numerosCanonicos(String(n / 100).replace('.', ','))];
    });
}

/**
 * Todos los términos deben aparecer. Los números se comparan enteros («0,8» no encuentra «0,85») y el
 * resto como fragmento, para que «molc» siga encontrando «Molco».
 */
export const coincideBusquedaCatalogo = (texto: string, terminos: string[][]) =>
  terminos.every((alternativas) =>
    alternativas.some((t) => (esNumero(t) ? texto.includes(` ${t} `) : texto.includes(t))),
  );

/** Texto normalizado para la búsqueda del listado: N°, cliente, RUT, comuna, proyecto, modelos y maderas. */
export function textoBusqueda(q: {
  numero: number | null;
  cliente: {
    nombre: string | null;
    rut: string | null;
    comuna: string | null;
    proyecto: string | null;
    giro?: string | null;
  };
  productos: (string | null)[];
}) {
  const partes = [
    q.numero === null ? '' : String(q.numero),
    q.cliente.nombre,
    q.cliente.rut,
    rutCompacto(q.cliente.rut),
    q.cliente.comuna,
    q.cliente.proyecto,
    q.cliente.giro ?? '',
    ...new Set(q.productos.map(normalizarTexto)),
  ];
  return ` ${normalizarTexto(partes.join(' '))} `;
}

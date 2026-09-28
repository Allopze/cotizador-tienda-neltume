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

import type { Catalogo, Madera, Producto, SolicitudItem } from './tipos';
export const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
export const metros = (n: number) => (n > 10 ? n / 100 : n);
export const normalizarMedida = (s: string) => s.toUpperCase().replace(/\s/g, '').replace('.', ',');
const alias: Record<string, Madera> = {
  OREGON: 'PINO OREGON',
  PINO: 'PINO OREGON',
  PINOOREGON: 'PINO OREGON',
  RAULI: 'RAULI',
  LENGA: 'LENGA',
  MARA: 'MARA',
};
export type Rechazo =
  | { tipo: 'faltan_datos'; campos: string[]; disponibles: Record<string, string[]> }
  | { tipo: 'modelo_desconocido'; valor: string; disponibles: string[] }
  | { tipo: 'madera_desconocida'; valor: string; disponibles: string[] }
  | { tipo: 'madera_no_disponible'; valor: string; disponibles: string[] }
  | {
      tipo: 'medida_no_disponible';
      campo: 'ancho' | 'alto' | 'medida';
      valor: number | string;
      disponibles: string[];
    }
  | { tipo: 'cantidad_invalida'; valor: number | null; disponibles: string[] };
export type Resolucion = { ok: true; producto: Producto; cantidad: number } | { ok: false; rechazo: Rechazo };
export function resolverItem(catalogo: Catalogo, entrada: Partial<SolicitudItem>): Resolucion {
  const s: SolicitudItem = {
    modelo: entrada.modelo ?? null,
    madera: entrada.madera ?? null,
    ancho: entrada.ancho ?? null,
    alto: entrada.alto ?? null,
    medida: entrada.medida ?? null,
    cantidad: entrada.cantidad ?? null,
  };
  const productos = catalogo.productos;
  const unicos = (ps: Producto[], campo: 'modelo' | 'madera' | 'medida' | 'largo') => [
    ...new Set(ps.map((p) => String(p[campo]))),
  ];
  const no = (rechazo: Rechazo): Resolucion => ({ ok: false, rechazo });
  if (!s.modelo)
    return no({
      tipo: 'faltan_datos',
      campos: ['modelo'],
      disponibles: { modelo: unicos(productos, 'modelo') },
    });
  let opciones = productos.filter((p) => normalizar(p.modelo) === normalizar(s.modelo!));
  if (!opciones.length)
    return no({ tipo: 'modelo_desconocido', valor: s.modelo, disponibles: unicos(productos, 'modelo') });
  const familia = opciones[0].familia,
    puerta = familia === 'PUERTA';
  const madera = s.madera ? alias[normalizar(s.madera)] : null;
  if (s.madera && !madera)
    return no({ tipo: 'madera_desconocida', valor: s.madera, disponibles: unicos(opciones, 'madera') });
  if (madera) {
    const conMadera = opciones.filter((p) => p.madera === madera);
    if (!conMadera.length)
      return no({ tipo: 'madera_no_disponible', valor: madera, disponibles: unicos(opciones, 'madera') });
    opciones = conMadera;
  }
  if (s.cantidad !== null && (!Number.isInteger(s.cantidad) || s.cantidad < 1 || s.cantidad > 10000))
    return no({ tipo: 'cantidad_invalida', valor: s.cantidad, disponibles: ['Entero entre 1 y 10.000'] });
  // Valida también medidas presentes aunque falten otros datos: nunca oculta un ancho imposible.
  if (puerta && s.ancho !== null) {
    const ancho = metros(s.ancho);
    const medidas = unicos(opciones, 'medida');
    opciones = opciones.filter((p) => ancho >= p.anchoMin! - 1e-9 && ancho <= p.anchoMax! + 1e-9);
    if (!opciones.length)
      return no({ tipo: 'medida_no_disponible', campo: 'ancho', valor: ancho, disponibles: medidas });
  }
  if (!puerta && s.medida) {
    let medida = normalizarMedida(s.medida);
    if (familia !== 'MOLDURA' && /^\d+$/.test(medida)) medida = `2X${medida}`;
    const medidas = unicos(opciones, 'medida');
    opciones = opciones.filter((p) => p.medida === medida);
    if (!opciones.length)
      return no({ tipo: 'medida_no_disponible', campo: 'medida', valor: s.medida, disponibles: medidas });
  }
  if (s.alto !== null) {
    const alto = metros(s.alto),
      disponibles = unicos(opciones, 'largo');
    opciones = opciones.filter((p) => Math.abs(p.largo - alto) <= 0.005 + 1e-9);
    if (!opciones.length)
      return no({ tipo: 'medida_no_disponible', campo: 'alto', valor: alto, disponibles });
  }
  const campos: string[] = [];
  if (!s.madera) campos.push('madera');
  if (puerta ? s.ancho === null : !s.medida) campos.push(puerta ? 'ancho' : 'medida');
  if (s.alto === null) campos.push('alto');
  if (s.cantidad === null) campos.push('cantidad');
  if (campos.length)
    return no({
      tipo: 'faltan_datos',
      campos,
      disponibles: {
        madera: unicos(opciones, 'madera'),
        ancho: unicos(opciones, 'medida'),
        medida: unicos(opciones, 'medida'),
        alto: unicos(opciones, 'largo'),
        cantidad: ['Entero entre 1 y 10.000'],
      },
    });
  return { ok: true, producto: opciones[0], cantidad: s.cantidad! };
}

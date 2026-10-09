import { cifrasDelTexto, nombresDichos, sinTildes, tieneMedidas, type ResolverNombre } from './anclaje';

/**
 * Cobertura del pedido: la IA a veces registra menos ítems de los que pide el mensaje («8 marcos…; 6 marcos…;
 * 5 juegos…» quedaba con uno solo) y la cotización se veía completa. Cada ítem trae la frase de la que salió:
 * lo que queda del mensaje fuera de esas frases y de los datos del cliente, y aun así nombra un modelo con
 * una cifra, es un pedido sin registrar.
 */
type Resolver = Record<'modelo' | 'madera', ResolverNombre>;

/** Palabras que hacen de un trozo un dato del cliente, del despacho o una edición, no un producto. */
const NO_ES_PEDIDO =
  /\b(para|calle|pasaje|avenida|av|direccion|comuna|rut|fono|telefono|celular|proyecto|obra|cliente|sr|sra|senor|senora|despacho|despachar|entrega|flete|fletes|envio|transporte|region|nro|saca|quita|elimina|borra|cambia|sin)\b/;
/** Monto o IVA: con un flete registrado, el trozo es su línea («depacho a Riñihue $350.000 + iva»). */
const MONTO_FLETE = /\$|\biva\b/;

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Trozo de `texto` (ya normalizado) que corresponde a `frase`, ignorando puntuación y espacios («80 x200» es
 * «80x200»); null si no está.
 */
function ubicar(texto: string, frase: string): [number, number] | null {
  const partes = sinTildes(frase.normalize('NFC')).match(/[a-zñ]+|\d+/g) ?? [];
  if (!partes.length) return null;
  const m = new RegExp(partes.map(escapar).join('[^a-z0-9ñ]*')).exec(texto);
  return m ? [m.index, m.index + m[0].length] : null;
}

/**
 * ¿Es una pregunta y no un pedido? «¿La Molco viene en 90?» lo es; «¿me pasai el valor de 9 Huellahue 71 por
 * 200?» es un pedido escrito como pregunta: trae las medidas del producto.
 */
const esPregunta = (texto: string) => texto.includes('?') && !tieneMedidas(texto);

/** ¿El texto nombra un modelo con una cifra, sin ser una pregunta ni un dato del cliente? */
function pidaProducto(texto: string, resolver: Resolver) {
  const plano = sinTildes(texto);
  return (
    !esPregunta(plano) &&
    // Con medidas de producto es un pedido aunque nombre al cliente («… 1.15 m por 2,3 m para Juan Soto»).
    (tieneMedidas(plano) || !NO_ES_PEDIDO.test(plano)) &&
    nombresDichos(plano, resolver.modelo, resolver.madera).resueltos.size > 0 &&
    cifrasDelTexto(plano).length > 0
  );
}

/**
 * Trozos del mensaje, tal como los escribió la persona, que piden productos y no están en la frase de ningún
 * ítem. `frases` son las de los ítems nuevos: si alguna no aparece en el mensaje (la IA la parafraseó), no se
 * puede revisar y devuelve null. `otros` (frases de ítems anteriores, datos del cliente) se descuentan si
 * aparecen y se ignoran si no. Con `conFlete` (la respuesta registró un flete), un trozo con un monto es esa
 * línea aunque nombre un modelo: el destino puede llamarse como uno («Riñihue»).
 */
export function pedidosSinRegistrar(
  mensaje: string,
  frases: string[],
  otros: string[],
  resolver: Resolver,
  { conFlete = false }: { conFlete?: boolean } = {},
): string[] | null {
  const original = mensaje.normalize('NFC');
  const texto = sinTildes(original);
  // Las posiciones del texto normalizado deben valer en el original para citarlo tal cual.
  if (texto.length !== original.length) return null;
  const cubierto = new Array<boolean>(texto.length).fill(false);
  const cubrir = (tramo: [number, number]) => cubierto.fill(true, tramo[0], tramo[1]);
  for (const frase of frases) {
    const tramo = ubicar(texto, frase);
    if (!tramo) return null;
    cubrir(tramo);
  }
  for (const otro of otros) {
    const tramo = otro.trim() ? ubicar(texto, otro) : null;
    if (tramo) cubrir(tramo);
  }
  // Trozos sin cubrir, cortados donde una persona separa productos: líneas, «;», «, », «. » y « y ».
  const trozos: string[] = [];
  let inicio = -1;
  const cerrar = (fin: number) => {
    if (inicio >= 0) trozos.push(original.slice(inicio, fin));
    inicio = -1;
  };
  for (let i = 0; i <= texto.length; i++) {
    const corte =
      i === texto.length ||
      cubierto[i] ||
      /[\n;]/.test(texto[i]) ||
      (/[,.]/.test(texto[i]) && /\s/.test(texto[i + 1] ?? ' ')) ||
      (/\s/.test(texto[i]) && /^(y|e)\s/.test(texto.slice(i + 1, i + 3)));
    if (corte) cerrar(i);
    else if (inicio < 0) inicio = i;
  }
  return trozos
    // Sin conectores sueltos en los bordes: «también 1 puerta Toledo … para» se cita «1 puerta Toledo …».
    .map((t) =>
      t
        .replace(/^(?:[\s\-•*·]+|(?:y|e|tambi[eé]n|adem[aá]s)\s+)+/i, '')
        .replace(/(?:[\s,.;:]+|\s+(?:para|de|en|a|con|y))+$/i, ''),
    )
    // Un trozo con medidas y precio («1 Huilo 1,90x2,20 a $450.000») es un producto, no la línea del flete.
    .filter(
      (t) =>
        t && !(conFlete && MONTO_FLETE.test(sinTildes(t)) && !tieneMedidas(t)) && pidaProducto(t, resolver),
    );
}

/**
 * El mensaje sin las líneas del flete (con un monto o el IVA y sin medidas de producto). Si la IA registró
 * solo el flete y ningún producto, el reintento se hace con esto: así no vuelve a quedarse solo con el flete.
 */
export const sinLineasDeFlete = (mensaje: string) =>
  mensaje
    .split('\n')
    .filter((l) => !(MONTO_FLETE.test(sinTildes(l)) && !tieneMedidas(l)))
    .join('\n');

/**
 * El mensaje con las líneas del flete al final: leído antes que los productos («Cotizar…\nDespacho a X $…\n3 …»),
 * la IA a veces registraba solo el flete. Las líneas no cambian, así que cada frase sigue siendo del mensaje.
 */
export function fleteAlFinal(mensaje: string) {
  const lineas = mensaje.split('\n');
  const esFlete = (l: string) => MONTO_FLETE.test(sinTildes(l)) && !tieneMedidas(l);
  const flete = lineas.filter(esFlete);
  if (!flete.length || flete.length === lineas.length) return mensaje;
  return [...lineas.filter((l) => !esFlete(l)), ...flete].join('\n');
}

/**
 * ¿El mensaje pide productos? Nombra un modelo y trae una cifra, y no es una pregunta sin medidas. A diferencia de un
 * trozo suelto, un mensaje completo puede traer además el cliente («… para Juan Pérez»).
 */
export function pareceUnPedido(mensaje: string, resolver: Resolver) {
  const plano = sinTildes(mensaje);
  return (
    !esPregunta(plano) &&
    nombresDichos(plano, resolver.modelo, resolver.madera).resueltos.size > 0 &&
    cifrasDelTexto(plano).length > 0
  );
}

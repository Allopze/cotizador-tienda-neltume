import { ubicarPartes } from './frases';
import { metros } from '../catalogo/resolver';
import {
  cantidadesDichas,
  cifrasDelTexto,
  nombresDichos,
  sinTildes,
  tieneMedidas,
  type ResolverNombre,
} from './anclaje';

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

/** Maderas y medidas (sin la cantidad) que dice un texto: lo que distingue dos pedidos del mismo modelo. */
function rasgos(texto: string, resolver: Resolver) {
  const cantidades = cantidadesDichas(texto);
  return {
    maderas: [...nombresDichos(texto, resolver.madera, resolver.modelo).resueltos.keys()],
    // En metros: «0,9 por 2,1» y «90x210» dicen lo mismo.
    medidas: cifrasDelTexto(texto, false)
      .filter((c) => !cantidades.includes(c))
      // Con el rango de un accesorio (hasta 6 m), «360» y «3,6» también coinciden; solo se usa para comparar.
      .map((c) => Math.round((metros(c, 'MOLDURA') ?? c) * 1000)),
  };
}

/**
 * ¿Cuánto se parece el trozo al pedido de la frase de un ítem que no se ubicó en el mensaje («tres puertas Molco
 * de lenga» por «3 Molco lenga 80x200», o cortada en «80x20»)? null si no es su pedido: debe nombrar uno de sus
 * modelos y, cuando ambos los dicen, su cantidad, una de sus maderas y una de sus medidas. Si no, cuenta las
 * maderas y medidas que comparten.
 */
function parecido(trozo: string, frase: string, resolver: Resolver): number | null {
  const modelos = (s: string) => [...nombresDichos(s, resolver.modelo, resolver.madera).resueltos.keys()];
  const delTrozo = modelos(trozo);
  if (!modelos(frase).some((m) => delTrozo.includes(m))) return null;
  const comunes = <T>(a: T[], b: T[]) => (!a.length || !b.length ? null : a.filter((x) => b.includes(x)).length);
  if (comunes(cantidadesDichas(frase), cantidadesDichas(trozo)) === 0) return null;
  const [f, t] = [rasgos(frase, resolver), rasgos(trozo, resolver)];
  const maderas = comunes(f.maderas, t.maderas),
    medidas = comunes(f.medidas, t.medidas);
  return maderas === 0 || medidas === 0 ? null : (maderas ?? 0) + (medidas ?? 0);
}

/**
 * Trozos del mensaje, tal como los escribió la persona, que piden productos y no son de ningún ítem. Cada
 * ítem nuevo (`frases`) toma una aparición distinta de su frase, las más largas primero: dos líneas iguales
 * son dos ítems, y «2 Molco lenga 80x200» no toma la línea «2 Molco lenga 80x200 con vidrio». Si una frase
 * no aparece (la IA la parafraseó o la cortó), su ítem cubre el trozo que más se le parece (ver `parecido`). `otros` (frases de ítems anteriores, datos del cliente) se descuentan si aparecen y se ignoran si
 * no. Con `conFlete` (la respuesta registró un flete), un trozo con un monto es esa línea aunque nombre un
 * modelo: el destino puede llamarse como uno («Riñihue»). null solo si el mensaje no se puede citar tal cual.
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
  const tomados: [number, number][] = [];
  /** Tramos de las frases de los ítems que no nombran un modelo («una en lenga»): continúan el pedido anterior. */
  const sinModelo: [number, number][] = [];
  const cubrir = (frase: string, deItem = false) => {
    const tramos = frase.trim() ? ubicarPartes(texto, frase, tomados) : null;
    if (!tramos) return false;
    for (const tramo of tramos) {
      cubierto.fill(true, ...tramo);
      tomados.push(tramo);
    }
    if (deItem && !nombresDichos(sinTildes(frase), resolver.modelo, resolver.madera).resueltos.size)
      sinModelo.push(...tramos);
    return true;
  };
  const sinUbicar = [...frases].sort((a, b) => b.length - a.length).filter((f) => !cubrir(f, true));
  otros.forEach((f) => cubrir(f));
  // Trozos sin cubrir, cortados donde una persona separa productos: líneas, «;», «, », «. » y « y ».
  const trozos: string[] = [];
  let inicio = -1;
  const cerrar = (fin: number) => {
    if (inicio >= 0 && !encabezaReparto(fin)) trozos.push(original.slice(inicio, fin));
    inicio = -1;
  };
  /**
   * «dame 2 LOS LAGOS, una en lenga y otra en mara»: la IA registró «una en lenga» y «otra en mara» como ítems sin
   * nombrar el modelo, que toman del trozo que va justo antes. Ese trozo es la cabeza del reparto (lo mismo que lee
   * `anclarFrases`), no un pedido sin registrar.
   */
  const encabezaReparto = (fin: number) => {
    const seguidas: string[] = [];
    for (let i = fin; ; ) {
      const separador = /^(?:[\s,;:.]|y\s|e\s)+/.exec(texto.slice(i))?.[0].length ?? 0;
      const tramo = sinModelo.find(([a]) => a === i + separador);
      if (!tramo) break;
      seguidas.push(texto.slice(...tramo));
      i = tramo[1];
    }
    return /\bun[oa]\b.*\botr[oa]\b/.test(seguidas.join(' '));
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
  const pedidos = trozos
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
  // La IA registró el pedido de una frase que no se ubicó: no se acusa como omitido. Cubre el trozo que más
  // se le parece; si empatan trozos distintos, no se sabe cuál registró y no se acusa ninguno.
  for (const frase of sinUbicar) {
    const puntos = pedidos.map((t) => parecido(t, frase, resolver));
    const mejor = Math.max(...puntos.map((p) => p ?? -1));
    if (mejor < 0) continue;
    const empatados = pedidos.filter((_, i) => puntos[i] === mejor);
    const iguales = empatados.every((t) => sinTildes(t) === sinTildes(empatados[0]));
    for (const t of iguales ? empatados.slice(0, 1) : empatados) pedidos.splice(pedidos.indexOf(t), 1);
  }
  return pedidos;
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
 * trozo suelto, un mensaje completo puede traer además el cliente («… para Juan Pérez»): en cada línea sin medidas
 * se lee solo lo que va antes de un dato del cliente, del despacho o una edición (`NO_ES_PEDIDO`). Así «Necesito
 * despacho a Riñihue para 3 pallets» no pide la puerta Riñihue.
 */
export function pareceUnPedido(mensaje: string, resolver: Resolver) {
  const plano = sinTildes(mensaje);
  const productos = plano
    .split('\n')
    .map((l) => {
      const dato = tieneMedidas(l) ? -1 : l.search(NO_ES_PEDIDO);
      return dato >= 0 ? l.slice(0, dato) : l;
    })
    .join('\n');
  return (
    !esPregunta(plano) &&
    nombresDichos(productos, resolver.modelo, resolver.madera).resueltos.size > 0 &&
    cifrasDelTexto(productos).length > 0
  );
}

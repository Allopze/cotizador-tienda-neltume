// Prueba comparativa de punta a punta: lo que obtiene una persona al escribir un pedido en la plataforma
// frente a lo que calcula la planilla Excel para el mismo pedido.
//
// Cada caso es una conversación en lenguaje natural generada a partir de productos reales de la planilla, en
// escenarios variados: pedidos normales, marcos de todas las maderas, puertas «con su marco», medidas entre
// escalones, milímetros, alias y errores de tipeo, alto antes que ancho, ruido, y pedidos vagos (sin madera,
// sin alto, sin cantidad, fuera de rango, nombres dudosos) que deben quedar pendientes, a veces completados
// en un segundo mensaje. Cada mensaje pasa por el mismo Servicio que la aplicación (IA de CommandCode con el
// modelo configurado, anclaje, catálogo vivo de la base y reglas de Ajustes), en una base temporal. Excel
// recalcula la hoja «Cotización» con los productos que sí deben cotizarse y, en la columna %, el margen de
// categoría que fija Ajustes (lo que escribiría el vendedor).
//
// Hallazgos graves: la cotización trae un producto, una cantidad o un monto distinto de lo pedido, cotiza un
// dato que no se dio o pierde un ítem sin preguntar. Leves: pregunta algo que ya estaba en el pedido.
//
//   npm run paridad:excel-ia -- [--casos 200] [--semilla 1] [--paralelo 4] [--escenario marco,vago_sin_madera]
//                               [--modelo id] [--anclaje corregir|avisar] [--ids 3,7] [--planilla ruta.xlsx]
//                               [--solo-mensajes]
//
// Solo macOS con Excel. Llama al proveedor de IA (costo pequeño por mensaje). No crea cotizaciones en la base real.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CommandCodeLLM, type ModoAnclaje } from '../src/asistente/llm';
import { leerConfiguracionCatalogo } from '../src/catalogo/configuracion-archivo';
import { importarPlanilla } from '../src/catalogo/planilla';
import { nombreCanonicoModelo } from '../src/catalogo/configuracion';
import type { Producto } from '../src/catalogo/tipos';
import { sumarCharla, type Cotizacion, type Mensaje } from '../src/negocio/estado';
import { margenProducto, type Montos } from '../src/negocio/precios';
import { leerAjustesIA, leerClaveCommandCode } from '../src/servidor/ajustes-ia';
import { Almacen, cerrarAlmacen } from '../src/servidor/almacen';
import { cargarCatalogo } from '../src/servidor/catalogo';
import { guardarConfiguracionNegocio, leerConfiguracionNegocio } from '../src/servidor/configuracion-negocio';
import { Servicio, type DiagnosticoTurno } from '../src/servidor/servicio';
import { ErrorIA } from '../src/asistente/errores';
import { obtenerCatalogoCommandCode } from '../src/servidor/modelos-commandcode';
import { entradasPlanilla, recalcularEnExcel, type ResultadoExcel } from './lib/excel-cotizacion';

const { values } = parseArgs({
  options: {
    casos: { type: 'string', default: '200' },
    semilla: { type: 'string', default: '1' },
    paralelo: { type: 'string', default: '4' },
    escenario: { type: 'string' },
    modelo: { type: 'string' },
    /** Modo del anclaje por frase; sin indicar, el predeterminado del cliente de IA. */
    anclaje: { type: 'string' },
    ids: { type: 'string' },
    planilla: { type: 'string' },
    'solo-mensajes': { type: 'boolean', default: false },
    /** Solo recalcula y guarda en caché lo que da Excel para estos pedidos (sin IA). */
    'solo-excel': { type: 'boolean', default: false },
  },
});
const planilla = resolve(values.planilla ?? process.env.NELTUME_PLANILLA ?? 'datos-privados/COTIZADOR_2026.xlsx');
const salida = resolve('data/test-paridad-excel');

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const azar = mulberry32(Number(values.semilla));
const entero = (min: number, max: number) => min + Math.floor(azar() * (max - min + 1));
const elegir = <T>(xs: readonly T[]) => xs[Math.floor(azar() * xs.length)];
const coma = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

// ---------- Catálogos ----------
const planillaImportada = (await importarPlanilla(planilla, await leerConfiguracionCatalogo())).catalogo;
const entradaExcel = await entradasPlanilla(planilla);
// LLAG-O-2-C no existe en la hoja Precio (código mal escrito en la fila 1193): Excel no puede cotizarla.
const candidatos = planillaImportada.productos.filter((p) => p.codigo !== 'LLAG-O-2-C');
const de = (f: (p: Producto) => boolean) => candidatos.filter(f);
const puertas = de((p) => p.familia === 'PUERTA');
const letra = (p: Producto) => p.codigo.split('-')[1];

// ---------- Cómo escribe la gente ----------
const MADERAS: Record<string, string[]> = {
  O: ['pino oregón', 'oregón', 'oregon', 'pino oregon', 'pino'],
  L: ['lenga', 'Lenga'],
  M: ['mara', 'Mara'],
  R: ['raulí', 'rauli', 'Raulí'],
};
const PALABRAS: Record<number, string[]> = {
  1: ['una', '1'],
  2: ['dos', 'un par de'],
  3: ['tres'],
  4: ['cuatro'],
  5: ['cinco'],
  6: ['seis', 'media docena de'],
  10: ['diez'],
  12: ['una docena de', 'doce'],
};
const cantidadAzar = () =>
  azar() < 0.2 ? Number(elegir(Object.keys(PALABRAS))) : azar() < 0.8 ? entero(1, 12) : entero(13, 80);
const cantidadTexto = (n: number) => (PALABRAS[n] && azar() < 0.6 ? elegir(PALABRAS[n]) : String(n));
const maderaTexto = (p: Producto) => elegir(MADERAS[letra(p)]);
const modeloTexto = (p: Producto) => elegir([nombreCanonicoModelo(p.modelo), p.modelo.toLowerCase(), p.modelo]);
const anchoTexto = (m: number) => elegir([coma(m * 100), `${coma(m * 100)} cm`, coma(m), `${String(m)} m`]);
const altoTexto = (m: number) => elegir([coma(m * 100), coma(m), `${coma(m)} m`, `${coma(m * 100)} cm`]);
/** Un ancho dentro del rango del producto, en pasos de 1 cm. */
const anchoDentro = (p: Producto) =>
  Math.round((p.anchoMin! + 0.01 * entero(0, Math.round((p.anchoMax! - p.anchoMin!) / 0.01))) * 1000) / 1000;
const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios);

function frasePuerta(p: Producto, cantidad: number, o: { modelo?: string; ancho?: string; alto?: string } = {}) {
  const n = cantidadTexto(cantidad),
    madera = maderaTexto(p),
    modelo = o.modelo ?? modeloTexto(p);
  const ancho = anchoDentro(p);
  const a = o.ancho ?? anchoTexto(ancho),
    h = o.alto ?? altoTexto(p.largo);
  return elegir([
    `${n} ${modelo} en ${madera} de ${a} x ${h}`,
    `${n} ${plural(cantidad, 'puerta', 'puertas')} ${modelo} ${madera} ${a} por ${h}`,
    `${modelo} ${madera} ${a} x ${h}, ${cantidad === 1 ? elegir(['1 unidad', 'una unidad']) : `${cantidad} unidades`}`,
    `${n} ${modelo} de ${madera} medida ${a} x ${h}`,
  ]);
}
function fraseAccesorio(p: Producto, cantidad: number) {
  const n = cantidadTexto(cantidad),
    madera = maderaTexto(p);
  if (p.familia === 'MOLDURA') {
    const tipo = p.modelo.toLowerCase();
    const medida = elegir([p.medida.toLowerCase(), p.medida.replace('X', ' x ')]);
    const uno = cantidad === 1;
    return `${uno ? (tipo === 'pilastra' ? 'una' : 'un') : n} ${tipo}${uno ? '' : 's'} ${madera} ${medida} de ${coma(p.largo)} m`;
  }
  const e = p.medida.split('X')[1];
  if (p.familia === 'PIEZAS_T') return `${n} piezas T ${madera} ${elegir([`2x${e}`, `2 x ${e}`])} de ${coma(p.largo)}`;
  return fraseMarco(p, cantidad);
}
function fraseMarco(p: Producto, cantidad: number) {
  const e = p.medida.split('X')[1],
    madera = maderaTexto(p),
    h = coma(p.largo),
    n = cantidadTexto(cantidad);
  const uno = cantidad === 1;
  return elegir([
    `${uno ? 'un' : n} ${plural(cantidad, 'marco', 'marcos')} ${madera} 2x${e} de ${h}`,
    `${uno ? 'un' : n} ${plural(cantidad, 'marco', 'marcos')} de ${e} en ${madera} de ${h}`,
    `${uno ? 'un' : n} ${plural(cantidad, 'marco', 'marcos')} 2 x ${e} ${madera}, alto ${h} m`,
    `marco ${madera} de ${e} pulgadas ${h} m, ${uno ? '1 unidad' : `${cantidad} unidades`}`,
    `${uno ? 'un' : n} ${plural(cantidad, 'marco', 'marcos')} en ${madera} escuadría 2x${e} para puerta de ${coma(p.largo * 100)}`,
    `${uno ? 'un' : n} ${plural(cantidad, 'juego', 'juegos')} de marco 2x${e} ${madera} de ${h} m`,
  ]);
}

// ---------- Escenarios ----------
type Esperado =
  | { tipo: 'cotiza'; producto: Producto; cantidad: number; frase: string }
  | { tipo: 'pregunta'; frase: string; motivo: string };
interface Escenario {
  mensajes: string[];
  items: Esperado[];
}
const cotiza = (producto: Producto, cantidad: number, frase: string): Esperado => ({ tipo: 'cotiza', producto, cantidad, frase });
const pregunta = (frase: string, motivo: string): Esperado => ({ tipo: 'pregunta', frase, motivo });
const solo = (e: Esperado, intro = true): Escenario => ({
  mensajes: [`${intro ? elegir(['Cotiza ', 'Necesito cotizar ', 'Hola, me cotizas ', '', 'Por favor cotizar ']) : ''}${e.frase}`.trim()],
  items: [e],
});
/** Varios ítems en un mensaje, unidos como los escribiría una persona. */
function juntar(items: Esperado[]): Escenario {
  const f = items.map((i) => i.frase);
  const cuerpo = elegir([
    () => f.slice(0, -1).join(', ') + ' y ' + f.at(-1),
    () => f.join('; '),
    () => '\n' + f.map((x) => `- ${x}`).join('\n'),
  ])();
  return { mensajes: [`${elegir(['Cotiza ', 'Necesito cotizar ', 'Hola, me cotizas ', ''])}${cuerpo}`.trim()], items };
}
const puertaNormal = () => {
  const p = elegir(puertas),
    q = cantidadAzar();
  return cotiza(p, q, frasePuerta(p, q));
};
const accesorioNormal = (familia: Producto['familia']) => {
  const p = elegir(de((x) => x.familia === familia)),
    q = cantidadAzar();
  return cotiza(p, q, fraseAccesorio(p, q));
};
const ESCENARIOS: Record<string, () => Escenario> = {
  // Lo cotizable, dicho de muchas formas.
  normal: () => juntar(Array.from({ length: entero(1, 4) }, () => (azar() < 0.6 ? puertaNormal() : accesorioNormal(elegir(['MARCO', 'PIEZAS_T', 'MOLDURA'] as const))))),
  marco: () => {
    const p = elegir(de((x) => x.familia === 'MARCO')),
      q = cantidadAzar();
    return solo(cotiza(p, q, fraseMarco(p, q)));
  },
  marcos_varios: () => {
    const madera = elegir(['O', 'L', 'M', 'R']);
    const marcos = de((x) => x.familia === 'MARCO' && letra(x) === madera);
    const usados = new Set<string>();
    const items: Esperado[] = [];
    while (items.length < entero(2, 3)) {
      const p = elegir(marcos);
      if (usados.has(p.codigo)) continue;
      usados.add(p.codigo);
      const q = cantidadAzar();
      items.push(cotiza(p, q, fraseMarco(p, q)));
    }
    return juntar(items);
  },
  puerta_con_marco: () => {
    const puerta = elegir(puertas.filter((p) => p.largo <= 2.6));
    const marco = elegir(de((x) => x.familia === 'MARCO' && letra(x) === letra(puerta) && Math.abs(x.largo - puerta.largo) < 1e-9));
    const q = cantidadAzar(),
      e = marco.medida.split('X')[1];
    const texto = `${frasePuerta(puerta, q)} ${elegir(['con su marco', 'con marco', 'cada una con su marco'])} 2x${e} en ${maderaTexto(marco)}`;
    return { mensajes: [`Cotiza ${texto}`], items: [cotiza(puerta, q, texto), cotiza(marco, q, texto)] };
  },
  entre_escalones: () => {
    // Una medida entre dos escalones se cotiza con el siguiente hacia arriba.
    const p = elegir(puertas.filter((x) => x.anchoMin! >= 0.7 && x.largo >= 2.1 && x.largo <= 2.6));
    const q = cantidadAzar();
    const modo = elegir(['ancho', 'alto', 'ambos']);
    const ancho = modo === 'alto' ? anchoDentro(p) : Math.round((p.anchoMin! - 0.03) * 1000) / 1000;
    const alto = modo === 'ancho' ? p.largo : Math.round((p.largo - 0.05) * 1000) / 1000;
    return solo(cotiza(p, q, frasePuerta(p, q, { ancho: coma(ancho * 100), alto: coma(alto * 100) })));
  },
  milimetros: () => {
    const p = elegir(puertas),
      q = cantidadAzar();
    const texto = `${cantidadTexto(q)} ${modeloTexto(p)} en ${maderaTexto(p)} de ${Math.round(anchoDentro(p) * 1000)} x ${Math.round(p.largo * 1000)} mm`;
    return solo(cotiza(p, q, texto));
  },
  vano_hoja: () => {
    const p = elegir(puertas),
      q = cantidadAzar();
    return solo(cotiza(p, q, `${frasePuerta(p, q)} ${elegir(['medida vano', 'medida de hoja', '(vano)', 'hoja'])}`));
  },
  alias: () => {
    const ALIAS: Record<string, string[]> = {
      'HUILO HUILO': ['huillo huillo', 'wilo wilo', 'huilo', 'huillo'],
      'COZ COZ': ['coscos', 'cos cos'],
      PANGUIPULLI: ['pangipulli'],
      'PUÑIR': ['punir'],
      'RIÑIHUE': ['rinihue'],
      'CHAN CHAN': ['chanchan'],
    };
    const modelo = elegir(Object.keys(ALIAS));
    const p = elegir(puertas.filter((x) => x.modelo.toUpperCase() === modelo)),
      q = cantidadAzar();
    return solo(cotiza(p, q, frasePuerta(p, q, { modelo: elegir(ALIAS[modelo]) })));
  },
  alto_primero: () => {
    const p = elegir(puertas),
      q = cantidadAzar();
    const a = coma(anchoDentro(p) * 100),
      h = coma(p.largo * 100);
    const texto = elegir([
      `${cantidadTexto(q)} ${modeloTexto(p)} ${maderaTexto(p)}, ${h} de alto por ${a} de ancho`,
      `${cantidadTexto(q)} ${modeloTexto(p)} en ${maderaTexto(p)} alto ${h} ancho ${a}`,
    ]);
    return solo(cotiza(p, q, texto));
  },
  ruido: () => {
    const items = Array.from({ length: entero(1, 2) }, puertaNormal);
    const f = items.map((i) => i.frase).join(' y también ');
    const texto = elegir([
      `hola buenas tardes!! necesito precio de ${f} para Juan Soto, Osorno. gracias`,
      `Estimados, junto con saludar, solicito cotización de ${f}. Proyecto Casa Lago, comuna de Frutillar.`,
      `oye me pasai el valor de ${f}? es pa una obra en temuco`,
    ]);
    return { mensajes: [texto], items };
  },
  dos_maderas: () => {
    for (;;) {
      const a = elegir(puertas);
      const otras = puertas.filter((x) => x.modelo === a.modelo && x.medida === a.medida && x.largo === a.largo && letra(x) !== letra(a));
      if (!otras.length) continue;
      const b = elegir(otras);
      const texto = `dame 2 ${modeloTexto(a)}, una en ${maderaTexto(a)} y otra en ${maderaTexto(b)}, ambas de ${coma(anchoDentro(a) * 100)}x${coma(a.largo * 100)}`;
      return { mensajes: [texto], items: [cotiza(a, 1, texto), cotiza(b, 1, texto)] };
    }
  },
  // Lo vago: debe quedar pendiente, sin inventar el dato.
  vago_sin_madera: () => {
    const p = elegir(puertas),
      q = cantidadAzar();
    return solo(pregunta(`${cantidadTexto(q)} ${modeloTexto(p)} de ${coma(anchoDentro(p) * 100)} por ${coma(p.largo * 100)}`, 'madera'));
  },
  vago_sin_alto: () => {
    const p = elegir(puertas),
      q = cantidadAzar();
    return solo(pregunta(`${cantidadTexto(q)} ${modeloTexto(p)} ${maderaTexto(p)} de ${coma(anchoDentro(p) * 100)}`, 'alto'));
  },
  vago_sin_cantidad: () => {
    const p = elegir(puertas);
    return solo(pregunta(`${elegir(['puerta', 'una puerta tipo', 'precio de'])} ${modeloTexto(p)} en ${maderaTexto(p)} de ${coma(anchoDentro(p) * 100)} x ${coma(p.largo * 100)}`.replace('una puerta tipo', 'puerta tipo'), 'cantidad'));
  },
  vago_sin_modelo: () => {
    const p = elegir(puertas);
    return solo(pregunta(`${cantidadTexto(entero(2, 8))} puertas de ${maderaTexto(p)} de ${coma(anchoDentro(p) * 100)} x ${coma(p.largo * 100)}`, 'modelo'));
  },
  vago_accesorio_sin_largo: () => {
    const p = elegir(de((x) => x.familia !== 'PUERTA'));
    const e = p.familia === 'MOLDURA' ? p.medida.toLowerCase() : `2x${p.medida.split('X')[1]}`;
    const nombre = { MARCO: 'marcos', PIEZAS_T: 'piezas T', MOLDURA: `${p.modelo.toLowerCase()}s` }[p.familia as 'MARCO'];
    return solo(pregunta(`${entero(2, 20)} ${nombre} ${e} en ${maderaTexto(p)}`, 'largo'));
  },
  vago_madera_desconocida: () => {
    const p = elegir(puertas);
    return solo(pregunta(`${entero(1, 6)} ${modeloTexto(p)} en ${elegir(['roble', 'cedro', 'pino radiata', 'coigüe'])} de ${coma(anchoDentro(p) * 100)} x ${coma(p.largo * 100)}`, 'madera desconocida'));
  },
  vago_fuera_de_rango: () => {
    const p = elegir(puertas);
    const [a, h] = elegir([
      [elegir([170, 180, 50]), coma(p.largo * 100)],
      [coma(anchoDentro(p) * 100), elegir([290, 320, 180])],
    ] as const);
    return solo(pregunta(`${entero(1, 6)} ${modeloTexto(p)} en ${maderaTexto(p)} de ${a} x ${h}`, 'medida no disponible'));
  },
  vago_nombre_dudoso: () => {
    const p = elegir(puertas);
    return solo(pregunta(`${entero(1, 6)} ${elegir(['pillo', 'Pillo'])} ${maderaTexto(p)} ${coma(anchoDentro(p) * 100)}x${coma(p.largo * 100)}`, 'modelo dudoso'));
  },
  vago_lo_de_siempre: () => {
    const p = elegir(puertas);
    return solo(pregunta(`${entero(2, 8)} ${modeloTexto(p)} ${coma(anchoDentro(p) * 100)}x${coma(p.largo * 100)}, lo de siempre`, 'madera'), false);
  },
  // Vago y completado en un segundo mensaje.
  completa_madera: () => {
    const p = elegir(puertas),
      q = cantidadAzar();
    const primero = `${cantidadTexto(q)} ${modeloTexto(p)} de ${coma(anchoDentro(p) * 100)} por ${coma(p.largo * 100)}`;
    return { mensajes: [primero, elegir([maderaTexto(p), `en ${maderaTexto(p)}`, `de ${maderaTexto(p)} por favor`])], items: [cotiza(p, q, primero)] };
  },
  completa_alto: () => {
    const p = elegir(puertas),
      q = cantidadAzar();
    const primero = `${cantidadTexto(q)} ${modeloTexto(p)} ${maderaTexto(p)} de ${coma(anchoDentro(p) * 100)}`;
    return { mensajes: [primero, elegir([`el alto es ${altoTexto(p.largo)}`, `de ${altoTexto(p.largo)} de alto`, `alto ${coma(p.largo)}`])], items: [cotiza(p, q, primero)] };
  },
  completa_cantidad: () => {
    const p = elegir(puertas),
      q = entero(2, 30);
    const primero = `puerta ${modeloTexto(p)} en ${maderaTexto(p)} de ${coma(anchoDentro(p) * 100)} x ${coma(p.largo * 100)}`;
    return { mensajes: [primero, elegir([`son ${q}`, `${q} unidades`, `necesito ${q}`])], items: [cotiza(p, q, primero)] };
  },
  // Mezcla: lo completo se cotiza y lo vago queda pendiente.
  mixto: () => {
    const vagos = ['vago_sin_madera', 'vago_sin_alto', 'vago_madera_desconocida', 'vago_fuera_de_rango'];
    const items = [puertaNormal(), accesorioNormal('MARCO'), ESCENARIOS[elegir(vagos)]().items[0]];
    return juntar(items.sort(() => azar() - 0.5));
  },
};
const PESOS: Record<string, number> = {
  normal: 4, marco: 6, marcos_varios: 3, puerta_con_marco: 3, entre_escalones: 2, milimetros: 1, vano_hoja: 1,
  alias: 2, alto_primero: 1, ruido: 1, dos_maderas: 1, vago_sin_madera: 1, vago_sin_alto: 1, vago_sin_cantidad: 1,
  vago_sin_modelo: 1, vago_accesorio_sin_largo: 1, vago_madera_desconocida: 1, vago_fuera_de_rango: 1,
  vago_nombre_dudoso: 1, vago_lo_de_siempre: 1, completa_madera: 1, completa_alto: 1, completa_cantidad: 1, mixto: 2,
};
const filtro = values.escenario?.split(',').map((s) => s.trim());
for (const e of filtro ?? []) if (!ESCENARIOS[e]) throw new Error(`Escenario desconocido: ${e}. Opciones: ${Object.keys(ESCENARIOS).join(', ')}`);
const bolsa = Object.entries(PESOS).flatMap(([e, n]) => (!filtro || filtro.includes(e) ? Array(n).fill(e) : []));
interface Caso extends Escenario {
  id: number;
  escenario: string;
}
const ids = values.ids ? new Set(values.ids.split(',').map(Number)) : null;
// Con --ids se generan todos los casos (misma semilla, mismos pedidos) y se corren solo esos.
const casos: Caso[] = Array.from({ length: Number(values.casos) }, (_, k) => {
  const escenario = elegir(bolsa);
  return { id: k + 1, escenario, ...ESCENARIOS[escenario]() };
}).filter((c) => !ids || ids.has(c.id));
const cotizables = (c: Caso) => c.items.filter((i): i is Extract<Esperado, { tipo: 'cotiza' }> => i.tipo === 'cotiza');

if (values['solo-mensajes']) {
  for (const c of casos)
    console.log(
      `${c.id}. [${c.escenario}] ${c.mensajes.join(' // ')}\n   → ${c.items.map((i) => (i.tipo === 'cotiza' ? `${i.cantidad} × ${i.producto.codigo}` : `pregunta (${i.motivo})`)).join(', ')}`,
    );
  process.exit(0);
}

// ---------- Consumo de CommandCode ----------
// Se lee el `usage` de cada respuesta del proveedor (Chat Completions o Messages) sin tocar la aplicación.
const consumo = { llamadas: 0, entrada: 0, salida: 0, cacheados: 0, sinUso: 0 };
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
  const respuesta = await fetchOriginal(...args);
  const url = String(args[0] instanceof Request ? args[0].url : args[0]);
  if (/api\.commandcode\.ai\/provider\/v1\/(chat\/completions|messages)/.test(url)) {
    consumo.llamadas++;
    try {
      const uso = (
        (await respuesta.clone().json()) as {
          usage?: Record<string, number> & { prompt_tokens_details?: { cached_tokens?: number } };
        }
      ).usage;
      if (!uso) consumo.sinUso++;
      consumo.entrada += uso?.prompt_tokens ?? uso?.input_tokens ?? 0;
      consumo.salida += uso?.completion_tokens ?? uso?.output_tokens ?? 0;
      consumo.cacheados += uso?.prompt_tokens_details?.cached_tokens ?? uso?.cache_read_input_tokens ?? 0;
    } catch {
      consumo.sinUso++;
    }
  }
  return respuesta;
};

const negocio = leerConfiguracionNegocio();
// ---------- Fase 1: Excel (solo lo que debe cotizarse) ----------
const reglas = negocio.reglas;
const conLineas = casos.filter((c) => cotizables(c).length);
// Lo que calcula Excel no depende del modelo: se reutiliza entre corridas con los mismos pedidos y planilla.
const entradasExcel = conLineas.map((c) => ({
  flete: 0,
  lineas: cotizables(c).map((x) => entradaExcel(x.producto, x.cantidad, margenProducto(x.producto, reglas))),
}));
const huella = createHash('sha256')
  .update(JSON.stringify(entradasExcel))
  .update(await readFile(planilla))
  .digest('hex')
  .slice(0, 16);
const cache = join(salida, `excel-${huella}.json`);
const resultadosExcel: ResultadoExcel[] = await readFile(cache, 'utf8')
  .then((t) => JSON.parse(t) as ResultadoExcel[])
  .catch(async () => {
    const r = await recalcularEnExcel(planilla, entradasExcel, (n) => console.log(`  excel ${n}/${conLineas.length}`));
    await mkdir(salida, { recursive: true });
    await writeFile(cache, JSON.stringify(r));
    return r;
  });
const excelDe = new Map(conLineas.map((c, i) => [c.id, resultadosExcel[i]]));
if (values['solo-excel']) {
  console.log(`Excel listo para ${conLineas.length} cotizaciones: ${cache}`);
  process.exit(0);
}

// ---------- Fase 2: la plataforma ----------
const clave = leerClaveCommandCode();
if (!clave) throw new Error('Falta la clave de CommandCode (Ajustes o CMD_API_KEY; corre con --env-file=.env.local).');
const modeloIA = values.modelo ?? leerAjustesIA().commandcode.modelo;
if (values.anclaje && values.anclaje !== 'corregir' && values.anclaje !== 'avisar')
  throw new Error(`--anclaje: «${values.anclaje}» no es corregir ni avisar.`);
const anclaje = (values.anclaje as ModoAnclaje | undefined) ?? new CommandCodeLLM(modeloIA, clave).anclaje;
const catalogoVivo = await cargarCatalogo();
interface Plataforma {
  cotizacion: Cotizacion | null;
  respuestas: string[];
  /** Milisegundos de cada respuesta de la plataforma (IA + anclaje + resolución), incluso las que fallan. */
  tiempos: number[];
  /** Veces que el proveedor respondió «límite» o «no disponible» y se reintentó tras esperar. */
  reintentos: number;
  /** Avisos que mostró el chat en toda la conversación, con su origen. */
  avisos: DiagnosticoTurno['avisos'];
  error?: string;
}
async function enPlataforma(caso: Caso): Promise<Plataforma> {
  const dir = await mkdtemp(join(tmpdir(), 'neltume-paridad-'));
  const almacen = new Almacen(dir);
  const respuestas: string[] = [];
  const tiempos: number[] = [];
  let reintentos = 0;
  const avisos: DiagnosticoTurno['avisos'] = [];
  let q: Cotizacion | null = null;
  try {
    guardarConfiguracionNegocio(negocio, almacen.baseDatos());
    const servicio = new Servicio(catalogoVivo, new CommandCodeLLM(modeloIA, clave, { anclaje }), almacen, null, (d) =>
      avisos.push(...d.avisos),
    );
    // Mientras no hay borrador, el intercambio previo viaja como contexto, igual que en la interfaz.
    let charla: Mensaje[] = [];
    for (const mensaje of caso.mensajes) {
      // Un límite del proveedor se reintenta tras esperar, como haría la persona; solo se mide el intento final.
      let r: Awaited<ReturnType<Servicio['ejecutar']>> | null = null;
      for (let intento = 0; !r; intento++) {
        const t0 = performance.now();
        try {
          r = await servicio.ejecutar(
            q
              ? { tipo: 'chat', id: q.id, actualizada: q.actualizada, mensaje }
              : { tipo: 'chat', mensaje, nuevoId: randomUUID(), contexto: charla },
          );
          tiempos.push(performance.now() - t0);
        } catch (e) {
          const limite = e instanceof ErrorIA && ['ia_limite', 'ia_no_disponible'].includes(e.codigo);
          if (!limite || intento >= 5) {
            tiempos.push(performance.now() - t0);
            throw e;
          }
          reintentos++;
          await new Promise((listo) => setTimeout(listo, 15_000 * (intento + 1)));
        }
      }
      respuestas.push(r.cotizacion.historial.at(-1)?.texto ?? '');
      if (r.efimera) charla = sumarCharla(charla, r.cotizacion.historial);
      else q = r.cotizacion;
    }
    return { cotizacion: q, respuestas, tiempos, reintentos, avisos };
  } catch (e) {
    return { cotizacion: q, respuestas, tiempos, reintentos, avisos, error: e instanceof Error ? e.message : String(e) };
  } finally {
    cerrarAlmacen(join(dir, 'cotizador.sqlite'));
    await rm(dir, { recursive: true, force: true });
  }
}
async function enParalelo<T, R>(lista: T[], limite: number, f: (x: T) => Promise<R>, avance: (n: number) => void) {
  const out: R[] = new Array(lista.length);
  let siguiente = 0,
    hechos = 0;
  await Promise.all(
    Array.from({ length: Math.min(limite, lista.length) }, async () => {
      while (siguiente < lista.length) {
        const i = siguiente++;
        out[i] = await f(lista[i]);
        avance(++hechos);
      }
    }),
  );
  return out;
}
console.log(`${casos.length} conversaciones con ${modeloIA}, anclaje ${anclaje} (semilla ${values.semilla}).`);
const inicio = Date.now();
const plataforma = await enParalelo(casos, Number(values.paralelo) || 1, enPlataforma, (n) => {
  if (n % 10 === 0 || n === casos.length)
    console.log(`  plataforma ${n}/${casos.length} · ${Math.round((Date.now() - inicio) / 1000)} s`);
});

const tiempoPlataforma = (Date.now() - inicio) / 1000;


// ---------- Comparación ----------
type Tipo =
  | 'error_plataforma'
  | 'producto_distinto'
  | 'cantidad_distinta'
  | 'cotizo_lo_que_debia_preguntar'
  | 'item_perdido'
  | 'monto'
  | 'excel_sin_precio'
  | 'pregunto_lo_que_ya_estaba';
const GRAVES: Tipo[] = ['error_plataforma', 'producto_distinto', 'cantidad_distinta', 'cotizo_lo_que_debia_preguntar', 'item_perdido', 'monto'];
interface Hallazgo {
  caso: number;
  tipo: Tipo;
  detalle: string;
}
interface Detalle {
  caso: number;
  escenario: string;
  mensajes: string[];
  esperado: string[];
  plataforma: { codigo: string; cantidad: number; unitario: number; total: number }[];
  pendientes: string[];
  respuestas: string[];
  /** Avisos que piden revisar el pedido (sin los informativos). */
  avisos: string[];
  montosApp: Pick<Montos, 'subtotal' | 'descuento' | 'neto' | 'iva' | 'total'> | null;
  excel: { subtotal: number; iva: number; total: number } | null;
  resultado: 'ok' | 'leve' | 'grave';
}
/** Avisos que piden revisar el pedido; los `otros` (flete neto, precio de catálogo…) solo informan. */
const revision = (p: Plataforma) => p.avisos.filter((a) => a.categoria !== 'otros');
const hallazgos: Hallazgo[] = [];
const detalles: Detalle[] = [];
const stats = { comparados: 0, netoAPesos: 0, totalAPesos: 0, maxDifTotal: 0 };

function comparar(caso: Caso, app: Plataforma, ex: ResultadoExcel | undefined) {
  const antes = hallazgos.length;
  const h = (tipo: Tipo, detalle: string) => hallazgos.push({ caso: caso.id, tipo, detalle });
  const q = app.cotizacion;
  const m = q?.montos;
  const lineas = m?.lineas ?? [];
  const pendientes = q?.incompletos ?? [];
  const esperadas = cotizables(caso);
  const preguntas = caso.items.filter((i) => i.tipo === 'pregunta').length;
  ex?.filas.forEach((f, i) => {
    if (typeof f.unitario !== 'number') h('excel_sin_precio', `${esperadas[i].producto.codigo}: Excel ${String(f.codigo)}`);
  });
  if (app.error) h('error_plataforma', app.error);
  // Se empareja por producto: el orden de las líneas no cambia el monto.
  const libres = [...lineas];
  const faltan: typeof esperadas = [];
  let montosComparables = true;
  esperadas.forEach((e) => {
    const j = libres.findIndex((l) => l.producto.codigo === e.producto.codigo);
    if (j < 0) return void faltan.push(e);
    const l = libres.splice(j, 1)[0];
    if (l.cantidad !== e.cantidad) {
      h('cantidad_distinta', `«${e.frase}»: esperado ${e.cantidad} × ${e.producto.codigo}, plataforma ${l.cantidad}`);
      montosComparables = false;
    }
  });
  // La IA también puede preguntar directamente en el chat, sin dejar el ítem guardado como pendiente.
  const preguntoEnChat = /¿[^?]+\?/.test(app.respuestas.at(-1) ?? '');
  let pendientesLibres = pendientes.length;
  for (const e of faltan) {
    montosComparables = false;
    if (libres.length) {
      const l = libres.shift()!;
      h('producto_distinto', `«${e.frase}»: esperado ${e.cantidad} × ${e.producto.codigo}, plataforma ${l.cantidad} × ${l.producto.codigo}`);
    } else if (pendientesLibres > 0) {
      pendientesLibres--;
      h('pregunto_lo_que_ya_estaba', `«${e.frase}» (${e.producto.codigo}) quedó pendiente: ${pendientes.map((p) => `«${p.pregunta}»`).join(' ')}`);
    } else if (preguntoEnChat)
      h('pregunto_lo_que_ya_estaba', `«${e.frase}» (${e.producto.codigo}) no se cotizó; la IA preguntó en el chat`);
    else h('item_perdido', `«${e.frase}» (${e.producto.codigo}) no se cotizó ni quedó pendiente`);
  }
  for (const l of libres) {
    montosComparables = false;
    h('cotizo_lo_que_debia_preguntar', `cotizó ${l.cantidad} × ${l.producto.codigo} sin que el pedido lo justificara`);
  }
  if (preguntas > pendientesLibres && !libres.length && !preguntoEnChat)
    h('item_perdido', `se esperaban ${preguntas} ítem(s) pendiente(s) con pregunta y quedaron ${pendientesLibres}`);
  if (ex && m && montosComparables && !app.error) {
    const tolerancia = esperadas.reduce((s, x) => s + x.cantidad * 0.5, 0);
    stats.comparados++;
    if (m.neto === Math.round(ex.subtotal)) stats.netoAPesos++;
    if (m.total === Math.round(ex.total)) stats.totalAPesos++;
    stats.maxDifTotal = Math.max(stats.maxDifTotal, Math.abs(m.total - ex.total));
    lineas.forEach((l) => {
      const i = esperadas.findIndex((e) => e.producto.codigo === l.producto.codigo);
      const f = ex.filas[i];
      if (typeof f?.unitario === 'number' && l.precioUnitario !== Math.round(f.unitario))
        h('monto', `${l.producto.codigo}: unitario plataforma ${l.precioUnitario}, Excel ${f.unitario}`);
    });
    if (Math.abs(m.neto - ex.subtotal) > tolerancia + 1e-6) h('monto', `neto plataforma ${m.neto}, Excel ${ex.subtotal}`);
    if (Math.abs(m.total - ex.total) > tolerancia * 1.19 + 0.5 + 1e-6) h('monto', `total plataforma ${m.total}, Excel ${ex.total}`);
  }
  const propios = hallazgos.slice(antes);
  detalles.push({
    caso: caso.id,
    escenario: caso.escenario,
    mensajes: caso.mensajes,
    esperado: caso.items.map((i) => (i.tipo === 'cotiza' ? `${i.cantidad} × ${i.producto.codigo}` : `pregunta (${i.motivo})`)),
    plataforma: lineas.map((l) => ({ codigo: l.producto.codigo, cantidad: l.cantidad, unitario: l.precioUnitario, total: l.total })),
    pendientes: pendientes.map((p) => p.pregunta),
    respuestas: app.respuestas,
    avisos: revision(app).map((a) => `[${a.categoria}] ${a.texto}`),
    montosApp: m ? { subtotal: m.subtotal, descuento: m.descuento, neto: m.neto, iva: m.iva, total: m.total } : null,
    excel: ex ? { subtotal: ex.subtotal, iva: ex.iva, total: ex.total } : null,
    resultado: propios.some((x) => GRAVES.includes(x.tipo)) ? 'grave' : propios.some((x) => x.tipo === 'pregunto_lo_que_ya_estaba') ? 'leve' : 'ok',
  });
}
casos.forEach((c, i) => comparar(c, plataforma[i], excelDe.get(c.id)));

// ---------- Reporte ----------
// Avisos que piden revisar el pedido: en una conversación correcta son falsas alarmas; en una grave, el error
// quedó a la vista. Una grave sin aviso es silenciosa.
const correctasConAviso = detalles.filter((d) => d.resultado === 'ok' && d.avisos.length);
const gravesD = detalles.filter((d) => d.resultado === 'grave');
const gravesSilenciosos = gravesD.filter((d) => !d.avisos.length).length;
const conCategoria = (c: string) => plataforma.filter((p) => p.avisos.some((a) => a.categoria === c)).length;
const falsasPorCategoria = Object.fromEntries(
  ['campo', 'palabra', 'cifras', 'nombres', 'noRegistre', 'responder'].map((c) => [
    c,
    correctasConAviso.filter((d) => d.avisos.some((a) => a.startsWith(`[${c}]`))).length,
  ]),
);
const pct = (n: number, d: number) => `${((100 * n) / Math.max(d, 1)).toFixed(1)} %`;
const porEscenario = new Map<string, Detalle[]>();
for (const d of detalles) porEscenario.set(d.escenario, [...(porEscenario.get(d.escenario) ?? []), d]);
const porTipo = new Map<Tipo, number>();
for (const x of hallazgos) porTipo.set(x.tipo, (porTipo.get(x.tipo) ?? 0) + 1);
const cuenta = (ds: Detalle[], r: Detalle['resultado']) => ds.filter((d) => d.resultado === r).length;
const fallidos = detalles.filter((d) => d.resultado !== 'ok');
const tarifa = await obtenerCatalogoCommandCode()
  .then((c) => c.modelos.find((m) => m.id === modeloIA) ?? null)
  .catch(() => null);
const costo =
  tarifa?.precioEntrada != null && tarifa.precioSalida != null
    ? (consumo.entrada * tarifa.precioEntrada + consumo.salida * tarifa.precioSalida) / 1e6
    : null;
const mensajesEnviados = casos.reduce((s, c) => s + c.mensajes.length, 0);
const lineaConsumo = `- Consumo CommandCode: ${consumo.llamadas} llamadas para ${mensajesEnviados} mensajes · ${consumo.entrada.toLocaleString('es-CL')} tokens de entrada (${pct(consumo.cacheados, consumo.entrada)} en caché) + ${consumo.salida.toLocaleString('es-CL')} de salida${consumo.sinUso ? ` (${consumo.sinUso} respuestas sin uso informado)` : ''} · ${
  costo === null
    ? 'tarifa no disponible'
    : `costo ≈ US$ ${costo.toFixed(4)} (US$ ${tarifa!.precioEntrada} entrada / US$ ${tarifa!.precioSalida} salida por millón)`
}`;
const tiempos = plataforma.flatMap((p) => p.tiempos).sort((a, b) => a - b);
const percentil = (q: number) => (tiempos.length ? tiempos[Math.min(tiempos.length - 1, Math.floor(q * tiempos.length))] : 0);
const promedio = tiempos.reduce((s, t) => s + t, 0) / Math.max(tiempos.length, 1);
const seg = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const lineaTiempo = `- Tiempo: ${tiempoPlataforma.toFixed(0)} s en total (${values.paralelo} en paralelo) · por respuesta: promedio ${seg(promedio)}, mediana ${seg(percentil(0.5))}, p95 ${seg(percentil(0.95))}, máximo ${seg(tiempos.at(-1) ?? 0)} · reintentos por límite del proveedor: ${plataforma.reduce((s, p) => s + p.reintentos, 0)}`;
const reporte = [
  '# Paridad de punta a punta: plataforma (IA + cálculo) ↔ Excel',
  '',
  `Modelo ${modeloIA} · anclaje ${anclaje} · semilla ${values.semilla} · ${new Date().toISOString()}`,
  `Reglas de Ajustes: márgenes ${JSON.stringify(reglas.margenes)} · tramos de descuento ${reglas.descuentosPorCantidad?.length ?? 0}`,
  '',
  `- Conversaciones: ${casos.length} · correctas ${cuenta(detalles, 'ok')} (${pct(cuenta(detalles, 'ok'), casos.length)}) · leves ${cuenta(detalles, 'leve')} · graves ${cuenta(detalles, 'grave')}`,
  `- Avisos: falsas alarmas en ${correctasConAviso.length} de ${cuenta(detalles, 'ok')} correctas (${pct(correctasConAviso.length, cuenta(detalles, 'ok'))}) · graves avisadas ${gravesD.length - gravesSilenciosos}/${gravesD.length} · «No registré» en ${conCategoria('noRegistre')} y «respondió en vez de registrar» en ${conCategoria('responder')} conversaciones`,
  lineaConsumo,
  lineaTiempo,
  `- Montos comparados con Excel: ${stats.comparados} · neto igual al peso ${pct(stats.netoAPesos, stats.comparados)} · total igual al peso ${pct(stats.totalAPesos, stats.comparados)} · diferencia máxima de total ${stats.maxDifTotal.toFixed(2)} (redondeo del unitario)`,
  '',
  '| Escenario | Casos | OK | Leves | Graves |',
  '|---|---:|---:|---:|---:|',
  ...[...porEscenario].sort().map(([e, ds]) => `| ${e} | ${ds.length} | ${cuenta(ds, 'ok')} | ${cuenta(ds, 'leve')} | ${cuenta(ds, 'grave')} |`),
  '',
  '| Hallazgo | Cantidad |',
  '|---|---:|',
  ...[...porTipo].map(([t, n]) => `| ${t}${GRAVES.includes(t) ? ' (grave)' : ''} | ${n} |`),
  '',
  '## Conversaciones con hallazgos',
  '',
  ...fallidos
    .sort((a, b) => (a.resultado === b.resultado ? a.caso - b.caso : a.resultado === 'grave' ? -1 : 1))
    .flatMap((d) => [
      `### Caso ${d.caso} · ${d.escenario} · ${d.resultado}`,
      '',
      '```',
      d.mensajes.join('\n// '),
      '```',
      '',
      `- Esperado: ${d.esperado.join(', ')}`,
      `- Plataforma: ${d.plataforma.map((e) => `${e.cantidad} × ${e.codigo}`).join(', ') || '(ninguno)'}${d.pendientes.length ? ` · pendientes: ${d.pendientes.join(' | ')}` : ''}`,
      ...hallazgos.filter((x) => x.caso === d.caso).map((x) => `- ${x.tipo}: ${x.detalle}`),
      ...d.avisos.map((a) => `- aviso ${a}`),
      `- Respuesta: ${(d.respuestas.at(-1) ?? '').replace(/\n+/g, ' ').slice(0, 300)}`,
      '',
    ]),
].join('\n');
await mkdir(salida, { recursive: true });
const sufijo = `${modeloIA.replace(/[^\w.-]+/g, '_')}-${anclaje}-s${values.semilla}${values.ids ? '-ids' : ''}`;
await writeFile(join(salida, `reporte-ia-${sufijo}.md`), reporte);
await writeFile(join(salida, `casos-ia-${sufijo}.json`), JSON.stringify(detalles, null, 2));
// Resumen por modelo, para comparar corridas.
await writeFile(
  join(salida, `resumen-${sufijo}.json`),
  JSON.stringify(
    {
      modelo: modeloIA,
      anclaje,
      semilla: values.semilla,
      conversaciones: casos.length,
      correctas: cuenta(detalles, 'ok'),
      leves: cuenta(detalles, 'leve'),
      graves: cuenta(detalles, 'grave'),
      errores: plataforma.filter((p) => p.error).length,
      porEscenario: Object.fromEntries([...porEscenario].map(([e, ds]) => [e, { casos: ds.length, ok: cuenta(ds, 'ok') }])),
      tiempoTotalSeg: tiempoPlataforma,
      paralelo: Number(values.paralelo),
      respuestas: tiempos.length,
      msPromedio: promedio,
      msMediana: percentil(0.5),
      msP95: percentil(0.95),
      msMaximo: tiempos.at(-1) ?? 0,
      reintentos: plataforma.reduce((s, p) => s + p.reintentos, 0),
      costoUSD: costo,
      falsasAlarmas: correctasConAviso.length,
      falsasPorCategoria,
      gravesAvisados: gravesD.length - gravesSilenciosos,
      gravesSilenciosos,
      conversacionesNoRegistre: conCategoria('noRegistre'),
      conversacionesResponder: conCategoria('responder'),
    },
    null,
    2,
  ),
);
console.log(`\n${reporte}\n\nDetalle: ${join(salida, `casos-ia-${sufijo}.json`)}`);
process.exitCode = detalles.some((d) => d.resultado === 'grave') ? 1 : 0;

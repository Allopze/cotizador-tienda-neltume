// Feriados nacionales de Chile (irrenunciables y legales de aplicación general) para contar días
// hábiles. Los feriados regionales no se incluyen. Las reglas legales se calculan aquí y funcionan sin
// conexión; los decretados por única vez (leyes puntuales, elecciones) llegan por la sincronización
// del servidor (src/servidor/feriados-sync.ts), que los registra con `registrarFeriadosExternos`.

const iso = (a: number, m: number, d: number) =>
  `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const diaSemana = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d)).getUTCDay();
const desplazar = (a: number, m: number, d: number, dias: number) => {
  const f = new Date(Date.UTC(a, m - 1, d + dias));
  return iso(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate());
};

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher, calendario gregoriano). */
function pascua(a: number) {
  const x = a % 19,
    b = Math.floor(a / 100),
    c = a % 100,
    d = Math.floor(b / 4),
    e = b % 4,
    f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3),
    h = (19 * x + b - d - g + 15) % 30,
    i = Math.floor(c / 4),
    k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.floor((x + 11 * h + 22 * l) / 451),
    mes = Math.floor((h + l - 7 * m + 114) / 31),
    dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
}

// Términos periódicos de Meeus (tabla 27.C) para la hora exacta del solsticio.
const TERMINOS: [number, number, number][] = [
  [485, 324.96, 1934.136],
  [203, 337.23, 32964.467],
  [199, 342.08, 20.186],
  [182, 27.85, 445267.112],
  [156, 73.14, 45036.886],
  [136, 171.52, 22518.443],
  [77, 222.54, 65928.934],
  [74, 296.72, 3034.906],
  [70, 243.58, 9037.513],
  [58, 119.81, 33718.147],
  [52, 297.17, 150.678],
  [50, 21.02, 2281.226],
  [45, 247.54, 29929.562],
  [44, 325.15, 31555.956],
  [29, 60.93, 4443.417],
  [18, 155.12, 67555.328],
  [17, 288.79, 4562.452],
  [16, 198.04, 62894.029],
  [14, 199.76, 31436.921],
  [12, 95.39, 14577.848],
  [12, 287.11, 31931.756],
  [12, 320.81, 34777.259],
  [9, 227.73, 1222.114],
  [8, 15.45, 16859.074],
];
const rad = (g: number) => (g * Math.PI) / 180;

/**
 * Día de los Pueblos Indígenas (Ley 21.357): el día del solsticio de invierno en Chile continental.
 * Se calcula con el algoritmo de Meeus (error de pocos minutos) y se lleva a la hora de Santiago.
 */
function solsticioInvierno(a: number) {
  const y = (a - 2000) / 1000;
  const jde0 = 2451716.56767 + 365241.62603 * y + 0.00325 * y ** 2 + 0.00888 * y ** 3 - 0.0003 * y ** 4;
  const t = (jde0 - 2451545) / 36525;
  const w = rad(35999.373 * t - 2.47);
  const dl = 1 + 0.0334 * Math.cos(w) + 0.0007 * Math.cos(2 * w);
  const s = TERMINOS.reduce((suma, [A, B, C]) => suma + A * Math.cos(rad(B + C * t)), 0);
  const jde = jde0 + (0.00001 * s) / dl;
  // Tiempo terrestre → UTC: ΔT ≈ 70 s en este siglo.
  const ms = (jde - 2440587.5) * 86_400_000 - 70_000;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/**
 * Ley 19.668 (29 de junio y 12 de octubre): si cae martes, miércoles o jueves se traslada al lunes de
 * esa semana; si cae viernes, al lunes siguiente.
 */
function trasladable(a: number, m: number, d: number) {
  const dia = diaSemana(a, m, d);
  if (dia >= 2 && dia <= 4) return desplazar(a, m, d, 1 - dia);
  if (dia === 5) return desplazar(a, m, d, 3);
  return iso(a, m, d);
}

const cache = new Map<number, Set<string>>();

export function feriadosDelAnio(a: number): Set<string> {
  const guardado = cache.get(a);
  if (guardado) return guardado;
  const p = pascua(a);
  const fechas = [
    iso(a, 1, 1),
    desplazar(a, p.mes, p.dia, -2), // Viernes Santo
    desplazar(a, p.mes, p.dia, -1), // Sábado Santo
    iso(a, 5, 1),
    iso(a, 5, 21),
    iso(a, 7, 16),
    iso(a, 8, 15),
    iso(a, 9, 18),
    iso(a, 9, 19),
    iso(a, 11, 1),
    iso(a, 12, 8),
    iso(a, 12, 25),
    trasladable(a, 6, 29),
    trasladable(a, 10, 12),
  ];
  // La ley fijó el 21 de junio para 2021; desde 2022 es el día del solsticio.
  if (a === 2021) fechas.push(iso(a, 6, 21));
  else if (a > 2021) fechas.push(solsticioInvierno(a));
  // Ley 20.983: 2 de enero cuando es lunes.
  if (diaSemana(a, 1, 2) === 1) fechas.push(iso(a, 1, 2));
  // Ley 20.215: 17 de septiembre si es lunes y 20 de septiembre si es viernes.
  if (diaSemana(a, 9, 17) === 1) fechas.push(iso(a, 9, 17));
  if (diaSemana(a, 9, 20) === 5) fechas.push(iso(a, 9, 20));
  // Ley 20.299: Día de las Iglesias Evangélicas; martes → viernes 27, miércoles → viernes 2 de noviembre.
  const evangelico = diaSemana(a, 10, 31);
  fechas.push(evangelico === 2 ? iso(a, 10, 27) : evangelico === 3 ? iso(a, 11, 2) : iso(a, 10, 31));
  const conjunto = new Set(fechas);
  cache.set(a, conjunto);
  return conjunto;
}

/** Feriados obtenidos de la fuente externa; se suman a los calculados, nunca los reemplazan. */
let externos = new Set<string>();

export function registrarFeriadosExternos(fechas: Iterable<string>) {
  externos = new Set([...fechas].filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)));
}

/** ¿La fecha (YYYY-MM-DD) es feriado nacional, calculado o sincronizado? */
export function esFeriado(fecha: string) {
  return feriadosDelAnio(Number(fecha.slice(0, 4))).has(fecha) || externos.has(fecha);
}

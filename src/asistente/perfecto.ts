// «IA perfecta»: doble de pruebas que responde, para un caso de evals/cotizacion.json, exactamente la lectura
// esperada. No se selecciona desde la aplicación; lo usan `npm run evaluar:ia -- --ia-perfecta` y
// tests/ia-perfecta.test.ts para revisar sin gasto el camino completo de la evaluación (servicio, anclaje en
// «avisar», avisos, pendientes, puntaje e informe). Con una IA que no se equivoca, todo lo que no sea 100 % y cero
// falsas alarmas lo pone el servidor, no el modelo.
//
// Declara `verificarCifras` como el cliente real, para que el servidor ancle cifras y nombres igual que con un
// modelo de verdad. En los casos de varios mensajes, la lectura de los turnos anteriores al último está escrita
// abajo (`INTERMEDIAS`): los casos solo traen el pedido final.
import type { CasoEvaluacion } from './evaluacion';
import type { ContextoLLM, LLM, ModoAnclaje } from './llm';

type Esperado = CasoEvaluacion['esperado'];
type ItemEsperado = Esperado['items'][number];
/** Lectura de un turno: los ítems de la cotización tras el mensaje y, si los hay, cliente y flete. */
export type Lectura = Pick<Esperado, 'items' | 'cliente' | 'flete'>;

const item = (i: ItemEsperado, cambios: Partial<ItemEsperado>): ItemEsperado => ({ ...i, ...cambios });
const sinDescuento = (i: ItemEsperado) => item(i, { descuento: undefined });

/**
 * Lectura de cada turno anterior al último, por caso, calculada desde el pedido final. Un caso de varios mensajes
 * sin entrada aquí no se puede simular (la IA perfecta lanza un error y la corrida cuenta como fallida).
 */
export const INTERMEDIAS: Record<string, (final: Esperado) => Lectura[]> = {
  'completa-madera': ({ items: [a] }) => [{ items: [item(a, { madera: null })] }],
  'cambia-cantidad': ({ items: [a] }) => [{ items: [item(a, { cantidad: 3 })] }],
  'quita-marcos': ({ items: [a] }) => [
    {
      items: [a, { modelo: 'MARCO', madera: 'LENGA', ancho: null, alto: 2, medida: '2X4', cantidad: 4 }],
    },
  ],
  'agrega-igual': ({ items: [a] }) => [{ items: [a] }],
  'corrige-uno-de-varios': ({ items: [a, b, c] }) => [{ items: [a, item(b, { ancho: 0.8 }), c] }],
  'cambia-madera-todos': ({ items }) => [{ items: items.map((i) => item(i, { madera: 'PINO OREGON' })) }],
  'agrega-cliente-despues': ({ items }) => [{ items }],
  'completa-madera-frase': ({ items: [a] }) => [{ items: [item(a, { madera: null })] }],
  'especial-precio-despues': ({ items: [a] }) => [{ items: [item(a, { precioUnitario: undefined })] }],
  'descuento-despues-un-item': ({ items }) => [{ items: items.map(sinDescuento) }],
  'descuento-monto': ({ items }) => [{ items: items.map(sinDescuento) }],
  'descuento-en-todo': ({ items }) => [{ items: items.map(sinDescuento) }],
  'descuento-palabras': ({ items }) => [{ items: items.map(sinDescuento) }],
  'descuento-quitar': ({ items: [a] }) => [
    { items: [item(a, { descuento: { tipo: 'porcentaje', valor: 10 } })] },
  ],
  'descuento-se-conserva': ({ items: [a] }) => [
    { items: [sinDescuento(item(a, { cantidad: 2 }))] },
    { items: [item(a, { cantidad: 2 })] },
  ],
  'descuento-sin-cifra': ({ items }) => [{ items }],
  'i2-madera-no-fija-alto': ({ items: [a] }) => [{ items: [item(a, { madera: null })] }],
  'i2-alto-no-fija-madera': ({ items: [a] }) => [{ items: [item(a, { alto: null })] }],
  'i6-responde-segundo-pendiente': ({ items: [a, b] }) => [{ items: [a, item(b, { alto: null })] }],
  'fabrica-reparto-despues': ({ items }) => [{ items: items.map((i) => item(i, { fabrica: undefined })) }],
};

type Solicitud = ReturnType<typeof solicitudDe>;
/**
 * Casos en que lo que la IA debe responder no es literalmente lo que queda en la cotización: el servidor lo
 * transforma (un nombre que lleva a otro set del catálogo) o lo declara de otra forma (un total sin valor unitario).
 */
export const SALIDA_IA: Record<string, (items: Solicitud[], mensajes: string[]) => Solicitud[]> = {
  // La IA lo pide en Mara Enchapada, como lo escribió la persona; el sistema lo cotiza con el set finger.
  'paula-lastra-enchapadas': (items) =>
    items.map((s, i) => (i === 1 ? { ...s, madera: 'MARA ENCHAPADA' } : s)),
  // Como pide el prompt: un total de varias unidades va sin valor y con la frase donde está el monto.
  'i7-precio-total': ([s], [mensaje]) => [{ ...s, precio: { valor: null, iva: null }, fuente: mensaje }],
};

function solicitudDe(i: ItemEsperado, conversacion: string) {
  return {
    modelo: i.modelo,
    madera: i.madera,
    ancho: i.ancho,
    alto: i.alto,
    medida: i.medida,
    cantidad: i.cantidad,
    tipoMedida: i.tipoMedida ?? null,
    fuente: null as string | null,
    precio: (i.precioUnitario == null ? null : montoEscrito(i.precioUnitario, conversacion)) as {
      valor: number | null;
      iva: 'neto' | 'incluido' | null;
    } | null,
    descuento: i.descuento ?? null,
    ...(i.fabrica ? { fabrica: i.fabrica } : {}),
  };
}

/** Lectura que la IA perfecta da en el turno `turno` (desde 0) del caso. */
export function lecturaDelTurno(caso: CasoEvaluacion, turno: number): Lectura {
  const ultimo = caso.mensajes.length - 1;
  if (turno >= ultimo) return caso.esperado;
  const intermedias = INTERMEDIAS[caso.id]?.(caso.esperado);
  if (!intermedias?.[turno])
    throw new Error(
      `IA perfecta: falta la lectura del turno ${turno + 1} del caso «${caso.id}» (INTERMEDIAS).`,
    );
  return intermedias[turno];
}

/**
 * Un monto como lo escribiría la persona: neto, salvo que la conversación diga «IVA incluido» o «con IVA»; entonces
 * el valor con IVA (el servidor lo vuelve a neto).
 */
function montoEscrito(neto: number, conversacion: string, iva = 0.19) {
  if (/iva\s+incluido|con\s+(el\s+)?iva/i.test(conversacion))
    return { valor: Math.round(neto * (1 + iva)), iva: 'incluido' as const };
  return { valor: neto, iva: /\biva\b|neto/i.test(conversacion) ? ('neto' as const) : null };
}

export class LLMPerfecto implements LLM {
  readonly verificarCifras = true;
  readonly modeloEfectivo = 'ia-perfecta';
  readonly usoRespaldo = false;
  constructor(
    private readonly caso: CasoEvaluacion,
    readonly anclaje: ModoAnclaje = 'avisar',
  ) {}

  async interpretar(c: ContextoLLM) {
    // El turno es la cantidad de mensajes de la persona que ya pasaron (el historial o el contexto previo).
    const turno = c.historial.filter((m) => m.rol === 'usuario').length;
    const lectura = lecturaDelTurno(this.caso, turno);
    const conversacion = [...this.caso.mensajes.slice(0, turno + 1)].join('\n');
    const ultimo = turno >= this.caso.mensajes.length - 1;
    const ajuste = ultimo ? SALIDA_IA[this.caso.id] : undefined;
    const solicitudes = lectura.items.map((i) => solicitudDe(i, conversacion));
    const items = ajuste ? ajuste(solicitudes, this.caso.mensajes) : solicitudes;
    // Un mensaje que no es un pedido (ni trae cliente ni flete) se contesta con texto, como el modelo.
    if (!lectura.items.length && !lectura.cliente && !lectura.flete && !c.borrador.items.length)
      return { name: 'responder', input: { texto: '¿Qué productos necesitas cotizar?' } };
    const flete = lectura.flete
      ? {
          descripcion: null,
          cantidad: lectura.flete.cantidad,
          ...montoEscrito(lectura.flete.unitario, conversacion),
        }
      : undefined;
    // Sin borrador, o con flete (que solo admite modificar_cotizacion), la lista completa va en `agregar`
    // quitando lo anterior; con borrador, la lista completa con actualizar_cotizacion, como lo haría el modelo.
    if (!c.borrador.items.length || flete)
      return {
        name: 'modificar_cotizacion',
        input: {
          ...(c.borrador.items.length ? { quitar: c.borrador.items.map((i) => i.indice) } : {}),
          agregar: items,
          ...(lectura.cliente ? { cliente: lectura.cliente } : {}),
          ...(flete ? { flete } : {}),
        },
      };
    return {
      name: 'actualizar_cotizacion',
      input: {
        items,
        cliente: { ...c.borrador.cliente, ...lectura.cliente },
      },
    };
  }
}

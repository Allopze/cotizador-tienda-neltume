/**
 * Opciones de la petición al modelo que algunos proveedores no aceptan. Se piden todas y, si el proveedor
 * rechaza una con un 400 que la nombra, se repite sin ella: así un modelo nuevo funciona sin configurarlo.
 */
export interface OpcionesPeticion {
  /** temperature 0: la misma frase da siempre la misma lectura. */
  temperatura: boolean;
  /** Obliga a llamar una herramienta («required» o «any»); sin ella, «auto» y el prompt la exigen. */
  herramientaForzada: boolean;
}
const OPCIONES_COMPLETAS: OpcionesPeticion = { temperatura: true, herramientaForzada: true };

/** Qué opción quitar según el texto de un rechazo 400; null si el rechazo es por otra causa. */
function opcionRechazada(texto: string, opciones: OpcionesPeticion): keyof OpcionesPeticion | null {
  if (opciones.herramientaForzada && /tool_choice/i.test(texto)) return 'herramientaForzada';
  if (opciones.temperatura && /temperature/i.test(texto)) return 'temperatura';
  return null;
}

/**
 * Pide con todas las opciones y quita, una por vez, las que el proveedor rechace (como máximo una petición
 * por opción, más la última). `textoRechazo` recibe la respuesta o el error y devuelve el texto de un 400,
 * o null si no lo es: el camino Chat Completions devuelve la respuesta y el SDK de Anthropic lanza.
 */
export async function negociar<T>(
  pedir: (opciones: OpcionesPeticion) => Promise<T>,
  textoRechazo: (respuesta: T | undefined, error: unknown) => Promise<string | null>,
): Promise<T> {
  let opciones = { ...OPCIONES_COMPLETAS };
  for (;;) {
    let respuesta: T | undefined,
      error: unknown,
      fallo = false;
    try {
      respuesta = await pedir(opciones);
    } catch (e) {
      error = e;
      fallo = true;
    }
    const texto = await textoRechazo(respuesta, error);
    const quitar = texto === null ? null : opcionRechazada(texto, opciones);
    if (!quitar) {
      if (fallo) throw error;
      return respuesta as T;
    }
    opciones = { ...opciones, [quitar]: false };
  }
}

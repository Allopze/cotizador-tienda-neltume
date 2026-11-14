// Qué se le dice a la persona cuando la hoja de compartir del teléfono no termina. Sin React: se prueba en
// tests/pantalla-cuentas-compartir.test.ts; el flujo completo, en tests/movil.e2e.ts.

export type FalloCompartir =
  /** La persona cerró la hoja: no se avisa nada. */
  | { tipo: 'nada' }
  /** El PDF quedó listo, pero su descarga consumió el toque: se ofrece «Compartir» de nuevo. */
  | { tipo: 'otro_toque'; texto: string }
  /** No se pudo compartir: se explica qué hacer. */
  | { tipo: 'error'; texto: string };

/**
 * `listo` dice si el PDF ya estaba descargado al tocar «Compartir». AbortError: la persona cerró la hoja.
 * NotAllowedError con un PDF recién descargado: el navegador pide un toque reciente y la descarga lo consumió, así que
 * se ofrece otro. Un segundo rechazo con el PDF ya listo, u otro error, explica que lo descargue y lo envíe.
 */
export function falloCompartir(error: unknown, listo: boolean): FalloCompartir {
  const nombre = error instanceof DOMException ? error.name : '';
  if (nombre === 'AbortError') return { tipo: 'nada' };
  if (nombre === 'NotAllowedError' && !listo) return { tipo: 'otro_toque', texto: 'El PDF está listo para compartir.' };
  return { tipo: 'error', texto: 'No se pudo compartir el PDF. Descárgalo y envíalo desde tus archivos.' };
}

/** Copia texto plano al portapapeles usando Clipboard API o un respaldo seguro en el DOM. */
export async function copiarTexto(texto: string): Promise<boolean> {
  if (!texto) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Reintentar con selección temporal si el navegador restringe Clipboard API fuera de HTTPS.
  }
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = texto;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

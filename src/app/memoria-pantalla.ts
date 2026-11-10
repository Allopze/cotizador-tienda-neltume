'use client';
import { useEffect, useRef, useSyncExternalStore } from 'react';

// Memoria por pestaña de cada pantalla (scroll, filtros, búsqueda): al ir de una pantalla a otra y volver,
// el usuario sigue donde estaba. Vive en sessionStorage; si está bloqueado, cada pantalla parte en blanco.
const PREFIJO = 'neltume:pantalla:';

export function leerSesion<T>(clave: string, porOmision: T): T {
  try {
    const crudo = sessionStorage.getItem(PREFIJO + clave);
    return crudo ? (JSON.parse(crudo) as T) : porOmision;
  } catch {
    return porOmision;
  }
}
export function guardarSesion(clave: string, valor: unknown) {
  try {
    sessionStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
  } catch {
    // Almacenamiento lleno o bloqueado: la memoria solo dura mientras la pantalla está abierta.
  }
}

const sinSuscripcion = () => () => {};
/**
 * `false` en el servidor y durante la hidratación, `true` después. Lo que lee sessionStorage en su estado
 * inicial se monta recién entonces: así el HTML del servidor y el primer render del cliente coinciden.
 */
export function useEsCliente() {
  return useSyncExternalStore(
    sinSuscripcion,
    () => true,
    () => false,
  );
}

/**
 * Guarda el scroll de la ventana mientras la pantalla está abierta y lo restaura al volver, cuando `listo`
 * (el contenido ya tiene su alto). Los enlaces internos usan `scroll={false}`: sin posición guardada se
 * parte arriba, en vez de heredar el scroll de la pantalla anterior. Con `restaurar` en falso solo guarda
 * (la pantalla lleva la vista a otro lugar, p. ej. a una cotización abierta desde el historial).
 */
export function useScrollRecordado(clave: string, listo: boolean, restaurar = true) {
  // Next oculta la pantalla anterior en vez de desmontarla al instante: mientras cambia, el documento se
  // achica, el navegador baja el scroll a 0 y ese 0 no debe guardarse. Por eso la posición se congela al
  // empezar a salir (clic en un enlace interno o antesDeNavegar) y se ignora lo que ocurra después.
  const saliendo = useRef(false);
  useEffect(() => {
    if (!listo) return;
    saliendo.current = false;
    // Se restaura cada vez que la pantalla se muestra, también si Next la conservó oculta con su estado.
    // Mientras la pantalla termina de aparecer el documento puede ser más corto que la posición guardada:
    // se reintenta cuadro a cuadro (hasta 1,5 s) y se desiste si el usuario se mueve antes.
    let restaurando = 0;
    const desistir = () => cancelAnimationFrame(restaurando);
    if (restaurar) {
      const y = leerSesion<number>(`scroll:${clave}`, 0);
      const hasta = performance.now() + 1500;
      const intentar = () => {
        window.scrollTo({ top: y, behavior: 'instant' });
        if (Math.abs(window.scrollY - y) > 1 && performance.now() < hasta)
          restaurando = requestAnimationFrame(intentar);
      };
      restaurando = requestAnimationFrame(intentar);
      window.addEventListener('wheel', desistir, { passive: true, once: true });
      window.addEventListener('touchstart', desistir, { passive: true, once: true });
      window.addEventListener('keydown', desistir, { once: true });
    }
    let pendiente = 0;
    const claveScroll = `scroll:${clave}`;
    const guardar = () => {
      if (saliendo.current) return;
      cancelAnimationFrame(pendiente);
      pendiente = requestAnimationFrame(() => {
        if (!saliendo.current) guardarSesion(claveScroll, Math.round(window.scrollY));
      });
    };
    const congelar = () => {
      if (saliendo.current) return;
      cancelAnimationFrame(pendiente);
      guardarSesion(claveScroll, Math.round(window.scrollY));
      saliendo.current = true;
    };
    // Fase de captura: corre antes que el enrutador de Next procese el clic.
    // Solo cuenta salir a otra pantalla: no otra sección de la misma (?seccion=…), ni una pestaña nueva
    // (PDF, clic con Ctrl/⌘), ni un recurso de la API.
    const alClic = (e: MouseEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const enlace = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!enlace || enlace.target === '_blank') return;
      const destino = new URL(enlace.href, location.href);
      if (
        destino.origin === location.origin &&
        destino.pathname !== location.pathname &&
        !destino.pathname.startsWith('/api/')
      )
        congelar();
    };
    window.addEventListener('scroll', guardar, { passive: true });
    document.addEventListener('click', alClic, true);
    window.addEventListener(EVENTO_SALIDA, congelar);
    return () => {
      desistir();
      window.removeEventListener('wheel', desistir);
      window.removeEventListener('touchstart', desistir);
      window.removeEventListener('keydown', desistir);
      cancelAnimationFrame(pendiente);
      window.removeEventListener('scroll', guardar);
      document.removeEventListener('click', alClic, true);
      window.removeEventListener(EVENTO_SALIDA, congelar);
    };
  }, [clave, listo, restaurar]);
}

const EVENTO_SALIDA = 'neltume:antes-de-navegar';
/** Llamar antes de un router.push: congela el scroll de la pantalla actual, como un clic en un enlace. */
export function antesDeNavegar() {
  window.dispatchEvent(new Event(EVENTO_SALIDA));
}

// Preferencias de quien usa este navegador (no de la cotización): sobreviven a recargar y cerrar la pestaña.
const PREFIJO_LOCAL = 'neltume:preferencia:';
const EVENTO_PREFERENCIA = 'neltume:preferencia';
const suscribirPreferencia = (avisar: () => void) => {
  window.addEventListener(EVENTO_PREFERENCIA, avisar);
  window.addEventListener('storage', avisar);
  return () => {
    window.removeEventListener(EVENTO_PREFERENCIA, avisar);
    window.removeEventListener('storage', avisar);
  };
};
const leerPreferencia = (clave: string) => {
  try {
    return localStorage.getItem(PREFIJO_LOCAL + clave) === '1';
  } catch {
    return false;
  }
};
/** Interruptor guardado en este navegador; `false` si el almacenamiento está bloqueado. */
export function usePreferencia(clave: string): [boolean, (valor: boolean) => void] {
  const valor = useSyncExternalStore(
    suscribirPreferencia,
    () => leerPreferencia(clave),
    () => false,
  );
  const cambiar = (nuevo: boolean) => {
    try {
      localStorage.setItem(PREFIJO_LOCAL + clave, nuevo ? '1' : '0');
    } catch {
      // Bloqueado: el interruptor no se recuerda, pero la pantalla sigue funcionando.
    }
    window.dispatchEvent(new Event(EVENTO_PREFERENCIA));
  };
  return [valor, cambiar];
}

const leerPreferenciaTexto = (clave: string) => {
  try {
    return localStorage.getItem(PREFIJO_LOCAL + clave);
  } catch {
    return null;
  }
};
/** Opción guardada en este navegador; `predeterminada` si no hay una válida o el almacenamiento está bloqueado. */
export function usePreferenciaOpcion<T extends string>(
  clave: string,
  opciones: readonly T[],
  predeterminada: T,
): [T, (valor: T) => void] {
  const guardada = useSyncExternalStore(
    suscribirPreferencia,
    () => leerPreferenciaTexto(clave),
    () => null,
  );
  const valor = opciones.includes(guardada as T) ? (guardada as T) : predeterminada;
  const cambiar = (nuevo: T) => {
    try {
      localStorage.setItem(PREFIJO_LOCAL + clave, nuevo);
    } catch {
      // Bloqueado: la opción vale para esta visita, pero no se recuerda.
    }
    window.dispatchEvent(new Event(EVENTO_PREFERENCIA));
  };
  return [valor, cambiar];
}

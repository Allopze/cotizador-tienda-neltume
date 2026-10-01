'use client';
import { useEffect, useRef } from 'react';

/**
 * Efectos de cambiar de sección en Catálogo y Ajustes: el título de la pestaña del navegador nombra la
 * sección, la pestaña activa queda a la vista en móvil (la fila se desplaza) y el foco pasa al título de la
 * sección para que el lector de pantalla anuncie el cambio, salvo que la sección ya haya enfocado un campo
 * propio (el buscador de Consultar).
 */
export function useSeccionVisible(pantalla: string, titulo: string) {
  const primera = useRef(true);
  useEffect(() => {
    document.title = `Neltume · ${pantalla} · ${titulo}`;
    document
      .querySelector('.secciones-nav [aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (primera.current) {
      primera.current = false;
      return;
    }
    const encabezado = document.getElementById('seccion-titulo');
    if (!encabezado?.parentElement?.contains(document.activeElement)) encabezado?.focus({ preventScroll: true });
  }, [pantalla, titulo]);
}

/**
 * Con cambios sin guardar, avisa antes de cerrar o recargar la pestaña y antes de seguir un enlace a otra
 * pantalla: los de la cabecera navegan con Next (sin «beforeunload»), así que se confirma antes de que actúe
 * el Link. Las secciones de la misma pantalla quedan montadas y no pierden lo escrito.
 */
export function useAvisoSalida(hayCambios: boolean, aviso: string) {
  useEffect(() => {
    if (!hayCambios) return;
    const alDescargar = (e: BeforeUnloadEvent) => e.preventDefault();
    const alClic = (e: globalThis.MouseEvent) => {
      const enlace = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!enlace || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || enlace.target === '_blank') return;
      const destino = new URL(enlace.href, location.href);
      if (destino.origin !== location.origin || destino.pathname === location.pathname) return;
      if (!window.confirm(aviso)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', alDescargar);
    document.addEventListener('click', alClic, true);
    return () => {
      window.removeEventListener('beforeunload', alDescargar);
      document.removeEventListener('click', alClic, true);
    };
  }, [hayCambios, aviso]);
}

'use client';
import { useEffect, type RefObject } from 'react';

/**
 * Lado de la puerta del ingreso: una foto fija del modelo Neltume y, encima, la escena 3D (ver escena-puerta.ts). La
 * escena solo se carga con WebGL, sin «reducir movimiento» ni ahorro de datos; en cualquier otro caso queda la foto.
 */
export function PuertaLogin({ raiz, boton }: { raiz: RefObject<HTMLElement | null>; boton: RefObject<HTMLElement | null> }) {
  useEffect(() => {
    const login = raiz.current;
    const lado = login?.querySelector<HTMLElement>('.door-side');
    const ingresar = boton.current;
    const ahorro = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (!login || !lado || !ingresar || ahorro || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let desmontar: (() => void) | null = null;
    let cancelado = false;
    void (async () => {
      try {
        const [{ montarEscena }, glb] = await Promise.all([
          import('./escena-puerta'),
          fetch('/3d/puerta_neltume.glb').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('sin modelo')))),
        ]);
        if (cancelado) return;
        desmontar = await montarEscena(lado, login, ingresar, glb);
        if (cancelado) desmontar?.();
      } catch {
        // Sin la escena queda la foto: el ingreso funciona igual.
      }
    })();
    return () => {
      cancelado = true;
      desmontar?.();
    };
  }, [raiz, boton]);

  return (
    <div className="door-side" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="door-still d" src="/3d/puerta-fija-escritorio.jpg" alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="door-still m" src="/3d/puerta-fija-telefono.jpg" alt="" />
      <div className="door-cap">
        <p className="door-t">
          Puertas nativas
          <br />
          del sur
        </p>
        <p className="door-s">Panguipulli, Región de Los Ríos</p>
      </div>
      <p className="ph-note">
        <span className="ph-long">Modelo Neltume en pino · hoja de 0,80 × 2,00 m</span>
        <span className="ph-short">Modelo Neltume · 0,80 × 2,00 m</span>
      </p>
    </div>
  );
}

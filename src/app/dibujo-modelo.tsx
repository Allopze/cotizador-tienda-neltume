'use client';
import { useEffect, useState } from 'react';

// Los modelos con dibujo se piden una sola vez por sesión del navegador.
let pendientes: Promise<Set<string>> | null = null;
const cargarModelos = () =>
  (pendientes ??= fetch('/api/dibujo', { cache: 'force-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<{ modelos: string[] }>) : { modelos: [] }))
    .then((d) => new Set(d.modelos))
    .catch(() => new Set<string>()));
const normalizar = (m: string) =>
  m
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/**
 * Dibujo de línea del modelo de una puerta (o el marco), el mismo de los PDF. Una puerta sin dibujo muestra el esquema
 * genérico; otras familias, nada.
 */
export function DibujoModelo({ modelo, familia, className = 'dibujo-modelo' }: { modelo: string | null; familia: string; className?: string }) {
  const [modelos, setModelos] = useState<Set<string> | null>(null);
  useEffect(() => {
    let vivo = true;
    void cargarModelos().then((m) => vivo && setModelos(m));
    return () => {
      vivo = false;
    };
  }, []);
  if (familia !== 'PUERTA' && familia !== 'MARCO') return null;
  const clave = normalizar(familia === 'MARCO' ? 'MARCO' : (modelo ?? ''));
  if (modelos?.has(clave)) return <img className={className} src={`/api/dibujo/${encodeURIComponent(clave)}`} alt="" width={28} height={56} loading="lazy" />;
  if (familia === 'MARCO' || !modelos) return <span className={className} aria-hidden />;
  return (
    <svg className={`${className} dibujo-generico`} viewBox="0 0 455 900" aria-hidden>
      <path d="M14 890V14H441V890" />
      <rect x="64" y="63" width="328" height="823" />
      <path d="M352 470v70" />
    </svg>
  );
}

'use client';
import { useCallback, useRef, useState } from 'react';

// Zona fija de avisos: errores (role=alert, quedan hasta cerrarlos) e información (role=status).
export type TipoAviso = 'error' | 'info' | 'exito';
export interface Aviso {
  id: number;
  tipo: TipoAviso;
  texto: string;
  accion?: { etiqueta: string; fn: () => void };
  /** Clave para reemplazar un aviso anterior del mismo tema en vez de apilarlo. */
  clave?: string;
}
const DURACION_INFO = 9000;

export function useAvisos() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const siguiente = useRef(1);
  const cerrar = useCallback((id: number) => setAvisos((a) => a.filter((x) => x.id !== id)), []);
  const avisar = useCallback(
    (tipo: TipoAviso, texto: string, extra: Pick<Aviso, 'accion' | 'clave'> = {}) => {
      const id = siguiente.current++;
      setAvisos((a) => [
        ...a.filter((x) => !extra.clave || x.clave !== extra.clave),
        { id, tipo, texto, ...extra },
      ]);
      if (tipo !== 'error' && !extra.accion) setTimeout(() => cerrar(id), DURACION_INFO);
      return id;
    },
    [cerrar],
  );
  const limpiar = useCallback((clave?: string) => {
    setAvisos((a) => (clave ? a.filter((x) => x.clave !== clave) : a.filter((x) => x.tipo !== 'error')));
  }, []);
  return { avisos, avisar, cerrar, limpiar };
}

export function Avisos({ avisos, cerrar }: { avisos: Aviso[]; cerrar: (id: number) => void }) {
  return (
    <div className="avisos">
      {avisos.map((a) => (
        <div key={a.id} className={`aviso ${a.tipo}`} role={a.tipo === 'error' ? 'alert' : 'status'}>
          <p>{a.texto}</p>
          {a.accion && (
            <button
              type="button"
              className="aviso-accion"
              onClick={() => {
                a.accion!.fn();
                cerrar(a.id);
              }}
            >
              {a.accion.etiqueta}
            </button>
          )}
          <button
            type="button"
            className="aviso-cerrar"
            aria-label="Cerrar aviso"
            onClick={() => cerrar(a.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

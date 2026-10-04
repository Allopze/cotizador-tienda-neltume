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
const DURACION_INFO = 7000;
/** Un éxito confirma algo que ya se ve en pantalla: basta un momento. */
const DURACION_EXITO = 4000;

export function useAvisos() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const siguiente = useRef(1);
  const cerrar = useCallback((id: number) => setAvisos((a) => a.filter((x) => x.id !== id)), []);
  const avisar = useCallback(
    (tipo: TipoAviso, texto: string, extra: Pick<Aviso, 'accion' | 'clave'> = {}) => {
      const id = siguiente.current++;
      // Un solo aviso informativo a la vez: apilados tapaban media pantalla en el teléfono. Los errores y los que
      // ofrecen una acción («Deshacer») se quedan hasta cerrarlos.
      const persiste = (x: Aviso) => x.tipo === 'error' || !!x.accion;
      setAvisos((a) => [
        ...a.filter((x) => (!extra.clave || x.clave !== extra.clave) && (tipo === 'error' || persiste(x))),
        { id, tipo, texto, ...extra },
      ]);
      if (tipo !== 'error' && !extra.accion)
        setTimeout(() => cerrar(id), tipo === 'exito' ? DURACION_EXITO : DURACION_INFO);
      return id;
    },
    [cerrar],
  );
  const limpiar = useCallback((clave?: string) => {
    setAvisos((a) => (clave ? a.filter((x) => x.clave !== clave) : a.filter((x) => x.tipo !== 'error')));
  }, []);
  /** Quita los avisos de información y éxito (no los errores): al pasar a otra cotización ya no aplican. */
  const limpiarInformativos = useCallback(() => setAvisos((a) => a.filter((x) => x.tipo === 'error')), []);
  return { avisos, avisar, cerrar, limpiar, limpiarInformativos };
}

export type Avisar = ReturnType<typeof useAvisos>['avisar'];

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

'use client';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';

// Diálogo modal nativo: <dialog>.showModal() aporta Escape, fondo inerte y foco contenido.
// Aquí se agrega foco inicial, retorno del foco, bloqueo del scroll y cierre por el fondo.
interface Props {
  /** Se monta solo mientras está abierto: cada apertura parte de cero. */
  abierto: boolean;
  alCerrar: () => void;
  titulo: ReactNode;
  eyebrow?: string;
  children: ReactNode;
  /** Falso mientras hay una operación en curso: Escape y el fondo no cierran. */
  cerrable?: boolean;
  /** Elemento que recibe el foco al abrir; por defecto el primero enfocable. */
  focoInicial?: RefObject<HTMLElement | null>;
  className?: string;
  /** Rol alertdialog para confirmaciones. */
  alerta?: boolean;
}
export function Dialogo({ abierto, ...props }: Props) {
  return abierto ? <DialogoAbierto {...props} /> : null;
}
function DialogoAbierto({
  alCerrar,
  titulo,
  eyebrow,
  children,
  cerrable = true,
  focoInicial,
  className,
  alerta,
}: Omit<Props, 'abierto'>) {
  const ref = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  const estado = useRef({ cerrable, alCerrar });
  useEffect(() => {
    estado.current = { cerrable, alCerrar };
  });
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const previo = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal();
    focoInicial?.current?.focus();
    document.documentElement.classList.add('con-dialogo');
    return () => {
      if (d.open) d.close();
      if (!document.querySelector('dialog[open]')) document.documentElement.classList.remove('con-dialogo');
      if (previo?.isConnected) previo.focus({ preventScroll: true });
    };
  }, [focoInicial]);
  return (
    <dialog
      ref={ref}
      className={`dialogo ${className ?? ''}`}
      role={alerta ? 'alertdialog' : undefined}
      aria-labelledby={idTitulo}
      onCancel={(e) => {
        // Escape: el diálogo lo controla React, nunca se cierra solo. React propaga «cancel» por el
        // árbol de componentes: un diálogo anidado (confirmación) no debe cerrar también al padre.
        e.preventDefault();
        e.stopPropagation();
        if (e.target === e.currentTarget && estado.current.cerrable) estado.current.alCerrar();
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget && estado.current.cerrable) estado.current.alCerrar();
      }}
    >
      <div className="dialogo-cuerpo">
        <header className="dialogo-cabecera">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2 id={idTitulo}>{titulo}</h2>
          </div>
          <button
            type="button"
            className="dialogo-cerrar"
            onClick={alCerrar}
            disabled={!cerrable}
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export interface OpcionesConfirmacion {
  titulo: string;
  mensaje: ReactNode;
  aceptar: string;
  cancelar?: string;
  eyebrow?: string;
}
/** Reemplazo accesible de window.confirm: `if (await confirmar({...})) …`. */
export function useConfirmacion() {
  const [pendiente, setPendiente] = useState<
    (OpcionesConfirmacion & { resolver: (ok: boolean) => void }) | null
  >(null);
  const cancelar = useRef<HTMLButtonElement>(null);
  const confirmar = useCallback(
    (opciones: OpcionesConfirmacion) =>
      new Promise<boolean>((resolver) => setPendiente({ ...opciones, resolver })),
    [],
  );
  const responder = (ok: boolean) => {
    pendiente?.resolver(ok);
    setPendiente(null);
  };
  const elemento = (
    <Dialogo
      abierto={!!pendiente}
      alCerrar={() => responder(false)}
      titulo={pendiente?.titulo}
      eyebrow={pendiente?.eyebrow ?? 'CONFIRMAR'}
      focoInicial={cancelar}
      className="dialogo-confirmacion"
      alerta
    >
      <div className="dialogo-mensaje">{pendiente?.mensaje}</div>
      <div className="dialogo-acciones">
        <button ref={cancelar} type="button" className="button secondary" onClick={() => responder(false)}>
          {pendiente?.cancelar ?? 'Cancelar'}
        </button>
        <button type="button" className="button primary" onClick={() => responder(true)}>
          {pendiente?.aceptar}
        </button>
      </div>
    </Dialogo>
  );
  return [confirmar, elemento] as const;
}

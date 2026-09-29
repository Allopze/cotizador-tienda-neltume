import type { ReactNode } from 'react';

/**
 * Encabezado de pantalla, igual en todas: título a la izquierda y acciones a la derecha, en una fila de
 * alto fijo para que el título no cambie de lugar al pasar de una pantalla a otra.
 */
export function EncabezadoPagina({
  titulo,
  id,
  children,
}: {
  titulo: string;
  id?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <h1 id={id}>{titulo}</h1>
      {children && <div className="heading-actions">{children}</div>}
    </div>
  );
}

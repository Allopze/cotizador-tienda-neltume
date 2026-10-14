import type { ReactNode, Ref } from 'react';

/**
 * Bloque «Avanzado» de Ajustes y del catálogo: lo que con un toque puede dejar mal el cotizador (modelo y clave
 * de la IA, IVA, ganancias por categoría, vista técnica) queda plegado, con su advertencia a la vista al abrirlo.
 * Lo de uso diario queda fuera, siempre visible. Sin estado propio: quien lo usa puede abrirlo por `ref` (por
 * ejemplo, para llevar el foco a un campo con error que quedó adentro).
 */
export function SeccionAvanzada({
  titulo,
  advertencia,
  children,
  abierta,
  ref,
}: {
  /** Qué hay adentro, en minúscula: «modelo y clave del asistente». */
  titulo: string;
  advertencia: ReactNode;
  children: ReactNode;
  /** Abierto al montar (p. ej. falta la clave de la IA y hay que escribirla). Debe ser constante: si cambia,
   *  React abriría o cerraría el bloque por su cuenta. */
  abierta?: boolean;
  ref?: Ref<HTMLDetailsElement>;
}) {
  return (
    <details className="ajustes-avanzado" open={abierta || undefined} ref={ref}>
      <summary>Avanzado · {titulo}</summary>
      <p className="ajustes-avanzado-aviso">{advertencia}</p>
      {children}
    </details>
  );
}

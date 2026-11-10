'use client';
import type { GrupoConsulta, RespuestaConsulta } from './contrato';
import { nombreProducto } from './formato';

const metros = (m: number) => m.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rango = (min: number | null, max: number | null) =>
  min === null || max === null ? null : min === max ? `${metros(min)} m` : `${metros(min)} a ${metros(max)} m`;

/**
 * Cómo se entendió la búsqueda («Ranco · Pino Oregón · 1,00 × 2,20 m») y, si una palabra no se reconoció, con qué
 * modelo se buscó («ranko» → Ranco). Así la persona ve que el buscador la entendió como el asistente.
 */
export function LecturaBusqueda({ datos, consulta }: { datos: RespuestaConsulta; consulta: string }) {
  if (!consulta.trim() || (!datos.interpretacion && !datos.sugerencia)) return null;
  return (
    <p className="lectura-busqueda">
      {datos.sugerencia ? (
        <>
          No encontré «{consulta.trim()}» tal cual. Te muestro <strong>{nombreProducto(datos.sugerencia)}</strong>
          {datos.interpretacion ? <>: {nombreProducto(datos.interpretacion)}</> : '.'}
        </>
      ) : (
        <>
          Buscando <strong>{nombreProducto(datos.interpretacion ?? '')}</strong>
        </>
      )}
    </p>
  );
}

/**
 * Con muchos resultados, primero los modelos en cada madera con sus medidas: elegir uno acota la búsqueda. Una
 * lista plana de cientos de filas casi iguales («Ranco» son 252) no ayudaba a encontrar la que se buscaba.
 */
export function GruposBusqueda({ grupos, elegir }: { grupos: GrupoConsulta[]; elegir: (g: GrupoConsulta) => void }) {
  return (
    <ul className="grupos-busqueda" aria-label="Modelos encontrados">
      {grupos.map((g) => {
        const ancho = rango(g.anchoMin, g.anchoMax);
        const alto = rango(g.altoMin, g.altoMax);
        return (
          <li key={`${g.modelo}|${g.madera}`}>
            <button type="button" onClick={() => elegir(g)}>
              <span>
                <strong>
                  {nombreProducto(g.modelo)} · {nombreProducto(g.madera)}
                </strong>
                <small>
                  {g.familia === 'PUERTA'
                    ? [ancho && `Anchos ${ancho}`, alto && `altos ${alto}`].filter(Boolean).join(' · ')
                    : [alto && `Largos ${alto}`].filter(Boolean).join(' · ')}
                </small>
              </span>
              <span className="grupos-busqueda-total">
                {g.total} {g.total === 1 ? 'medida' : 'medidas'}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

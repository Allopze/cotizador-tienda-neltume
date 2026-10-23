import { avancePedido, PASOS, type DatosPasos } from '@/negocio/pasos';

/**
 * El avance de un pedido como una línea de pasos: lo que ya se cumplió, el paso que sigue y lo que falta. `detalles`
 * agrega una línea corta bajo cada paso (la fecha, «50 %», «N° 577 y 59»). En el teléfono muestra solo el paso en curso.
 */
export function LineaPasos({ datos, detalles = {} }: { datos: DatosPasos; detalles?: Partial<Record<(typeof PASOS)[number], string | null>> }) {
  const { hechos, actual } = avancePedido(datos);
  const completo = actual === PASOS.length;
  return (
    <div className="pasos-contenedor">
      <ol className="pasos-linea" style={{ ['--n' as string]: PASOS.length }} aria-label="Avance del pedido">
        {PASOS.map((paso, i) => {
          const estado = hechos[i] ? 'hecho' : i === actual ? 'actual' : 'pendiente';
          return (
            <li key={paso} className={`paso-${estado}`} aria-current={estado === 'actual' ? 'step' : undefined} style={{ ['--i' as string]: i }}>
              <span className="paso-punto" aria-hidden>
                {estado === 'hecho' ? '✓' : ''}
              </span>
              <b>{paso}</b>
              {detalles[paso] ? <small>{detalles[paso]}</small> : null}
            </li>
          );
        })}
      </ol>
      <p className="pasos-resumen">
        {completo ? (
          'Pedido completo'
        ) : (
          <>
            Paso {actual + 1} de {PASOS.length}: <b>{PASOS[actual]}</b>
            {detalles[PASOS[actual]] ? `, ${detalles[PASOS[actual]]}` : ''}
          </>
        )}
      </p>
    </div>
  );
}

/** Mini-barra de una fila del historial: un trazo por paso. El texto va para quien no ve los colores. */
export function PasosMini({ datos }: { datos: DatosPasos }) {
  const { hechos, actual } = avancePedido(datos);
  const completo = actual === PASOS.length;
  return (
    <span className="pasos-mini">
      <span className="pasos-mini-barra" aria-hidden>
        {PASOS.map((paso, i) => (
          <i key={paso} className={hechos[i] ? 'hecho' : i === actual ? 'actual' : ''} />
        ))}
      </span>
      <span className="pasos-mini-texto">{completo ? 'Completo' : PASOS[actual]}</span>
      <span className="sr-only">
        {completo ? 'Pedido completo.' : `Paso ${actual + 1} de ${PASOS.length}: ${PASOS[actual]}.`}
      </span>
    </span>
  );
}

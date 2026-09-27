import { etiquetaEstado, type Cotizacion } from '@/negocio/estado';
import { pesos, porcentajeIva } from '@/negocio/precios';
interface Props {
  actual: Cotizacion | null;
  ocupado: boolean;
  accion: (tipo: 'emitir' | 'aprobar' | 'quitar', indice?: number) => Promise<void>;
}
export function CotizacionPanel({ actual, ocupado, accion }: Props) {
  const bloqueada = actual?.estado === 'aprobada';
  const listo = !!actual?.montos.lineas.length && !actual.incompletos.length;
  const emitida = !!actual?.pdf;
  return (
    <section className="quote-panel" aria-label="Cotización en curso">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">02 / COTIZACIÓN</p>
          <h2>{actual?.numero ? `N° ${actual.numero}` : 'Borrador'}</h2>
        </div>
        <span className={`status ${actual?.estado ?? 'borrador'}`}>
          {etiquetaEstado[actual?.estado ?? 'borrador']}
        </span>
      </div>
      <div className="client">
        <div>
          <span>CLIENTE</span>
          <strong>{actual?.cliente.nombre || 'Sin nombre aún'}</strong>
        </div>
        <div>
          <span>CIUDAD / COMUNA</span>
          <strong>{actual?.cliente.comuna || '—'}</strong>
        </div>
        <div>
          <span>PROYECTO</span>
          <strong>{actual?.cliente.proyecto || '—'}</strong>
        </div>
        <div>
          <span>CONTACTO</span>
          <strong>{actual?.cliente.telefono || '—'}</strong>
        </div>
        {actual?.cliente.rut && (
          <div>
            <span>RUT</span>
            <strong>{actual.cliente.rut}</strong>
          </div>
        )}
        {actual?.cliente.direccion && (
          <div>
            <span>DIRECCIÓN</span>
            <strong>{actual.cliente.direccion}</strong>
          </div>
        )}
      </div>
      <div className="items-top">
        <span>Detalle del pedido</span>
        <span>{actual?.solicitudes.length ?? 0} ítems</span>
      </div>
      {actual?.solicitudes.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PRODUCTO / CÓDIGO</th>
                <th>CANT.</th>
                <th>UNITARIO</th>
                <th>TOTAL</th>
                <th>
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {actual.solicitudes.map((s, i) => {
                const pendiente = actual.incompletos.find((p) => p.indice === i);
                const index = i - actual.incompletos.filter((p) => p.indice < i).length;
                const linea = pendiente ? null : actual.montos.lineas[index];
                return (
                  <tr key={i} className={pendiente ? 'pending' : ''}>
                    <td>
                      <strong>{linea?.producto.descripcion || s.modelo || 'Producto por definir'}</strong>
                      <small>{linea?.producto.codigo || 'Pendiente de completar'}</small>
                      {pendiente && <span className="pending-label">Incompleto · no suma al total</span>}
                    </td>
                    <td>{s.cantidad ?? '—'}</td>
                    <td>{linea ? pesos(linea.precioUnitario) : '—'}</td>
                    <td>{linea ? pesos(linea.total) : '—'}</td>
                    <td>
                      <button
                        className="remove"
                        onClick={() => accion('quitar', i)}
                        disabled={ocupado || bloqueada}
                        aria-label={`Quitar ítem ${i + 1}`}
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-quote">
          <div className="door-icon" aria-hidden>
            <span />
          </div>
          <h3>El próximo proyecto empieza aquí.</h3>
          <p>
            Tu pedido aparecerá con sus medidas,
            <br />
            cantidades y valores, listo para revisar.
          </p>
        </div>
      )}
      <div className="totals">
        <div>
          <span>Neto</span>
          <span data-testid="neto">{pesos(actual?.montos.neto ?? 0)}</span>
        </div>
        <div>
          <span>
            IVA <small>{porcentajeIva()}</small>
          </span>
          <span>{pesos(actual?.montos.iva ?? 0)}</span>
        </div>
        <div className="grand-total">
          <span>Total</span>
          <strong data-testid="total">{pesos(actual?.montos.total ?? 0)}</strong>
        </div>
      </div>
      <div className="quote-actions">
        <button className="button primary" disabled={!listo || ocupado} onClick={() => accion('emitir')}>
          {actual?.pdf ? 'Descargar cotización' : 'Generar PDF'} <span aria-hidden>↓</span>
        </button>
        <button
          className="button secondary"
          disabled={!emitida || ocupado}
          title={emitida ? undefined : 'Genera y revisa el PDF antes de aprobar.'}
          onClick={() => accion('aprobar')}
        >
          {bloqueada ? 'Descargar nota de pedido' : 'Aprobar y generar nota de pedido'}
        </button>
      </div>
      <p className="review-note">
        {bloqueada
          ? 'Cotización aprobada y bloqueada para edición.'
          : actual?.estado === 'emitida'
            ? `${actual.fechaEmision ? `Emitida el ${new Date(actual.fechaEmision).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}. ` : ''}Si haces cambios, se creará un nuevo borrador y se conservará este PDF.`
            : actual?.origen
              ? `Revisión de la cotización N° ${actual.origen}. Revisa antes de compartir; tú decides cuándo emitirla.`
              : 'Revisa antes de compartir. Tú decides cuándo enviarla.'}
      </p>
      <div className="conditions">
        <span>Valores puestos en fábrica.</span>
        <span>Despacho por confirmar · Validez: 10 días hábiles</span>
      </div>
    </section>
  );
}

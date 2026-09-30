'use client';
import { useState } from 'react';
import {
  anticipoMinimo,
  etiquetaComercial,
  etiquetaFacturacion,
  etiquetaOperativo,
  pagoAnulable,
  sinTransportista,
  type Cotizacion,
} from '@/negocio/estado';
import { leerPesos } from '@/negocio/cifras';
import { pesos, porcentaje } from '@/negocio/precios';
import { fechaLocal } from '@/negocio/vigencia';
import { fechaLarga } from './formato';

interface Props {
  actual: Cotizacion;
  ocupado: boolean;
  /** Ejecuta una acción sobre la cotización abierta con su versión; responde si se aplicó. */
  flujo: (accion: Record<string, unknown>) => Promise<boolean>;
  /** Anula un pago registrado por error, previa confirmación. */
  anularPago: (pagoId: string) => Promise<boolean>;
}

/**
 * Seguimiento de la operación: pagos, producción, despacho, facturación y notas internas. Guarda los
 * borradores de sus formularios, así que el panel lo monta con `key` = id de la cotización.
 */
export function SeguimientoOperacion({ actual, ocupado, flujo, anularPago }: Props) {
  const [montoPago, setMontoPago] = useState('');
  const [fechaPago, setFechaPago] = useState(() => fechaLocal(new Date()));
  const [observacionPago, setObservacionPago] = useState('');
  const [tipoFactura, setTipoFactura] = useState<'factura' | 'boleta'>('factura');
  const [numeroFactura, setNumeroFactura] = useState('');
  const [fechaFactura, setFechaFactura] = useState(() => fechaLocal(new Date()));
  const [comentario, setComentario] = useState('');
  const estado = actual.estado;
  const pagosRegistrados = actual.pagos ?? [];
  const pagado = pagosRegistrados.reduce((s, p) => s + p.monto, 0);
  const saldo = Math.max(0, actual.montos.total - pagado);
  const porcentajePagado = actual.montos.total ? Math.min(100, (100 * pagado) / actual.montos.total) : 0;
  const operacionActual = actual.estadoOperativo ?? (actual.nota ? 'pedido_generado' : 'sin_pedido');
  const estadoComercial = actual.estadoComercial ?? (estado === 'emitida' ? 'enviada' : 'pendiente');
  const pagoMinimoNP = anticipoMinimo(actual.montos.total);
  const aprobada = estado === 'aprobada';
  const puedeAnularPago = pagoAnulable(actual);
  const faltaTransportista = sinTransportista(actual.despacho?.transporte);
  async function registrarPago(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const monto = leerPesos(montoPago);
    if (!Number.isSafeInteger(monto) || monto <= 0 || monto > saldo || ocupado) return;
    if (await flujo({ tipo: 'pago', monto, fecha: fechaPago || undefined, observacion: observacionPago || null })) {
      setMontoPago('');
      setObservacionPago('');
    }
  }
  async function marcarFacturada(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (ocupado) return;
    if (
      await flujo({
        tipo: 'facturacion',
        estado: 'facturada',
        tipoDocumento: tipoFactura,
        identificadorExterno: numeroFactura.trim() || null,
        fecha: fechaFactura || null,
      })
    )
      setNumeroFactura('');
  }
  async function guardarComentario(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!comentario.trim() || ocupado) return;
    if (await flujo({ tipo: 'comentario', texto: comentario.trim() })) setComentario('');
  }
  const operar = (paso: string, extra: Record<string, unknown> = {}) => flujo({ tipo: 'operacion', paso, ...extra });
  return (
    <section className="quote-workflow" aria-labelledby="seguimiento-title">
      <div className="workflow-heading">
        <div>
          <p className="eyebrow">SEGUIMIENTO DE LA OPERACIÓN</p>
          <h3 id="seguimiento-title">
            {aprobada || pagado > 0 ? `${pesos(pagado)} pagado · ${pesos(saldo)} pendiente` : 'Esperando la aprobación del cliente'}
          </h3>
        </div>
        {(aprobada || pagado > 0) && <span className="status">{porcentaje(porcentajePagado)} pagado</span>}
      </div>
      <div className="workflow-states">
        <span>Comercial: <strong>{etiquetaComercial[estadoComercial]}</strong></span>
        <span>Operación: <strong>{etiquetaOperativo[operacionActual]}</strong></span>
        {aprobada && <span>Facturación: <strong>{etiquetaFacturacion(actual.facturacion)}</strong></span>}
      </div>
      {estado === 'emitida' && (
        <div className="workflow-actions">
          {estadoComercial !== 'seguimiento' && <button type="button" className="button secondary small" disabled={ocupado} onClick={() => void flujo({ tipo: 'comercial', estado: 'seguimiento' })}>Marcar seguimiento</button>}
          <button type="button" className="button secondary small" disabled={ocupado} onClick={() => void flujo({ tipo: 'comercial', estado: 'rechazada' })}>Marcar rechazada</button>
          <p className="muted">Los pagos se registran cuando el cliente aprueba la cotización.</p>
        </div>
      )}
      {aprobada && (
        <form className="workflow-payment" onSubmit={registrarPago}>
          <label className="ia-field"><span>Monto recibido (máx. {pesos(saldo)})</span><input inputMode="numeric" value={montoPago} onChange={(e) => setMontoPago(e.target.value)} placeholder="0" disabled={ocupado || saldo <= 0} /></label>
          <label className="ia-field"><span>Fecha del pago</span><input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} disabled={ocupado || saldo <= 0} /></label>
          <label className="ia-field"><span>Observación</span><input value={observacionPago} onChange={(e) => setObservacionPago(e.target.value)} maxLength={500} placeholder="Transferencia, anticipo…" disabled={ocupado || saldo <= 0} /></label>
          <button type="submit" className="button secondary" disabled={ocupado || saldo <= 0 || leerPesos(montoPago) <= 0}>Registrar pago</button>
        </form>
      )}
      {pagosRegistrados.length > 0 && (
        <ul className="workflow-ledger">
          {pagosRegistrados.map((p) => (
            <li key={p.id}>
              <span>{fechaLarga(p.fecha)}{p.observacion ? ` · ${p.observacion}` : ''}</span>
              <span className="workflow-ledger-monto">
                <strong>{pesos(p.monto)}</strong>
                {puedeAnularPago && (
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={ocupado}
                    aria-label={`Anular el pago de ${pesos(p.monto)} del ${fechaLarga(p.fecha)}`}
                    onClick={() => void anularPago(p.id)}
                  >
                    Anular
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {aprobada && !actual.nota && (
        <div className="workflow-actions">
          <p className="muted">Nota de pedido disponible desde {pesos(pagoMinimoNP)} (50 %).</p>
          <button type="button" className="button primary" disabled={ocupado || pagado < pagoMinimoNP} onClick={() => void flujo({ tipo: 'generar_nota' })}>Generar nota de pedido</button>
        </div>
      )}
      {actual.nota && (
        <div className="workflow-actions">
          {operacionActual === 'pedido_generado' && <button type="button" className="button secondary" disabled={ocupado || pagado < pagoMinimoNP} onClick={() => void operar('iniciar_produccion')}>Iniciar producción</button>}
          {operacionActual === 'en_produccion' && <button type="button" className="button secondary" disabled={ocupado || pagado < pagoMinimoNP} onClick={() => void operar('produccion_terminada')}>Marcar producción terminada</button>}
          {(operacionActual === 'pedido_generado' || operacionActual === 'en_produccion') && pagado < pagoMinimoNP && <p className="muted">La producción se habilita con al menos {pesos(pagoMinimoNP)} (50 %) pagado.</p>}
          {operacionActual === 'saldo_pendiente' && <p className="muted">La producción terminó. Registra el saldo antes de habilitar el despacho.</p>}
          {(operacionActual === 'pagada' || operacionActual === 'produccion_terminada') && pagado >= actual.montos.total && <button type="button" className="button secondary" disabled={ocupado} onClick={() => void operar('lista_despacho')}>Marcar lista para despacho</button>}
          {operacionActual === 'lista_despacho' && <button type="button" className="button primary" disabled={ocupado || faltaTransportista} onClick={() => void operar('despachada')}>Registrar despacho</button>}
          {operacionActual === 'lista_despacho' && faltaTransportista && <p className="muted">Indica el transportista en «Despacho» para registrar el despacho.</p>}
          {operacionActual === 'despachada' && <button type="button" className="button secondary" disabled={ocupado} onClick={() => void operar('completada')}>Completar operación</button>}
        </div>
      )}
      {aprobada && (
        actual.facturacion?.estado === 'facturada' ? (
          <div className="workflow-actions">
            <p>
              <strong>{etiquetaFacturacion(actual.facturacion)}</strong>
              {actual.facturacion.fecha ? ` · ${fechaLarga(actual.facturacion.fecha)}` : ''}
            </p>
            <button type="button" className="button secondary small" disabled={ocupado} onClick={() => void flujo({ tipo: 'facturacion', estado: 'pendiente' })}>Volver a pendiente</button>
          </div>
        ) : (
          <form className="workflow-payment" onSubmit={marcarFacturada}>
            <label className="ia-field">
              <span>Documento</span>
              <select value={tipoFactura} onChange={(e) => setTipoFactura(e.target.value as 'factura' | 'boleta')} disabled={ocupado}>
                <option value="factura">Factura</option>
                <option value="boleta">Boleta</option>
              </select>
            </label>
            <label className="ia-field"><span>N° o identificador externo</span><input value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} maxLength={120} placeholder="Ej. 1234" disabled={ocupado} /></label>
            <label className="ia-field"><span>Fecha de emisión</span><input type="date" value={fechaFactura} onChange={(e) => setFechaFactura(e.target.value)} disabled={ocupado} /></label>
            <button type="submit" className="button secondary" disabled={ocupado}>Marcar como facturada</button>
          </form>
        )
      )}
      <form className="workflow-comment" onSubmit={guardarComentario}>
        <label className="ia-field"><span>Nota interna</span><textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} maxLength={2000} placeholder="Seguimiento, acuerdos o instrucciones internas" disabled={ocupado} /></label>
        <button type="submit" className="button secondary small" disabled={ocupado || !comentario.trim()}>Agregar nota</button>
      </form>
      {(actual.comentariosInternos?.length ?? 0) > 0 && (
        <ul className="workflow-ledger internal-comments">
          {actual.comentariosInternos!.map((c) => <li key={c.id}><span>{fechaLarga(c.fecha)} · {c.usuario ?? 'Equipo'}: {c.texto}</span></li>)}
        </ul>
      )}
    </section>
  );
}

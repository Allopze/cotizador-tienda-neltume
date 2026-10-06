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
import { SelectorDesplegable } from './selector-desplegable';

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
  const irAPago = () => {
    const campo = document.getElementById('monto-recibido') as HTMLInputElement | null;
    campo?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    campo?.focus({ preventScroll: true });
  };
  const irADespacho = () => {
    const detalle = document.getElementById('despacho-details') as HTMLDetailsElement | null;
    if (!detalle) return;
    detalle.open = true;
    detalle.scrollIntoView({ block: 'center', behavior: 'smooth' });
    detalle.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  };
  const irAFacturacion = () => {
    const campo = document.getElementById('facturacion-identificador') as HTMLInputElement | null;
    campo?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    campo?.focus({ preventScroll: true });
  };
  const siguiente = (() => {
    if (!aprobada) return null;
    if (!actual.nota || actual.nota.anulada)
      return pagado < pagoMinimoNP
        ? { titulo: 'Registrar anticipo', detalle: `La nota de pedido se habilita al registrar ${pesos(pagoMinimoNP)} (50 %).`, etiqueta: 'Ir a pagos', accion: irAPago }
        : { titulo: 'Generar nota de pedido', detalle: 'El anticipo está registrado. Prepara el documento para fábrica.', etiqueta: 'Generar nota de pedido', accion: () => void flujo({ tipo: 'generar_nota' }) };
    if (pagado < pagoMinimoNP)
      return { titulo: 'Completar anticipo', detalle: `La producción requiere al menos ${pesos(pagoMinimoNP)} pagado.`, etiqueta: 'Ir a pagos', accion: irAPago };
    switch (operacionActual) {
      case 'pedido_generado':
        return { titulo: 'Iniciar producción', detalle: `La nota de pedido N° ${actual.nota.numero} ya está generada. Registra el inicio cuando pase a fábrica.`, etiqueta: 'Iniciar producción', accion: () => void operar('iniciar_produccion') };
      case 'en_produccion':
        return { titulo: 'Cerrar producción', detalle: 'Confirma que fábrica terminó el pedido.', etiqueta: 'Marcar producción terminada', accion: () => void operar('produccion_terminada') };
      case 'saldo_pendiente':
        return { titulo: 'Registrar saldo', detalle: `Faltan ${pesos(saldo)} para continuar con el despacho.`, etiqueta: 'Ir a pagos', accion: irAPago };
      case 'pagada':
      case 'produccion_terminada':
        return pagado >= actual.montos.total
          ? { titulo: 'Preparar despacho', detalle: 'El pedido está pagado. Indica que está listo para despacho.', etiqueta: 'Marcar lista para despacho', accion: () => void operar('lista_despacho') }
          : { titulo: 'Registrar saldo', detalle: `Faltan ${pesos(saldo)} para continuar con el despacho.`, etiqueta: 'Ir a pagos', accion: irAPago };
      case 'lista_despacho':
        return faltaTransportista
          ? { titulo: 'Indicar transportista', detalle: 'Completa el transportista en Despacho antes de registrar la salida.', etiqueta: 'Completar despacho', accion: irADespacho }
          : { titulo: 'Registrar despacho', detalle: 'El pedido está listo y tiene transportista asignado.', etiqueta: 'Registrar despacho', accion: () => void operar('despachada') };
      case 'despachada':
        return { titulo: 'Completar operación', detalle: 'Confirma el cierre del pedido despachado.', etiqueta: 'Completar operación', accion: () => void operar('completada') };
      case 'completada':
        return actual.facturacion?.estado === 'facturada'
          ? { titulo: 'Operación completada', detalle: 'El pedido y su facturación están registrados.', etiqueta: null, accion: null }
          : { titulo: 'Registrar facturación', detalle: 'El pedido está completo; falta registrar la factura o boleta.', etiqueta: 'Ir a facturación', accion: irAFacturacion };
      default:
        return { titulo: 'Revisar el siguiente paso', detalle: 'Revisa pagos, producción y despacho para continuar.', etiqueta: 'Ir a pagos', accion: irAPago };
    }
  })();
  return (
    <section className="quote-workflow" aria-labelledby="seguimiento-title">
      <div className="workflow-heading">
        <div>
          <h3 id="seguimiento-title">
            {aprobada ? 'Seguimiento del pedido' : 'Esperando la aprobación del cliente'}
          </h3>
        </div>
        {(aprobada || pagado > 0) && <span className="status">{porcentaje(porcentajePagado)} pagado</span>}
      </div>
      {aprobada && (
        <div className="workflow-focus">
          <div className="workflow-progress">
            <span>Pago recibido</span>
            <strong>{pesos(pagado)} de {pesos(actual.montos.total)}</strong>
            <div className="workflow-progress-track" role="progressbar" aria-label="Porcentaje pagado" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(porcentajePagado)}>
              <span style={{ width: `${porcentajePagado}%` }} />
            </div>
            <small>{porcentaje(porcentajePagado)} pagado · {pesos(saldo)} pendiente</small>
          </div>
          {siguiente && (
            <div className="workflow-next">
              <span>Siguiente acción</span>
              <h4>{siguiente.titulo}</h4>
              <p>{siguiente.detalle}</p>
              {siguiente.accion && siguiente.etiqueta && (
                <button type="button" className="button primary" disabled={ocupado} onClick={siguiente.accion}>
                  {siguiente.etiqueta}
                </button>
              )}
            </div>
          )}
        </div>
      )}
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
          <label className="ia-field"><span>Monto recibido (máx. {pesos(saldo)})</span><input id="monto-recibido" inputMode="numeric" value={montoPago} onChange={(e) => setMontoPago(e.target.value)} onBlur={() => { const n = leerPesos(montoPago); if (n > 0) setMontoPago(n.toLocaleString('es-CL')); }} placeholder="0" disabled={ocupado || saldo <= 0} /></label>
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
            <div className="ia-field">
              <span>Documento</span>
              <SelectorDesplegable
                ariaLabel="Documento"
                value={tipoFactura}
                opciones={[
                  { value: 'factura', label: 'Factura' },
                  { value: 'boleta', label: 'Boleta' },
                ]}
                onChange={(valor) => setTipoFactura(valor as 'factura' | 'boleta')}
                disabled={ocupado}
              />
            </div>
            <label className="ia-field"><span>N° o identificador externo</span><input id="facturacion-identificador" value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} maxLength={120} placeholder="Ej. 1234" disabled={ocupado} /></label>
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

'use client';
import { useCallback, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Dialogo } from './dialogo';
import type { Despacho } from './contrato';
import { fechaLarga, numeroCotizacion } from './formato';

// Diálogos con formulario que devuelven una promesa, como useConfirmacion.

interface DatosAprobacion {
  numero: number | null;
  direccion: string | null;
  vence: string | null;
  vencida: boolean;
}
/** Aprobación: pide despacho (opcional) y advierte si la cotización está vencida. */
export function useAprobacion() {
  const [pendiente, setPendiente] = useState<
    | (DatosAprobacion & { resolver: (r: { despacho: Despacho; confirmarVencida: boolean } | null) => void })
    | null
  >(null);
  const pedir = useCallback(
    (datos: DatosAprobacion) =>
      new Promise<{ despacho: Despacho; confirmarVencida: boolean } | null>((resolver) =>
        setPendiente({ ...datos, resolver }),
      ),
    [],
  );
  const cancelar = useRef<HTMLButtonElement>(null);
  const cerrar = (r: { despacho: Despacho; confirmarVencida: boolean } | null) => {
    pendiente?.resolver(r);
    setPendiente(null);
  };
  const elemento = (
    <Dialogo
      abierto={!!pendiente}
      alCerrar={() => cerrar(null)}
      titulo={`¿Aprobar la cotización ${numeroCotizacion(pendiente?.numero)}?`}
      eyebrow="APROBAR"
      className="dialogo-confirmacion"
      focoInicial={cancelar}
      alerta
    >
      {pendiente && <FormAprobacion datos={pendiente} responder={cerrar} cancelar={cancelar} />}
    </Dialogo>
  );
  return [pedir, elemento] as const;
}
function FormAprobacion({
  datos,
  responder,
  cancelar,
}: {
  datos: DatosAprobacion;
  cancelar: RefObject<HTMLButtonElement | null>;
  responder: (r: { despacho: Despacho; confirmarVencida: boolean } | null) => void;
}) {
  const [direccion, setDireccion] = useState(datos.direccion ?? '');
  const [transporte, setTransporte] = useState('');
  function enviar(e: FormEvent) {
    e.preventDefault();
    const despacho: Despacho = {};
    if (direccion.trim()) despacho.direccion = direccion.trim();
    if (transporte.trim()) despacho.transporte = transporte.trim();
    responder({ despacho, confirmarVencida: datos.vencida });
  }
  return (
    <form onSubmit={enviar}>
      <div className="dialogo-mensaje">
        <p>Se generará la nota de pedido para fábrica y la cotización quedará bloqueada.</p>
        <p>Esta acción no se puede deshacer.</p>
        {datos.vencida && (
          <p className="dialogo-advertencia">
            Esta cotización venció{datos.vence ? ` el ${fechaLarga(datos.vence)}` : ''}. Apruébala solo si el
            cliente aceptó los valores igualmente.
          </p>
        )}
      </div>
      <div className="dialogo-campos">
        <label className="ia-field">
          <span>Dirección de despacho (opcional)</span>
          <input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            maxLength={300}
            autoComplete="off"
          />
        </label>
        <label className="ia-field">
          <span>Transporte (opcional)</span>
          <input
            value={transporte}
            onChange={(e) => setTransporte(e.target.value)}
            maxLength={120}
            placeholder="Retira el cliente, camión propio, Starken…"
            autoComplete="off"
          />
        </label>
      </div>
      <div className="dialogo-acciones">
        <button ref={cancelar} type="button" className="button secondary" onClick={() => responder(null)}>
          Cancelar
        </button>
        <button type="submit" className="button primary">
          {datos.vencida ? 'Aprobar de todos modos' : 'Aprobar y generar nota'}
        </button>
      </div>
    </form>
  );
}

/** Anulación: irreversible, con motivo opcional y confirmación explícita. */
export function useAnulacion() {
  const [pendiente, setPendiente] = useState<{
    numero: number | null;
    aprobada: boolean;
    resolver: (r: { motivo: string } | null) => void;
  } | null>(null);
  const pedir = useCallback(
    (numero: number | null, aprobada: boolean) =>
      new Promise<{ motivo: string } | null>((resolver) => setPendiente({ numero, aprobada, resolver })),
    [],
  );
  const cancelar = useRef<HTMLButtonElement>(null);
  const cerrar = (r: { motivo: string } | null) => {
    pendiente?.resolver(r);
    setPendiente(null);
  };
  const elemento = (
    <Dialogo
      abierto={!!pendiente}
      alCerrar={() => cerrar(null)}
      titulo={`Anular la cotización ${numeroCotizacion(pendiente?.numero)}`}
      eyebrow="ANULAR"
      className="dialogo-confirmacion"
      focoInicial={cancelar}
      alerta
    >
      {pendiente && <FormAnulacion aprobada={pendiente.aprobada} responder={cerrar} cancelar={cancelar} />}
    </Dialogo>
  );
  return [pedir, elemento] as const;
}
function FormAnulacion({
  aprobada,
  responder,
  cancelar,
}: {
  aprobada: boolean;
  responder: (r: { motivo: string } | null) => void;
  cancelar: RefObject<HTMLButtonElement | null>;
}) {
  const [motivo, setMotivo] = useState('');
  const [entiendo, setEntiendo] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (entiendo) responder({ motivo: motivo.trim() });
      }}
    >
      <div className="dialogo-mensaje">
        <p>
          <strong>La anulación es definitiva y no se puede deshacer.</strong> La cotización dejará de ser
          válida y no podrá aprobarse ni editarse; su número no se reutiliza.
        </p>
        {aprobada && <p>La nota de pedido de fábrica asociada también quedará marcada como anulada.</p>}
        <p>Si necesitas cambiarla, puedes duplicarla antes o después de anular.</p>
      </div>
      <div className="dialogo-campos">
        <label className="ia-field">
          <span>Motivo (opcional)</span>
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} rows={2} />
        </label>
        <label className="dialogo-check">
          <input type="checkbox" checked={entiendo} onChange={(e) => setEntiendo(e.target.checked)} />
          Entiendo que la anulación no se puede deshacer.
        </label>
      </div>
      <div className="dialogo-acciones">
        <button ref={cancelar} type="button" className="button secondary" onClick={() => responder(null)}>
          Cancelar
        </button>
        <button type="submit" className="button peligro" disabled={!entiendo}>
          Anular cotización
        </button>
      </div>
    </form>
  );
}

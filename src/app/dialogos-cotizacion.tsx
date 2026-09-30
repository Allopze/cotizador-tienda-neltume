'use client';
import { useCallback, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Dialogo } from './dialogo';
import type { Despacho } from './contrato';
import { fechaLarga, numeroCotizacion } from './formato';

// Diálogos con formulario que devuelven una promesa, como useConfirmacion.

interface DatosAprobacion {
  numero: number | null;
  despacho: Despacho | null;
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
  const [direccion, setDireccion] = useState(datos.despacho?.direccion ?? '');
  const [transporte, setTransporte] = useState(datos.despacho?.transporte ?? '');
  const [entregaComprometida, setEntregaComprometida] = useState(datos.despacho?.entregaComprometida ?? '');
  function enviar(e: FormEvent) {
    e.preventDefault();
    const despacho: Despacho = {};
    if (direccion.trim()) despacho.direccion = direccion.trim();
    if (transporte.trim()) despacho.transporte = transporte.trim();
    if (entregaComprometida.trim()) despacho.entregaComprometida = entregaComprometida.trim();
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
          <span>Entrega comprometida (opcional)</span>
          <input
            value={entregaComprometida}
            onChange={(e) => setEntregaComprometida(e.target.value)}
            maxLength={120}
            placeholder="Ej. semana del 15 de abril"
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

interface DatosEmision {
  numero?: number | null;
  total: number;
}

/** Emisión: permite elegir un número nuevo solo por encima del último correlativo reservado. */
export function useEmision() {
  const [pendiente, setPendiente] = useState<
    (DatosEmision & { resolver: (r: { numero: number | null } | null) => void }) | null
  >(null);
  const pedir = useCallback(
    (datos: DatosEmision) =>
      new Promise<{ numero: number | null } | null>((resolver) => setPendiente({ ...datos, resolver })),
    [],
  );
  const cancelar = useRef<HTMLButtonElement>(null);
  const cerrar = (r: { numero: number | null } | null) => {
    pendiente?.resolver(r);
    setPendiente(null);
  };
  const elemento = (
    <Dialogo
      abierto={!!pendiente}
      alCerrar={() => cerrar(null)}
      titulo="Emitir la cotización"
      eyebrow="EMITIR"
      className="dialogo-confirmacion"
      focoInicial={cancelar}
      alerta
    >
      {pendiente && <FormEmision datos={pendiente} responder={cerrar} cancelar={cancelar} />}
    </Dialogo>
  );
  return [pedir, elemento] as const;
}

function FormEmision({
  datos,
  responder,
  cancelar,
}: {
  datos: DatosEmision;
  responder: (r: { numero: number | null } | null) => void;
  cancelar: RefObject<HTMLButtonElement | null>;
}) {
  const [numero, setNumero] = useState('');
  const [error, setError] = useState('');
  function enviar(e: FormEvent) {
    e.preventDefault();
    const escrito = numero.trim();
    if (escrito && (!/^\d+$/.test(escrito) || Number(escrito) <= 0)) {
      setError('El número debe ser un entero positivo.');
      return;
    }
    responder({ numero: escrito ? Number(escrito) : null });
  }
  return (
    <form onSubmit={enviar}>
      <div className="dialogo-mensaje">
        <p>
          Total a emitir: <strong>{new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(datos.total)}</strong> (IVA incluido).
        </p>
        <p>Si dejas el número vacío se asignará el siguiente correlativo disponible.</p>
        <p>También puedes indicar un número manual, pero debe ser mayor que el último número usado o reservado.</p>
      </div>
      <div className="dialogo-campos">
        <label className="ia-field">
          <span>Número de cotización (opcional)</span>
          <input
            type="number"
            min={1}
            max={1_000_000_000}
            step={1}
            value={numero}
            onChange={(e) => {
              setNumero(e.target.value);
              setError('');
            }}
            placeholder="Siguiente disponible"
            autoComplete="off"
          />
        </label>
        {error && <p className="campo-error" role="alert">{error}</p>}
      </div>
      <div className="dialogo-acciones">
        <button ref={cancelar} type="button" className="button secondary" onClick={() => responder(null)}>Cancelar</button>
        <button type="submit" className="button primary">Emitir y generar PDF</button>
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

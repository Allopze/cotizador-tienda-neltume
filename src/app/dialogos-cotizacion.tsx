'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { Dialogo } from './dialogo';
import type { Despacho } from './contrato';
import { fechaLarga, numeroCotizacion } from './formato';
import { ANTICIPO_TEXTO } from '@/negocio/limites';
import { FABRICAS, nombreFabrica, productosFabrica, type Fabrica } from '@/negocio/estado';
import { pesos } from '@/negocio/precios';
import { pedirJSON } from './solicitud';

// Diálogos con formulario que devuelven una promesa, como useConfirmacion.

interface DatosAprobacion {
  numero: number | null;
  despacho: Despacho | null;
  vence: string | null;
  vencida: boolean;
}
/** Aprobación: registra la aceptación del cliente y deja la nota para después del anticipo. */
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
        <p>Se registrará la aprobación del cliente y la cotización quedará bloqueada para edición.</p>
        <p>La nota de pedido se habilitará cuando registres al menos {ANTICIPO_TEXTO} de pago.</p>
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
          {datos.vencida ? 'Registrar aprobación de todos modos' : 'Registrar aprobación'}
        </button>
      </div>
    </form>
  );
}

interface DatosEmision {
  numero?: number | null;
  total: number;
  cliente?: string | null;
  productos?: { nombre: string; medida: string | null }[];
  /** N° de la cotización que esta revisión reemplaza al emitirse. */
  reemplaza?: number | null;
  /** Solo una cuenta administradora elige el número a mano (la API lo exige igual). */
  numeroManual?: boolean;
}

/** Emisión: una cuenta administradora puede elegir un número nuevo por encima del último reservado. */
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

/** Último número de cotización usado o reservado y el rango de un número elegido a mano (`GET ?numeracion=1`). */
export interface Numeracion {
  ultimo: number;
  siguiente: number;
  tope: number;
}

/**
 * Error del número escrito en el diálogo de emisión, o null si sirve. Sin la numeración (no llegó), solo se
 * revisa que sea un entero positivo: el servidor vuelve a validar el rango al emitir.
 */
export function errorNumeroManual(escrito: string, numeracion: Numeracion | null): string | null {
  if (!escrito) return null;
  if (!/^\d+$/.test(escrito) || Number(escrito) <= 0) return 'El número debe ser un entero positivo.';
  if (!numeracion) return null;
  const n = Number(escrito);
  const miles = (x: number) => x.toLocaleString('es-CL');
  if (n <= numeracion.ultimo)
    return `El N° ${miles(n)} ya se usó o quedó reservado: elige uno desde el ${miles(numeracion.siguiente)}.`;
  if (n > numeracion.tope)
    return `El número puede saltar hasta 1.000 sobre el último: elige uno entre el ${miles(numeracion.siguiente)} y el ${miles(numeracion.tope)}.`;
  return null;
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
  // Último número y tope, para mostrarlos y validar antes de enviar. Si no llegan, el servidor valida igual.
  const [numeracion, setNumeracion] = useState<Numeracion | null>(null);
  useEffect(() => {
    if (!datos.numeroManual) return;
    const control = new AbortController();
    pedirJSON<Numeracion>('/api/accion?numeracion=1', { signal: control.signal, cache: 'no-store' })
      .then(setNumeracion)
      .catch(() => {});
    return () => control.abort();
  }, [datos.numeroManual]);
  // «1.250» se lee como 1250: los puntos de miles no hacen inválido el número.
  const escrito = datos.numeroManual ? numero.replace(/[.\s]/g, '') : '';
  const fueraDeRango = errorNumeroManual(escrito, numeracion);
  const valido = !!escrito && !fueraDeRango;
  function enviar(e: FormEvent) {
    e.preventDefault();
    if (fueraDeRango) {
      setError(fueraDeRango);
      return;
    }
    responder({ numero: escrito ? Number(escrito) : null });
  }
  return (
    <form onSubmit={enviar}>
      <div className="dialogo-mensaje">
        <p>Revisa los datos que verá el cliente antes de generar el documento.</p>
        <p>Cliente: <strong>{datos.cliente || 'Sin nombre'}</strong></p>
        {!!datos.productos?.length && (
          <div className="emission-review">
            <strong>Productos y medidas</strong>
            <ul>
              {datos.productos.map((producto, i) => (
                <li key={i}>
                  <span>{producto.nombre}</span>
                  {producto.medida && <small>{producto.medida}</small>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p>
          Total a emitir: <strong>{pesos(datos.total)}</strong> (IVA incluido).
        </p>
        {datos.reemplaza ? (
          <p>
            Es una revisión: al emitirla, la cotización N° {datos.reemplaza} quedará <strong>Reemplazada</strong>
            (se guarda para consultarla, pero ya no se podrá aprobar) y su PDF se conserva.
          </p>
        ) : null}
        {datos.numeroManual ? (
          <>
            <p>
              Si dejas el número vacío se asignará el siguiente número disponible
              {numeracion ? <> (N° {numeracion.siguiente.toLocaleString('es-CL')})</> : null}.
            </p>
            {numeracion ? (
              <p id="emision-rango">
                Último número usado o reservado: <strong>N° {numeracion.ultimo.toLocaleString('es-CL')}</strong>. Un
                número a mano puede ir del {numeracion.siguiente.toLocaleString('es-CL')} al{' '}
                {numeracion.tope.toLocaleString('es-CL')}.
              </p>
            ) : (
              <p id="emision-rango">
                Un número a mano debe ser mayor que el último usado o reservado y no superarlo en más de 1.000.
              </p>
            )}
          </>
        ) : (
          <p>Se le asignará el siguiente número disponible.</p>
        )}
        {valido && (
          // El salto no se deshace: los números intermedios no se vuelven a usar.
          <p className="dialogo-advertencia" id="emision-salto">
            Se emitirá como N° {Number(escrito).toLocaleString('es-CL')}: los números que se salten no se usarán
            después y la siguiente cotización seguirá desde el {(Number(escrito) + 1).toLocaleString('es-CL')}.
          </p>
        )}
      </div>
      {datos.numeroManual && (
        <div className="dialogo-campos">
          <label className="ia-field">
            <span>Número de cotización (opcional)</span>
            <input
              inputMode="numeric"
              value={numero}
              onChange={(e) => {
                setNumero(e.target.value);
                setError('');
              }}
              placeholder="Siguiente disponible"
              autoComplete="off"
              maxLength={13}
              aria-invalid={error ? true : undefined}
              aria-describedby={
                error ? 'emision-numero-error' : valido ? 'emision-salto emision-rango' : 'emision-rango'
              }
            />
          </label>
          {error && (
            <p className="campo-error" id="emision-numero-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
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
    pagado: number;
    resolver: (r: { motivo: string } | null) => void;
  } | null>(null);
  const pedir = useCallback(
    (numero: number | null, aprobada: boolean, pagado = 0) =>
      new Promise<{ motivo: string } | null>((resolver) => setPendiente({ numero, aprobada, pagado, resolver })),
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
      {pendiente && <FormAnulacion aprobada={pendiente.aprobada} pagado={pendiente.pagado} responder={cerrar} cancelar={cancelar} />}
    </Dialogo>
  );
  return [pedir, elemento] as const;
}
function FormAnulacion({
  aprobada,
  pagado,
  responder,
  cancelar,
}: {
  aprobada: boolean;
  /** Pagos registrados: anular no los devuelve, y se advierte. */
  pagado: number;
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
        {pagado > 0 && (
          <p className="dialogo-advertencia">
            <strong>Tiene {pesos(pagado)} pagado; anular no lo devuelve.</strong> La devolución se gestiona aparte y
            el monto queda anotado en la actividad.
          </p>
        )}
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

interface DatosAnulacionPago {
  monto: string;
  fecha: string;
  /** Consecuencia que conviene leer antes de confirmar (p. ej. la producción vuelve a exigir el anticipo). */
  aviso?: string;
}
/** Anular un pago registrado por error: motivo opcional; el monto vuelve al saldo y queda en la actividad. */
export function useAnulacionPago() {
  const [pendiente, setPendiente] = useState<
    (DatosAnulacionPago & { resolver: (r: { motivo: string } | null) => void }) | null
  >(null);
  const pedir = useCallback(
    (datos: DatosAnulacionPago) =>
      new Promise<{ motivo: string } | null>((resolver) => setPendiente({ ...datos, resolver })),
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
      titulo="Anular el pago"
      eyebrow="ANULAR PAGO"
      className="dialogo-confirmacion"
      focoInicial={cancelar}
      alerta
    >
      {pendiente && <FormAnulacionPago datos={pendiente} responder={cerrar} cancelar={cancelar} />}
    </Dialogo>
  );
  return [pedir, elemento] as const;
}
function FormAnulacionPago({
  datos,
  responder,
  cancelar,
}: {
  datos: DatosAnulacionPago;
  responder: (r: { motivo: string } | null) => void;
  cancelar: RefObject<HTMLButtonElement | null>;
}) {
  const [motivo, setMotivo] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        responder({ motivo: motivo.trim() });
      }}
    >
      <div className="dialogo-mensaje">
        <p>
          Se quitará el pago de <strong>{datos.monto}</strong> del {datos.fecha} y ese monto volverá al saldo
          pendiente. Queda registrado en la actividad.
        </p>
        {datos.aviso && <p className="dialogo-advertencia">{datos.aviso}</p>}
      </div>
      <div className="dialogo-campos">
        <label className="ia-field">
          <span>Motivo (opcional)</span>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={300}
            rows={2}
            placeholder="Ej. monto mal ingresado"
          />
        </label>
      </div>
      <div className="dialogo-acciones">
        <button ref={cancelar} type="button" className="button secondary" onClick={() => responder(null)}>
          Cancelar
        </button>
        <button type="submit" className="button peligro">
          Anular pago
        </button>
      </div>
    </form>
  );
}

interface DatosRetroceso {
  /** Etiquetas del paso actual y del anterior («Despachada» → «Lista para despacho»). */
  desde: string;
  hasta: string;
}
/** Volver un paso de la operación: el motivo es obligatorio y queda en la actividad. */
export function useRetroceso() {
  const [pendiente, setPendiente] = useState<
    (DatosRetroceso & { resolver: (r: { motivo: string } | null) => void }) | null
  >(null);
  const pedir = useCallback(
    (datos: DatosRetroceso) =>
      new Promise<{ motivo: string } | null>((resolver) => setPendiente({ ...datos, resolver })),
    [],
  );
  const campo = useRef<HTMLTextAreaElement>(null);
  const cerrar = (r: { motivo: string } | null) => {
    pendiente?.resolver(r);
    setPendiente(null);
  };
  const elemento = (
    <Dialogo
      abierto={!!pendiente}
      alCerrar={() => cerrar(null)}
      titulo="Volver al paso anterior"
      eyebrow="OPERACIÓN"
      className="dialogo-confirmacion"
      focoInicial={campo}
      alerta
    >
      {pendiente && <FormRetroceso datos={pendiente} responder={cerrar} campo={campo} />}
    </Dialogo>
  );
  return [pedir, elemento] as const;
}
function FormRetroceso({
  datos,
  responder,
  campo,
}: {
  datos: DatosRetroceso;
  responder: (r: { motivo: string } | null) => void;
  campo: RefObject<HTMLTextAreaElement | null>;
}) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (motivo.trim()) responder({ motivo: motivo.trim() });
        else {
          setError('Escribe el motivo: queda registrado en la actividad.');
          campo.current?.focus();
        }
      }}
    >
      <div className="dialogo-mensaje">
        <p>
          La operación vuelve de «{datos.desde}» a «{datos.hasta}». El cambio y su motivo quedan en la actividad.
        </p>
      </div>
      <div className="dialogo-campos">
        <label className="ia-field">
          <span>Motivo</span>
          <textarea
            ref={campo}
            value={motivo}
            onChange={(e) => {
              setMotivo(e.target.value);
              setError('');
            }}
            maxLength={300}
            rows={2}
            placeholder="Ej. se marcó por error"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'retroceso-error' : undefined}
          />
        </label>
        {error && (
          <p className="campo-error" id="retroceso-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialogo-acciones">
        <button type="button" className="button secondary" onClick={() => responder(null)}>
          Cancelar
        </button>
        <button type="submit" className="button primary">
          Volver al paso anterior
        </button>
      </div>
    </form>
  );
}

/** Un ítem del pedido en el reparto entre fábricas, con la fábrica que tiene asignada (null si ninguna). */
export interface LineaReparto {
  indice: number;
  nombre: string;
  detalle: string | null;
  fabrica: Fabrica | null;
}
interface DatosReparto {
  lineas: LineaReparto[];
  /** Al aceptar se generan las notas de pedido: exige fábrica en todos los ítems. Sin él, solo se guarda el reparto. */
  generar: boolean;
}
type Asignaciones = { indice: number; fabrica: Fabrica | null }[];

/**
 * Reparto entre fábricas: quien cotiza elige la de cada ítem (no hay una por omisión). Para generar las notas de
 * pedido, una por fábrica con sus ítems, todos deben tener fábrica; cada una numera sus notas por separado.
 */
export function useRepartoFabricas() {
  const [pendiente, setPendiente] = useState<(DatosReparto & { resolver: (r: { asignaciones: Asignaciones } | null) => void }) | null>(null);
  const pedir = useCallback(
    (datos: DatosReparto) =>
      new Promise<{ asignaciones: Asignaciones } | null>((resolver) => setPendiente({ ...datos, resolver })),
    [],
  );
  const cancelar = useRef<HTMLButtonElement>(null);
  const cerrar = (r: { asignaciones: Asignaciones } | null) => {
    pendiente?.resolver(r);
    setPendiente(null);
  };
  const elemento = (
    <Dialogo
      abierto={!!pendiente}
      alCerrar={() => cerrar(null)}
      titulo={pendiente?.generar ? '¿Generar las notas de pedido?' : 'Repartir entre fábricas'}
      eyebrow="OPERACIÓN"
      className="dialogo-confirmacion dialogo-reparto"
      focoInicial={cancelar}
      alerta={pendiente?.generar}
    >
      {pendiente && <FormReparto datos={pendiente} responder={cerrar} cancelar={cancelar} />}
    </Dialogo>
  );
  return [pedir, elemento] as const;
}
function FormReparto({
  datos,
  responder,
  cancelar,
}: {
  datos: DatosReparto;
  responder: (r: { asignaciones: Asignaciones } | null) => void;
  cancelar: RefObject<HTMLButtonElement | null>;
}) {
  const [fabricas, setFabricas] = useState<Map<number, Fabrica | null>>(
    () => new Map(datos.lineas.map((l) => [l.indice, l.fabrica])),
  );
  const [error, setError] = useState('');
  const elegir = (indice: number, fabrica: Fabrica) => {
    setFabricas((m) => new Map(m).set(indice, fabrica));
    setError('');
  };
  const todas = (fabrica: Fabrica) => {
    setFabricas(new Map(datos.lineas.map((l) => [l.indice, fabrica])));
    setError('');
  };
  const sinFabrica = datos.lineas.filter((l) => !fabricas.get(l.indice));
  const porFabrica = FABRICAS.map((f) => ({ f, n: datos.lineas.filter((l) => fabricas.get(l.indice) === f).length })).filter(
    (x) => x.n,
  );
  const items = (n: number) => `${n} ítem${n === 1 ? '' : 's'}`;
  function enviar(e: FormEvent) {
    e.preventDefault();
    if (datos.generar && sinFabrica.length) {
      setError(`Elige la fábrica de ${sinFabrica.length === 1 ? 'un ítem' : `${sinFabrica.length} ítems`}: ${sinFabrica.map((l) => l.nombre).join(', ')}.`);
      return;
    }
    responder({
      asignaciones: datos.lineas
        .filter((l) => (fabricas.get(l.indice) ?? null) !== l.fabrica)
        .map((l) => ({ indice: l.indice, fabrica: fabricas.get(l.indice) ?? null })),
    });
  }
  return (
    <form onSubmit={enviar}>
      <div className="dialogo-mensaje">
        {datos.generar ? (
          <p>
            Se genera una nota de pedido por fábrica, cada una con sus ítems a precio de fábrica. Cada fábrica asigna su
            siguiente N° de nota (no se reutiliza).
          </p>
        ) : (
          <p>Elige qué fábrica hace cada ítem. Puedes cambiarlo hasta generar las notas de pedido.</p>
        )}
      </div>
      <div className="reparto-todas" role="group" aria-label="Asignar todos los ítems">
        {FABRICAS.map((f) => (
          <button key={f} type="button" className="button secondary small" onClick={() => todas(f)}>
            Todo a {nombreFabrica[f]}
          </button>
        ))}
      </div>
      <ul className="reparto-lineas">
        {datos.lineas.map((l) => (
          <li key={l.indice}>
            <span className="reparto-producto">
              <b>{l.nombre}</b>
              {l.detalle && <small>{l.detalle}</small>}
            </span>
            <span className="reparto-opciones" role="radiogroup" aria-label={`Fábrica de ${l.nombre}`}>
              {FABRICAS.map((f) => (
                <label key={f} className="opcion-fabrica" title={productosFabrica[f]}>
                  <input
                    type="radio"
                    name={`fabrica-${l.indice}`}
                    value={f}
                    checked={fabricas.get(l.indice) === f}
                    onChange={() => elegir(l.indice, f)}
                  />
                  <span>{nombreFabrica[f]}</span>
                </label>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="reparto-resumen" aria-live="polite">
        {porFabrica.length
          ? `${datos.generar ? (porFabrica.length > 1 ? `Se generarán ${porFabrica.length} notas: ` : 'Se generará 1 nota: ') : ''}${porFabrica.map(({ f, n }) => `${nombreFabrica[f]}, ${items(n)}`).join(' · ')}`
          : 'Ningún ítem tiene fábrica todavía.'}
        {sinFabrica.length > 0 && porFabrica.length > 0 ? ` · sin fábrica: ${items(sinFabrica.length)}` : ''}
      </p>
      {error && (
        <p className="campo-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialogo-acciones">
        <button ref={cancelar} type="button" className="button secondary" onClick={() => responder(null)}>
          Cancelar
        </button>
        <button type="submit" className="button primary">
          {datos.generar ? (porFabrica.length > 1 ? 'Generar notas de pedido' : 'Generar nota de pedido') : 'Guardar reparto'}
        </button>
      </div>
    </form>
  );
}

/** Numeración de la cotización y de las notas de cada fábrica (`GET ?numeracion=1`). */
export interface NumeracionDocumentos extends Numeracion {
  notas?: Partial<Record<Fabrica, Numeracion>>;
}
interface DatosCambioNumero {
  documento: 'cotizacion' | 'nota';
  fabrica?: Fabrica;
  actual: number;
  /** La cotización tiene notas de pedido: también se vuelven a generar, porque la nombran. */
  conNotas?: boolean;
}

/**
 * Cambio del número de un documento ya emitido, desde el propio documento (solo cuentas administradoras). El número
 * debe estar libre: uno mayor que el último mueve la serie; uno menor solo sirve si nunca se usó (lo comprueba el
 * servidor). El PDF se vuelve a generar con el número nuevo.
 */
export function useCambioNumero() {
  const [pendiente, setPendiente] = useState<(DatosCambioNumero & { resolver: (r: { numero: number } | null) => void }) | null>(
    null,
  );
  const pedir = useCallback(
    (datos: DatosCambioNumero) =>
      new Promise<{ numero: number } | null>((resolver) => setPendiente({ ...datos, resolver })),
    [],
  );
  const campo = useRef<HTMLInputElement>(null);
  const cerrar = (r: { numero: number } | null) => {
    pendiente?.resolver(r);
    setPendiente(null);
  };
  const documento = pendiente
    ? pendiente.documento === 'cotizacion'
      ? `la cotización N° ${pendiente.actual}`
      : `la nota de pedido N° ${pendiente.actual}${pendiente.fabrica ? ` de ${nombreFabrica[pendiente.fabrica]}` : ''}`
    : '';
  const elemento = (
    <Dialogo
      abierto={!!pendiente}
      alCerrar={() => cerrar(null)}
      titulo={`Cambiar el número de ${documento}`}
      eyebrow="NUMERACIÓN"
      className="dialogo-confirmacion"
      focoInicial={campo}
      alerta
    >
      {pendiente && <FormCambioNumero datos={pendiente} responder={cerrar} campo={campo} />}
    </Dialogo>
  );
  return [pedir, elemento] as const;
}
function FormCambioNumero({
  datos,
  responder,
  campo,
}: {
  datos: DatosCambioNumero;
  responder: (r: { numero: number } | null) => void;
  campo: RefObject<HTMLInputElement | null>;
}) {
  const [numero, setNumero] = useState('');
  const [error, setError] = useState('');
  const [numeracion, setNumeracion] = useState<NumeracionDocumentos | null>(null);
  useEffect(() => {
    const control = new AbortController();
    pedirJSON<NumeracionDocumentos>('/api/accion?numeracion=1', { signal: control.signal, cache: 'no-store' })
      .then(setNumeracion)
      .catch(() => {});
    return () => control.abort();
  }, []);
  const serie = datos.documento === 'nota' && datos.fabrica ? numeracion?.notas?.[datos.fabrica] : numeracion;
  const miles = (x: number) => x.toLocaleString('es-CL');
  const escrito = numero.replace(/[.\s]/g, '');
  const invalido = !escrito
    ? 'Escribe el número nuevo.'
    : !/^\d+$/.test(escrito) || Number(escrito) <= 0
      ? 'El número debe ser un entero positivo.'
      : Number(escrito) === datos.actual
        ? `El documento ya tiene el N° ${miles(datos.actual)}.`
        : serie && Number(escrito) > serie.tope
          ? `El número puede saltar hasta 1.000 sobre el último: elige uno hasta el ${miles(serie.tope)}.`
          : null;
  const n = Number(escrito);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (invalido) {
          setError(invalido);
          campo.current?.focus();
        } else responder({ numero: n });
      }}
    >
      <div className="dialogo-mensaje">
        <p>
          Se vuelve a generar {datos.conNotas ? 'su PDF y los de sus notas de pedido, que la nombran,' : 'su PDF'} con el
          número nuevo, y el cambio queda en la actividad. El PDF con el número anterior se reemplaza.
        </p>
        {serie ? (
          <p id="cambio-numero-serie">
            {datos.documento === 'nota' && datos.fabrica ? `Notas de ${nombreFabrica[datos.fabrica]}: ` : 'Cotizaciones: '}
            el último número usado o reservado es el <strong>N° {miles(serie.ultimo)}</strong>. Uno menor solo sirve si
            nunca se usó.
          </p>
        ) : (
          <p id="cambio-numero-serie">El número debe estar libre: uno que ya usa otro documento no se acepta.</p>
        )}
        {!invalido && serie && n > serie.ultimo && (
          <p className="dialogo-advertencia" id="cambio-numero-salto">
            La serie seguirá desde el N° {miles(n + 1)}: los números que se salten no se usarán después.
          </p>
        )}
      </div>
      <div className="dialogo-campos">
        <label className="ia-field">
          <span>Número nuevo</span>
          <input
            ref={campo}
            inputMode="numeric"
            value={numero}
            onChange={(e) => {
              setNumero(e.target.value);
              setError('');
            }}
            placeholder={`Hoy: ${miles(datos.actual)}`}
            autoComplete="off"
            maxLength={13}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'cambio-numero-error' : 'cambio-numero-serie'}
          />
        </label>
        {error && (
          <p className="campo-error" id="cambio-numero-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialogo-acciones">
        <button type="button" className="button secondary" onClick={() => responder(null)}>
          Cancelar
        </button>
        <button type="submit" className="button primary">
          Cambiar número
        </button>
      </div>
    </form>
  );
}

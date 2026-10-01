'use client';
import { useId, useState, type FormEvent } from 'react';
import { metros } from '@/catalogo/resolver';
import { metrosTexto } from '@/catalogo/escalones';
import { cambiosRespuesta, type PreguntaPendiente } from '@/negocio/pendientes';
import type { CambiosEdicion } from './contrato';

/** Con más opciones que estas, un desplegable se lee mejor que una fila de botones. */
const MAX_BOTONES = 10;

interface Props {
  preguntas: PreguntaPendiente[];
  editable: boolean;
  guardando: string | null;
  responder: (cambios: CambiosEdicion, campo: string) => Promise<boolean>;
}

/**
 * Preguntas de los ítems pendientes. Cada respuesta se guarda con una edición directa: no pasa por la IA,
 * así que es inmediata y no se puede malinterpretar.
 */
export function PreguntasPendientes({ preguntas, editable, guardando, responder }: Props) {
  if (!preguntas.length) return null;
  return (
    <div className="pendientes-preguntas">
      {preguntas.map((p) => (
        <Pregunta
          key={p.clave}
          pregunta={p}
          editable={editable}
          guardando={guardando === `pendiente.${p.clave}`}
          responder={(valor) => responder(cambiosRespuesta(p, valor), `pendiente.${p.clave}`)}
        />
      ))}
    </div>
  );
}

function Pregunta({
  pregunta: p,
  editable,
  guardando,
  responder,
}: {
  pregunta: PreguntaPendiente;
  editable: boolean;
  guardando: boolean;
  responder: (valor: string | number) => Promise<boolean>;
}) {
  const id = useId();
  const deshabilitado = !editable || guardando;
  const desplegable = p.opciones.length > MAX_BOTONES;
  return (
    <div className="pendiente-pregunta" role="group" aria-labelledby={`${id}-texto`}>
      <p id={`${id}-texto`} className="pendiente-texto">
        {p.texto}
        {guardando && <span className="pendiente-guardando"> · Guardando…</span>}
      </p>
      {p.detalle && <p className="pendiente-detalle">{p.detalle}</p>}
      {p.opciones.length > 0 &&
        (desplegable ? (
          <Desplegable pregunta={p} deshabilitado={deshabilitado} responder={responder} />
        ) : (
          <div className="pendiente-opciones">
            {p.opciones.map((o) => (
              <button
                key={String(o.valor)}
                type="button"
                className={o.sugerencia ? 'sugerida' : undefined}
                disabled={deshabilitado}
                onClick={() => void responder(o.valor)}
                aria-label={`${o.etiqueta}${o.sugerencia ? ` (${o.sugerencia.toLowerCase()})` : ''} · ${p.texto}`}
              >
                {o.etiqueta}
                {o.sugerencia && <small>{o.sugerencia}</small>}
              </button>
            ))}
          </div>
        ))}
      {p.entrada && <Entrada pregunta={p} deshabilitado={deshabilitado} responder={responder} />}
    </div>
  );
}

function Desplegable({
  pregunta: p,
  deshabilitado,
  responder,
}: {
  pregunta: PreguntaPendiente;
  deshabilitado: boolean;
  responder: (valor: string | number) => Promise<boolean>;
}) {
  const [valor, setValor] = useState('');
  const opcion = p.opciones.find((o) => String(o.valor) === valor);
  return (
    <form
      className="pendiente-entrada"
      onSubmit={(e) => {
        e.preventDefault();
        if (opcion) void responder(opcion.valor);
      }}
    >
      <select
        aria-label={p.texto}
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        disabled={deshabilitado}
      >
        <option value="">Elegir…</option>
        {p.opciones.map((o) => (
          <option key={String(o.valor)} value={String(o.valor)}>
            {o.etiqueta}
            {o.sugerencia ? ` · ${o.sugerencia}` : ''}
          </option>
        ))}
      </select>
      <button type="submit" className="button secondary small" disabled={deshabilitado || !opcion}>
        Aplicar
      </button>
    </form>
  );
}

function Entrada({
  pregunta: p,
  deshabilitado,
  responder,
}: {
  pregunta: PreguntaPendiente;
  deshabilitado: boolean;
  responder: (valor: string | number) => Promise<boolean>;
}) {
  const entrada = p.entrada!;
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const idError = useId();
  const enMetros = entrada.unidad === 'm';
  const rango = enMetros
    ? `entre ${metrosTexto(entrada.min)} y ${metrosTexto(entrada.max)} m`
    : `entre ${entrada.min} y ${entrada.max.toLocaleString('es-CL')}`;
  function enviar(e: FormEvent) {
    e.preventDefault();
    const n = Number(texto.trim().replace(',', '.'));
    // Una medida se acepta también en centímetros o milímetros: «80» es 0,80 m.
    const valor = enMetros ? metros(n) : n;
    const valido =
      valor !== null &&
      Number.isFinite(valor) &&
      (enMetros || Number.isInteger(valor)) &&
      valor >= entrada.min - 1e-9 &&
      valor <= entrada.max + 1e-9;
    if (!valido) {
      setError(`Indica ${enMetros ? 'una medida' : 'un número entero'} ${rango}.`);
      return;
    }
    setError(null);
    void responder(valor).then((ok) => ok && setTexto(''));
  }
  return (
    <form className="pendiente-entrada" onSubmit={enviar} noValidate>
      <input
        type="text"
        inputMode={enMetros ? 'decimal' : 'numeric'}
        aria-label={`${p.texto} (${rango})`}
        aria-invalid={!!error}
        aria-describedby={error ? idError : undefined}
        placeholder={enMetros ? `${metrosTexto(entrada.min)}–${metrosTexto(entrada.max)}` : 'Cantidad'}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        disabled={deshabilitado}
      />
      {enMetros && <span className="pendiente-unidad">m</span>}
      <button type="submit" className="button secondary small" disabled={deshabilitado || !texto.trim()}>
        Aplicar
      </button>
      {error && (
        <p className="pendiente-error" id={idError} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

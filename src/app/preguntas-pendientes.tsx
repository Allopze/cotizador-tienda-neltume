'use client';
import { useId, useState, type FormEvent } from 'react';
import { metrosTexto } from '@/catalogo/escalones';
import { cambiosRespuesta, type PreguntaPendiente } from '@/negocio/pendientes';
import type { CambiosEdicion } from './contrato';
import { AltaProducto } from './alta-producto';
import { Dialogo } from './dialogo';
import { leerMedida } from './formato';

/** Con más opciones que estas, un desplegable se lee mejor que una fila de botones. */
const MAX_BOTONES = 10;

/** Resumen del detalle de un ítem pendiente por precio o descuento: la explicación completa va bajo el producto. */
export const RESUMEN_FUERA_DE_REGLA = 'Precio o descuento fuera de regla';

/**
 * Preguntas del detalle de un ítem sin la explicación de un precio o descuento fuera de regla, que ya se lee bajo
 * el producto: la pregunta conserva el título y el botón para corregirlo. En el chat se muestra completa.
 */
export function sinExplicacionRepetida(preguntas: PreguntaPendiente[], explicacion: string | null) {
  if (!explicacion) return preguntas;
  // El detalle es la explicación sin una lista final de opciones (`sinLista`): basta con que la empiece.
  return preguntas.map((p) =>
    p.campo === null && p.detalle && explicacion.startsWith(p.detalle) ? { ...p, detalle: null } : p,
  );
}

interface Props {
  preguntas: PreguntaPendiente[];
  editable: boolean;
  asistente: boolean;
  guardando: string | null;
  responder: (cambios: CambiosEdicion, campo: string) => Promise<boolean>;
}

/**
 * Preguntas de los ítems pendientes. Cada respuesta se guarda con una edición directa: no pasa por la IA,
 * así que es inmediata y no se puede malinterpretar.
 */
export function PreguntasPendientes({ preguntas, editable, asistente, guardando, responder }: Props) {
  if (!preguntas.length) return null;
  return (
    <div className="pendientes-preguntas">
      {preguntas.map((p) => (
        <Pregunta
          key={p.clave}
          pregunta={p}
          editable={editable}
          asistente={asistente}
          guardando={guardando === `pendiente.${p.clave}`}
          responder={(valor) => responder(cambiosRespuesta(p, valor), `pendiente.${p.clave}`)}
          alGuardar={() => responder({}, `pendiente.${p.clave}`)}
        />
      ))}
    </div>
  );
}

function Pregunta({
  pregunta: p,
  editable,
  asistente,
  guardando,
  responder,
  alGuardar,
}: {
  pregunta: PreguntaPendiente;
  editable: boolean;
  asistente: boolean;
  guardando: boolean;
  responder: (valor: string | number) => Promise<boolean>;
  alGuardar: () => Promise<boolean>;
}) {
  const id = useId();
  const [altaAbierta, setAltaAbierta] = useState(false);
  const deshabilitado = !editable || guardando;
  const desplegable = p.opciones.length > MAX_BOTONES;
  const botonAlta = p.alta && editable && (
    <button type="button" disabled={deshabilitado} onClick={() => setAltaAbierta(true)}>
      {p.modeloNuevo ? 'Es un modelo nuevo' : 'Agregar al catálogo'}
    </button>
  );
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
            {botonAlta}
          </div>
        ))}
      {p.entrada && <Entrada pregunta={p} deshabilitado={deshabilitado} responder={responder} />}
      {(desplegable || !p.opciones.length) && botonAlta && (
        <div className="pendiente-opciones">{botonAlta}</div>
      )}
      {p.alta && (
        <Dialogo
          abierto={altaAbierta}
          alCerrar={() => setAltaAbierta(false)}
          titulo="Agregar al catálogo"
          className="dialogo-alta"
        >
          <AltaProducto
            inicial={p.alta}
            asistente={asistente}
            alGuardar={() => {
              setAltaAbierta(false);
              void alGuardar();
            }}
          />
        </Dialogo>
      )}
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
    // Una medida se lee como en el detalle del ítem, con la familia del ítem: «80», «0,80», «80 cm» o «3600 mm».
    const valor = enMetros
      ? leerMedida(texto, entrada.familia ?? 'PUERTA', p.campo === 'ancho' ? 'ancho' : 'alto')
      : Number(texto.trim().replace(',', '.'));
    const valido =
      valor !== null &&
      Number.isFinite(valor) &&
      (enMetros || Number.isInteger(valor)) &&
      valor >= entrada.min - 1e-9 &&
      valor <= entrada.max + 1e-9;
    if (!valido) {
      setError(
        enMetros
          ? `Indica una medida ${rango}: en metros (${metrosTexto(entrada.min)}) o con «cm» o «mm» (${Math.round(entrada.min * 100)} cm).`
          : `Indica un número entero ${rango}.`,
      );
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

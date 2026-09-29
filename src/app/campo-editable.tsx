'use client';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';

// Valor con edición en línea: muestra el dato y un botón «Editar»; al guardar informa su propio estado.
interface Props {
  etiqueta: string;
  valor: string;
  /** Lo que se muestra fuera de edición (por omisión el valor o «—»). */
  mostrar?: ReactNode;
  editable: boolean;
  guardando: boolean;
  /** Devuelve un mensaje de error de validación o null si es válido. */
  validar?: (v: string) => string | null;
  guardar: (v: string) => Promise<boolean>;
  tipo?: 'text' | 'number';
  min?: number;
  max?: number;
  paso?: number;
  maxLength?: number;
  sufijo?: string;
  /** Oculta la etiqueta visible (p. ej. dentro de una tabla). */
  etiquetaOculta?: boolean;
  /** El valor mismo abre la edición (sin botón «Editar» aparte); vacío se lee «Agregar». */
  discreto?: boolean;
  className?: string;
}
export function CampoEditable({
  etiqueta,
  valor,
  mostrar,
  editable,
  guardando,
  validar,
  guardar,
  tipo = 'text',
  min,
  max,
  paso,
  maxLength = 300,
  sufijo,
  etiquetaOculta,
  discreto,
  className,
}: Props) {
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState(valor);
  const [error, setError] = useState('');
  const entrada = useRef<HTMLInputElement>(null),
    boton = useRef<HTMLButtonElement>(null);
  const id = useId();

  function abrir() {
    setBorrador(valor);
    setError('');
    setEditando(true);
    requestAnimationFrame(() => entrada.current?.select());
  }
  function cerrar() {
    setEditando(false);
    setError('');
    requestAnimationFrame(() => boton.current?.focus());
  }
  async function enviar(e: FormEvent) {
    e.preventDefault();
    const v = borrador.trim();
    if (v === valor.trim()) return cerrar();
    const problema = validar?.(v) ?? null;
    if (problema) {
      setError(problema);
      entrada.current?.focus();
      return;
    }
    if (await guardar(v)) cerrar();
  }

  if (!editando && discreto && editable)
    return (
      <div className={`campo campo-discreto ${className ?? ''}`}>
        {!etiquetaOculta && <span className="campo-etiqueta">{etiqueta}</span>}
        <button
          ref={boton}
          type="button"
          className="campo-valor-boton"
          onClick={abrir}
          disabled={guardando}
          aria-label={`Editar ${etiqueta.toLowerCase()}${valor ? `: ${valor}` : ''}`}
        >
          {guardando ? (
            <span>Guardando…</span>
          ) : valor ? (
            <span>{mostrar ?? valor}</span>
          ) : (
            <span className="campo-vacio">Agregar</span>
          )}
          <span className="campo-lapiz" aria-hidden>
            ✎
          </span>
        </button>
      </div>
    );
  if (!editando)
    return (
      <div className={`campo ${className ?? ''}`}>
        {!etiquetaOculta && <span className="campo-etiqueta">{etiqueta}</span>}
        <span className="campo-valor">
          <strong>{guardando ? 'Guardando…' : (mostrar ?? (valor || '—'))}</strong>
          {editable && (
            <button
              ref={boton}
              type="button"
              className="campo-editar"
              onClick={abrir}
              disabled={guardando}
              aria-label={`Editar ${etiqueta.toLowerCase()}`}
            >
              Editar
            </button>
          )}
        </span>
      </div>
    );
  return (
    <form className={`campo editando ${className ?? ''}`} onSubmit={enviar}>
      <label htmlFor={id} className={etiquetaOculta ? 'sr-only' : 'campo-etiqueta'}>
        {etiqueta}
      </label>
      <span className="campo-valor">
        <input
          ref={entrada}
          id={id}
          type={tipo}
          inputMode={tipo === 'number' ? (paso === 1 ? 'numeric' : 'decimal') : undefined}
          min={min}
          max={max}
          step={paso}
          maxLength={tipo === 'text' ? maxLength : undefined}
          value={borrador}
          onChange={(e) => setBorrador(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              cerrar();
            }
          }}
          disabled={guardando}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        {sufijo && <span className="campo-sufijo">{sufijo}</span>}
        <button type="submit" className="campo-guardar" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" className="campo-cancelar" onClick={cerrar} disabled={guardando}>
          Cancelar
        </button>
      </span>
      {error && (
        <span className="campo-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

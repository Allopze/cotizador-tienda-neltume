'use client';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

/**
 * Campos en edición con cambios sin guardar. El panel los registra para avisar antes de emitir o de salir
 * (auditoría BUG-011) y para marcar el campo como «sin guardar» (BUG-057).
 */
export interface RegistroCamposAbiertos {
  registrar: (id: string, sucio: boolean) => void;
  quitar: (id: string) => void;
}
export const CamposAbiertosContext = createContext<RegistroCamposAbiertos | null>(null);

/** Sugerencia mientras se escribe (p. ej. un cliente de otra cotización): elegirla la aplica y cierra el campo. */
export interface SugerenciaCampo {
  clave: string;
  etiqueta: string;
  detalle?: string;
  /** Guarda lo sugerido; true si quedó guardado. */
  aplicar: () => Promise<boolean>;
}

/** Desde cuántas letras se buscan sugerencias, y la pausa tras la última tecla. */
const MIN_SUGERIR = 2;
const PAUSA_SUGERIR_MS = 250;

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
  /** Teclado de los dispositivos táctiles en un campo de texto que recibe cifras (p. ej. «12,5»). */
  modoEntrada?: 'decimal' | 'numeric';
  maxLength?: number;
  sufijo?: string;
  /** Oculta la etiqueta visible (p. ej. dentro de una tabla). */
  etiquetaOculta?: boolean;
  /** El valor mismo abre la edición (sin botón «Editar» aparte); vacío se lee «Agregar». */
  discreto?: boolean;
  /** Indicación cuando no hay valor (p. ej. «Agregar dirección»): se ve como campo vacío, nunca como un dato. */
  vacio?: string;
  className?: string;
  area?: boolean;
  /**
   * Abre con el cursor al final, para retocar un texto largo (p. ej. la descripción del documento). Por
   * omisión se selecciona todo: lo que se escribe reemplaza el valor, y un monto nunca se concatena.
   */
  cursorAlFinal?: boolean;
  /**
   * Sugerencias para lo escrito, desde dos letras y tras una pausa breve; la búsqueda anterior se cancela. Se
   * eligen con el mouse, el dedo o las flechas y Enter.
   */
  sugerir?: (texto: string, senal: AbortSignal) => Promise<SugerenciaCampo[]>;
  /** Aparece ya en edición y con el foco (p. ej. al elegir «Otro» transportista, hasta escribir el nombre). */
  abrirAlMontar?: boolean;
  /** Se cancela la edición sin guardar (Escape o «Cancelar»). */
  alCancelar?: () => void;
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
  modoEntrada,
  maxLength = 300,
  sufijo,
  etiquetaOculta,
  discreto,
  vacio,
  className,
  area = false,
  cursorAlFinal = false,
  sugerir,
  abrirAlMontar = false,
  alCancelar,
}: Props) {
  // El borrador es de quien escribe: se toma del valor al abrir y no se pisa mientras se edita, aunque llegue
  // otra versión de la cotización (otra vendedora guardó, o se volvió a la pestaña).
  const [editando, setEditando] = useState(abrirAlMontar);
  const [borrador, setBorrador] = useState(valor);
  const [error, setError] = useState('');
  const [sugerencias, setSugerencias] = useState<SugerenciaCampo[]>([]);
  const [activa, setActiva] = useState(-1);
  const entrada = useRef<HTMLInputElement | HTMLTextAreaElement>(null),
    boton = useRef<HTMLButtonElement>(null);
  /** Al cerrar, el foco vuelve al botón que abrió el campo en cuanto esté disponible (tras «Guardando…»). */
  const devolverFoco = useRef(false);
  const busqueda = useRef<{ temporizador?: ReturnType<typeof setTimeout>; control?: AbortController }>({});
  const id = useId();
  // Lo escrito que aún no está guardado: el panel lo cuenta para avisar y el campo lo marca.
  const registro = useContext(CamposAbiertosContext);
  const sucio = editando && borrador.trim() !== valor.trim();
  useEffect(() => {
    if (!registro) return;
    registro.registrar(id, sucio);
    return () => registro.quitar(id);
  }, [registro, id, sucio]);

  useEffect(() => {
    if (!abrirAlMontar) return;
    entrada.current?.focus();
  }, [abrirAlMontar]);
  useEffect(() => {
    const estado = busqueda.current;
    return () => {
      clearTimeout(estado.temporizador);
      estado.control?.abort();
    };
  }, []);
  // Sin dependencias: se reintenta tras cada render hasta que el botón exista y esté habilitado. Si la persona ya
  // pasó a otro control, no se le quita el foco.
  useEffect(() => {
    if (editando || !devolverFoco.current) return;
    const destino = boton.current;
    if (!destino || destino.disabled) return;
    devolverFoco.current = false;
    const activo = document.activeElement;
    if (!activo || activo === document.body) destino.focus();
  });

  function cancelarBusqueda() {
    const estado = busqueda.current;
    clearTimeout(estado.temporizador);
    estado.control?.abort();
    estado.temporizador = undefined;
    estado.control = undefined;
  }
  function cerrarSugerencias() {
    cancelarBusqueda();
    setSugerencias([]);
    setActiva(-1);
  }
  function abrir() {
    setBorrador(valor);
    setError('');
    cerrarSugerencias();
    setEditando(true);
    requestAnimationFrame(() => {
      const campo = entrada.current;
      if (!campo) return;
      campo.focus();
      if (cursorAlFinal) campo.setSelectionRange(campo.value.length, campo.value.length);
      else campo.select();
    });
  }
  function cerrar() {
    cerrarSugerencias();
    setEditando(false);
    setError('');
    devolverFoco.current = true;
  }
  function cancelar() {
    cerrar();
    alCancelar?.();
  }
  function cambiar(texto: string) {
    setBorrador(texto);
    if (!sugerir) return;
    cancelarBusqueda();
    setActiva(-1);
    const consulta = texto.trim();
    if (consulta.length < MIN_SUGERIR) {
      setSugerencias([]);
      return;
    }
    const control = new AbortController();
    busqueda.current.control = control;
    busqueda.current.temporizador = setTimeout(() => {
      sugerir(consulta, control.signal)
        .then((lista) => {
          if (!control.signal.aborted) setSugerencias(lista);
        })
        .catch(() => {
          if (!control.signal.aborted) setSugerencias([]);
        });
    }, PAUSA_SUGERIR_MS);
  }
  async function elegir(sugerencia: SugerenciaCampo) {
    cerrarSugerencias();
    if (await sugerencia.aplicar()) cerrar();
  }
  async function enviar(e: FormEvent) {
    e.preventDefault();
    // Enter otra vez mientras se guarda no envía de nuevo.
    if (guardando) return;
    const v = borrador.trim();
    if (v === valor.trim()) return cerrar();
    const problema = validar?.(v) ?? null;
    if (problema) {
      setError(problema);
      entrada.current?.focus();
      return;
    }
    cerrarSugerencias();
    if (await guardar(v)) cerrar();
  }
  function teclado(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // Primero se cierra la lista de sugerencias; un segundo Escape cancela la edición.
      if (sugerencias.length) cerrarSugerencias();
      else cancelar();
      return;
    }
    if (!sugerencias.length) return;
    const total = sugerencias.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const abajo = e.key === 'ArrowDown';
      setActiva((i) => (abajo ? (i + 1) % total : i <= 0 ? total - 1 : i - 1));
    } else if (e.key === 'Enter' && activa >= 0 && sugerencias[activa]) {
      e.preventDefault();
      void elegir(sugerencias[activa]);
    }
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
          ) : valor || mostrar !== undefined ? (
            <span>{mostrar ?? valor}</span>
          ) : (
            <span className="campo-vacio">{vacio ?? 'Agregar'}</span>
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
          <strong>
            {guardando
              ? 'Guardando…'
              : (mostrar ??
                (valor || (editable && vacio ? <span className="campo-vacio">{vacio}</span> : '—')))}
          </strong>
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
  const idLista = `${id}-sugerencias`;
  const conLista = sugerencias.length > 0;
  // Mientras se guarda, el campo queda de solo lectura y no deshabilitado: así conserva el foco (y el teclado del
  // teléfono) si el servidor rechaza el valor y hay que corregirlo.
  const comunes = {
    id,
    value: borrador,
    readOnly: guardando,
    'aria-busy': guardando || undefined,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
    onKeyDown: teclado,
  } as const;
  // `noValidate`: el rango (min/max) lo explica `validar` con su mensaje en español junto al campo; sin esto el
  // navegador bloqueaba el envío con su propia burbuja, en el idioma del navegador y con otro texto.
  return (
    <form
      className={`campo editando ${sugerir ? 'con-sugerencias ' : ''}${className ?? ''}`}
      onSubmit={enviar}
      noValidate
    >
      <label htmlFor={id} className={etiquetaOculta ? 'sr-only' : 'campo-etiqueta'}>
        {etiqueta}
      </label>
      <span className="campo-valor">
        {area ? (
          <textarea
            {...comunes}
            ref={(elemento) => {
              entrada.current = elemento;
            }}
            maxLength={maxLength}
            rows={3}
            onChange={(e) => cambiar(e.target.value)}
          />
        ) : (
          <input
            {...comunes}
            ref={(elemento) => {
              entrada.current = elemento;
            }}
            type={tipo}
            inputMode={modoEntrada ?? (tipo === 'number' ? (paso === 1 ? 'numeric' : 'decimal') : undefined)}
            min={min}
            max={max}
            step={paso}
            maxLength={tipo === 'text' ? maxLength : undefined}
            onChange={(e) => cambiar(e.target.value)}
            {...(sugerir
              ? {
                  role: 'combobox',
                  autoComplete: 'off',
                  // Al salir del campo (Tab) la lista se cierra; elegir con el mouse no lo saca (`onMouseDown`).
                  onBlur: cerrarSugerencias,
                  'aria-autocomplete': 'list' as const,
                  'aria-expanded': conLista,
                  // Solo mientras la lista existe: un id ausente es una referencia rota para el lector.
                  'aria-controls': conLista ? idLista : undefined,
                  'aria-activedescendant': activa >= 0 && conLista ? `${idLista}-${activa}` : undefined,
                }
              : {})}
          />
        )}
        {sufijo && <span className="campo-sufijo">{sufijo}</span>}
        {sucio && <span className="campo-sin-guardar">Sin guardar</span>}
        <button type="submit" className="campo-guardar" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" className="campo-cancelar" onClick={cancelar} disabled={guardando}>
          Cancelar
        </button>
      </span>
      {error && (
        <span className="campo-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
      {conLista && (
        <div id={idLista} className="selector-lista" role="listbox" aria-label={`Sugerencias para ${etiqueta.toLowerCase()}`}>
          {sugerencias.map((s, i) => (
            <div
              key={s.clave}
              id={`${idLista}-${i}`}
              className="selector-opcion"
              role="option"
              aria-selected={i === activa}
              data-activo={i === activa ? 'true' : undefined}
              // El foco sigue en el campo: elegir con el mouse no lo cierra antes de tiempo.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActiva(i)}
              onClick={() => void elegir(s)}
            >
              <span>
                {s.etiqueta}
                {s.detalle && (
                  <>
                    <br />
                    <small className="muted">{s.detalle}</small>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </form>
  );
}

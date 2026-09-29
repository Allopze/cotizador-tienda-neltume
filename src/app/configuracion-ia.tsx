'use client';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import type { AjustesIA } from '@/asistente/ajustes';
import type { ModeloCommandCode } from '@/asistente/modelos-commandcode';
import { Dialogo } from './dialogo';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

export interface EstadoAjustes {
  ajustes: AjustesIA;
  commandcodeClave: boolean;
  asistenteConfigurado: boolean;
  /** Solo quien administra puede cambiar el modelo; ausente = editable (compatibilidad). */
  puedeEditar?: boolean;
}
interface CatalogoModelos {
  modelos: ModeloCommandCode[];
  desactualizado: boolean;
}
interface Props {
  abierta: boolean;
  estado: EstadoAjustes | null;
  /** Error al leer la configuración; el diálogo ofrece reintentar. */
  errorCarga: string;
  reintentar: () => void;
  cerrar: () => void;
  guardado: (estado: EstadoAjustes) => void;
}

export function ConfiguracionIA({ abierta, estado, errorCarga, reintentar, cerrar, guardado }: Props) {
  const campo = useRef<HTMLButtonElement>(null);
  const [ocupado, setOcupado] = useState(false);
  return (
    <Dialogo
      abierto={abierta}
      alCerrar={cerrar}
      cerrable={!ocupado}
      titulo="Asistente"
      eyebrow="CONFIGURACIÓN"
      focoInicial={campo}
    >
      {estado ? (
        // Se monta con cada apertura: parte de la configuración guardada.
        <Formulario
          estado={estado}
          campo={campo}
          cerrar={cerrar}
          guardado={guardado}
          setOcupado={setOcupado}
        />
      ) : errorCarga ? (
        <div className="catalog-error" role="alert">
          {errorCarga}
          <button type="button" className="link" onClick={reintentar}>
            Reintentar
          </button>
        </div>
      ) : (
        <p className="catalog-modal-intro" role="status">
          Cargando la configuración…
        </p>
      )}
    </Dialogo>
  );
}

function Formulario({
  estado,
  campo,
  cerrar,
  guardado,
  setOcupado: avisarOcupado,
}: Pick<Props, 'cerrar' | 'guardado'> & {
  estado: EstadoAjustes;
  campo: RefObject<HTMLButtonElement | null>;
  setOcupado: (v: boolean) => void;
}) {
  const [borrador, setBorrador] = useState<AjustesIA>(() => structuredClone(estado.ajustes));
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const [catalogo, setCatalogo] = useState<CatalogoModelos | null>(null);
  const [errorCatalogo, setErrorCatalogo] = useState('');
  const [intentoCatalogo, setIntentoCatalogo] = useState(0);
  const editable = estado.puedeEditar !== false;

  useEffect(() => {
    const controlador = new AbortController();
    pedirJSON<CatalogoModelos>('/api/ajustes/modelos', {
      signal: controlador.signal,
      cache: 'no-store',
    }).then(setCatalogo, (causa) => {
      if (!esSilencioso(causa)) setErrorCatalogo(mensajeDe(causa));
    });
    return () => controlador.abort();
  }, [intentoCatalogo]);

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado || !editable) return;
    setOcupado(true);
    avisarOcupado(true);
    setError('');
    try {
      const data = await pedirJSON<EstadoAjustes>('/api/ajustes', {
        json: { tipo: 'guardar', ajustes: borrador },
      });
      guardado(data);
      cerrar();
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado(false);
      avisarOcupado(false);
    }
  }

  return (
    <form onSubmit={guardar}>
      <p className="catalog-modal-intro">
        El asistente interpreta los mensajes del chat. Los precios siempre se calculan en el cotizador y nunca
        se envían al asistente.
      </p>

      <div className="ia-section">
        <div className="ia-field">
          <span id="ia-modelo-label">Modelo del asistente</span>
          {!editable ? (
            // Sin permiso no se muestra un selector deshabilitado: es un dato, no un control.
            <div className="ia-model-fijo">
              <strong>
                {catalogo?.modelos.find((m) => m.id === borrador.commandcode.modelo)?.nombre ??
                  borrador.commandcode.modelo}
              </strong>
              <code>{borrador.commandcode.modelo}</code>
            </div>
          ) : (
            <SelectorModelo
              refTrigger={campo}
              modelo={borrador.commandcode.modelo}
              modelos={catalogo?.modelos ?? []}
              cargando={catalogo === null && !errorCatalogo}
              error={errorCatalogo}
              desactualizado={catalogo?.desactualizado ?? false}
              editable={editable && !ocupado}
              seleccionar={(modelo) => setBorrador({ commandcode: { modelo } })}
              reintentar={() => {
                // Se limpia aquí y no en el efecto: el efecto solo sincroniza con la API.
                setCatalogo(null);
                setErrorCatalogo('');
                setIntentoCatalogo((actual) => actual + 1);
              }}
            />
          )}
          {!editable && (
            <p id="ia-permiso" className="ia-permiso">
              Solo quien administra el cotizador puede cambiar el modelo.
            </p>
          )}
        </div>
        {catalogo?.desactualizado && (
          <p className="ia-status falta" role="status">
            CommandCode no respondió; se muestra el último catálogo disponible.
          </p>
        )}
        <p id="ia-nota" className={`ia-status ${estado.commandcodeClave ? 'ok' : 'falta'}`}>
          {estado.commandcodeClave
            ? '✓ El asistente tiene su clave de acceso configurada.'
            : 'El asistente no está configurado. Pide a quien administra el cotizador que lo active.'}
        </p>
      </div>

      {error && (
        <p className="catalog-error" role="alert">
          {error}
        </p>
      )}
      <div className="ia-actions">
        <button type="button" className="button secondary" onClick={cerrar} disabled={ocupado}>
          {editable ? 'Cancelar' : 'Cerrar'}
        </button>
        {editable && (
          <button type="submit" className="button primary" disabled={ocupado}>
            {ocupado ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      </div>
    </form>
  );
}

function precioModelo(modelo: ModeloCommandCode) {
  if (modelo.gratis) return 'Gratis';
  if (modelo.precioEntrada === null || modelo.precioSalida === null) return 'Precio no publicado';
  const usd = (precio: number) =>
    `US$${new Intl.NumberFormat('es-CL', { maximumSignificantDigits: 3 }).format(precio)}`;
  return `${usd(modelo.precioEntrada)} entrada · ${usd(modelo.precioSalida)} salida / 1 M`;
}

function SelectorModelo({
  refTrigger,
  modelo,
  modelos,
  cargando,
  error,
  desactualizado,
  editable,
  seleccionar,
  reintentar,
}: {
  refTrigger: RefObject<HTMLButtonElement | null>;
  modelo: string;
  modelos: ModeloCommandCode[];
  cargando: boolean;
  error: string;
  desactualizado: boolean;
  editable: boolean;
  seleccionar: (modelo: string) => void;
  reintentar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [activo, setActivo] = useState(0);
  const selector = useRef<HTMLDivElement>(null);
  const filtro = useRef<HTMLInputElement>(null);
  const actual = modelos.find((opcion) => opcion.id === modelo);
  const filtrados = useMemo(() => {
    const criterio = busqueda.trim().toLocaleLowerCase('es');
    const ordenados = [...modelos].sort((a, b) => {
      if (a.gratis !== b.gratis) return a.gratis ? -1 : 1;
      const costoA =
        a.precioEntrada === null || a.precioSalida === null ? null : a.precioEntrada + a.precioSalida;
      const costoB =
        b.precioEntrada === null || b.precioSalida === null ? null : b.precioEntrada + b.precioSalida;
      if (costoA !== null && costoB === null) return -1;
      if (costoA === null && costoB !== null) return 1;
      if (costoA !== null && costoB !== null && costoA !== costoB) return costoA - costoB;
      return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
    });
    return ordenados.filter(
      (opcion) =>
        !criterio ||
        opcion.nombre.toLocaleLowerCase('es').includes(criterio) ||
        opcion.id.toLocaleLowerCase('es').includes(criterio),
    );
  }, [busqueda, modelos]);
  const grupos = [
    { titulo: 'GRATIS', opciones: filtrados.filter((opcion) => opcion.gratis) },
    {
      titulo: 'ORDENADOS POR PRECIO',
      opciones: filtrados.filter(
        (opcion) => !opcion.gratis && opcion.precioEntrada !== null && opcion.precioSalida !== null,
      ),
    },
    {
      titulo: 'PRECIO NO PUBLICADO',
      opciones: filtrados.filter(
        (opcion) => !opcion.gratis && (opcion.precioEntrada === null || opcion.precioSalida === null),
      ),
    },
  ]
    .filter((grupo) => grupo.opciones.length > 0)
    .reduce<{ titulo: string; opciones: { opcion: ModeloCommandCode; indice: number }[] }[]>(
      (lista, grupo) => {
        const inicio = lista.reduce((n, g) => n + g.opciones.length, 0);
        return [
          ...lista,
          {
            titulo: grupo.titulo,
            opciones: grupo.opciones.map((opcion, i) => ({ opcion, indice: inicio + i })),
          },
        ];
      },
      [],
    );
  const seleccionadoNoDisponible = !actual && modelo.trim() !== '';

  useEffect(() => {
    if (abierto) filtro.current?.focus();
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const cerrarFuera = (evento: PointerEvent) => {
      if (!selector.current?.contains(evento.target as Node)) setAbierto(false);
    };
    document.addEventListener('pointerdown', cerrarFuera);
    return () => document.removeEventListener('pointerdown', cerrarFuera);
  }, [abierto]);

  function cerrar() {
    setAbierto(false);
    setBusqueda('');
    refTrigger.current?.focus();
  }

  function elegir(opcion: ModeloCommandCode) {
    seleccionar(opcion.id);
    cerrar();
  }

  function manejarTeclado(evento: KeyboardEvent<HTMLInputElement>) {
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      setActivo((actual) => Math.min(actual + 1, filtrados.length - 1));
    } else if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      setActivo((actual) => Math.max(actual - 1, 0));
    } else if (evento.key === 'Enter') {
      evento.preventDefault();
      if (filtrados[activo]) elegir(filtrados[activo]);
    } else if (evento.key === 'Escape') {
      evento.preventDefault();
      cerrar();
    }
  }

  return (
    <div
      ref={selector}
      className="ia-model-selector"
      onBlur={(evento) => {
        if (!selector.current?.contains(evento.relatedTarget as Node | null)) setAbierto(false);
      }}
    >
      <button
        ref={refTrigger}
        type="button"
        className="ia-model-trigger"
        aria-labelledby="ia-modelo-label"
        aria-describedby="ia-nota"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        disabled={!editable}
        onClick={() => {
          if (abierto) cerrar();
          else {
            setBusqueda('');
            setActivo(0);
            setAbierto(true);
          }
        }}
      >
        <span className="ia-model-selection">
          <strong>{actual?.nombre ?? modelo}</strong>
          <code>{modelo}</code>
        </span>
        <span className="ia-model-chevron" aria-hidden="true">
          {abierto ? '⌃' : '⌄'}
        </span>
      </button>
      {seleccionadoNoDisponible && (
        <p className="ia-model-unavailable" role="status">
          El modelo guardado no aparece en el catálogo actual de CommandCode.
        </p>
      )}
      {abierto && (
        <div className="ia-model-popover">
          <input
            ref={filtro}
            type="search"
            role="combobox"
            aria-label="Buscar modelo de CommandCode"
            aria-autocomplete="list"
            aria-controls={!cargando && !error ? 'ia-modelos-lista' : undefined}
            aria-expanded="true"
            aria-activedescendant={filtrados.length > 0 ? `ia-modelo-opcion-${activo}` : undefined}
            autoComplete="off"
            placeholder="Buscar modelo o identificador…"
            value={busqueda}
            onChange={(evento) => {
              setBusqueda(evento.target.value);
              setActivo(0);
            }}
            onKeyDown={manejarTeclado}
          />
          <p className="ia-model-sort-note">
            Gratis primero; los demás se ordenan por entrada + salida por millón de tokens.
          </p>
          {cargando ? (
            <p className="ia-model-list-status" role="status">
              Cargando el catálogo de CommandCode…
            </p>
          ) : error ? (
            <p className="ia-model-list-status" role="alert">
              No se pudo cargar el catálogo.{' '}
              <button type="button" className="link" onClick={reintentar}>
                Reintentar
              </button>
            </p>
          ) : (
            <div
              id="ia-modelos-lista"
              className="ia-model-options"
              role="listbox"
              aria-label="Modelos de CommandCode"
            >
              {seleccionadoNoDisponible && (
                <p className="ia-model-list-status" role="note">
                  El modelo seleccionado ya no aparece en el catálogo actual.
                </p>
              )}
              {grupos.length ? (
                grupos.map((grupo) => (
                  <div key={grupo.titulo} role="presentation">
                    <p className="ia-model-group-title">{grupo.titulo}</p>
                    {grupo.opciones.map(({ opcion, indice }) => {
                      return (
                        <div
                          id={`ia-modelo-opcion-${indice}`}
                          key={opcion.id}
                          className="ia-model-option"
                          role="option"
                          aria-selected={opcion.id === modelo}
                          data-activo={indice === activo ? 'true' : undefined}
                          onMouseDown={(evento) => evento.preventDefault()}
                          onMouseMove={() => setActivo(indice)}
                          onClick={() => elegir(opcion)}
                        >
                          <span className="ia-model-option-name">
                            <strong>{opcion.nombre}</strong>
                            <code>{opcion.id}</code>
                          </span>
                          <span className="ia-model-option-price">
                            {opcion.gratis && <b>GRATIS</b>}
                            <small>{precioModelo(opcion)}</small>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))
              ) : (
                <p className="ia-model-list-status" role="status">
                  {modelos.length
                    ? 'No hay modelos que coincidan con la búsqueda.'
                    : 'CommandCode no publicó modelos compatibles.'}
                </p>
              )}
              {desactualizado && (
                <p className="ia-model-list-status" role="status">
                  No se pudo actualizar el catálogo; esta lista puede estar desactualizada.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

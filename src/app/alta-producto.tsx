'use client';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Familia, Producto } from '@/catalogo/tipos';
import { leerPesos } from '@/negocio/cifras';
import { pesos, porcentaje, REGLAS } from '@/negocio/precios';
import { useConfirmacion } from './dialogo';
import { enterEnvia, nombreProducto } from './formato';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

type Mensaje = { rol: 'usuario' | 'asistente'; texto: string };
interface Props {
  /** Sin asistente sigue disponible el formulario: solo se oculta la descripción asistida. */
  asistente: boolean;
}
/** Atributos que el servidor interpretó o recibió (null = sin dato). */
interface Borrador {
  modelo: string | null;
  familia: Familia | null;
  madera: string | null;
  tipo: string | null;
  medida: string | null;
  anchoMin: number | null;
  anchoMax: number | null;
  largo: number | null;
  precioNeto: number | null;
}
interface Respuesta {
  id: string;
  mensajes?: Mensaje[];
  propuesta: Producto | null;
  producto?: Producto;
  borrador?: Borrador;
  /** Conversión bruto→neto, precio atípico… */
  avisos?: string[];
}
/** Valores del formulario tal como se escriben (decimales con coma). */
type Campos = Record<
  'familia' | 'modelo' | 'madera' | 'tipo' | 'medida' | 'anchoMin' | 'anchoMax' | 'largo' | 'precio',
  string
>;

const VACIO: Campos = {
  familia: '',
  modelo: '',
  madera: '',
  tipo: '',
  medida: '',
  anchoMin: '',
  anchoMax: '',
  largo: '',
  precio: '',
};
const FAMILIAS: [Familia, string][] = [
  ['PUERTA', 'Puerta'],
  ['MARCO', 'Marco'],
  ['PIEZAS_T', 'Piezas T'],
  ['MOLDURA', 'Moldura'],
];
const ajuste = porcentaje(REGLAS.ajuste * 100);
const venta = (neto: number) => Math.round(neto * (1 + REGLAS.ajuste));
const decimal = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 4, useGrouping: false });
/** «0,80», «0.8» u «80» (centímetros) → metros; vacío o ilegible → null. */
function metros(valor: string, limite: number) {
  const n = Number(valor.trim().replace(',', '.'));
  if (!valor.trim() || !Number.isFinite(n)) return null;
  return n > limite ? n / 100 : n;
}

function SelectorFamilia({
  id,
  value,
  disabled,
  seleccionar,
}: {
  id: string;
  value: string;
  disabled: boolean;
  seleccionar: (familia: Familia) => void;
}) {
  const selector = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const actual = FAMILIAS.find(([familia]) => familia === value);
  const indiceSeleccionado = Math.max(
    0,
    FAMILIAS.findIndex(([familia]) => familia === value),
  );
  const listaId = `${id}-opciones`;

  useEffect(() => {
    if (!abierto) return;
    const cerrarFuera = (evento: PointerEvent) => {
      if (!selector.current?.contains(evento.target as Node)) setAbierto(false);
    };
    document.addEventListener('pointerdown', cerrarFuera);
    return () => document.removeEventListener('pointerdown', cerrarFuera);
  }, [abierto]);

  function abrir() {
    setActivo(indiceSeleccionado);
    setAbierto(true);
  }

  function cerrar(devolverFoco = false) {
    setAbierto(false);
    if (devolverFoco) trigger.current?.focus();
  }

  function elegir(familia: Familia) {
    seleccionar(familia);
    cerrar(true);
  }

  function manejarTeclado(evento: KeyboardEvent<HTMLButtonElement>) {
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (!abierto) {
        abrir();
        return;
      }
      setActivo((actual) =>
        evento.key === 'ArrowDown' ? Math.min(actual + 1, FAMILIAS.length - 1) : Math.max(actual - 1, 0),
      );
    } else if (evento.key === 'Home' || evento.key === 'End') {
      if (!abierto) return;
      evento.preventDefault();
      setActivo(evento.key === 'Home' ? 0 : FAMILIAS.length - 1);
    } else if (evento.key === 'Enter' || evento.key === ' ') {
      evento.preventDefault();
      if (!abierto) abrir();
      else elegir(FAMILIAS[activo][0]);
    } else if (evento.key === 'Escape' && abierto) {
      evento.preventDefault();
      cerrar(true);
    }
  }

  return (
    <div
      ref={selector}
      className="familia-selector"
      onBlur={(evento) => {
        if (!selector.current?.contains(evento.relatedTarget as Node | null)) setAbierto(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="familia-trigger"
        aria-labelledby={id}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={listaId}
        disabled={disabled}
        onClick={() => (abierto ? cerrar(true) : abrir())}
        onKeyDown={manejarTeclado}
      >
        <span>{actual?.[1] ?? 'Elige una familia'}</span>
        <span className="familia-chevron" aria-hidden="true">
          {abierto ? '⌃' : '⌄'}
        </span>
      </button>
      {abierto && (
        <div id={listaId} className="familia-popover" role="listbox" aria-labelledby={id}>
          {FAMILIAS.map(([familia, texto], indice) => (
            <div
              id={`${listaId}-${familia}`}
              key={familia}
              className="familia-option"
              role="option"
              aria-selected={value === familia}
              data-activo={indice === activo ? 'true' : undefined}
              onMouseDown={(evento) => evento.preventDefault()}
              onMouseMove={() => setActivo(indice)}
              onClick={() => elegir(familia)}
            >
              <span>{texto}</span>
              {value === familia && <span aria-hidden="true">✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Alta de un producto al catálogo en una sola pantalla: el formulario es la vía manual y el asistente,
 * opcional, lo completa a partir de una descripción. Ambas vías terminan en la misma propuesta revisable.
 */
export function AltaProducto({ asistente }: Props) {
  const [campos, setCampos] = useState<Campos>(VACIO);
  const [avisosAlta, setAvisosAlta] = useState<string[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [propuesta, setPropuesta] = useState<Producto | null>(null);
  const [guardado, setGuardado] = useState<Producto | null>(null);
  const [ocupado, setOcupado] = useState<'asistente' | 'revisar' | 'guardar' | null>(null);
  const [error, setError] = useState('');
  const entrada = useRef<HTMLTextAreaElement>(null),
    listo = useRef<HTMLButtonElement>(null),
    revision = useRef<HTMLDivElement>(null);
  const [confirmar, confirmacion] = useConfirmacion();
  const uid = useId();
  const puerta = campos.familia === 'PUERTA';

  // Tras guardar, el foco pasa al botón del resultado para no quedar en un elemento desmontado.
  useEffect(() => {
    if (guardado) listo.current?.focus();
  }, [guardado]);

  const pedir = (cuerpo: Record<string, unknown>) => pedirJSON<Respuesta>('/api/catalogo', { json: cuerpo });

  // Al salir de la pantalla con una propuesta a medias, se descarta el borrador del servidor.
  const pendiente = useRef<string | null>(null);
  useEffect(() => {
    pendiente.current = id && !guardado ? id : null;
  }, [id, guardado]);
  useEffect(
    () => () => {
      if (pendiente.current)
        pedirJSON('/api/catalogo', { json: { tipo: 'cancelar', id: pendiente.current } }).catch(() => {
          // El borrador puede haber expirado; no hay nada más que hacer.
        });
    },
    [],
  );
  const fallo = (causa: unknown) => {
    if (!esSilencioso(causa)) setError(mensajeDe(causa));
  };

  /** Cambiar un dato invalida la propuesta revisada: hay que volver a revisarla. */
  function cambiar(campo: keyof Campos, valor: string) {
    setCampos((c) => ({ ...c, [campo]: valor }));
    setPropuesta(null);
    setAvisosAlta([]);
  }

  /** Vuelca en el formulario lo que el asistente entendió, sin borrar lo que ya estaba escrito. */
  function volcar(b: Borrador) {
    setCampos((c) => ({
      familia: b.familia ?? c.familia,
      modelo: b.modelo ?? c.modelo,
      madera: b.madera ?? c.madera,
      tipo: b.tipo ?? c.tipo,
      medida: b.medida ?? c.medida,
      anchoMin: b.anchoMin !== null ? decimal(b.anchoMin) : c.anchoMin,
      anchoMax: b.anchoMax !== null ? decimal(b.anchoMax) : c.anchoMax,
      largo: b.largo !== null ? decimal(b.largo) : c.largo,
      precio: b.precioNeto !== null ? decimal(b.precioNeto) : c.precio,
    }));
  }

  async function describir(evento: FormEvent) {
    evento.preventDefault();
    if (!mensaje.trim() || ocupado || guardado) return;
    setOcupado('asistente');
    setError('');
    try {
      const data = await pedir({ tipo: 'mensaje', ...(id ? { id } : {}), mensaje });
      setId(data.id);
      setMensajes(data.mensajes ?? []);
      if (data.borrador) volcar(data.borrador);
      setPropuesta(data.propuesta);
      setAvisosAlta(data.avisos ?? []);
      setMensaje('');
    } catch (causa) {
      fallo(causa);
    } finally {
      setOcupado(null);
      requestAnimationFrame(() => entrada.current?.focus());
    }
  }

  async function revisar(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado || guardado) return;
    const precio = campos.precio.trim() ? leerPesos(campos.precio) : null;
    setOcupado('revisar');
    setError('');
    try {
      const data = await pedir({
        tipo: 'manual',
        ...(id ? { id } : {}),
        producto: {
          familia: campos.familia || null,
          modelo: campos.modelo.trim() || null,
          madera: campos.madera.trim() || null,
          tipo: campos.tipo.trim() || null,
          medida: puerta ? null : campos.medida.trim() || null,
          anchoMin: puerta ? metros(campos.anchoMin, 4) : null,
          anchoMax: puerta ? metros(campos.anchoMax, 4) : null,
          largo: metros(campos.largo, 10),
          precioNeto: precio !== null && Number.isFinite(precio) && precio > 0 ? precio : null,
        },
      });
      setId(data.id);
      setPropuesta(data.propuesta);
      setAvisosAlta(data.avisos ?? []);
      requestAnimationFrame(() => revision.current?.focus());
    } catch (causa) {
      fallo(causa);
    } finally {
      setOcupado(null);
    }
  }

  async function guardar() {
    if (!id || !propuesta || ocupado || guardado) return;
    const aceptar = await confirmar({
      titulo: 'Agregar al catálogo',
      mensaje: (
        <p>
          ¿Agregar «{propuesta.descripcion}» al catálogo con precio neto unitario{' '}
          {pesos(propuesta.precioNeto)}? En las cotizaciones se mostrará a{' '}
          {pesos(venta(propuesta.precioNeto))} (neto + {ajuste}).
        </p>
      ),
      aceptar: 'Agregar al catálogo',
    });
    if (!aceptar) return;
    setOcupado('guardar');
    setError('');
    try {
      const data = await pedir({ tipo: 'confirmar', id });
      setGuardado(data.producto ?? propuesta);
      setPropuesta(null);
    } catch (causa) {
      fallo(causa);
    } finally {
      setOcupado(null);
    }
  }

  /** Descarta la conversación y los datos, y deja la pantalla lista para otro producto. */
  async function reiniciar() {
    if (ocupado) return;
    if (id && !guardado) {
      try {
        await pedir({ tipo: 'cancelar', id });
      } catch {
        // El borrador puede haber expirado; descartarlo sigue siendo seguro.
      }
    }
    setId(null);
    setMensajes([]);
    setMensaje('');
    setCampos(VACIO);
    setPropuesta(null);
    setGuardado(null);
    setError('');
    setAvisosAlta([]);
  }

  if (guardado)
    return (
      <div className="alta-producto">
        <div className="catalog-success" role="status">
          <span className="catalog-success-mark" aria-hidden>
            ✓
          </span>
          <h3>Producto agregado</h3>
          <p>{nombreProducto(guardado.descripcion)}</p>
          <small>Código {guardado.codigo} · Precio neto ingresado manualmente.</small>
          <button ref={listo} type="button" className="button primary" onClick={reiniciar}>
            Agregar otro producto
          </button>
        </div>
        {confirmacion}
      </div>
    );

  const campo = (
    nombre: keyof Campos,
    etiqueta: string,
    extra: { ayuda?: string; placeholder?: string } = {},
  ) => (
    <label className="alta-campo" htmlFor={`${uid}-${nombre}`}>
      <span>{etiqueta}</span>
      <input
        id={`${uid}-${nombre}`}
        value={campos[nombre]}
        onChange={(e) => cambiar(nombre, e.target.value)}
        placeholder={extra.placeholder}
        inputMode={['anchoMin', 'anchoMax', 'largo', 'precio'].includes(nombre) ? 'decimal' : undefined}
        maxLength={120}
        disabled={!!ocupado}
      />
      {extra.ayuda && <small>{extra.ayuda}</small>}
    </label>
  );

  return (
    <div className="alta-producto">
      <p className="catalog-modal-intro">
        Completa los datos a mano o describe el producto y deja que el asistente llene el formulario. En ambos
        casos revisas la propuesta antes de guardarla.{' '}
        <strong>Ingresa el precio base neto, no el de venta:</strong> las cotizaciones le suman {ajuste}{' '}
        automáticamente, igual que a los productos de la planilla.
      </p>

      <section className="alta-bloque" aria-labelledby={`${uid}-asistente`}>
        <h3 id={`${uid}-asistente`} className="eyebrow">
          DESCRIBIR CON EL ASISTENTE <span className="alta-opcional">· opcional</span>
        </h3>
        {!asistente ? (
          <p className="muted">El asistente no está configurado: completa los datos en el formulario.</p>
        ) : (
          <>
            {mensajes.length > 0 && (
              <div className="catalog-chat" aria-busy={ocupado === 'asistente'}>
                {mensajes.map((item, indice) => (
                  <div key={indice} className={`catalog-message ${item.rol}`}>
                    <span className="speaker">{item.rol === 'usuario' ? 'TÚ' : 'NELTUME'}</span>
                    <p>{item.texto}</p>
                  </div>
                ))}
              </div>
            )}
            <p className="sr-only" aria-live="polite">
              {ocupado === 'asistente'
                ? 'Interpretando la descripción…'
                : mensajes.at(-1)?.rol === 'asistente'
                  ? mensajes.at(-1)?.texto
                  : ''}
            </p>
            <form className="catalog-composer" onSubmit={describir}>
              <label className="sr-only" htmlFor="mensaje-catalogo">
                Describe el producto
              </label>
              <textarea
                id="mensaje-catalogo"
                ref={entrada}
                value={mensaje}
                onChange={(evento) => setMensaje(evento.target.value)}
                placeholder="Ej.: puerta modelo Roble, en raulí, de 80 a 85 cm de ancho y 2,10 m de alto; precio neto $145.000"
                rows={2}
                maxLength={3000}
                disabled={!!ocupado}
                aria-describedby="ayuda-catalogo"
                onKeyDown={enterEnvia}
              />
              <div>
                <span id="ayuda-catalogo">Lo que entienda se carga en el formulario de abajo.</span>
                <button type="submit" disabled={!mensaje.trim() || !!ocupado}>
                  {ocupado === 'asistente' ? 'Interpretando…' : 'Completar formulario'}
                </button>
              </div>
            </form>
          </>
        )}
      </section>

      <form className="alta-bloque alta-formulario" onSubmit={revisar} aria-labelledby={`${uid}-datos`}>
        <h3 id={`${uid}-datos`} className="eyebrow">
          DATOS DEL PRODUCTO
        </h3>
        <div className="alta-campos">
          <div className="alta-campo">
            <span id={`${uid}-familia-label`}>Familia</span>
            <SelectorFamilia
              id={`${uid}-familia-label`}
              value={campos.familia}
              disabled={!!ocupado}
              seleccionar={(familia) => cambiar('familia', familia)}
            />
          </div>
          {campo('modelo', 'Modelo', { placeholder: 'Ej.: Roble' })}
          {campo('madera', 'Madera', { placeholder: 'Ej.: Raulí' })}
          {campo('tipo', 'Tipo (opcional)')}
          {puerta ? (
            <>
              {campo('anchoMin', 'Ancho mínimo', {
                placeholder: '0,80',
                ayuda: 'En metros (0,80) o centímetros (80).',
              })}
              {campo('anchoMax', 'Ancho máximo', { placeholder: '0,85' })}
              {campo('largo', 'Alto', {
                placeholder: '2,10',
                ayuda: 'En metros (2,10) o centímetros (210).',
              })}
            </>
          ) : (
            <>
              {campo('medida', 'Medida o escuadría', { placeholder: '2x4' })}
              {campo('largo', 'Largo', {
                placeholder: '2,10',
                ayuda: 'En metros (2,10) o centímetros (210).',
              })}
            </>
          )}
          {campo('precio', 'Precio neto unitario', {
            placeholder: '$145.000',
            ayuda: 'Sin IVA y sin el ajuste de venta.',
          })}
        </div>
        <div className="alta-acciones">
          <button type="submit" className="button primary" disabled={!!ocupado}>
            {ocupado === 'revisar' ? 'Revisando…' : 'Revisar propuesta'}
          </button>
          {(id || Object.values(campos).some(Boolean)) && (
            <button type="button" className="button secondary" onClick={reiniciar} disabled={!!ocupado}>
              Empezar de nuevo
            </button>
          )}
        </div>
      </form>

      {error && (
        <p className="catalog-error" role="alert">
          {error}
        </p>
      )}

      {propuesta && (
        <div className="catalog-preview" ref={revision} tabIndex={-1} aria-labelledby={`${uid}-revision`}>
          <p className="eyebrow" id={`${uid}-revision`}>
            REVISIÓN ANTES DE GUARDAR
          </p>
          <h3>{nombreProducto(propuesta.descripcion)}</h3>
          <dl>
            <div>
              <dt>Código interno asignado</dt>
              <dd>{propuesta.codigo}</dd>
            </div>
            <div>
              <dt>Familia</dt>
              <dd>{FAMILIAS.find(([f]) => f === propuesta.familia)?.[1] ?? propuesta.familia}</dd>
            </div>
            <div>
              <dt>Precio neto unitario</dt>
              <dd>{pesos(propuesta.precioNeto)}</dd>
            </div>
            <div>
              <dt>Unitario en cotizaciones (+{ajuste})</dt>
              <dd>{pesos(venta(propuesta.precioNeto))}</dd>
            </div>
          </dl>
          {avisosAlta.length > 0 && (
            <ul className="catalog-avisos">
              {avisosAlta.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          <p className="catalog-price-note">Confirma que el precio neto y los atributos sean correctos.</p>
          <button type="button" className="button primary" onClick={guardar} disabled={!!ocupado}>
            {ocupado === 'guardar' ? 'Guardando…' : 'Confirmar y guardar'}
          </button>
        </div>
      )}
      {confirmacion}
    </div>
  );
}

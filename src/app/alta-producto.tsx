'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Familia, Producto } from '@/catalogo/tipos';
import type { PrefillAlta } from '@/negocio/pendientes';
import { leerPesos } from '@/negocio/cifras';
import { pesos, porcentaje, REGLAS } from '@/negocio/precios';
import { useConfirmacion } from './dialogo';
import { FAMILIAS, etiquetaFamilia } from '@/catalogo/familias';
import { decimalCampo, enterEnvia, errorMedida, leerMedida, nombreProducto, type CampoMedida } from './formato';
import { SelectorFamilia } from './selector-familia';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

type Mensaje = { rol: 'usuario' | 'asistente'; texto: string };
interface Props {
  /** Sin asistente sigue disponible el formulario: solo se oculta la descripción asistida. */
  asistente: boolean;
  inicial?: PrefillAlta;
  alGuardar?: (producto: Producto) => void;
  /** Informa si el alta tiene datos a medias, para avisar antes de salir de la pantalla (auditoría BUG-063). */
  alCambiarSucio?: (sucio: boolean) => void;
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

/**
 * Medidas del alta con el mismo lector que el detalle y el chat (`leerMedida`): «0,80», «80 cm», «2100 mm» o
 * «3600 mm» en un accesorio. El ancho es de puerta; el alto o largo, de la familia elegida. Un campo vacío pide el
 * dato; uno ilegible o fuera de rango dice el rango y cómo escribirlo (`errorMedida`).
 */
export function medidasAlta(c: Pick<Campos, 'familia' | 'anchoMin' | 'anchoMax' | 'largo'>) {
  const puerta = c.familia === 'PUERTA';
  const errores: Partial<Record<'anchoMin' | 'anchoMax' | 'largo', string>> = {};
  const leer = (nombre: 'anchoMin' | 'anchoMax' | 'largo', campo: CampoMedida, vacio: string) => {
    const texto = c[nombre].trim();
    if (!texto) {
      errores[nombre] = vacio;
      return null;
    }
    const valor = leerMedida(texto, c.familia, campo);
    if (valor === null) errores[nombre] = errorMedida(campo, c.familia);
    return valor;
  };
  const anchoMin = puerta ? leer('anchoMin', 'ancho', 'Escribe el ancho mínimo.') : null;
  const anchoMax = puerta ? leer('anchoMax', 'ancho', 'Escribe el ancho máximo.') : null;
  const largo = leer('largo', 'alto', puerta ? 'Escribe el alto.' : 'Escribe el largo.');
  return { anchoMin, anchoMax, largo, errores };
}

/**
 * Alta de un producto al catálogo en una sola pantalla: el formulario es la vía manual y el asistente,
 * opcional, lo completa a partir de una descripción. Ambas vías terminan en la misma propuesta revisable.
 */
export function AltaProducto({ asistente, inicial, alGuardar, alCambiarSucio }: Props) {
  const [ajusteNumero, setAjusteNumero] = useState(REGLAS.ajuste);
  const [campos, setCampos] = useState<Campos>(() => inicial
    ? {
        ...VACIO,
        familia: inicial.familia ?? '',
        modelo: inicial.modelo ?? '',
        madera: inicial.madera ?? '',
        medida: inicial.medida ?? '',
        anchoMin: inicial.anchoMin !== null ? decimalCampo(inicial.anchoMin) : '',
        anchoMax: inicial.anchoMax !== null ? decimalCampo(inicial.anchoMax) : '',
        largo: inicial.largo !== null ? decimalCampo(inicial.largo) : '',
      }
    : VACIO);
  const [avisosAlta, setAvisosAlta] = useState<string[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [propuesta, setPropuesta] = useState<Producto | null>(null);
  const [guardado, setGuardado] = useState<Producto | null>(null);
  const [ocupado, setOcupado] = useState<'asistente' | 'revisar' | 'guardar' | null>(null);
  const [error, setError] = useState('');
  const [errores, setErrores] = useState<Partial<Record<keyof Campos, string>>>({});
  const formulario = useRef<HTMLFormElement>(null);
  const entrada = useRef<HTMLTextAreaElement>(null),
    listo = useRef<HTMLButtonElement>(null),
    revision = useRef<HTMLDivElement>(null);
  const [confirmar, confirmacion] = useConfirmacion();
  const uid = useId();
  const inicialAlMontar = useRef(inicial);
  // Lo escrito a medias: el catálogo lo usa para no perderlo al cambiar de pantalla (auditoría BUG-063).
  const [baseCampos, setBaseCampos] = useState(() => JSON.stringify(campos));
  const sucio = !guardado && (JSON.stringify(campos) !== baseCampos || !!mensaje.trim());
  useEffect(() => {
    alCambiarSucio?.(sucio);
    return () => alCambiarSucio?.(false);
  }, [sucio, alCambiarSucio]);
  const puerta = campos.familia === 'PUERTA';
  const ajuste = porcentaje(ajusteNumero * 100);
  const venta = (neto: number) => Math.round(neto * (1 + ajusteNumero));

  useEffect(() => {
    if (!inicialAlMontar.current) return;
    const cuadro = requestAnimationFrame(() => {
      const primero = !inicialAlMontar.current?.familia
        ? formulario.current?.querySelector<HTMLElement>('.familia-trigger')
        : [...(formulario.current?.querySelectorAll<HTMLInputElement>('input') ?? [])]
            .find((c) => c.id !== `${uid}-tipo` && !c.value.trim());
      primero?.focus();
    });
    return () => cancelAnimationFrame(cuadro);
  }, [uid]);

  useEffect(() => {
    const control = new AbortController();
    pedirJSON<{ configuracion: { reglas: { ajuste: number } } }>('/api/configuracion-negocio', { signal: control.signal, cache: 'no-store' })
      .then((data) => setAjusteNumero(data.configuracion.reglas.ajuste), () => {});
    return () => control.abort();
  }, []);

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
    setErrores((e) => ({ ...e, [campo]: undefined }));
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
      anchoMin: b.anchoMin !== null ? decimalCampo(b.anchoMin) : c.anchoMin,
      anchoMax: b.anchoMax !== null ? decimalCampo(b.anchoMax) : c.anchoMax,
      largo: b.largo !== null ? decimalCampo(b.largo) : c.largo,
      precio: b.precioNeto !== null ? decimalCampo(b.precioNeto) : c.precio,
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
    // Lo que falta se marca en su campo antes de ir al servidor; el foco va al primero.
    const faltan: Partial<Record<keyof Campos, string>> = {};
    if (!campos.familia) faltan.familia = 'Elige la familia.';
    if (!campos.modelo.trim()) faltan.modelo = 'Escribe el modelo.';
    if (!campos.madera.trim()) faltan.madera = 'Escribe la madera.';
    const medidas = medidasAlta(campos);
    if (puerta) {
      if (medidas.errores.anchoMin) faltan.anchoMin = medidas.errores.anchoMin;
      if (medidas.errores.anchoMax) faltan.anchoMax = medidas.errores.anchoMax;
    } else if (!campos.medida.trim()) faltan.medida = 'Escribe la medida o escuadría.';
    if (medidas.errores.largo) faltan.largo = medidas.errores.largo;
    if (precio === null || !Number.isFinite(precio) || precio <= 0) faltan.precio = 'Escribe el precio base sin IVA, en pesos.';
    setErrores(faltan);
    const primero = Object.keys(faltan)[0];
    if (primero) {
      setError('');
      formulario.current
        ?.querySelector<HTMLElement>(primero === 'familia' ? '.familia-trigger' : `#${CSS.escape(`${uid}-${primero}`)}`)
        ?.focus();
      return;
    }
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
          anchoMin: medidas.anchoMin,
          anchoMax: medidas.anchoMax,
          largo: medidas.largo,
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
          ¿Agregar «{propuesta.descripcion}» al catálogo con precio base sin IVA{' '}
          {pesos(propuesta.precioNeto)}? En las cotizaciones se mostrará a{' '}
          {pesos(venta(propuesta.precioNeto))} (precio base + {ajuste}).
        </p>
      ),
      aceptar: 'Agregar al catálogo',
    });
    if (!aceptar) return;
    setOcupado('guardar');
    setError('');
    try {
      const data = await pedir({ tipo: 'confirmar', id });
      const producto = data.producto ?? propuesta;
      pendiente.current = null;
      setGuardado(producto);
      // Lo guardado es el punto de partida: editar desde ahí vuelve a marcar el alta como pendiente.
      setBaseCampos(JSON.stringify(campos));
      setPropuesta(null);
      alGuardar?.(producto);
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
    setBaseCampos(JSON.stringify(VACIO));
    setPropuesta(null);
    setGuardado(null);
    setError('');
    setErrores({});
    setAvisosAlta([]);
  }

  if (guardado && !alGuardar)
    return (
      <div className="alta-producto">
        <div className="catalog-success" role="status">
          <span className="catalog-success-mark" aria-hidden>
            ✓
          </span>
          <h3>Producto agregado</h3>
          <p>{nombreProducto(guardado.descripcion)}</p>
          <small>
            Código {guardado.codigo} ·{' '}
            {mensajes.length ? 'Completado con el asistente y revisado por ti.' : 'Ingresado a mano.'}
          </small>
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
        aria-invalid={errores[nombre] ? true : undefined}
        aria-describedby={errores[nombre] || extra.ayuda ? `${uid}-${nombre}-ayuda` : undefined}
      />
      {(errores[nombre] || extra.ayuda) && (
        <small id={`${uid}-${nombre}-ayuda`} className={errores[nombre] ? 'campo-error' : undefined}>
          {errores[nombre] ?? extra.ayuda}
        </small>
      )}
    </label>
  );

  return (
    <div className="alta-producto">
      <p className="catalog-modal-intro">
        Completa los datos a mano o describe el producto y deja que el asistente llene el formulario. En ambos
        casos revisas la propuesta antes de guardarla.{' '}
        <strong>Ingresa el precio base sin IVA, no el de venta:</strong> las cotizaciones le suman {ajuste}{' '}
        automáticamente, igual que a los productos de la planilla.
      </p>

      <section className="alta-bloque" aria-labelledby={`${uid}-asistente`}>
        <h3 id={`${uid}-asistente`} className="eyebrow">
          Describir con el asistente <span className="alta-opcional">· opcional</span>
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
                placeholder="Ej.: puerta modelo Roble, en raulí, de 80 a 85 cm de ancho y 2,10 m de alto; precio $145.000 sin IVA"
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

      <form ref={formulario} className="alta-bloque alta-formulario" onSubmit={revisar} noValidate aria-labelledby={`${uid}-datos`}>
        <h3 id={`${uid}-datos`} className="eyebrow">
          Datos del producto
        </h3>
        <div className="alta-campos">
          <div className="alta-campo">
            <span id={`${uid}-familia-label`}>Familia</span>
            <SelectorFamilia
              id={`${uid}-familia-label`}
              value={campos.familia}
              opciones={FAMILIAS}
              vacio="Elige una familia"
              disabled={!!ocupado}
              seleccionar={(familia) => cambiar('familia', familia)}
            />
            {errores.familia && <small className="campo-error">{errores.familia}</small>}
          </div>
          {campo('modelo', 'Modelo', { placeholder: 'Ej.: Roble' })}
          {campo('madera', 'Madera', { placeholder: 'Ej.: Raulí' })}
          {campo('tipo', 'Tipo (opcional)')}
          {puerta ? (
            <>
              {campo('anchoMin', 'Ancho mínimo', {
                placeholder: 'Ej.: 0,80',
                ayuda: 'En metros (0,80), centímetros (80 cm) o milímetros (800 mm).',
              })}
              {campo('anchoMax', 'Ancho máximo', { placeholder: 'Ej.: 0,85' })}
              {campo('largo', 'Alto', {
                placeholder: 'Ej.: 2,10',
                ayuda: 'En metros (2,10), centímetros (210 cm) o milímetros (2100 mm).',
              })}
            </>
          ) : (
            <>
              {campo('medida', 'Medida o escuadría', {
                placeholder: 'Ej.: 2x4',
                ayuda: 'Escuadría: grosor por ancho de la pieza.',
              })}
              {campo('largo', 'Largo', {
                placeholder: 'Ej.: 3,60',
                ayuda: 'En metros (3,60), centímetros (360 cm) o milímetros (3600 mm).',
              })}
            </>
          )}
          {campo('precio', 'Precio base sin IVA', {
            placeholder: 'Ej.: 145.000',
            ayuda: 'Costo de fábrica, sin la ganancia de venta.',
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
            Revisión antes de guardar
          </p>
          <h3>{nombreProducto(propuesta.descripcion)}</h3>
          <dl>
            <div>
              <dt>Código interno asignado</dt>
              <dd>{propuesta.codigo}</dd>
            </div>
            <div>
              <dt>Familia</dt>
              <dd>{etiquetaFamilia(propuesta.familia)}</dd>
            </div>
            <div>
              <dt>Precio base sin IVA</dt>
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
          <p className="catalog-price-note">Confirma que el precio base sin IVA y los datos del producto sean correctos.</p>
          <button type="button" className="button primary" onClick={guardar} disabled={!!ocupado}>
            {ocupado === 'guardar' ? 'Guardando…' : 'Confirmar y guardar'}
          </button>
        </div>
      )}
      {confirmacion}
    </div>
  );
}

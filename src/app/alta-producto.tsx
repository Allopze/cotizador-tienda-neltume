'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Producto } from '@/catalogo/tipos';
import { pesos, porcentaje, REGLAS } from '@/negocio/precios';
import { CatalogoConsulta } from './catalogo-consulta';
import { Dialogo, useConfirmacion } from './dialogo';
import { enterEnvia } from './formato';
import { ProductosManuales } from './productos-manuales';
import type { TipoAviso } from './avisos';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

type Mensaje = { rol: 'usuario' | 'asistente'; texto: string };
interface Props {
  abierta: boolean;
  /** El alta asistida necesita el asistente; la lista de manuales no. */
  asistente: boolean;
  cerrar: () => void;
  avisar: (tipo: TipoAviso, texto: string, extra?: { clave?: string }) => number;
}
interface Respuesta {
  id: string;
  mensajes: Mensaje[];
  propuesta: Producto | null;
  producto?: Producto;
  /** Conversión bruto→neto, precio atípico… */
  avisos?: string[];
}

const ajuste = porcentaje(REGLAS.ajuste * 100);
const venta = (neto: number) => Math.round(neto * (1 + REGLAS.ajuste));

export function AltaProducto({ abierta, asistente, cerrar, avisar }: Props) {
  const [pestana, setPestana] = useState<'consultar' | 'alta' | 'manuales'>('consultar');
  const [avisosAlta, setAvisosAlta] = useState<string[]>([]);
  const [id, setId] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [propuesta, setPropuesta] = useState<Producto | null>(null);
  const [guardado, setGuardado] = useState<Producto | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const entrada = useRef<HTMLTextAreaElement>(null),
    listo = useRef<HTMLButtonElement>(null);
  const [confirmar, confirmacion] = useConfirmacion();

  // Tras guardar, el foco pasa a «Listo» para no quedar en un elemento desmontado.
  useEffect(() => {
    if (guardado) listo.current?.focus();
  }, [guardado]);

  const pedir = (cuerpo: Record<string, unknown>) => pedirJSON<Respuesta>('/api/catalogo', { json: cuerpo });
  const fallo = (causa: unknown) => {
    if (!esSilencioso(causa)) setError(mensajeDe(causa));
  };

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (!mensaje.trim() || ocupado || guardado) return;
    setOcupado(true);
    setError('');
    try {
      const data = await pedir({ tipo: 'mensaje', ...(id ? { id } : {}), mensaje });
      setId(data.id);
      setMensajes(data.mensajes);
      setPropuesta(data.propuesta);
      setAvisosAlta(data.avisos ?? []);
      setMensaje('');
    } catch (causa) {
      fallo(causa);
    } finally {
      setOcupado(false);
      requestAnimationFrame(() => entrada.current?.focus());
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
    setOcupado(true);
    setError('');
    try {
      const data = await pedir({ tipo: 'confirmar', id });
      setGuardado(data.producto ?? propuesta);
      setPropuesta(null);
    } catch (causa) {
      fallo(causa);
    } finally {
      setOcupado(false);
    }
  }

  async function salir() {
    if (ocupado) return;
    if (id && !guardado) {
      setOcupado(true);
      try {
        await pedir({ tipo: 'cancelar', id });
      } catch {
        // El borrador puede haber expirado; cerrarlo sigue siendo seguro.
      } finally {
        setOcupado(false);
      }
    }
    setId(null);
    setMensajes([]);
    setMensaje('');
    setPropuesta(null);
    setGuardado(null);
    setError('');
    setAvisosAlta([]);
    setPestana('consultar');
    cerrar();
  }

  return (
    <Dialogo
      abierto={abierta}
      alCerrar={salir}
      cerrable={!ocupado}
      titulo="Catálogo de productos"
      eyebrow="CATÁLOGO"
      focoInicial={asistente && pestana === 'alta' ? entrada : undefined}
    >
      <div className="pestanas" role="tablist" aria-label="Secciones del catálogo">
        <button
          type="button"
          role="tab"
          id="tab-consultar"
          aria-selected={pestana === 'consultar'}
          aria-controls="panel-catalogo"
          onClick={() => setPestana('consultar')}
          disabled={ocupado}
        >
          Consultar
        </button>
        <button
          type="button"
          role="tab"
          id="tab-alta"
          aria-selected={pestana === 'alta'}
          aria-controls="panel-catalogo"
          onClick={() => setPestana('alta')}
          disabled={ocupado}
        >
          Agregar producto
        </button>
        <button
          type="button"
          role="tab"
          id="tab-manuales"
          aria-selected={pestana === 'manuales'}
          aria-controls="panel-catalogo"
          onClick={() => setPestana('manuales')}
          disabled={ocupado}
        >
          Agregados manualmente
        </button>
      </div>
      <div id="panel-catalogo" role="tabpanel" aria-labelledby={`tab-${pestana}`}>
        {pestana === 'consultar' ? (
          <CatalogoConsulta />
        ) : pestana === 'manuales' ? (
          <ProductosManuales avisar={avisar} />
        ) : guardado ? (
          <div className="catalog-success" role="status">
            <span className="catalog-success-mark" aria-hidden>
              ✓
            </span>
            <h3>Producto agregado</h3>
            <p>{guardado.descripcion}</p>
            <small>Código {guardado.codigo} · Precio neto ingresado manualmente.</small>
            <button ref={listo} type="button" className="button primary" onClick={salir}>
              Listo
            </button>
          </div>
        ) : (
          <>
            {!asistente && (
              <p className="notice">
                El alta asistida no está disponible: el asistente no está configurado. Aún puedes revisar y
                editar los productos agregados manualmente.
              </p>
            )}
            <p className="catalog-modal-intro">
              Describe el modelo, la familia, la madera, las medidas y el precio neto unitario. El asistente
              te preguntará lo que falte. <strong>Ingresa el precio base neto, no el de venta:</strong> las
              cotizaciones le suman {ajuste} automáticamente, igual que a los productos de la planilla.
            </p>
            <div className="catalog-chat" aria-busy={ocupado}>
              {!mensajes.length ? (
                <div className="catalog-chat-hint">
                  Por ejemplo: «Agrega una puerta modelo Roble, en raulí, de 80 a 85 cm de ancho y 2,10 m de
                  alto; precio neto $145.000».
                </div>
              ) : (
                mensajes.map((item, indice) => (
                  <div key={indice} className={`catalog-message ${item.rol}`}>
                    <span className="speaker">{item.rol === 'usuario' ? 'TÚ' : 'NELTUME'}</span>
                    <p>{item.texto}</p>
                  </div>
                ))
              )}
              {ocupado && <div className="thinking">Preparando la propuesta…</div>}
            </div>
            <p className="sr-only" aria-live="polite">
              {ocupado
                ? 'Preparando la propuesta…'
                : mensajes.at(-1)?.rol === 'asistente'
                  ? mensajes.at(-1)?.texto
                  : ''}
            </p>

            {propuesta && (
              <div className="catalog-preview">
                <p className="eyebrow">REVISIÓN ANTES DE GUARDAR</p>
                <h3>{propuesta.descripcion}</h3>
                <dl>
                  <div>
                    <dt>Código interno asignado</dt>
                    <dd>{propuesta.codigo}</dd>
                  </div>
                  <div>
                    <dt>Familia</dt>
                    <dd>{propuesta.familia}</dd>
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
                <p className="catalog-price-note">
                  Confirma que el precio neto y los atributos sean correctos.
                </p>
                <button type="button" className="button primary" onClick={guardar} disabled={ocupado}>
                  Confirmar y guardar
                </button>
              </div>
            )}

            {error && (
              <p className="catalog-error" role="alert">
                {error}
              </p>
            )}
            <form className="catalog-composer" onSubmit={enviar}>
              <label className="sr-only" htmlFor="mensaje-catalogo">
                Describe el producto
              </label>
              <textarea
                id="mensaje-catalogo"
                ref={entrada}
                value={mensaje}
                onChange={(evento) => setMensaje(evento.target.value)}
                placeholder="Describe o completa los datos…"
                rows={3}
                maxLength={3000}
                disabled={ocupado || !asistente}
                aria-describedby="ayuda-catalogo"
                onKeyDown={enterEnvia}
              />
              <div>
                <span id="ayuda-catalogo">Debe incluir un precio neto explícito.</span>
                <button type="submit" disabled={!mensaje.trim() || ocupado}>
                  Enviar <span aria-hidden>↗</span>
                </button>
              </div>
            </form>
          </>
        )}
      </div>
      {confirmacion}
    </Dialogo>
  );
}

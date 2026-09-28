'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { fetchAutenticado } from './solicitud';
import type { Producto } from '@/catalogo/tipos';

type Mensaje = { rol: 'usuario' | 'asistente'; texto: string };
interface Props {
  abierta: boolean;
  cerrar: () => void;
}

const pesos = (valor: number) =>
  new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 2 }).format(valor);

export function AltaProducto({ abierta, cerrar }: Props) {
  const [id, setId] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [propuesta, setPropuesta] = useState<Producto | null>(null);
  const [guardado, setGuardado] = useState<Producto | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const entrada = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (abierta) entrada.current?.focus();
  }, [abierta]);

  if (!abierta) return null;

  async function pedir(cuerpo: Record<string, unknown>) {
    const respuesta = await fetchAutenticado('/api/catalogo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const data = await respuesta.json();
    if (!respuesta.ok) throw new Error(data.error ?? 'No se pudo completar el alta.');
    return data;
  }

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
      setMensaje('');
    } catch (causa) {
      setError((causa as Error).message);
    } finally {
      setOcupado(false);
      entrada.current?.focus();
    }
  }

  async function confirmar() {
    if (!id || !propuesta || ocupado || guardado) return;
    const aceptar = window.confirm(
      `¿Agregar “${propuesta.descripcion}” al catálogo con precio neto unitario ${pesos(propuesta.precioNeto)}?`,
    );
    if (!aceptar) return;
    setOcupado(true);
    setError('');
    try {
      const data = await pedir({ tipo: 'confirmar', id });
      setGuardado(data.producto);
      setPropuesta(null);
    } catch (causa) {
      setError((causa as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function salir() {
    if (ocupado) return;
    if (id && !guardado) {
      try {
        await pedir({ tipo: 'cancelar', id });
      } catch {
        // El borrador puede haber expirado; cerrarlo sigue siendo seguro.
      }
    }
    setId(null);
    setMensajes([]);
    setMensaje('');
    setPropuesta(null);
    setGuardado(null);
    setError('');
    cerrar();
  }

  return (
    <div className="catalog-modal-backdrop">
      <section className="catalog-modal" role="dialog" aria-modal="true" aria-labelledby="alta-titulo">
        <header className="catalog-modal-heading">
          <div>
            <p className="eyebrow">CATÁLOGO / ALTA ASISTIDA</p>
            <h2 id="alta-titulo">Agregar un producto</h2>
          </div>
          <button type="button" className="catalog-modal-close" onClick={salir} disabled={ocupado} aria-label="Cerrar">
            ×
          </button>
        </header>

        {guardado ? (
          <div className="catalog-success" role="status">
            <span className="catalog-success-mark" aria-hidden>✓</span>
            <h3>Producto agregado</h3>
            <p>{guardado.descripcion}</p>
            <small>Código {guardado.codigo} · El precio lo ingresaste tú.</small>
            <button type="button" className="button primary" onClick={salir}>Listo</button>
          </div>
        ) : (
          <>
            <p className="catalog-modal-intro">
              Describe el modelo, la familia, la madera, las medidas y el precio neto unitario. La IA puede preguntarte lo que falte.
            </p>
            <div className="catalog-chat" aria-live="polite" aria-busy={ocupado}>
              {!mensajes.length ? (
                <div className="catalog-chat-hint">
                  Por ejemplo: «Agrega una puerta modelo Roble, en raulí, de 80 a 85 cm de ancho y 2,10 m de alto; precio neto $145.000».
                </div>
              ) : (
                mensajes.map((item, indice) => (
                  <div key={indice} className={`catalog-message ${item.rol}`}>
                    <span className="speaker">{item.rol === 'usuario' ? 'TÚ' : 'NELTUME'}</span>
                    <p>{item.texto}</p>
                  </div>
                ))
              )}
              {ocupado && <div className="thinking" role="status">Preparando la propuesta…</div>}
            </div>

            {propuesta && (
              <div className="catalog-preview">
                <p className="eyebrow">REVISIÓN ANTES DE GUARDAR</p>
                <h3>{propuesta.descripcion}</h3>
                <dl>
                  <div><dt>Código interno asignado</dt><dd>{propuesta.codigo}</dd></div>
                  <div><dt>Familia</dt><dd>{propuesta.familia}</dd></div>
                  <div><dt>Precio neto unitario</dt><dd>{pesos(propuesta.precioNeto)}</dd></div>
                </dl>
                <p className="catalog-price-note">Confirma que el precio neto y los atributos sean correctos.</p>
                <button type="button" className="button primary" onClick={confirmar} disabled={ocupado}>
                  Confirmar y guardar
                </button>
              </div>
            )}

            {error && <p className="catalog-error" role="alert">{error}</p>}
            <form className="catalog-composer" onSubmit={enviar}>
              <label className="sr-only" htmlFor="mensaje-catalogo">Describe el producto</label>
              <textarea
                id="mensaje-catalogo"
                ref={entrada}
                value={mensaje}
                onChange={(evento) => setMensaje(evento.target.value)}
                placeholder="Describe o completa los datos…"
                rows={3}
                maxLength={3000}
                disabled={ocupado}
                onKeyDown={(evento) => {
                  if (evento.key === 'Enter' && !evento.shiftKey) {
                    evento.preventDefault();
                    evento.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div>
                <span>Debe incluir un precio neto explícito.</span>
                <button type="submit" disabled={!mensaje.trim() || ocupado}>Enviar ↗</button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

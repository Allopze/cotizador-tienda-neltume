'use client';
import { useEffect, useState } from 'react';
import { pesos } from '@/negocio/precios';
import { CampoEditable } from './campo-editable';
import type { ProductoManual } from './contrato';
import type { TipoAviso } from './avisos';
import { useConfirmacion } from './dialogo';
import { fechaCorta } from './formato';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

type Avisar = (tipo: TipoAviso, texto: string, extra?: { clave?: string }) => number;
const numero = (v: string) => Number(v.replace(/[$.\s]/g, '').replace(',', '.'));

/** Productos agregados a mano: listar, corregir precio o descripción y eliminar. */
export function ProductosManuales({ avisar }: { avisar: Avisar }) {
  const [productos, setProductos] = useState<ProductoManual[] | null>(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [confirmar, confirmacion] = useConfirmacion();

  useEffect(() => {
    const control = new AbortController();
    pedirJSON<{ productos: ProductoManual[] }>('/api/catalogo', {
      json: { tipo: 'listar_manuales' },
      signal: control.signal,
    }).then(
      (d) => {
        setProductos(d.productos);
        setError('');
      },
      (e) => {
        if (!esSilencioso(e)) setError(mensajeDe(e));
      },
    );
    return () => control.abort();
  }, [recarga]);

  async function editar(p: ProductoManual, cambios: Record<string, unknown>, campo: string) {
    setGuardando(`${p.codigo}.${campo}`);
    try {
      const d = await pedirJSON<{ producto: ProductoManual }>('/api/catalogo', {
        json: { tipo: 'editar', codigo: p.codigo, cambios },
      });
      setProductos((l) => l?.map((x) => (x.codigo === p.codigo ? { ...x, ...d.producto } : x)) ?? l);
      avisar('exito', `Se actualizó ${p.codigo}.`, { clave: 'catalogo' });
      return true;
    } catch (e) {
      if (!esSilencioso(e)) avisar('error', mensajeDe(e), { clave: 'catalogo' });
      return false;
    } finally {
      setGuardando(null);
    }
  }

  async function eliminar(p: ProductoManual) {
    const ok = await confirmar({
      titulo: 'Eliminar producto',
      mensaje: (
        <>
          <p>
            ¿Eliminar «{p.descripcion}» ({p.codigo}) del catálogo?
          </p>
          <p>
            Los borradores que lo usan quedarán con ese ítem pendiente. Las cotizaciones emitidas o aprobadas
            conservan su precio.
          </p>
        </>
      ),
      aceptar: 'Eliminar producto',
    });
    if (!ok) return;
    setGuardando(`${p.codigo}.eliminar`);
    try {
      await pedirJSON('/api/catalogo', { json: { tipo: 'eliminar', codigo: p.codigo } });
      setProductos((l) => l?.filter((x) => x.codigo !== p.codigo) ?? l);
      avisar('exito', `Se eliminó ${p.codigo} del catálogo.`, { clave: 'catalogo' });
    } catch (e) {
      if (!esSilencioso(e)) avisar('error', mensajeDe(e), { clave: 'catalogo' });
    } finally {
      setGuardando(null);
    }
  }

  if (error)
    return (
      <p className="catalog-error" role="alert">
        {error}
        <button type="button" className="link" onClick={() => setRecarga((n) => n + 1)}>
          Reintentar
        </button>
      </p>
    );
  if (!productos) return <p className="catalog-modal-intro">Cargando productos…</p>;
  return (
    <div className="manuales">
      <p className="catalog-modal-intro">
        Productos agregados a mano. Los importados de la planilla no se editan aquí. Cambiar un precio afecta
        a los borradores; lo ya emitido conserva su valor.
      </p>
      {!productos.length ? (
        <p className="catalog-chat-hint">Aún no se han agregado productos a mano.</p>
      ) : (
        <ul className="manuales-lista">
          {productos.map((p) => (
            <li key={p.codigo}>
              <div className="manuales-cabecera">
                <strong>{p.codigo}</strong>
                <small>
                  {p.familia} · agregado el {fechaCorta(p.creada)}
                  {p.creadaPor ? ` por ${p.creadaPor}` : ''}
                </small>
              </div>
              <CampoEditable
                etiqueta="Descripción"
                valor={p.descripcion}
                editable
                guardando={guardando === `${p.codigo}.descripcion`}
                validar={(v) => (v ? null : 'La descripción no puede quedar vacía.')}
                guardar={(v) => editar(p, { descripcion: v }, 'descripcion')}
              />
              <CampoEditable
                etiqueta="Precio neto unitario"
                valor={String(p.precioNeto)}
                mostrar={pesos(p.precioNeto)}
                editable
                guardando={guardando === `${p.codigo}.precio`}
                sufijo="$"
                validar={(v) => {
                  const n = numero(v);
                  return Number.isFinite(n) && n > 0 && n <= 100_000_000
                    ? null
                    : 'Ingresa un precio neto mayor que cero.';
                }}
                guardar={(v) => editar(p, { precioNeto: numero(v) }, 'precio')}
              />
              <button
                type="button"
                className="button secondary small peligro"
                onClick={() => eliminar(p)}
                disabled={guardando === `${p.codigo}.eliminar`}
              >
                {guardando === `${p.codigo}.eliminar` ? 'Eliminando…' : 'Eliminar'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {confirmacion}
    </div>
  );
}

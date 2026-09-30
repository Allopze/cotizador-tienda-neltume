'use client';
import { useState, type FormEvent } from 'react';
import { esSilencioso, mensajeDe, pedirJSON } from '../solicitud';

interface ProductoBreve { codigo: string; descripcion: string; precioNeto?: number }
interface Preview {
  /** Planilla detectada por la forma del libro: cada una reemplaza solo sus productos. */
  origen: string;
  etiquetaOrigen: string;
  /** Las otras planillas ya importadas, que esta importación no toca. */
  sinModificar: { origen: string; etiqueta: string; productos: number }[];
  sha256: string;
  baseSha256: string | null;
  fuente: string;
  totalProductos: number;
  conteos: { nuevos: number; modificados: number; sinCambios: number; eliminados: number };
  productos: {
    nuevos: ProductoBreve[];
    modificados: { codigo: string; anterior: ProductoBreve; nuevo: ProductoBreve }[];
    sinCambios: ProductoBreve[];
    eliminados: ProductoBreve[];
  };
  incidencias: { fila: number; hoja?: string; accion: 'correccion' | 'exclusion'; detalle: string }[];
  erroresPlantilla: string[];
}

const cantidad = (n: number) => new Intl.NumberFormat('es-CL').format(n);
const pesos = (n: number) => '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n);

export function ImportarCatalogo() {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [forzarConfirmado, setForzarConfirmado] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  const cantidadAnterior = preview ? preview.conteos.sinCambios + preview.conteos.modificados + preview.conteos.eliminados : 0;
  const requiereForzar = !!preview && preview.totalProductos < cantidadAnterior * 0.9;

  async function enviar(evento: FormEvent, accion: 'previsualizar' | 'confirmar') {
    evento.preventDefault();
    if (!archivo || ocupado) return;
    if (accion === 'confirmar' && preview) {
      const resumen = `Excel: ${preview.fuente}\n${preview.etiquetaOrigen}\nNuevos: ${preview.conteos.nuevos}\nModificados: ${preview.conteos.modificados}\nSin cambios: ${preview.conteos.sinCambios}\nEliminados: ${preview.conteos.eliminados}\n\n¿Aplicar esta versión de la planilla? Los demás productos del catálogo no cambian.`;
      if (!window.confirm(resumen)) return;
    }
    setOcupado(true);
    setError('');
    setMensaje('');
    try {
      const body = new FormData();
      body.set('archivo', archivo);
      body.set('accion', accion);
      if (accion === 'confirmar' && preview) {
        body.set('sha256', preview.sha256);
        body.set('baseSha256', preview.baseSha256 ?? '');
        body.set('forzar', String(requiereForzar && forzarConfirmado));
        const resultado = await pedirJSON<{ importado: true; fuente: string; etiquetaOrigen: string; conteos: Preview['conteos'] }>('/api/catalogo/importar', { method: 'POST', body });
        setMensaje(`${resultado.etiquetaOrigen} actualizada desde ${resultado.fuente}: ${resultado.conteos.nuevos} productos nuevos, ${resultado.conteos.modificados} modificados y ${resultado.conteos.eliminados} retirados.`);
        setPreview(null);
        setArchivo(null);
        setForzarConfirmado(false);
        setInputKey((n) => n + 1);
      } else {
        setPreview(await pedirJSON<Preview>('/api/catalogo/importar', { method: 'POST', body }));
        setForzarConfirmado(false);
      }
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="catalog-import">
      <p className="catalog-modal-intro">El catálogo vigente se conserva hasta que revises la comparación y confirmes el cambio. Sube la planilla de puertas sólidas o la de enchapadas, prepintadas y marcos finger: se reconoce sola y cada una reemplaza únicamente sus propios productos.</p>
      <form onSubmit={(e) => void enviar(e, 'previsualizar')}>
        <label className="ia-field">
          <span>Planilla de precios Excel (.xlsx, máximo 20 MB)</span>
          <input key={inputKey} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setPreview(null); setError(''); setForzarConfirmado(false); }} disabled={ocupado} />
        </label>
        <div className="ia-actions"><button type="submit" className="button primary" disabled={!archivo || ocupado}>{ocupado ? 'Analizando…' : 'Analizar y comparar'}</button></div>
      </form>
      {error && <p className="catalog-error" role="alert">{error}</p>}
      {mensaje && <p className="notice notice-success" role="status">{mensaje}</p>}
      {preview && (
        <section className="catalog-import-preview" aria-labelledby="import-preview-title">
          <h3 id="import-preview-title">Vista previa · {preview.fuente}</h3>
          <p>Formato detectado: <strong>{preview.etiquetaOrigen}</strong>. {preview.totalProductos} productos en la planilla.</p>
          <p>Solo se reemplazan los productos de esta planilla. No se modifican {preview.sinModificar.map((o) => `la ${o.etiqueta.toLowerCase()} (${o.productos ? `${cantidad(o.productos)} productos` : 'aún sin importar'})`).join(' ni ')} ni los productos agregados a mano.</p>
          <div className="import-counts">
            <span><strong>{preview.conteos.nuevos}</strong> Nuevos</span>
            <span><strong>{preview.conteos.modificados}</strong> Modificados</span>
            <span><strong>{preview.conteos.sinCambios}</strong> Sin cambios</span>
            <span><strong>{preview.conteos.eliminados}</strong> Eliminados</span>
          </div>
          {preview.conteos.eliminados > 0 && <p className="catalog-warning">Al confirmar, se retirarán {preview.conteos.eliminados} productos que no aparecen en esta planilla.</p>}
          {requiereForzar && <label className="import-force"><input type="checkbox" checked={forzarConfirmado} onChange={(e) => setForzarConfirmado(e.target.checked)} /> Confirmo que la reducción a {preview.totalProductos} productos es intencional.</label>}
          {preview.erroresPlantilla.length > 0 && <div className="catalog-warning"><strong>Advertencias de la planilla</strong><ul>{preview.erroresPlantilla.map((x) => <li key={x}>{x}</li>)}</ul></div>}
          <div className="import-change-groups">
            {preview.productos.nuevos.length > 0 && <div><h4>Nuevos</h4><ul>{preview.productos.nuevos.map((p) => <li key={p.codigo}>{p.codigo} · {p.descripcion} · {pesos(p.precioNeto ?? 0)}</li>)}</ul>{preview.conteos.nuevos > 100 && <small>Se muestran los primeros 100.</small>}</div>}
            {preview.productos.modificados.length > 0 && <div><h4>Modificados</h4><ul>{preview.productos.modificados.map((p) => <li key={p.codigo}>{p.codigo} · {p.anterior.descripcion} → {p.nuevo.descripcion} · {pesos(p.anterior.precioNeto ?? 0)} → {pesos(p.nuevo.precioNeto ?? 0)}</li>)}</ul></div>}
            {preview.productos.eliminados.length > 0 && <div><h4>Eliminados</h4><ul>{preview.productos.eliminados.map((p) => <li key={p.codigo}>{p.codigo} · {p.descripcion}</li>)}</ul></div>}
          </div>
          {preview.incidencias.length > 0 && <details><summary>Incidencias de la importación ({preview.incidencias.length})</summary><ul>{preview.incidencias.slice(0, 50).map((i, n) => <li key={`${i.hoja ?? ''}-${i.fila}-${n}`}>{i.hoja ? `${i.hoja.trim()} · ` : ''}Fila {i.fila}: {i.detalle}</li>)}</ul></details>}
          <div className="ia-actions">
            <button type="button" className="button secondary" disabled={ocupado} onClick={() => { setPreview(null); setForzarConfirmado(false); }}>Descartar vista previa</button>
            <button type="button" className="button primary" disabled={ocupado || (requiereForzar && !forzarConfirmado)} onClick={(e) => void enviar(e as unknown as FormEvent, 'confirmar')}>{ocupado ? 'Aplicando…' : 'Confirmar e importar'}</button>
          </div>
        </section>
      )}
    </div>
  );
}

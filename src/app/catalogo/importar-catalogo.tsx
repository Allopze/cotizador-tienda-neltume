'use client';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { useConfirmacion } from '../dialogo';
import { fechaCorta, plural } from '../formato';
import { codigoDe, esSilencioso, mensajeDe, pedirJSON } from '../solicitud';

interface ProductoBreve { codigo: string; descripcion: string; precioNeto?: number }
interface Preview {
  /** Planilla detectada por la forma del libro: cada una reemplaza solo sus productos. */
  origen: string;
  etiquetaOrigen: string;
  /** Las otras planillas ya importadas, que esta importación no toca. */
  sinModificar: { origen: string; etiqueta: string; productos: number }[];
  sha256: string;
  baseSha256: string | null;
  /** Versión del catálogo al previsualizar (null si aún no hay): se devuelve al confirmar. */
  versionCatalogo: string | null;
  /** Productos de esta planilla editados a mano: al importar vuelven a los valores de la planilla. */
  edicionesManuales: ProductoBreve[];
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
/** Copia que guardó la importación: lo que trae «Volver a la planilla anterior» (ver PlanillaAnterior). */
interface PlanillaAnterior {
  origen: string;
  etiqueta: string;
  fuente: string;
  fecha: string;
  productos: number;
  edicionesManuales: number;
}
interface Importado {
  importado: true;
  fuente: string;
  etiquetaOrigen: string;
  conteos: Preview['conteos'];
  anterior: PlanillaAnterior | null;
  /** Versión del catálogo tras importar: volver atrás solo se permite si sigue vigente. */
  versionCatalogo: string | null;
}
/** Se puede volver a la planilla anterior mientras el catálogo siga en `versionCatalogo`. */
type Deshacer = PlanillaAnterior & { importada: string; versionCatalogo: string };

const MAXIMO_MB = 20;
const cantidad = (n: number) => new Intl.NumberFormat('es-CL').format(n);
const pesos = (n: number) => '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n);
const tamano = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toLocaleString('es-CL', { maximumFractionDigits: 1 })} MB`;
/** Diferencia de precio: «+4,2 %», «−1 %». */
function variacion(anterior = 0, nuevo = 0) {
  if (!anterior) return '';
  const pct = ((nuevo - anterior) / anterior) * 100;
  if (Math.abs(pct) < 0.05) return '';
  return ` (${pct > 0 ? '+' : '−'}${Math.abs(pct).toLocaleString('es-CL', { maximumFractionDigits: 1 })} %)`;
}

export function ImportarCatalogo() {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  // Qué se está haciendo; vacío si nada.
  const [ocupado, setOcupado] = useState<'' | 'previsualizar' | 'confirmar' | 'volver'>('');
  const [arrastrando, setArrastrando] = useState(false);
  const [forzarConfirmado, setForzarConfirmado] = useState(false);
  const [inputKey, setInputKey] = useState(0);
  // El catálogo o el archivo cambiaron después de la vista previa: ya no se puede confirmar, solo volver a analizar.
  const [obsoleta, setObsoleta] = useState('');
  const [deshacer, setDeshacer] = useState<Deshacer | null>(null);
  const [confirmar, confirmacion] = useConfirmacion();
  // «Confirmar e importar» se deshabilita con el foco encima: pasa a «Volver a analizar», que es lo que sigue.
  const volverAnalizar = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (obsoleta) volverAnalizar.current?.focus();
  }, [obsoleta]);
  const cantidadAnterior = preview ? preview.conteos.sinCambios + preview.conteos.modificados + preview.conteos.eliminados : 0;
  const requiereForzar = !!preview && preview.totalProductos < cantidadAnterior * 0.9;
  const sinCambios = !!preview && preview.conteos.nuevos + preview.conteos.modificados + preview.conteos.eliminados === 0;

  function elegir(nuevo: File | null) {
    setPreview(null);
    setError('');
    setMensaje('');
    setForzarConfirmado(false);
    setObsoleta('');
    setDeshacer(null);
    if (nuevo && !/\.xlsx$/i.test(nuevo.name)) {
      setArchivo(null);
      setError('El archivo debe ser una planilla Excel .xlsx.');
      return;
    }
    if (nuevo && nuevo.size > MAXIMO_MB * 1024 * 1024) {
      setArchivo(null);
      setError(`El archivo pesa ${tamano(nuevo.size)}; el máximo es ${MAXIMO_MB} MB.`);
      return;
    }
    setArchivo(nuevo);
  }

  function soltar(evento: DragEvent<HTMLLabelElement>) {
    evento.preventDefault();
    setArrastrando(false);
    if (!ocupado) elegir(evento.dataTransfer.files?.[0] ?? null);
  }

  async function enviar(evento: FormEvent | null, accion: 'previsualizar' | 'confirmar') {
    evento?.preventDefault();
    if (!archivo || ocupado) return;
    if (accion === 'confirmar' && obsoleta) return;
    if (accion === 'confirmar' && preview) {
      const aceptar = await confirmar({
        titulo: 'Importar planilla',
        mensaje: (
          <>
            <p>
              Se aplicará <strong>{preview.fuente}</strong> ({preview.etiquetaOrigen.toLowerCase()}). Los demás
              productos del catálogo no cambian.
            </p>
            <dl className="import-resumen">
              <div><dt>Nuevos</dt><dd>{cantidad(preview.conteos.nuevos)}</dd></div>
              <div><dt>Modificados</dt><dd>{cantidad(preview.conteos.modificados)}</dd></div>
              <div><dt>Sin cambios</dt><dd>{cantidad(preview.conteos.sinCambios)}</dd></div>
              <div><dt>Retirados</dt><dd>{cantidad(preview.conteos.eliminados)}</dd></div>
            </dl>
            {preview.edicionesManuales.length > 0 && (
              <p>
                Se pierden los cambios hechos a mano en{' '}
                {plural(preview.edicionesManuales.length, 'producto', 'productos')} de esta planilla.
              </p>
            )}
          </>
        ),
        aceptar: 'Importar planilla',
      });
      if (!aceptar) return;
    }
    setOcupado(accion);
    setError('');
    setMensaje('');
    try {
      const body = new FormData();
      body.set('archivo', archivo);
      body.set('accion', accion);
      if (accion === 'confirmar' && preview) {
        body.set('versionCatalogo', preview.versionCatalogo ?? '');
        body.set('sha256', preview.sha256);
        body.set('baseSha256', preview.baseSha256 ?? '');
        body.set('forzar', String(requiereForzar && forzarConfirmado));
        const resultado = await pedirJSON<Importado>('/api/catalogo/importar', { method: 'POST', body });
        setMensaje(`${resultado.etiquetaOrigen} actualizada desde ${resultado.fuente}: ${cantidad(resultado.conteos.nuevos)} productos nuevos, ${cantidad(resultado.conteos.modificados)} modificados y ${cantidad(resultado.conteos.eliminados)} retirados.`);
        setDeshacer(
          resultado.anterior && resultado.versionCatalogo
            ? { ...resultado.anterior, importada: resultado.fuente, versionCatalogo: resultado.versionCatalogo }
            : null,
        );
        setPreview(null);
        setArchivo(null);
        setForzarConfirmado(false);
        setInputKey((n) => n + 1);
      } else {
        setPreview(await pedirJSON<Preview>('/api/catalogo/importar', { method: 'POST', body }));
        setForzarConfirmado(false);
        setObsoleta('');
      }
    } catch (causa) {
      if (esSilencioso(causa)) return;
      // Repetir la confirmación daría el mismo error: la vista previa queda inhabilitada hasta analizar de nuevo.
      if (accion === 'confirmar' && codigoDe(causa) === 'vista_previa_obsoleta') setObsoleta(mensajeDe(causa));
      else setError(mensajeDe(causa));
    } finally {
      setOcupado('');
    }
  }

  async function volverAnterior() {
    if (!deshacer || ocupado) return;
    const d = deshacer;
    const aceptar = await confirmar({
      titulo: 'Volver a la planilla anterior',
      mensaje: (
        <>
          <p>
            La {d.etiqueta.toLowerCase()} vuelve a como estaba antes de importar <strong>{d.importada}</strong>: los{' '}
            {cantidad(d.productos)} productos de <strong>{d.fuente}</strong>
            {d.fecha ? `, importada el ${fechaCorta(d.fecha)}` : ''}, con los precios que tenían en el catálogo.
          </p>
          {d.edicionesManuales > 0 && (
            <p>
              Vuelven también los cambios hechos a mano en {plural(d.edicionesManuales, 'producto', 'productos')} de esa
              planilla, que siguen marcados como editados a mano: la próxima importación los volverá a avisar.
            </p>
          )}
          <p>
            No cambian la otra planilla ni los productos agregados a mano, y las cotizaciones ya emitidas conservan
            sus precios. Si después quieres la planilla que acabas de importar, vuelve a importarla.
          </p>
        </>
      ),
      aceptar: 'Volver a la planilla anterior',
    });
    if (!aceptar) return;
    setOcupado('volver');
    setError('');
    setMensaje('');
    try {
      const r = await pedirJSON<{ restaurada: PlanillaAnterior }>('/api/catalogo', {
        json: { tipo: 'volver_planilla', origen: d.origen, versionCatalogo: d.versionCatalogo },
      });
      setMensaje(
        `${r.restaurada.etiqueta} de vuelta en ${r.restaurada.fuente}: ${cantidad(r.restaurada.productos)} productos${r.restaurada.edicionesManuales ? `, ${plural(r.restaurada.edicionesManuales, 'editado', 'editados')} a mano` : ''}.`,
      );
      setDeshacer(null);
    } catch (causa) {
      if (esSilencioso(causa)) return;
      setError(mensajeDe(causa));
      // El catálogo cambió o ya no hay copia: volver atrás dejó de ser posible.
      if (codigoDe(causa) === 'version_obsoleta' || codigoDe(causa) === 'no_encontrada') setDeshacer(null);
    } finally {
      setOcupado('');
    }
  }

  return (
    <div className="catalog-import">
      <p className="catalog-modal-intro">
        Sube la planilla de puertas sólidas o la de enchapadas, prepintadas y marcos finger: se reconoce sola y cada
        una reemplaza únicamente sus propios productos. El catálogo vigente no cambia hasta que revises la comparación
        y confirmes.
      </p>
      <form className="import-formulario" onSubmit={(e) => void enviar(e, 'previsualizar')}>
        <label
          className={`import-archivo${arrastrando ? ' arrastrando' : ''}${archivo ? ' elegido' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!ocupado) setArrastrando(true);
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={soltar}
        >
          <input
            key={inputKey}
            className="sr-only"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => elegir(e.target.files?.[0] ?? null)}
            disabled={!!ocupado}
          />
          {archivo ? (
            <>
              <strong>{archivo.name}</strong>
              <span>{tamano(archivo.size)} · Elegir otro archivo</span>
            </>
          ) : (
            <>
              <strong>Elegir planilla Excel</strong>
              {/* Arrastrar no existe en el teléfono: allí solo se indica el formato. */}
              <span>
                <span className="solo-escritorio">o arrástrala aquí · </span>.xlsx, máximo {MAXIMO_MB} MB
              </span>
            </>
          )}
        </label>
        <button
          type="submit"
          className="button primary"
          disabled={!archivo || !!ocupado}
          aria-describedby={!archivo ? 'importar-sin-archivo' : undefined}
        >
          {ocupado === 'previsualizar' && !preview ? 'Analizando…' : 'Analizar y comparar'}
        </button>
        {!archivo && (
          <p className="muted" id="importar-sin-archivo">
            Elige una planilla para analizarla.
          </p>
        )}
      </form>
      {error && <p className="catalog-error" role="alert">{error}</p>}
      {mensaje && <p className="notice notice-success" role="status">{mensaje}</p>}
      {deshacer && (
        <div className="import-deshacer">
          <p className="muted">
            ¿No era esta planilla? Puedes volver a la anterior ({deshacer.fuente}) mientras nadie cambie el catálogo.
          </p>
          <div className="alta-acciones">
            <button type="button" className="button secondary" disabled={!!ocupado} onClick={() => void volverAnterior()}>
              {ocupado === 'volver' ? 'Volviendo…' : 'Volver a la planilla anterior'}
            </button>
          </div>
        </div>
      )}
      {preview && (
        <section className="catalog-import-preview" aria-labelledby="import-preview-title">
          <h3 id="import-preview-title">Vista previa · {preview.fuente}</h3>
          <p>
            Formato detectado: <strong>{preview.etiquetaOrigen}</strong>. {cantidad(preview.totalProductos)} productos en la planilla.
          </p>
          <p className="muted">
            Solo se reemplazan los productos de esta planilla. No se modifican{' '}
            {preview.sinModificar.map((o) => `la ${o.etiqueta.toLowerCase()} (${o.productos ? `${cantidad(o.productos)} productos` : 'aún sin importar'})`).join(' ni ')}{' '}
            ni los productos agregados a mano.
          </p>
          <div className="import-counts">
            <span><strong>{cantidad(preview.conteos.nuevos)}</strong> Nuevos</span>
            <span><strong>{cantidad(preview.conteos.modificados)}</strong> Modificados</span>
            <span><strong>{cantidad(preview.conteos.sinCambios)}</strong> Sin cambios</span>
            <span><strong>{cantidad(preview.conteos.eliminados)}</strong> Retirados</span>
          </div>
          {sinCambios && <p className="notice">La planilla es idéntica al catálogo vigente: no hay nada que importar.</p>}
          {preview.edicionesManuales.length > 0 && (
            <>
              <p className="catalog-warning">
                {plural(preview.edicionesManuales.length, 'producto de esta planilla se editó', 'productos de esta planilla se editaron')}{' '}
                a mano. Al confirmar, vuelven a los valores de la planilla y esos cambios se pierden.
              </p>
              <details open><summary>Editados a mano ({cantidad(preview.edicionesManuales.length)})</summary><ul>{preview.edicionesManuales.map((p) => <li key={p.codigo}>{p.codigo} · {p.descripcion} · {pesos(p.precioNeto ?? 0)}</li>)}</ul></details>
            </>
          )}
          {preview.conteos.eliminados > 0 && <p className="catalog-warning">Al confirmar, se retirarán {cantidad(preview.conteos.eliminados)} productos que no aparecen en esta planilla.</p>}
          {requiereForzar && <label className="import-force"><input type="checkbox" checked={forzarConfirmado} onChange={(e) => setForzarConfirmado(e.target.checked)} /> Confirmo que la reducción a {cantidad(preview.totalProductos)} productos es intencional.</label>}
          {!sinCambios && (
            <div className="import-change-groups">
              {preview.productos.nuevos.length > 0 && <div><h4>Nuevos</h4><ul>{preview.productos.nuevos.map((p) => <li key={p.codigo}>{p.codigo} · {p.descripcion} · {pesos(p.precioNeto ?? 0)}</li>)}</ul>{preview.conteos.nuevos > preview.productos.nuevos.length && <small>Se muestran los primeros {preview.productos.nuevos.length}.</small>}</div>}
              {preview.productos.modificados.length > 0 && <div><h4>Modificados</h4><ul>{preview.productos.modificados.map((p) => <li key={p.codigo}>{p.codigo} · {p.anterior.descripcion === p.nuevo.descripcion ? p.nuevo.descripcion : `${p.anterior.descripcion} → ${p.nuevo.descripcion}`} · {pesos(p.anterior.precioNeto ?? 0)} → {pesos(p.nuevo.precioNeto ?? 0)}{variacion(p.anterior.precioNeto, p.nuevo.precioNeto)}</li>)}</ul></div>}
              {preview.productos.eliminados.length > 0 && <div><h4>Retirados</h4><ul>{preview.productos.eliminados.map((p) => <li key={p.codigo}>{p.codigo} · {p.descripcion}</li>)}</ul></div>}
            </div>
          )}
          {preview.incidencias.length > 0 && <details><summary>Filas corregidas o excluidas al leer la planilla ({cantidad(preview.incidencias.length)})</summary><ul>{preview.incidencias.slice(0, 50).map((i, n) => <li key={`${i.hoja ?? ''}-${i.fila}-${n}`}>{i.hoja ? `${i.hoja.trim()} · ` : ''}Fila {i.fila}: {i.detalle}</li>)}</ul>{preview.incidencias.length > 50 && <small>Se muestran las primeras 50.</small>}</details>}
          {/* Fallas de la hoja «Cotizador» del Excel original: no cambian los precios que se importan. */}
          {preview.erroresPlantilla.length > 0 && <details><summary>Notas sobre la hoja «Cotizador» del Excel ({preview.erroresPlantilla.length}) · no afectan la importación</summary><ul>{preview.erroresPlantilla.map((x) => <li key={x}>{x}</li>)}</ul></details>}
          {obsoleta && (
            <p className="catalog-warning" role="alert">
              {obsoleta}
            </p>
          )}
          <div className="ia-actions">
            <button type="button" className="button secondary" disabled={!!ocupado} onClick={() => { setPreview(null); setForzarConfirmado(false); setObsoleta(''); }}>Descartar vista previa</button>
            {obsoleta && (
              <button ref={volverAnalizar} type="button" className="button secondary" disabled={!!ocupado} onClick={() => void enviar(null, 'previsualizar')}>
                {ocupado === 'previsualizar' ? 'Analizando…' : 'Volver a analizar'}
              </button>
            )}
            <button type="button" className="button primary" disabled={!!ocupado || !!obsoleta || sinCambios || (requiereForzar && !forzarConfirmado)} onClick={() => void enviar(null, 'confirmar')}>{ocupado === 'confirmar' ? 'Aplicando…' : 'Confirmar e importar'}</button>
          </div>
        </section>
      )}
      {confirmacion}
    </div>
  );
}

'use client';
import { useRef, useState, type DragEvent } from 'react';
import type { ReferenciaItem } from '@/catalogo/tipos';
import {
  ACEPTA_REFERENCIA,
  MAX_BYTES_REFERENCIA,
  MAX_REFERENCIAS_ITEM,
  esImagen,
  etiquetaTipoReferencia,
  tamanoReferencia,
  urlReferencia,
} from '@/negocio/personalizados';
import { Dialogo, useConfirmacion } from './dialogo';
import { mensajeDe, pedirJSON } from './solicitud';

const EXTENSIONES = /\.(jpe?g|png|webp|pdf)$/i;

/** Revisa formato y tamaño antes de subir; el servidor vuelve a validarlo por el contenido. */
function errorArchivo(archivo: File) {
  if (!EXTENSIONES.test(archivo.name))
    return `«${archivo.name}» no es una imagen JPG, PNG o WEBP ni un PDF.`;
  if (archivo.size > MAX_BYTES_REFERENCIA) return `«${archivo.name}» supera los 10 MB.`;
  if (!archivo.size) return `«${archivo.name}» está vacío.`;
  return null;
}

export async function subirReferencia(archivo: File) {
  const error = errorArchivo(archivo);
  if (error) throw new Error(error);
  const cuerpo = new FormData();
  cuerpo.append('archivo', archivo);
  const d = await pedirJSON<{ referencia: ReferenciaItem }>('/api/referencias', { method: 'POST', body: cuerpo });
  return d.referencia;
}

const conArchivos = (e: DragEvent) => e.dataTransfer.types.includes('Files');

/**
 * Referencias que entregó el cliente para un ítem (foto, croquis, plano). Sin referencias ocupa una sola línea;
 * `guardar` recibe la lista completa y devuelve si se guardó.
 */
export function ReferenciasItem({
  referencias,
  editable,
  ocupado = false,
  guardar,
  producto,
  amplio = false,
  alSubir,
}: {
  referencias: ReferenciaItem[];
  editable: boolean;
  ocupado?: boolean;
  guardar: (referencias: ReferenciaItem[]) => Promise<boolean>;
  /** Nombre del ítem, para las etiquetas de los botones. */
  producto: string;
  /** En un formulario: título y acción visibles aunque todavía no haya referencias. */
  amplio?: boolean;
  /** Avisa cuando empieza y termina una subida: un formulario no debe enviarse a medias. */
  alSubir?: (subiendo: boolean) => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  /** Posición que reemplaza el archivo elegido; null agrega al final. */
  const reemplazando = useRef<number | null>(null);
  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [arrastrando, setArrastrando] = useState(false);
  const [viendo, setViendo] = useState<ReferenciaItem | null>(null);
  const [confirmar, confirmacion] = useConfirmacion();
  const bloqueado = !editable || ocupado || subiendo !== null;
  const lleno = referencias.length >= MAX_REFERENCIAS_ITEM;

  async function adjuntar(archivos: File[], posicion: number | null) {
    if (!archivos.length || bloqueado) return;
    setError('');
    const lista = posicion === null ? archivos.slice(0, MAX_REFERENCIAS_ITEM - referencias.length) : archivos.slice(0, 1);
    if (!lista.length) {
      setError(`Cada producto admite hasta ${MAX_REFERENCIAS_ITEM} referencias.`);
      return;
    }
    const invalido = lista.map(errorArchivo).find(Boolean);
    if (invalido) {
      setError(invalido);
      return;
    }
    alSubir?.(true);
    try {
      const nuevas: ReferenciaItem[] = [];
      for (const archivo of lista) {
        setSubiendo(archivo.name);
        nuevas.push(await subirReferencia(archivo));
      }
      const siguiente =
        posicion === null
          ? [...referencias, ...nuevas]
          : referencias.map((r, i) => (i === posicion ? nuevas[0] : r));
      await guardar(siguiente);
      if (archivos.length > lista.length)
        setError(`Se adjuntaron ${lista.length}; cada producto admite hasta ${MAX_REFERENCIAS_ITEM} referencias.`);
    } catch (e) {
      setError(mensajeDe(e));
    } finally {
      setSubiendo(null);
      alSubir?.(false);
    }
  }

  function elegir(posicion: number | null) {
    reemplazando.current = posicion;
    entrada.current?.click();
  }

  async function eliminar(r: ReferenciaItem) {
    const ok = await confirmar({
      titulo: 'Eliminar referencia',
      mensaje: (
        <p>
          Se quitará «{r.nombre}» de este producto. Las cotizaciones emitidas, revisiones o duplicados que ya la
          tengan la conservan.
        </p>
      ),
      aceptar: 'Eliminar referencia',
    });
    if (ok) await guardar(referencias.filter((x) => x !== r));
  }

  const soltar = {
    onDragOver: (e: DragEvent) => {
      if (!conArchivos(e) || bloqueado || lleno) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setArrastrando(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastrando(false);
    },
    onDrop: (e: DragEvent) => {
      if (!conArchivos(e)) return;
      // Sin esto la fila lo tomaría como un reordenamiento.
      e.preventDefault();
      e.stopPropagation();
      setArrastrando(false);
      void adjuntar([...e.dataTransfer.files], null);
    },
  };

  if (!referencias.length && !editable) return null;
  return (
    <div
      className={`item-referencias${referencias.length ? ' con-referencias' : ''}${arrastrando ? ' arrastrando' : ''}`}
      {...soltar}
    >
      <input
        ref={entrada}
        type="file"
        hidden
        accept={ACEPTA_REFERENCIA}
        multiple
        onChange={(e) => {
          const archivos = [...(e.target.files ?? [])];
          e.target.value = '';
          void adjuntar(archivos, reemplazando.current);
        }}
      />
      {(referencias.length > 0 || amplio) && <span className="item-referencias-titulo">Referencia del cliente</span>}
      {referencias.length > 0 && (
        <>
          <ul className="item-referencias-lista">
            {referencias.map((r, i) => (
              <li key={`${r.archivo}-${i}`} className="referencia-tarjeta">
                <button
                  type="button"
                  className="referencia-miniatura"
                  onClick={() => (esImagen(r) ? setViendo(r) : window.open(urlReferencia(r), '_blank', 'noopener'))}
                  aria-label={`Ver ${r.nombre}`}
                  tabIndex={-1}
                >
                  {esImagen(r) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- archivo privado servido por la API, sin optimizador.
                    <img src={urlReferencia(r)} alt="" loading="lazy" draggable={false} />
                  ) : (
                    <span aria-hidden="true">PDF</span>
                  )}
                </button>
                <div className="referencia-datos">
                  <strong title={r.nombre}>{r.nombre}</strong>
                  <small>
                    {etiquetaTipoReferencia(r)} · {tamanoReferencia(r.tamano)}
                  </small>
                  <div className="referencia-acciones">
                    {esImagen(r) ? (
                      <button type="button" onClick={() => setViendo(r)} aria-label={`Ver ${r.nombre}`}>
                        Ver
                      </button>
                    ) : (
                      <a href={urlReferencia(r)} target="_blank" rel="noopener" aria-label={`Ver ${r.nombre}`}>
                        Ver
                      </a>
                    )}
                    {editable && (
                      <>
                        <button
                          type="button"
                          disabled={bloqueado}
                          onClick={() => elegir(i)}
                          aria-label={`Reemplazar ${r.nombre} de ${producto}`}
                        >
                          Reemplazar
                        </button>
                        <button
                          type="button"
                          className="peligro"
                          disabled={bloqueado}
                          onClick={() => void eliminar(r)}
                          aria-label={`Eliminar ${r.nombre} de ${producto}`}
                        >
                          Eliminar
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {editable && !lleno && (
        <button
          type="button"
          className="item-referencias-agregar"
          disabled={bloqueado}
          onClick={() => elegir(null)}
          aria-label={`Agregar imagen o dibujo de referencia a ${producto}`}
          title="Imagen JPG, PNG o WEBP, o PDF de hasta 10 MB. También puedes arrastrar el archivo aquí."
        >
          {subiendo
            ? `Subiendo ${subiendo}…`
            : arrastrando
              ? 'Suelta el archivo para adjuntarlo'
              : referencias.length
                ? '+ Agregar otra referencia'
                : amplio
                  ? '+ Agregar imagen o dibujo de referencia'
                  : '+ Agregar referencia'}
        </button>
      )}
      {error && (
        <p role="alert" className="item-referencias-error">
          {error}
        </p>
      )}
      <Dialogo
        abierto={!!viendo}
        alCerrar={() => setViendo(null)}
        titulo={viendo?.nombre}
        eyebrow="REFERENCIA DEL CLIENTE"
        className="dialogo-referencia"
      >
        {viendo && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- archivo privado servido por la API. */}
            <img className="referencia-vista" src={urlReferencia(viendo)} alt={`Referencia del cliente: ${viendo.nombre}`} />
            <div className="dialogo-acciones">
              <a className="button secondary" href={urlReferencia(viendo, true)}>
                Descargar
              </a>
              <a className="button secondary" href={urlReferencia(viendo)} target="_blank" rel="noopener">
                Abrir en pestaña nueva
              </a>
            </div>
          </>
        )}
      </Dialogo>
      {confirmacion}
    </div>
  );
}

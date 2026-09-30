'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ProductoAdministrable } from './contrato';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

const FAMILIAS = ['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA'] as const;
type Campos = Omit<ProductoAdministrable, 'codigo' | 'fuente' | 'creada' | 'creadaPor' | 'actualizada' | 'filaOrigen'>;

const inicial = (p: ProductoAdministrable): Campos => ({
  modelo: p.modelo,
  familia: p.familia,
  tipo: p.tipo,
  madera: p.madera,
  medida: p.medida,
  anchoMin: p.anchoMin,
  anchoMax: p.anchoMax,
  largo: p.largo,
  precioNeto: p.precioNeto,
  descripcion: p.descripcion,
});

export function GestionManuales() {
  const [productos, setProductos] = useState<ProductoAdministrable[]>([]);
  const [total, setTotal] = useState(0);
  const [busqueda, setBusqueda] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [campos, setCampos] = useState<Campos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ocupado, setOcupado] = useState('');
  const [error, setError] = useState('');
  const termino = busqueda.trim();

  const cargar = useCallback(async () => {
    const q = busqueda.trim();
    // Sin término no se lista: el catálogo tiene miles de productos y volcarlos todos no ayuda a
    // encontrar el que se quiere corregir.
    if (!q) {
      setProductos([]);
      setTotal(0);
      setCargando(false);
      return;
    }
    setCargando(true);
    try {
      const data = await pedirJSON<{ productos: ProductoAdministrable[]; total: number }>('/api/catalogo', {
        json: { tipo: 'listar_productos', q },
        method: 'POST',
      });
      setProductos(data.productos);
      setTotal(data.total);
      setError('');
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setCargando(false);
    }
  }, [busqueda]);
  useEffect(() => {
    const tarea = window.setTimeout(() => void cargar(), 0);
    return () => window.clearTimeout(tarea);
  }, [cargar]);

  function cambiar<K extends keyof Campos>(campo: K, valor: Campos[K]) {
    setCampos((actual) => (actual ? { ...actual, [campo]: valor } : actual));
  }

  async function guardar(codigo: string) {
    if (!campos || ocupado) return;
    setOcupado(codigo);
    setError('');
    try {
      const data = await pedirJSON<{ producto: ProductoAdministrable }>('/api/catalogo', {
        json: {
          tipo: 'editar',
          codigo,
          cambios: campos,
        },
      });
      setProductos((actuales) => actuales.map((p) => (p.codigo === codigo ? { ...p, ...data.producto } : p)));
      setEditando(null);
      setCampos(null);
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado('');
    }
  }

  async function eliminar(codigo: string) {
    if (ocupado || !window.confirm(`¿Eliminar el producto manual ${codigo}? Los borradores que lo usaban quedarán pendientes.`)) return;
    setOcupado(codigo);
    setError('');
    try {
      await pedirJSON('/api/catalogo', { json: { tipo: 'eliminar', codigo } });
      setProductos((actuales) => actuales.filter((p) => p.codigo !== codigo));
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado('');
    }
  }

  if (cargando) return <p className="muted">Cargando productos…</p>;
  return (
    <div className="gestion-manuales">
      <p className="catalog-modal-intro">Aquí puedes corregir los atributos operativos de productos manuales e importados. Los cambios sobre productos importados quedan en la base actual y se reemplazan si vuelves a importar la planilla.</p>
      <label className="catalogo-busqueda">
        <span>Buscar código, modelo, madera o medida</span>
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Ej. MOL-O-3-A o MOLCO" />
      </label>
      {error && <p className="catalog-error" role="alert">{error} <button type="button" className="link" onClick={() => void cargar()}>Reintentar</button></p>}
      {cargando && <p className="muted">Buscando productos…</p>}
      {!cargando && !termino && (
        <p className="muted">Escribe un código, modelo, madera o medida para encontrar el producto que quieres corregir.</p>
      )}
      {!cargando && termino && !productos.length && <p className="muted">No se encontraron productos.</p>}
      {!cargando && termino && productos.length > 0 && (
        <p className="muted" aria-live="polite">
          {total > productos.length
            ? `Mostrando ${productos.length} de ${total} productos: afina la búsqueda para ver el resto.`
            : `${total} producto${total === 1 ? '' : 's'}.`}
        </p>
      )}
      {!cargando && productos.length > 0 && (
        <div className="catalogo-lista">
          <table>
            <thead><tr><th>PRODUCTO / CÓDIGO</th><th>ATRIBUTOS</th><th>PRECIO NETO</th><th><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>
              {productos.map((producto) => {
                const activo = editando === producto.codigo && campos;
                return (
                  <tr key={producto.codigo}>
                    <td>
                      <strong>{producto.descripcion}</strong>
                      <small>{producto.codigo} · {producto.modelo} · {producto.fuente === 'manual' ? 'Agregado' : 'Planilla'}</small>
                    </td>
                    <td>
                      {activo ? (
                        <div className="manual-editor">
                          <label>Modelo<input value={activo.modelo} onChange={(e) => cambiar('modelo', e.target.value)} /></label>
                          <label>Familia<select value={activo.familia} onChange={(e) => cambiar('familia', e.target.value as Campos['familia'])}>{FAMILIAS.map((f) => <option key={f}>{f}</option>)}</select></label>
                          <label>Madera<input value={activo.madera} onChange={(e) => cambiar('madera', e.target.value)} /></label>
                          <label>Medida<input value={activo.medida} onChange={(e) => cambiar('medida', e.target.value)} /></label>
                          <label>Ancho mín.<input type="number" step="0.01" value={activo.anchoMin ?? ''} onChange={(e) => cambiar('anchoMin', e.target.value ? Number(e.target.value) : null)} /></label>
                          <label>Ancho máx.<input type="number" step="0.01" value={activo.anchoMax ?? ''} onChange={(e) => cambiar('anchoMax', e.target.value ? Number(e.target.value) : null)} /></label>
                          <label>Largo<input type="number" step="0.01" value={activo.largo} onChange={(e) => cambiar('largo', Number(e.target.value))} /></label>
                          <label>Tipo<input value={activo.tipo ?? ''} onChange={(e) => cambiar('tipo', e.target.value || null)} /></label>
                          <label className="manual-editor-wide">Descripción<input value={activo.descripcion} onChange={(e) => cambiar('descripcion', e.target.value)} /></label>
                        </div>
                      ) : <span>{producto.familia} · {producto.madera} · {producto.medida} × {producto.largo} m</span>}
                    </td>
                    <td data-etiqueta="Precio neto">
                      {activo ? <input type="number" min={1} step={1} value={activo.precioNeto} onChange={(e) => cambiar('precioNeto', Number(e.target.value))} /> : <span>${producto.precioNeto.toLocaleString('es-CL')}</span>}
                    </td>
                    <td className="celda-acciones">
                      {activo ? <><button type="button" className="button secondary small" onClick={() => void guardar(producto.codigo)} disabled={ocupado === producto.codigo}>Guardar</button><button type="button" className="button secondary small" onClick={() => { setEditando(null); setCampos(null); }} disabled={!!ocupado}>Cancelar</button></> : <><button type="button" className="button secondary small" onClick={() => { setEditando(producto.codigo); setCampos(inicial(producto)); }} disabled={!!ocupado}>Editar</button>{producto.fuente === 'manual' && <button type="button" className="button secondary small" onClick={() => void eliminar(producto.codigo)} disabled={!!ocupado}>Eliminar</button>}</>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

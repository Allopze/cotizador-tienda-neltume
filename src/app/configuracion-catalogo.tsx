'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

interface Configuracion {
  maderas: { nombre: string; codigo: string; alias: string[] }[];
  familiasPorModelo: Record<string, 'PUERTA' | 'MARCO' | 'PIEZAS_T' | 'MOLDURA'>;
  aliasModelos: Record<string, string[]>;
}

export function ConfiguracionCatalogo() {
  const [configuracion, setConfiguracion] = useState<Configuracion | null>(null);
  const [texto, setTexto] = useState('');
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    const control = new AbortController();
    pedirJSON<{ configuracion: Configuracion; puedeEditar: boolean }>('/api/catalogo-configuracion', { signal: control.signal, cache: 'no-store' }).then(
      (data) => {
        setConfiguracion(data.configuracion);
        setTexto(JSON.stringify(data.configuracion, null, 2));
        setPuedeEditar(data.puedeEditar);
      },
      (causa) => {
        if (!esSilencioso(causa)) setError(mensajeDe(causa));
      },
    );
    return () => control.abort();
  }, []);

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (!puedeEditar || ocupado) return;
    let valor: Configuracion;
    try {
      valor = JSON.parse(texto) as Configuracion;
    } catch {
      setError('La configuración debe ser JSON válido.');
      return;
    }
    setOcupado(true);
    setError('');
    try {
      const data = await pedirJSON<{ configuracion: Configuracion }>('/api/catalogo-configuracion', { json: valor });
      setConfiguracion(data.configuracion);
      setTexto(JSON.stringify(data.configuracion, null, 2));
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado(false);
    }
  }

  if (!configuracion) return <p className="catalog-modal-intro">{error || 'Cargando configuración…'}</p>;
  return (
    <form onSubmit={guardar}>
      <p className="catalog-modal-intro">
        Edita nombres y alias de maderas, familias y alias de modelos sin tocar el archivo de configuración. El servidor valida duplicados antes de guardar.
      </p>
      <label className="ia-field">
        <span>Configuración del catálogo (JSON)</span>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={20} spellCheck={false} disabled={!puedeEditar || ocupado} />
      </label>
      {error && <p className="catalog-error" role="alert">{error}</p>}
      {!puedeEditar ? <p className="ia-permiso">Solo quien administra el cotizador puede cambiar esta configuración.</p> : (
        <div className="ia-actions">
          <button type="button" className="button secondary" onClick={() => setTexto(JSON.stringify(configuracion, null, 2))} disabled={ocupado}>Descartar cambios</button>
          <button type="submit" className="button primary" disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar configuración'}</button>
        </div>
      )}
    </form>
  );
}

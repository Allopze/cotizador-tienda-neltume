'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { TipoAviso } from '../avisos';
import { esSilencioso, mensajeDe, pedirJSON } from '../solicitud';

interface Feriado { fecha: string; nombre: string; creada: string }

export function GestionFeriados({ avisar }: { avisar: (tipo: TipoAviso, texto: string, extra?: { clave?: string }) => number }) {
  const [feriados, setFeriados] = useState<Feriado[]>([]);
  const [fecha, setFecha] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function cargar() {
    try {
      const data = await pedirJSON<{ feriados: Feriado[] }>('/api/feriados', { cache: 'no-store' });
      setFeriados(data.feriados);
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    }
  }
  useEffect(() => {
    const tarea = window.setTimeout(() => void cargar(), 0);
    return () => window.clearTimeout(tarea);
  }, []);

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado || !fecha || !nombre.trim()) return;
    setOcupado(true);
    setError('');
    try {
      const data = await pedirJSON<{ feriados: Feriado[] }>('/api/feriados', { json: { accion: 'guardar', fecha, nombre } });
      setFeriados(data.feriados);
      setFecha('');
      setNombre('');
      avisar('exito', 'Feriado adicional guardado.', { clave: 'feriados' });
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado(false);
    }
  }

  async function eliminar(fechaEliminar: string) {
    if (ocupado || !window.confirm('¿Eliminar este feriado adicional?')) return;
    setOcupado(true);
    setError('');
    try {
      const data = await pedirJSON<{ feriados: Feriado[] }>('/api/feriados', { json: { accion: 'eliminar', fecha: fechaEliminar } });
      setFeriados(data.feriados);
      avisar('exito', 'Feriado adicional eliminado.', { clave: 'feriados' });
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="gestion-feriados">
      <p className="catalog-modal-intro">Agrega feriados excepcionales o regionales que deban descontarse de la vigencia. Los feriados nacionales y los decretados que llegan por sincronización automática se conservan aparte.</p>
      <form className="feriado-form" onSubmit={guardar}>
        <label className="ia-field"><span>Fecha</span><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required disabled={ocupado} /></label>
        <label className="ia-field"><span>Nombre</span><input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={200} placeholder="Ej. Feriado regional" required disabled={ocupado} /></label>
        <button className="button primary" type="submit" disabled={ocupado || !fecha || !nombre.trim()}>Agregar feriado</button>
      </form>
      {error && <p className="catalog-error" role="alert">{error} <button type="button" className="link" onClick={() => void cargar()}>Reintentar</button></p>}
      {!feriados.length ? <p className="muted">No hay feriados adicionales.</p> : (
        <div className="feriado-lista">
          {feriados.map((feriado) => <div className="feriado-fila" key={feriado.fecha}><span><strong>{feriado.fecha}</strong><small>{feriado.nombre}</small></span><button type="button" className="button secondary small" onClick={() => void eliminar(feriado.fecha)} disabled={ocupado}>Eliminar</button></div>)}
        </div>
      )}
    </div>
  );
}

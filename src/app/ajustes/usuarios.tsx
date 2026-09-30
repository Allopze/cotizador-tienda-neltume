'use client';
import { useEffect, useState } from 'react';
import type { TipoAviso } from '../avisos';
import { esSilencioso, mensajeDe, pedirJSON } from '../solicitud';

interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
}

export function GestionUsuarios({ avisar }: { avisar: (tipo: TipoAviso, texto: string, extra?: { clave?: string }) => number }) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [actual, setActual] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [claveId, setClaveId] = useState<string | null>(null);
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState('');

  async function cargar() {
    try {
      const data = await pedirJSON<{ usuarios: Usuario[]; actual: string }>('/api/usuarios', { cache: 'no-store' });
      setUsuarios(data.usuarios);
      setActual(data.actual);
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    }
  }
  useEffect(() => {
    const tarea = window.setTimeout(() => void cargar(), 0);
    return () => window.clearTimeout(tarea);
  }, []);

  async function accion(body: Record<string, unknown>, mensaje: string) {
    setOcupado(String(body.id));
    setError('');
    try {
      const data = await pedirJSON<{ usuarios: Usuario[]; actual: string }>('/api/usuarios', { method: 'PATCH', json: body });
      setUsuarios(data.usuarios);
      setActual(data.actual);
      setEditando(null);
      setClaveId(null);
      setClave('');
      avisar('exito', mensaje, { clave: 'usuarios' });
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado('');
    }
  }

  return (
    <div className="usuarios-admin">
      <p className="catalog-modal-intro">Edita nombre y correo, activa o desactiva cuentas y restablece contraseñas. El rol administrador se mantiene fijo para todas las cuentas.</p>
      {error && <p className="catalog-error" role="alert">{error} <button type="button" className="link" onClick={() => void cargar()}>Reintentar</button></p>}
      {!usuarios.length ? <p className="muted">Cargando cuentas…</p> : (
        <div className="catalogo-lista">
          <table>
            <thead><tr><th>CUENTA</th><th>ESTADO</th><th><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>{usuarios.map((usuario) => {
              const editandoEsta = editando === usuario.id;
              const claveEsta = claveId === usuario.id;
              return <tr key={usuario.id}>
                <td>
                  {editandoEsta ? <div className="manual-editor"><label>Nombre<input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} /></label><label>Correo<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} /></label></div> : <><strong>{usuario.nombre}</strong><small>{usuario.email} · {usuario.rol}</small></>}
                  {claveEsta && <label className="ia-field"><span>Nueva contraseña</span><input type="password" minLength={12} maxLength={128} value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" /></label>}
                </td>
                <td data-etiqueta="Estado"><span className={`status ${usuario.activo ? 'aprobada' : 'anulada'}`}>{usuario.activo ? 'Activa' : 'Desactivada'}</span>{usuario.id === actual && <small> · Tu cuenta</small>}</td>
                <td className="celda-acciones">
                  {editandoEsta ? <><button type="button" className="button secondary small" onClick={() => void accion({ accion: 'editar', id: usuario.id, nombre, email }, 'Cuenta actualizada.')} disabled={ocupado === usuario.id}>Guardar</button><button type="button" className="button secondary small" onClick={() => setEditando(null)} disabled={!!ocupado}>Cancelar</button></> : <button type="button" className="button secondary small" onClick={() => { setEditando(usuario.id); setNombre(usuario.nombre); setEmail(usuario.email); }} disabled={!!ocupado}>Editar</button>}
                  {claveEsta ? <button type="button" className="button secondary small" onClick={() => void accion({ accion: 'restablecer-clave', id: usuario.id, password: clave }, 'Contraseña restablecida y sesiones revocadas.')} disabled={!!ocupado || clave.length < 12}>Guardar clave</button> : <button type="button" className="button secondary small" onClick={() => { setClaveId(usuario.id); setClave(''); }} disabled={!!ocupado}>Restablecer clave</button>}
                  <button type="button" className="button secondary small" onClick={() => void accion({ accion: usuario.activo ? 'desactivar' : 'activar', id: usuario.id }, usuario.activo ? 'Cuenta desactivada.' : 'Cuenta activada.')} disabled={!!ocupado || (usuario.id === actual && usuario.activo)}>{usuario.activo ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

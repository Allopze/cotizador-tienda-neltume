'use client';
import { useEffect, useEffectEvent, useState, type FormEvent } from 'react';
import type { TipoAviso } from '../avisos';
import { useConfirmacion } from '../dialogo';
import { esSilencioso, mensajeDe, pedirJSON } from '../solicitud';

// Mismos límites que Better Auth (minPasswordLength / maxPasswordLength en autenticacion-config).
const MINIMO = 8,
  MAXIMO = 128;

interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: string;
  activo: boolean;
}

interface CambioCuenta {
  id: number;
  fecha: string;
  actor: string | null;
  objetivo: string | null;
  accion: string;
}

interface RespuestaCuentas {
  usuarios: Usuario[];
  actual: string;
  cambios?: CambioCuenta[];
}

/** Lo emite «Crear cuenta» para que la lista y el registro de cambios se actualicen sin recargar. */
export const EVENTO_CUENTAS = 'neltume:cuentas-cambiaron';

const ACCIONES: Record<string, string> = {
  crear: 'Creó la cuenta',
  'crear-primera': 'Creó la primera cuenta',
  editar: 'Editó la cuenta',
  desactivar: 'Desactivó la cuenta',
  activar: 'Activó la cuenta',
  'restablecer-clave': 'Restableció la contraseña',
};

const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function GestionUsuarios({ avisar }: { avisar: (tipo: TipoAviso, texto: string, extra?: { clave?: string }) => number }) {
  const [usuarios, setUsuarios] = useState<Usuario[] | null>(null);
  const [cambios, setCambios] = useState<CambioCuenta[]>([]);
  const [actual, setActual] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [claveId, setClaveId] = useState<string | null>(null);
  const [clave, setClave] = useState('');
  const [repetida, setRepetida] = useState('');
  const [errorClave, setErrorClave] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [confirmar, dialogoConfirmacion] = useConfirmacion();

  function aplicar(data: RespuestaCuentas) {
    setUsuarios(data.usuarios);
    setActual(data.actual);
    setCambios(data.cambios ?? []);
  }

  async function cargar() {
    setError('');
    try {
      const data = await pedirJSON<RespuestaCuentas>('/api/usuarios', { cache: 'no-store' });
      setUsuarios(data.usuarios);
      setActual(data.actual);
      setCambios(data.cambios ?? []);
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    }
  }
  useEffect(() => {
    const tarea = window.setTimeout(() => void cargar(), 0);
    return () => window.clearTimeout(tarea);
  }, []);
  // «Crear cuenta» avisa con un evento: la lista y el registro de cambios se recargan sin recargar la página.
  const alCambiarCuentas = useEffectEvent(() => void cargar());
  useEffect(() => {
    const recargar = () => alCambiarCuentas();
    window.addEventListener(EVENTO_CUENTAS, recargar);
    return () => window.removeEventListener(EVENTO_CUENTAS, recargar);
  }, []);

  const adminsActivos = usuarios?.filter((u) => u.activo && u.rol === 'admin').length ?? 0;

  function cerrarClave() {
    setClaveId(null);
    setClave('');
    setRepetida('');
    setErrorClave('');
  }

  async function accion(body: Record<string, unknown>, mensaje: string) {
    setOcupado(String(body.id));
    setError('');
    try {
      aplicar(await pedirJSON<RespuestaCuentas>('/api/usuarios', { method: 'PATCH', json: body }));
      setEditando(null);
      cerrarClave();
      avisar('exito', mensaje, { clave: 'usuarios' });
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado('');
    }
  }

  function restablecer(evento: FormEvent, usuario: Usuario) {
    evento.preventDefault();
    if (ocupado) return;
    if (clave.length < MINIMO || clave.length > MAXIMO)
      return setErrorClave(`La contraseña debe tener entre ${MINIMO} y ${MAXIMO} caracteres.`);
    if (clave !== repetida) return setErrorClave('La confirmación no coincide con la contraseña.');
    void accion(
      { accion: 'restablecer-clave', id: usuario.id, password: clave },
      `Contraseña de ${usuario.nombre} restablecida; se cerraron sus sesiones.`,
    );
  }

  async function cambiarEstado(usuario: Usuario) {
    if (usuario.activo) {
      const aceptado = await confirmar({
        eyebrow: 'USUARIOS',
        titulo: 'Desactivar cuenta',
        mensaje: (
          <p>
            Se cerrarán las sesiones abiertas de {usuario.nombre} ({usuario.email}) y no podrá volver a entrar
            hasta que actives la cuenta otra vez. Sus cotizaciones se conservan.
          </p>
        ),
        aceptar: 'Desactivar cuenta',
      });
      if (!aceptado) return;
    }
    void accion(
      { accion: usuario.activo ? 'desactivar' : 'activar', id: usuario.id },
      usuario.activo ? 'Cuenta desactivada.' : 'Cuenta activada.',
    );
  }

  return (
    <div className="usuarios-admin">
      <p className="catalog-modal-intro">
        Edita nombre y correo, activa o desactiva cuentas y restablece contraseñas. Las cuentas que se crean aquí
        tienen rol de administrador; las de rol estándar ven Ajustes en solo lectura.
      </p>
      {usuarios !== null && adminsActivos < 2 && (
        <p className="catalog-error" role="status">
          Hay una sola cuenta administradora activa. Crea otra: si se olvida esta contraseña, otra administradora puede
          restablecerla sin recurrir a la terminal del servidor.
        </p>
      )}
      {error && (
        <p className="catalog-error" role="alert">
          {error}{' '}
          <button type="button" className="link" onClick={() => void cargar()}>
            Reintentar
          </button>
        </p>
      )}
      {usuarios === null ? (
        !error && <p className="muted" role="status">Cargando cuentas…</p>
      ) : !usuarios.length ? (
        <p className="muted">No hay cuentas.</p>
      ) : (
        <div className="catalogo-lista">
          <table>
            <thead><tr><th>CUENTA</th><th>ESTADO</th><th><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>{usuarios.map((usuario) => {
              const editandoEsta = editando === usuario.id;
              const claveEsta = claveId === usuario.id;
              return <tr key={usuario.id}>
                <td>
                  {editandoEsta ? <div className="manual-editor"><label>Nombre<input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} /></label><label>Correo<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} /></label></div> : <><strong>{usuario.nombre}</strong><small>{usuario.email}</small></>}
                  {claveEsta && (
                    <form className="usuario-clave" onSubmit={(e) => restablecer(e, usuario)} aria-label={`Restablecer la contraseña de ${usuario.nombre}`}>
                      <label className="ia-field"><span>Nueva contraseña (mínimo {MINIMO} caracteres)</span><input type="password" maxLength={MAXIMO} value={clave} onChange={(e) => { setClave(e.target.value); setErrorClave(''); }} autoComplete="new-password" disabled={!!ocupado} /></label>
                      <label className="ia-field"><span>Repite la nueva contraseña</span><input type="password" maxLength={MAXIMO} value={repetida} onChange={(e) => { setRepetida(e.target.value); setErrorClave(''); }} autoComplete="new-password" disabled={!!ocupado} /></label>
                      {errorClave && <p className="catalog-error" role="alert">{errorClave}</p>}
                      <p className="muted">Se cerrarán las sesiones abiertas de esta cuenta.</p>
                      <div className="celda-acciones">
                        <button type="submit" className="button primary small" disabled={!!ocupado || !clave}>Guardar contraseña</button>
                        <button type="button" className="button secondary small" onClick={cerrarClave} disabled={!!ocupado}>Cancelar</button>
                      </div>
                    </form>
                  )}
                </td>
                <td data-etiqueta="Estado"><span className={`status ${usuario.activo ? 'aprobada' : 'anulada'}`}>{usuario.activo ? 'Activa' : 'Desactivada'}</span><small>{usuario.rol === 'admin' ? 'Administrador' : 'Estándar'}{usuario.id === actual ? ' · Tu cuenta' : ''}</small></td>
                <td className="celda-acciones">
                  {editandoEsta ? <><button type="button" className="button primary small" onClick={() => void accion({ accion: 'editar', id: usuario.id, nombre, email }, 'Cuenta actualizada.')} disabled={ocupado === usuario.id}>Guardar</button><button type="button" className="button secondary small" onClick={() => setEditando(null)} disabled={!!ocupado}>Cancelar</button></> : <button type="button" className="button secondary small" onClick={() => { setEditando(usuario.id); setNombre(usuario.nombre); setEmail(usuario.email); }} disabled={!!ocupado}>Editar</button>}
                  {!claveEsta && <button type="button" className="button secondary small" onClick={() => { cerrarClave(); setClaveId(usuario.id); }} disabled={!!ocupado}>Restablecer clave</button>}
                  {/* La propia cuenta no se puede desactivar: sin botón (el motivo solo estaba en un title, invisible en táctil). */}
                  {!(usuario.id === actual && usuario.activo) && <button type="button" className="button secondary small" onClick={() => void cambiarEstado(usuario)} disabled={!!ocupado}>{usuario.activo ? 'Desactivar' : 'Activar'}</button>}
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
      {usuarios !== null && (
        <>
          <h3 className="eyebrow ajustes-subtitulo">REGISTRO DE CAMBIOS</h3>
          <p className="catalog-modal-intro">
            Los cambios de cuentas más recientes (hasta 50): quién creó, editó, desactivó, activó o restableció la
            contraseña de qué cuenta.
          </p>
          {!cambios.length ? (
            <p className="muted">Todavía no hay cambios registrados.</p>
          ) : (
            <div className="catalogo-lista">
              <table>
                <thead><tr><th>FECHA</th><th>QUIÉN</th><th>CAMBIO</th></tr></thead>
                <tbody>{cambios.map((cambio) => (
                  <tr key={cambio.id}>
                    <td data-etiqueta="Fecha"><small>{fechaHora(cambio.fecha)}</small></td>
                    <td data-etiqueta="Quién">{cambio.actor ?? '—'}</td>
                    <td data-etiqueta="Cambio">{ACCIONES[cambio.accion] ?? cambio.accion}<small>{cambio.objetivo ?? ''}</small></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      )}
      {dialogoConfirmacion}
    </div>
  );
}

'use client';
import { useEffect, useEffectEvent, useState, type FormEvent } from 'react';
import type { TipoAviso } from '../avisos';
import { useConfirmacion } from '../dialogo';
import { correoValido, useErrorCampo } from '../error-campo';
import { codigoDe, esSilencioso, mensajeDe, pedirJSON } from '../solicitud';
import { faltaOtraAdministradora, fechaHoraCuenta, textoAccionCuenta } from './cuentas';

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
  // Cambiar el correo o la contraseña de una cuenta pide la contraseña propia («confirmacion»).
  const [confirmacion, setConfirmacion] = useState('');
  const erroresClave = useErrorCampo<'clave' | 'repetida' | 'confirmacion'>('restablecer', 'catalog-error');
  const erroresEdicion = useErrorCampo<'nombre' | 'correo' | 'confirmacion'>('editar-cuenta', 'catalog-error');
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


  function cerrarClave() {
    setClaveId(null);
    setClave('');
    setRepetida('');
    setConfirmacion('');
    erroresClave.limpiar();
  }

  function cerrarEdicion() {
    setEditando(null);
    setConfirmacion('');
    erroresEdicion.limpiar();
  }

  /** `alFallar` recibe el error y devuelve true si ya lo mostró junto a un campo. */
  async function accion(body: Record<string, unknown>, mensaje: string, alFallar?: (causa: unknown) => boolean) {
    setOcupado(String(body.id));
    setError('');
    try {
      aplicar(await pedirJSON<RespuestaCuentas>('/api/usuarios', { method: 'PATCH', json: body }));
      cerrarEdicion();
      cerrarClave();
      avisar('exito', mensaje, { clave: 'usuarios' });
    } catch (causa) {
      if (!esSilencioso(causa) && !alFallar?.(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado('');
    }
  }

  /** Un error de la contraseña propia (falta, es incorrecta o hubo demasiados intentos) va junto a ese campo. */
  const errorConfirmacion =
    (errores: { fallar: (campo: 'confirmacion', texto: string) => void }) => (causa: unknown) => {
      if (codigoDe(causa) !== 'confirmar_clave') return false;
      setConfirmacion('');
      errores.fallar('confirmacion', mensajeDe(causa));
      return true;
    };

  function restablecer(evento: FormEvent, usuario: Usuario) {
    evento.preventDefault();
    if (ocupado) return;
    if (clave.length < MINIMO || clave.length > MAXIMO)
      return erroresClave.fallar('clave', `La contraseña debe tener entre ${MINIMO} y ${MAXIMO} caracteres.`);
    if (clave !== repetida) return erroresClave.fallar('repetida', 'La confirmación no coincide con la contraseña.');
    if (!confirmacion) return erroresClave.fallar('confirmacion', 'Escribe tu contraseña para confirmar el cambio.');
    erroresClave.limpiar();
    void accion(
      { accion: 'restablecer-clave', id: usuario.id, password: clave, passwordActual: confirmacion },
      `Contraseña de ${usuario.nombre} restablecida; se cerraron sus sesiones.`,
      errorConfirmacion(erroresClave),
    );
  }

  function guardarEdicion(evento: FormEvent, usuario: Usuario) {
    evento.preventDefault();
    if (ocupado) return;
    if (!nombre.trim()) return erroresEdicion.fallar('nombre', 'Escribe el nombre de la persona.');
    if (!correoValido(email)) return erroresEdicion.fallar('correo', 'Revisa el correo: debe tener la forma nombre@dominio.cl.');
    const cambiaCorreo = email.trim().toLowerCase() !== usuario.email.toLowerCase();
    if (cambiaCorreo && !confirmacion)
      return erroresEdicion.fallar('confirmacion', 'Escribe tu contraseña para confirmar el cambio de correo.');
    erroresEdicion.limpiar();
    void accion(
      { accion: 'editar', id: usuario.id, nombre, email, ...(cambiaCorreo ? { passwordActual: confirmacion } : {}) },
      'Cuenta actualizada.',
      errorConfirmacion(erroresEdicion),
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
        son todas administradoras: pueden cotizar y cambiar Ajustes. Mantén siempre al menos dos activas.
      </p>
      {usuarios !== null && faltaOtraAdministradora(usuarios) && (
        <p className="catalog-warning" role="status">
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
                  {editandoEsta ? (
                    <form id={`editar-${usuario.id}`} className="manual-editor" onSubmit={(e) => guardarEdicion(e, usuario)} noValidate aria-label={`Editar la cuenta de ${usuario.nombre}`}>
                      <label>Nombre<input ref={erroresEdicion.ref('nombre')} {...erroresEdicion.atributos('nombre')} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} /></label>
                      {erroresEdicion.mensaje('nombre')}
                      <label>Correo<input ref={erroresEdicion.ref('correo')} {...erroresEdicion.atributos('correo')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} /></label>
                      {erroresEdicion.mensaje('correo')}
                      {email.trim().toLowerCase() !== usuario.email.toLowerCase() && (
                        <>
                          <label className="manual-editor-ancho">Tu contraseña (para confirmar el cambio de correo)<input ref={erroresEdicion.ref('confirmacion')} {...erroresEdicion.atributos('confirmacion')} type="password" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} autoComplete="current-password" maxLength={MAXIMO} disabled={!!ocupado} /></label>
                          {erroresEdicion.mensaje('confirmacion')}
                        </>
                      )}
                    </form>
                  ) : <><strong>{usuario.nombre}</strong><small>{usuario.email}</small></>}
                  {claveEsta && (
                    <form className="usuario-clave" onSubmit={(e) => restablecer(e, usuario)} aria-label={`Restablecer la contraseña de ${usuario.nombre}`} noValidate>
                      <label className="ia-field"><span>Nueva contraseña (mínimo {MINIMO} caracteres)</span><input ref={erroresClave.ref('clave')} {...erroresClave.atributos('clave')} type="password" maxLength={MAXIMO} value={clave} onChange={(e) => { setClave(e.target.value); erroresClave.limpiar(); }} autoComplete="new-password" disabled={!!ocupado} /></label>
                      {erroresClave.mensaje('clave')}
                      <label className="ia-field"><span>Repite la nueva contraseña</span><input ref={erroresClave.ref('repetida')} {...erroresClave.atributos('repetida')} type="password" maxLength={MAXIMO} value={repetida} onChange={(e) => { setRepetida(e.target.value); erroresClave.limpiar(); }} autoComplete="new-password" disabled={!!ocupado} /></label>
                      {erroresClave.mensaje('repetida')}
                      <label className="ia-field"><span>Tu contraseña (para confirmar)</span><input ref={erroresClave.ref('confirmacion')} {...erroresClave.atributos('confirmacion')} type="password" maxLength={MAXIMO} value={confirmacion} onChange={(e) => { setConfirmacion(e.target.value); erroresClave.limpiar(); }} autoComplete="current-password" disabled={!!ocupado} /></label>
                      {erroresClave.mensaje('confirmacion')}
                      <p className="muted">Se cerrarán las sesiones abiertas de esta cuenta.</p>
                      <div className="celda-acciones">
                        <button type="submit" className="button primary small" disabled={!!ocupado || !clave}>Guardar contraseña</button>
                        <button type="button" className="button secondary small" onClick={cerrarClave} disabled={!!ocupado}>Cancelar</button>
                      </div>
                    </form>
                  )}
                </td>
                <td data-etiqueta="Estado"><span className={`status ${usuario.activo ? 'aprobada' : 'anulada'}`}>{usuario.activo ? 'Activa' : 'Desactivada'}</span><small>{usuario.rol === 'admin' ? 'Administradora' : 'Sin permisos de administración'}{usuario.id === actual ? ' · Tu cuenta' : ''}</small></td>
                <td className="celda-acciones">
                  {editandoEsta ? <><button type="submit" form={`editar-${usuario.id}`} className="button primary small" disabled={ocupado === usuario.id}>Guardar</button><button type="button" className="button secondary small" onClick={cerrarEdicion} disabled={!!ocupado}>Cancelar</button></> : <button type="button" className="button secondary small" onClick={() => { cerrarEdicion(); cerrarClave(); setEditando(usuario.id); setNombre(usuario.nombre); setEmail(usuario.email); }} disabled={!!ocupado}>Editar</button>}
                  {!claveEsta && <button type="button" className="button secondary small" onClick={() => { cerrarClave(); cerrarEdicion(); setClaveId(usuario.id); }} disabled={!!ocupado}>Restablecer clave</button>}
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
            Los movimientos más recientes (hasta 50): quién creó, editó, desactivó, activó o restableció la contraseña de
            qué cuenta, y los inicios de sesión correctos y fallidos con el dispositivo y la IP.
          </p>
          {!cambios.length ? (
            <p className="muted">Todavía no hay cambios registrados.</p>
          ) : (
            <div className="catalogo-lista">
              <table>
                <thead><tr><th>FECHA</th><th>QUIÉN</th><th>CAMBIO</th></tr></thead>
                <tbody>{cambios.map((cambio) => (
                  <tr key={cambio.id}>
                    <td data-etiqueta="Fecha"><small>{fechaHoraCuenta(cambio.fecha)}</small></td>
                    <td data-etiqueta="Quién">{cambio.actor ?? '—'}</td>
                    <td data-etiqueta="Cambio">{textoAccionCuenta(cambio.accion)}<small>{cambio.objetivo ?? ''}</small></td>
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

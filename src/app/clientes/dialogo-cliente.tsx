'use client';
import { useState, type FormEvent } from 'react';
import { normalizarRut } from '@/negocio/cliente';
import type { ClienteRegistrado } from '@/negocio/cliente-registro';
import { correoElectronicoValido, receptorTieneContenido } from '@/negocio/facturacion';
import { Dialogo } from '../dialogo';
import {
  editableAReceptor,
  receptorAEditable,
  validarReceptorEditable,
  type ReceptorEditable,
} from '../receptor-facturacion';
import { ErrorSolicitud, codigoDe, esSilencioso, mensajeDe, pedirJSON } from '../solicitud';
import { FacturacionClienteCampos, type OpcionDocumentoCliente } from './facturacion-cliente-campos';

export type ModoClienteDialogo =
  | { tipo: 'nuevo'; inicial?: Partial<ClienteRegistrado> }
  | { tipo: 'editar'; cliente: ClienteRegistrado };

interface Props {
  modo: ModoClienteDialogo | null;
  alCerrar: () => void;
  alGuardado: (cliente: ClienteRegistrado, accion: 'crear' | 'editar') => void;
  alAbrirExistente: (cliente: ClienteRegistrado) => void;
}

export function DialogoCliente({ modo, alCerrar, alGuardado, alAbrirExistente }: Props) {
  const titulo =
    modo?.tipo === 'editar'
      ? `Editar cliente: ${modo.cliente.nombre}`
      : modo?.inicial?.nombre
        ? 'Guardar como cliente frecuente'
        : 'Nuevo cliente frecuente';
  const keyForm =
    modo?.tipo === 'editar'
      ? `editar-${modo.cliente.id}-${modo.cliente.actualizado}`
      : `nuevo-${modo?.inicial?.nombre ?? ''}-${modo?.inicial?.rut ?? ''}`;

  const [guardando, setGuardando] = useState(false);

  return (
    <Dialogo
      abierto={!!modo}
      alCerrar={alCerrar}
      cerrable={!guardando}
      titulo={titulo}
      className="dialogo-cliente"
    >
      {modo && (
        <FormularioCliente
          key={keyForm}
          modo={modo}
          guardando={guardando}
          setGuardando={setGuardando}
          alCerrar={alCerrar}
          alGuardado={alGuardado}
          alAbrirExistente={alAbrirExistente}
        />
      )}
    </Dialogo>
  );
}

function FormularioCliente({
  modo,
  guardando,
  setGuardando,
  alCerrar,
  alGuardado,
  alAbrirExistente,
}: {
  modo: ModoClienteDialogo;
  guardando: boolean;
  setGuardando: (v: boolean) => void;
  alCerrar: () => void;
  alGuardado: (cliente: ClienteRegistrado, accion: 'crear' | 'editar') => void;
  alAbrirExistente: (cliente: ClienteRegistrado) => void;
}) {
  const base = modo.tipo === 'editar' ? modo.cliente : (modo.inicial ?? {});
  const [nombre, setNombre] = useState(base.nombre ?? '');
  const [rut, setRut] = useState(base.rut ?? '');
  const [giro, setGiro] = useState(base.giro ?? '');
  const [telefono, setTelefono] = useState(base.telefono ?? '');
  const [direccion, setDireccion] = useState(base.direccion ?? '');
  const [comuna, setComuna] = useState(base.comuna ?? '');
  const [correo, setCorreo] = useState(base.correo ?? '');
  const [notas, setNotas] = useState(base.notas ?? '');
  const [documentoHabitual, setDocumentoHabitual] = useState<OpcionDocumentoCliente>(
    base.documentoHabitual ?? 'sin_definir',
  );
  const [receptor, setReceptor] = useState<ReceptorEditable>(() => receptorAEditable(base.receptorFacturacion));
  const [erroresReceptor, setErroresReceptor] = useState<{ rut?: string | null; correo?: string | null }>({});
  const [error, setError] = useState('');
  const [duplicado, setDuplicado] = useState<ClienteRegistrado | null>(null);

  function formatearRut() {
    const normalizado = normalizarRut(rut);
    if (normalizado && normalizado !== rut) setRut(normalizado);
  }

  function cambiarReceptor(siguiente: ReceptorEditable) {
    setReceptor(siguiente);
    if (erroresReceptor.rut || erroresReceptor.correo) {
      const val = validarReceptorEditable(siguiente);
      setErroresReceptor({ rut: val.errorRut, correo: val.errorCorreo });
    }
  }

  function copiarDesdeCliente() {
    setReceptor({
      razonSocial: nombre.trim(),
      rut: (normalizarRut(rut) ?? rut).trim(),
      giro: giro.trim(),
      direccion: direccion.trim(),
      comuna: comuna.trim(),
      correo: correo.trim(),
    });
    setErroresReceptor({});
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (guardando) return;
    setError('');
    setDuplicado(null);

    const nombreLimpio = nombre.trim();
    if (!nombreLimpio) {
      setError('El nombre del cliente es obligatorio.');
      return;
    }
    const rutLimpio = rut.trim();
    const rutNorm = rutLimpio ? normalizarRut(rutLimpio) : null;
    if (rutLimpio && !rutNorm) {
      setError('Revisa el RUT (ej. 76.543.210-3) o déjalo vacío.');
      return;
    }
    const correoLimpio = correo.trim();
    if (correoLimpio && !correoElectronicoValido(correoLimpio)) {
      setError('Revisa el correo electrónico (ej. facturas@empresa.cl).');
      return;
    }

    const docFinal = documentoHabitual === 'sin_definir' ? null : documentoHabitual;
    let receptorFinal = null;
    if (docFinal === 'factura') {
      const val = validarReceptorEditable(receptor);
      if (val.errorRut || val.errorCorreo) {
        setErroresReceptor({ rut: val.errorRut, correo: val.errorCorreo });
        setError('Revisa el RUT o correo de facturación antes de guardar.');
        return;
      }
      const rec = editableAReceptor(receptor);
      receptorFinal = receptorTieneContenido(rec) ? rec : null;
    }

    const carga = {
      nombre: nombreLimpio,
      rut: rutNorm,
      giro: giro.trim() || null,
      telefono: telefono.trim() || null,
      direccion: direccion.trim() || null,
      comuna: comuna.trim() || null,
      correo: correoLimpio || null,
      notas: notas.trim() || null,
      documentoHabitual: docFinal,
      receptorFacturacion: receptorFinal,
    };

    setGuardando(true);
    try {
      const { cliente } = await pedirJSON<{ cliente: ClienteRegistrado }>('/api/clientes', {
        method: modo.tipo === 'editar' ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          modo.tipo === 'editar'
            ? { id: modo.cliente.id, actualizado: modo.cliente.actualizado, ...carga }
            : carga,
        ),
      });
      alGuardado(cliente, modo.tipo === 'editar' ? 'editar' : 'crear');
    } catch (err) {
      if (esSilencioso(err)) return;
      if (codigoDe(err) === 'rut_duplicado' && err instanceof ErrorSolicitud) {
        const existente = err.detalle?.clienteExistente as ClienteRegistrado | undefined;
        setDuplicado(existente ?? null);
      }
      setError(mensajeDe(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="dialogo-cliente-form">
      <div className="receptor-grid">
        <label className="ia-field receptor-campo-ancho">
          <span>Nombre *</span>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={300}
            required
            placeholder="Ej. Constructora Lingue"
            disabled={guardando}
          />
        </label>
        <label className="ia-field">
          <span>RUT</span>
          <input
            value={rut}
            onChange={(e) => setRut(e.target.value)}
            onBlur={formatearRut}
            maxLength={300}
            placeholder="76.543.210-3"
            autoComplete="off"
            disabled={guardando}
          />
        </label>
        <label className="ia-field">
          <span>Giro</span>
          <input
            value={giro}
            onChange={(e) => setGiro(e.target.value)}
            maxLength={300}
            placeholder="Ej. Construcción de obras"
            disabled={guardando}
          />
        </label>
        <label className="ia-field">
          <span>Teléfono</span>
          <input
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            maxLength={300}
            placeholder="+56 9 1234 5678"
            disabled={guardando}
          />
        </label>
        <label className="ia-field">
          <span>Comuna</span>
          <input
            value={comuna}
            onChange={(e) => setComuna(e.target.value)}
            maxLength={300}
            placeholder="Ej. Temuco"
            disabled={guardando}
          />
        </label>
        <label className="ia-field receptor-campo-ancho">
          <span>Dirección</span>
          <input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            maxLength={300}
            placeholder="Ej. Camino Villarrica Km 4"
            disabled={guardando}
          />
        </label>
        <label className="ia-field receptor-campo-ancho">
          <span>Correo</span>
          <input
            type="email"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            maxLength={300}
            placeholder="contacto@empresa.cl"
            disabled={guardando}
          />
        </label>
        <label className="ia-field receptor-campo-ancho">
          <span>Notas (opcional)</span>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Horario de atención, contacto de pagos…"
            disabled={guardando}
          />
        </label>
      </div>
      <FacturacionClienteCampos
        documento={documentoHabitual}
        alCambiarDocumento={(doc) => {
          setDocumentoHabitual(doc);
          if (doc !== 'factura') setErroresReceptor({});
        }}
        receptor={receptor}
        alCambiarReceptor={cambiarReceptor}
        erroresReceptor={erroresReceptor}
        disabled={guardando}
        alCopiarDesdeCliente={copiarDesdeCliente}
      />
      <p className="receptor-ayuda">
        Esta ficha sirve para autocompletar nuevas cotizaciones. Nunca cambia cotizaciones ya emitidas ni sus PDF.
      </p>
      {error && (
        <div className="cliente-duplicado" role="alert">
          <p className="campo-error">{error}</p>
          {duplicado && (
            <button
              type="button"
              className="button secondary small"
              disabled={guardando}
              onClick={() => alAbrirExistente(duplicado)}
            >
              Abrir ficha existente
            </button>
          )}
        </div>
      )}
      <div className="dialogo-acciones">
        <button type="button" className="button secondary" onClick={alCerrar} disabled={guardando}>
          Cancelar
        </button>
        <button type="submit" className="button primary" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar cliente'}
        </button>
      </div>
    </form>
  );
}

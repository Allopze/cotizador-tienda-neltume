'use client';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { etiquetaFacturacion, type Cotizacion } from '@/negocio/estado';
import {
  faltanDatosFactura,
  receptorDesdeCliente,
  receptorTieneContenido,
  textoCopiarFactura,
  type ReceptorFacturacion,
  type TipoDocumentoTributario,
} from '@/negocio/facturacion';
import { fechaLocal } from '@/negocio/vigencia';
import { copiarTexto } from './compartir';
import { fechaLarga } from './formato';
import {
  editableAReceptor,
  receptorAEditable,
  ReceptorFacturacionCampos,
  ResumenReceptor,
  validarReceptorEditable,
  type ReceptorEditable,
} from './receptor-facturacion';
import { SelectorDesplegable } from './selector-desplegable';

type OpcionDocumento = 'sin_definir' | TipoDocumentoTributario;

interface Props {
  actual: Cotizacion;
  ocupado: boolean;
  rangoFecha: { min: string | null; max: string };
  explicarFecha: (campo: HTMLInputElement, de: string) => void;
  flujo: (accion: Record<string, unknown>) => Promise<boolean>;
  confirmar: (opciones: {
    titulo: string;
    mensaje: ReactNode;
    aceptar: string;
    cancelar?: string;
    eyebrow?: string;
  }) => Promise<boolean>;
}

const CAMPOS: (keyof ReceptorFacturacion)[] = ['razonSocial', 'rut', 'giro', 'direccion', 'comuna', 'correo'];

function mismosReceptores(a: ReceptorFacturacion | null | undefined, b: ReceptorFacturacion | null | undefined): boolean {
  const hayA = receptorTieneContenido(a);
  const hayB = receptorTieneContenido(b);
  if (!hayA && !hayB) return true;
  if (!hayA || !hayB) return false;
  return CAMPOS.every((c) => (a?.[c] ?? null) === (b?.[c] ?? null));
}

/** Sección de facturación en el seguimiento: preferencia, receptor, copia y marcado final. */
export function FacturacionOperacion(props: Props) {
  const f = props.actual.facturacion;
  const clave = `${props.actual.id}:${f?.estado ?? 'pendiente'}:${f?.documento ?? 'null'}:${JSON.stringify(f?.receptor ?? null)}`;
  return (
    <>
      <h4 className="workflow-grupo">Facturación</h4>
      <FacturacionOperacionCuerpo key={clave} {...props} />
    </>
  );
}

function FacturacionOperacionCuerpo({ actual, ocupado, rangoFecha, explicarFecha, flujo, confirmar }: Props) {
  const fact = actual.facturacion;
  const docGuardado: OpcionDocumento = fact?.documento ?? 'sin_definir';
  const receptorGuardado = fact?.receptor ?? null;

  const [documento, setDocumento] = useState<OpcionDocumento>(docGuardado);
  const [receptor, setReceptor] = useState<ReceptorEditable>(() =>
    receptorAEditable(receptorGuardado ?? receptorDesdeCliente(actual.cliente)),
  );
  const [erroresReceptor, setErroresReceptor] = useState<{ rut?: string | null; correo?: string | null }>({});
  const [tipoFactura, setTipoFactura] = useState<TipoDocumentoTributario>(() =>
    fact?.documento === 'boleta' ? 'boleta' : 'factura',
  );
  const [numeroFactura, setNumeroFactura] = useState('');
  const [fechaFactura, setFechaFactura] = useState(() => fechaLocal(new Date()));
  const [estadoCopia, setEstadoCopia] = useState<'ok' | 'error' | null>(null);

  useEffect(() => {
    if (!estadoCopia) return;
    const t = setTimeout(() => setEstadoCopia(null), 2800);
    return () => clearTimeout(t);
  }, [estadoCopia]);

  async function copiarReceptor(datos: ReceptorFacturacion | null | undefined) {
    const texto = textoCopiarFactura(datos);
    if (!texto) return;
    setEstadoCopia((await copiarTexto(texto)) ? 'ok' : 'error');
  }

  if (fact?.estado === 'facturada') {
    const tieneReceptor = receptorTieneContenido(receptorGuardado);
    return (
      <div className="facturacion-card">
        <div className="workflow-actions">
          <p>
            <strong>{etiquetaFacturacion(fact)}</strong>
            {fact.fecha ? ` · ${fechaLarga(fact.fecha)}` : ''}
          </p>
          <button
            type="button"
            className="button secondary small"
            disabled={ocupado}
            onClick={() => void flujo({ tipo: 'facturacion', estado: 'pendiente' })}
          >
            Volver a pendiente
          </button>
        </div>
        {tieneReceptor && <ResumenReceptor receptor={receptorGuardado!} />}
        {tieneReceptor && (
          <div className="facturacion-acciones">
            <button type="button" className="button secondary small" disabled={ocupado} onClick={() => void copiarReceptor(receptorGuardado)}>
              Copiar datos para facturar
            </button>
            {estadoCopia === 'ok' && <span className="facturacion-copiado" role="status">Datos copiados para facturar</span>}
            {estadoCopia === 'error' && <span className="campo-error" role="alert">No se pudo copiar al portapapeles. Copia los datos manualmente.</span>}
          </div>
        )}
      </div>
    );
  }

  const receptorBorrador = editableAReceptor(receptor);
  const documentoNormalizado: TipoDocumentoTributario | null = documento === 'sin_definir' ? null : documento;
  const hayCambiosSinGuardar =
    (fact?.documento ?? null) !== documentoNormalizado ||
    (documentoNormalizado === 'factura'
      ? !mismosReceptores(receptorGuardado, receptorBorrador)
      : receptorTieneContenido(receptorGuardado));

  const faltantesGuardados = faltanDatosFactura(receptorGuardado);
  const faltantesBorrador = faltanDatosFactura(receptorBorrador);
  const faltantesAMostrar = documento === 'factura' ? faltantesBorrador : faltantesGuardados;
  const mostrarAvisoFaltantes =
    (documento === 'factura' || tipoFactura === 'factura') && (faltantesGuardados.length > 0 || faltantesBorrador.length > 0);
  const faltaReceptorParaEmitir = tipoFactura === 'factura' && (faltantesGuardados.length > 0 || hayCambiosSinGuardar);
  const hayAlgoParaCopiar = documento === 'factura' && receptorTieneContenido(receptorBorrador);

  function cambiarReceptor(siguiente: ReceptorEditable) {
    setReceptor(siguiente);
    if (erroresReceptor.rut || erroresReceptor.correo) {
      const val = validarReceptorEditable(siguiente);
      setErroresReceptor({ rut: val.errorRut, correo: val.errorCorreo });
    }
  }

  async function guardarDatosFacturacion() {
    if (ocupado || !hayCambiosSinGuardar) return;
    if (documentoNormalizado === 'factura') {
      const val = validarReceptorEditable(receptor);
      if (val.errorRut || val.errorCorreo) {
        setErroresReceptor({ rut: val.errorRut, correo: val.errorCorreo });
        return;
      }
    }
    setErroresReceptor({});
    await flujo({
      tipo: 'datos_facturacion',
      documento: documentoNormalizado,
      receptor: documentoNormalizado === 'factura' ? receptorBorrador : null,
    });
  }

  async function marcarFacturada(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (ocupado || faltaReceptorParaEmitir) return;
    if (fact?.documento && fact.documento !== tipoFactura) {
      const pedida = fact.documento === 'factura' ? 'Factura' : 'Boleta';
      const elegida = tipoFactura === 'factura' ? 'Factura' : 'Boleta';
      const ok = await confirmar({
        titulo: `¿Marcar como ${elegida}?`,
        mensaje: <p>El cliente había pedido <strong>{pedida}</strong>, pero vas a registrar una <strong>{elegida}</strong>.</p>,
        aceptar: `Sí, marcar como ${elegida}`,
        eyebrow: 'FACTURACIÓN',
      });
      if (!ok) return;
    }
    if (await flujo({
      tipo: 'facturacion',
      estado: 'facturada',
      tipoDocumento: tipoFactura,
      identificadorExterno: numeroFactura.trim() || null,
      fecha: fechaFactura || null,
    })) {
      setNumeroFactura('');
    }
  }

  return (
    <div className="facturacion-card">
      <div className="facturacion-preferencia">
        <p className="facturacion-bloque-titulo">Documento pedido por el cliente</p>
        <fieldset className="facturacion-opciones-fila" aria-label="Documento pedido por el cliente">
          {([['sin_definir', 'Aún no sabe'], ['boleta', 'Boleta'], ['factura', 'Factura']] as const).map(([valor, etiqueta]) => (
            <label key={valor} className="facturacion-pill">
              <input
                type="radio"
                name={`operacion-doc-${actual.id}`}
                value={valor}
                checked={documento === valor}
                disabled={ocupado}
                onChange={() => {
                  setDocumento(valor);
                  setErroresReceptor({});
                  if (valor === 'boleta' || valor === 'factura') setTipoFactura(valor);
                }}
              />
              <span>{etiqueta}</span>
            </label>
          ))}
        </fieldset>
      </div>

      {documento === 'factura' && (
        <ReceptorFacturacionCampos valor={receptor} alCambiar={cambiarReceptor} disabled={ocupado} prefijoId="operacion" errores={erroresReceptor} />
      )}

      {mostrarAvisoFaltantes && (
        <div className="facturacion-aviso" role="status">
          <div>
            <strong>Faltan datos para facturar</strong>
            {faltantesAMostrar.length > 0
              ? <span>: {faltantesAMostrar.join(', ')}.</span>
              : <span>: guarda los datos del receptor para poder emitir factura.</span>}
          </div>
          {documento !== 'factura' && (
            <button type="button" className="button secondary small" disabled={ocupado} onClick={() => setDocumento('factura')}>
              Completar datos
            </button>
          )}
        </div>
      )}

      {(hayCambiosSinGuardar || hayAlgoParaCopiar) && (
        <div className="facturacion-acciones">
          <button
            type="button"
            className={hayCambiosSinGuardar ? 'button primary small' : 'button secondary small'}
            disabled={ocupado || !hayCambiosSinGuardar}
            onClick={() => void guardarDatosFacturacion()}
          >
            Guardar datos de facturación
          </button>
          {hayAlgoParaCopiar && (
            <button type="button" className="button secondary small" disabled={ocupado} onClick={() => void copiarReceptor(receptorBorrador)}>
              Copiar datos para facturar
            </button>
          )}
          {hayCambiosSinGuardar && <span className="campo-sin-guardar">Cambios sin guardar</span>}
          {estadoCopia === 'ok' && <span className="facturacion-copiado" role="status">Datos copiados para facturar</span>}
          {estadoCopia === 'error' && <span className="campo-error" role="alert">No se pudo copiar al portapapeles.</span>}
        </div>
      )}

      <form className="workflow-payment" onSubmit={marcarFacturada}>
        <div className="ia-field">
          <span>Documento emitido</span>
          <SelectorDesplegable
            ariaLabel="Documento"
            value={tipoFactura}
            opciones={[{ value: 'factura', label: 'Factura' }, { value: 'boleta', label: 'Boleta' }]}
            onChange={(valor) => setTipoFactura(valor as TipoDocumentoTributario)}
            disabled={ocupado}
          />
        </div>
        <label className="ia-field">
          <span>N° o identificador externo</span>
          <input id="facturacion-identificador" value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} maxLength={120} placeholder="Ej. 1234" disabled={ocupado} />
        </label>
        <label className="ia-field">
          <span>Fecha de emisión</span>
          <input type="date" value={fechaFactura} min={rangoFecha.min ?? undefined} max={rangoFecha.max} onInvalid={(e) => explicarFecha(e.currentTarget, 'de la factura')} onChange={(e) => { e.currentTarget.setCustomValidity(''); setFechaFactura(e.target.value); }} disabled={ocupado} />
        </label>
        <button type="submit" className="button secondary" disabled={ocupado || faltaReceptorParaEmitir}>
          Marcar como facturada
        </button>
      </form>
      {faltaReceptorParaEmitir && (
        <p className="receptor-ayuda">
          Completa y guarda los datos obligatorios del receptor para marcar como Factura, o selecciona Boleta.
        </p>
      )}
    </div>
  );
}

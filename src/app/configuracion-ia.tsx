'use client';
import { useRef, useState, type FormEvent, type RefObject } from 'react';
import type { AjustesIA } from '@/asistente/ajustes';
import { Dialogo } from './dialogo';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

export interface EstadoAjustes {
  ajustes: AjustesIA;
  commandcodeClave: boolean;
  asistenteConfigurado: boolean;
  /** Solo quien administra puede cambiar el modelo; ausente = editable (compatibilidad). */
  puedeEditar?: boolean;
}
interface Props {
  abierta: boolean;
  estado: EstadoAjustes | null;
  /** Error al leer la configuración; el diálogo ofrece reintentar. */
  errorCarga: string;
  reintentar: () => void;
  cerrar: () => void;
  guardado: (estado: EstadoAjustes) => void;
}

export function ConfiguracionIA({ abierta, estado, errorCarga, reintentar, cerrar, guardado }: Props) {
  const campo = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState(false);
  return (
    <Dialogo
      abierto={abierta}
      alCerrar={cerrar}
      cerrable={!ocupado}
      titulo="Asistente"
      eyebrow="CONFIGURACIÓN"
      focoInicial={campo}
    >
      {estado ? (
        // Se monta con cada apertura: parte de la configuración guardada.
        <Formulario
          estado={estado}
          campo={campo}
          cerrar={cerrar}
          guardado={guardado}
          setOcupado={setOcupado}
        />
      ) : errorCarga ? (
        <div className="catalog-error" role="alert">
          {errorCarga}
          <button type="button" className="link" onClick={reintentar}>
            Reintentar
          </button>
        </div>
      ) : (
        <p className="catalog-modal-intro" role="status">
          Cargando la configuración…
        </p>
      )}
    </Dialogo>
  );
}

function Formulario({
  estado,
  campo,
  cerrar,
  guardado,
  setOcupado: avisarOcupado,
}: Pick<Props, 'cerrar' | 'guardado'> & {
  estado: EstadoAjustes;
  campo: RefObject<HTMLInputElement | null>;
  setOcupado: (v: boolean) => void;
}) {
  const [borrador, setBorrador] = useState<AjustesIA>(() => structuredClone(estado.ajustes));
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const editable = estado.puedeEditar !== false;

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado || !editable) return;
    setOcupado(true);
    avisarOcupado(true);
    setError('');
    try {
      const data = await pedirJSON<EstadoAjustes>('/api/ajustes', {
        json: { tipo: 'guardar', ajustes: borrador },
      });
      guardado(data);
      cerrar();
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado(false);
      avisarOcupado(false);
    }
  }

  return (
    <form onSubmit={guardar}>
      <p className="catalog-modal-intro">
        El asistente interpreta los mensajes del chat. Los precios siempre se calculan en el cotizador y nunca
        se envían al asistente.
      </p>

      <div className="ia-section">
        <label className="ia-field">
          <span>Modelo del asistente</span>
          <input
            ref={campo}
            value={borrador.commandcode.modelo}
            onChange={(e) => setBorrador({ commandcode: { modelo: e.target.value } })}
            placeholder="claude-sonnet-5"
            spellCheck={false}
            readOnly={!editable}
            aria-describedby="ia-nota"
            required
          />
        </label>
        <p id="ia-nota" className={`ia-status ${estado.commandcodeClave ? 'ok' : 'falta'}`}>
          {!editable ? 'Solo quien administra el cotizador puede cambiar el modelo. ' : ''}
          {estado.commandcodeClave
            ? '✓ El asistente tiene su clave de acceso configurada.'
            : 'El asistente no está configurado. Pide a quien administra el cotizador que lo active.'}
        </p>
      </div>

      {error && (
        <p className="catalog-error" role="alert">
          {error}
        </p>
      )}
      <div className="ia-actions">
        <button type="button" className="button secondary" onClick={cerrar} disabled={ocupado}>
          {editable ? 'Cancelar' : 'Cerrar'}
        </button>
        {editable && (
          <button type="submit" className="button primary" disabled={ocupado}>
            {ocupado ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      </div>
    </form>
  );
}

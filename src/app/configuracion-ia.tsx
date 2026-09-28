'use client';
import { useState, type FormEvent } from 'react';
import { fetchAutenticado } from './solicitud';
import type { AjustesIA } from '@/asistente/ajustes';

export interface EstadoAjustes {
  ajustes: AjustesIA;
  commandcodeClave: boolean;
  asistenteConfigurado: boolean;
}
interface Props {
  abierta: boolean;
  estado: EstadoAjustes | null;
  cerrar: () => void;
  guardado: (estado: EstadoAjustes) => void;
}

// Se monta solo mientras está abierta: cada apertura parte de la configuración guardada.
export function ConfiguracionIA({ abierta, estado, ...resto }: Props) {
  return abierta && estado ? <Formulario estado={estado} {...resto} /> : null;
}

function Formulario({ estado, cerrar, guardado }: Omit<Props, 'abierta'> & { estado: EstadoAjustes }) {
  const [borrador, setBorrador] = useState<AjustesIA>(() => structuredClone(estado.ajustes));
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  async function pedir(cuerpo: Record<string, unknown>): Promise<EstadoAjustes> {
    const respuesta = await fetchAutenticado('/api/ajustes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const data = await respuesta.json();
    if (!respuesta.ok) throw new Error(data.error ?? 'No se pudo guardar la configuración.');
    return data;
  }

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setError('');
    try {
      const data = await pedir({ tipo: 'guardar', ajustes: borrador });
      guardado(data);
      cerrar();
    } catch (causa) {
      setError((causa as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="catalog-modal-backdrop">
      <section className="catalog-modal" role="dialog" aria-modal="true" aria-labelledby="ia-titulo">
        <header className="catalog-modal-heading">
          <div>
            <p className="eyebrow">CONFIGURACIÓN / ASISTENTE</p>
            <h2 id="ia-titulo">Modelo de IA</h2>
          </div>
          <button
            type="button"
            className="catalog-modal-close"
            onClick={cerrar}
            disabled={ocupado}
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>
        <form onSubmit={guardar}>
          <p className="catalog-modal-intro">
            Elige el modelo de CommandCode que interpreta los mensajes. Los precios siempre se calculan en el
            servidor y nunca se envían al modelo.
          </p>

          <div className="ia-section">
            <label className="ia-field">
              <span>Modelo de CommandCode</span>
              <input
                value={borrador.commandcode.modelo}
                onChange={(e) => setBorrador({ commandcode: { modelo: e.target.value } })}
                placeholder="claude-sonnet-5"
                spellCheck={false}
                required
              />
            </label>
            <p className={`ia-status ${estado.commandcodeClave ? 'ok' : 'falta'}`}>
              {estado.commandcodeClave
                ? '✓ Clave CMD_API_KEY configurada en .env.local.'
                : 'Falta CMD_API_KEY en .env.local. La clave no se guarda desde esta pantalla.'}
            </p>
          </div>

          {error && (
            <p className="catalog-error" role="alert">
              {error}
            </p>
          )}
          <div className="ia-actions">
            <button type="button" className="button secondary" onClick={cerrar} disabled={ocupado}>
              Cancelar
            </button>
            <button type="submit" className="button primary" disabled={ocupado}>
              Guardar
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

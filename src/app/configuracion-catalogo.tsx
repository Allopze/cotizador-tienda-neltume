'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

type Familia = 'PUERTA' | 'MARCO' | 'PIEZAS_T' | 'MOLDURA';
interface Madera {
  nombre: string;
  codigo: string;
  alias: string[];
}
interface Configuracion {
  maderas: Madera[];
  familiasPorModelo: Record<string, Familia>;
  aliasModelos: Record<string, string[]>;
  aliasPosiblesModelos: Record<string, string[]>;
}
/** Fila en edición: los alias se guardan como texto para poder escribir comas mientras se escribe. */
interface MaderaEdit {
  nombre: string;
  codigo: string;
  aliasTexto: string;
}
interface FamiliaEdit {
  modelo: string;
  familia: Familia;
}
interface ModeloEdit {
  modelo: string;
  aliasTexto: string;
}

const FAMILIAS: Familia[] = ['PUERTA', 'MARCO', 'PIEZAS_T', 'MOLDURA'];
const partirAlias = (texto: string) =>
  texto
    .split(',')
    .map((valor) => valor.trim())
    .filter(Boolean);

const aliasPorModelo = (filas: ModeloEdit[]) =>
  Object.fromEntries(filas.filter((m) => m.modelo.trim()).map((m) => [m.modelo.trim(), partirAlias(m.aliasTexto)]));

/** Editor de «modelo → alias»: el mismo para los alias seguros y para los que piden confirmación. */
function GrupoAlias({
  titulo,
  ayuda,
  filas,
  setFilas,
  editable,
}: {
  titulo: string;
  ayuda: string;
  filas: ModeloEdit[];
  setFilas: (cambio: (actual: ModeloEdit[]) => ModeloEdit[]) => void;
  editable: boolean;
}) {
  return (
    <fieldset className="config-grupo" disabled={!editable}>
      <legend>{titulo}</legend>
      <p className="catalog-modal-intro">{ayuda}</p>
      {filas.map((fila, indice) => (
        <div className="config-editor-fila" key={indice}>
          <label className="ia-field">
            <span>Modelo</span>
            <input
              value={fila.modelo}
              onChange={(e) => setFilas((actual) => actual.map((m, i) => (i === indice ? { ...m, modelo: e.target.value } : m)))}
              maxLength={80}
            />
          </label>
          <label className="ia-field">
            <span>Alias (separados por coma)</span>
            <input
              value={fila.aliasTexto}
              onChange={(e) => setFilas((actual) => actual.map((m, i) => (i === indice ? { ...m, aliasTexto: e.target.value } : m)))}
              maxLength={200}
            />
          </label>
          <button type="button" className="button secondary small" onClick={() => setFilas((actual) => actual.filter((_, i) => i !== indice))}>
            Quitar
          </button>
        </div>
      ))}
      <button type="button" className="button secondary small" onClick={() => setFilas((actual) => [...actual, { modelo: '', aliasTexto: '' }])}>
        Agregar modelo
      </button>
    </fieldset>
  );
}

export function ConfiguracionCatalogo() {
  const [configuracion, setConfiguracion] = useState<Configuracion | null>(null);
  const [maderas, setMaderas] = useState<MaderaEdit[]>([]);
  const [familias, setFamilias] = useState<FamiliaEdit[]>([]);
  const [modelos, setModelos] = useState<ModeloEdit[]>([]);
  const [posibles, setPosibles] = useState<ModeloEdit[]>([]);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const aplicar = (config: Configuracion) => {
    setConfiguracion(config);
    setMaderas(config.maderas.map((m) => ({ nombre: m.nombre, codigo: m.codigo, aliasTexto: m.alias.join(', ') })));
    setFamilias(Object.entries(config.familiasPorModelo).map(([modelo, familia]) => ({ modelo, familia })));
    setModelos(Object.entries(config.aliasModelos).map(([modelo, alias]) => ({ modelo, aliasTexto: alias.join(', ') })));
    setPosibles(Object.entries(config.aliasPosiblesModelos).map(([modelo, alias]) => ({ modelo, aliasTexto: alias.join(', ') })));
  };

  useEffect(() => {
    const control = new AbortController();
    pedirJSON<{ configuracion: Configuracion; puedeEditar: boolean }>('/api/catalogo-configuracion', { signal: control.signal, cache: 'no-store' }).then(
      (data) => {
        aplicar(data.configuracion);
        setPuedeEditar(data.puedeEditar);
      },
      (causa) => {
        if (!esSilencioso(causa)) setError(mensajeDe(causa));
      },
    );
    return () => control.abort();
  }, []);

  function borrador(): Configuracion {
    return {
      maderas: maderas.map((m) => ({ nombre: m.nombre.trim(), codigo: m.codigo.trim(), alias: partirAlias(m.aliasTexto) })),
      familiasPorModelo: Object.fromEntries(familias.filter((f) => f.modelo.trim()).map((f) => [f.modelo.trim(), f.familia])),
      aliasModelos: aliasPorModelo(modelos),
      aliasPosiblesModelos: aliasPorModelo(posibles),
    };
  }

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (!puedeEditar || ocupado) return;
    if (!maderas.length) {
      setError('Debe quedar al menos una madera.');
      return;
    }
    setOcupado(true);
    setError('');
    try {
      const data = await pedirJSON<{ configuracion: Configuracion }>('/api/catalogo-configuracion', { json: borrador() });
      aplicar(data.configuracion);
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado(false);
    }
  }

  if (!configuracion) return <p className="catalog-modal-intro">{error || 'Cargando configuración…'}</p>;

  const cambiarMadera = (indice: number, cambio: Partial<MaderaEdit>) =>
    setMaderas((actual) => actual.map((m, i) => (i === indice ? { ...m, ...cambio } : m)));
  const editable = puedeEditar && !ocupado;

  return (
    <form onSubmit={guardar}>
      <p className="catalog-modal-intro">
        Edita nombres y alias de maderas, familias y alias de modelos sin tocar el archivo de configuración. El servidor valida duplicados antes de guardar.
      </p>

      <fieldset className="config-grupo" disabled={!editable}>
        <legend>Maderas</legend>
        {maderas.map((madera, indice) => (
          <div className="config-editor-fila" key={indice}>
            <label className="ia-field">
              <span>Nombre</span>
              <input value={madera.nombre} onChange={(e) => cambiarMadera(indice, { nombre: e.target.value })} maxLength={80} />
            </label>
            <label className="ia-field">
              <span>Código</span>
              <input value={madera.codigo} onChange={(e) => cambiarMadera(indice, { codigo: e.target.value })} maxLength={10} />
            </label>
            <label className="ia-field">
              <span>Alias (separados por coma)</span>
              <input value={madera.aliasTexto} onChange={(e) => cambiarMadera(indice, { aliasTexto: e.target.value })} maxLength={200} placeholder="Ej. PINO, OREGON" />
            </label>
            <button
              type="button"
              className="button secondary small"
              onClick={() => setMaderas((actual) => actual.filter((_, i) => i !== indice))}
            >
              Quitar
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button secondary small"
          onClick={() => setMaderas((actual) => [...actual, { nombre: '', codigo: '', aliasTexto: '' }])}
        >
          Agregar madera
        </button>
      </fieldset>

      <fieldset className="config-grupo" disabled={!editable}>
        <legend>Familia por modelo</legend>
        {familias.map((fila, indice) => (
          <div className="config-editor-fila" key={indice}>
            <label className="ia-field">
              <span>Modelo</span>
              <input
                value={fila.modelo}
                onChange={(e) => setFamilias((actual) => actual.map((f, i) => (i === indice ? { ...f, modelo: e.target.value } : f)))}
                maxLength={80}
              />
            </label>
            <label className="ia-field">
              <span>Familia</span>
              <select
                value={fila.familia}
                onChange={(e) =>
                  setFamilias((actual) => actual.map((f, i) => (i === indice ? { ...f, familia: e.target.value as Familia } : f)))
                }
              >
                {FAMILIAS.map((familia) => (
                  <option key={familia}>{familia}</option>
                ))}
              </select>
            </label>
            <button type="button" className="button secondary small" onClick={() => setFamilias((actual) => actual.filter((_, i) => i !== indice))}>
              Quitar
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button secondary small"
          onClick={() => setFamilias((actual) => [...actual, { modelo: '', familia: 'PUERTA' }])}
        >
          Agregar modelo
        </button>
      </fieldset>

      <GrupoAlias
        titulo="Alias por modelo"
        ayuda="Se normalizan al modelo sin preguntar."
        filas={modelos}
        setFilas={setModelos}
        editable={editable}
      />

      <GrupoAlias
        titulo="Alias posibles por modelo"
        ayuda="Nunca se sustituyen solos: el ítem queda pendiente hasta confirmar el modelo."
        filas={posibles}
        setFilas={setPosibles}
        editable={editable}
      />

      {error && <p className="catalog-error" role="alert">{error}</p>}
      {!puedeEditar ? (
        <p className="ia-permiso">Solo quien administra el cotizador puede cambiar esta configuración.</p>
      ) : (
        <div className="ia-actions">
          <button type="button" className="button secondary" onClick={() => aplicar(configuracion)} disabled={ocupado}>
            Descartar cambios
          </button>
          <button type="submit" className="button primary" disabled={ocupado}>
            {ocupado ? 'Guardando…' : 'Guardar configuración'}
          </button>
        </div>
      )}

      <details className="config-json">
        <summary>Ver la configuración como JSON</summary>
        <pre>{JSON.stringify(borrador(), null, 2)}</pre>
      </details>
    </form>
  );
}

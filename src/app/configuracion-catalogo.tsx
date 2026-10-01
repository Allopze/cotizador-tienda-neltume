'use client';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { FAMILIAS } from '@/catalogo/familias';
import type { Familia } from '@/catalogo/tipos';
import type { Avisar } from './avisos';
import { SelectorFamilia } from './selector-familia';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

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
interface Filas {
  maderas: MaderaEdit[];
  familias: FamiliaEdit[];
  modelos: ModeloEdit[];
  posibles: ModeloEdit[];
}
type Grupo = keyof Filas;
/** Errores por grupo y fila: se muestran junto a la fila que hay que corregir. */
type Errores = Partial<Record<Grupo, Record<number, string>>>;

const DURACION_DESHACER = 8000;
const partirAlias = (texto: string) =>
  texto
    .split(',')
    .map((valor) => valor.trim())
    .filter(Boolean);
const aliasPorModelo = (filas: ModeloEdit[]) =>
  Object.fromEntries(filas.filter((m) => m.modelo.trim()).map((m) => [m.modelo.trim(), partirAlias(m.aliasTexto)]));
const clave = (texto: string) => texto.trim().toLocaleUpperCase('es-CL');

const filasDe = (c: Configuracion): Filas => ({
  maderas: c.maderas.map((m) => ({ nombre: m.nombre, codigo: m.codigo, aliasTexto: m.alias.join(', ') })),
  familias: Object.entries(c.familiasPorModelo).map(([modelo, familia]) => ({ modelo, familia })),
  modelos: Object.entries(c.aliasModelos).map(([modelo, alias]) => ({ modelo, aliasTexto: alias.join(', ') })),
  posibles: Object.entries(c.aliasPosiblesModelos).map(([modelo, alias]) => ({ modelo, aliasTexto: alias.join(', ') })),
});
const configuracionDe = (f: Filas): Configuracion => ({
  maderas: f.maderas.map((m) => ({ nombre: m.nombre.trim(), codigo: m.codigo.trim(), alias: partirAlias(m.aliasTexto) })),
  familiasPorModelo: Object.fromEntries(f.familias.filter((x) => x.modelo.trim()).map((x) => [x.modelo.trim(), x.familia])),
  aliasModelos: aliasPorModelo(f.modelos),
  aliasPosiblesModelos: aliasPorModelo(f.posibles),
});

/** Lo que el servidor rechazaría, dicho junto a la fila: vacíos y duplicados. */
function validar(f: Filas): Errores {
  const errores: Errores = {};
  const marcar = (grupo: Grupo, fila: number, texto: string) => {
    errores[grupo] = { ...errores[grupo], [fila]: texto };
  };
  const nombres = new Map<string, number>();
  const codigos = new Map<string, number>();
  f.maderas.forEach((m, i) => {
    if (!m.nombre.trim() || !m.codigo.trim()) return marcar('maderas', i, 'La madera necesita nombre y código.');
    if (nombres.has(clave(m.nombre))) return marcar('maderas', i, `«${m.nombre.trim()}» ya está en la fila ${nombres.get(clave(m.nombre))! + 1}.`);
    if (codigos.has(clave(m.codigo))) return marcar('maderas', i, `El código «${m.codigo.trim()}» ya lo usa la fila ${codigos.get(clave(m.codigo))! + 1}.`);
    nombres.set(clave(m.nombre), i);
    codigos.set(clave(m.codigo), i);
  });
  for (const grupo of ['familias', 'modelos', 'posibles'] as const) {
    const vistos = new Map<string, number>();
    f[grupo].forEach((fila, i) => {
      if (!fila.modelo.trim()) return;
      const k = clave(fila.modelo);
      if (vistos.has(k)) return marcar(grupo, i, `El modelo «${fila.modelo.trim()}» ya está en la fila ${vistos.get(k)! + 1}.`);
      vistos.set(k, i);
    });
  }
  return errores;
}

/** Botón «Quitar»: dice qué quita y, si la fila tenía datos, ofrece deshacer. */
function BotonQuitar({ etiqueta, quitar }: { etiqueta: string; quitar: () => void }) {
  return (
    <button type="button" className="button secondary small" onClick={quitar} aria-label={`Quitar ${etiqueta}`}>
      Quitar
    </button>
  );
}

function ErrorFila({ id, texto }: { id: string; texto?: string }) {
  return texto ? (
    <p id={id} className="campo-error config-error-fila">
      {texto}
    </p>
  ) : null;
}

export function ConfiguracionCatalogo({
  avisar,
  cerrarAviso,
  alCambiar,
}: {
  avisar: Avisar;
  cerrarAviso: (id: number) => void;
  alCambiar: (sucio: boolean) => void;
}) {
  const uid = useId();
  const [base, setBase] = useState<Filas | null>(null);
  const [filas, setFilas] = useState<Filas | null>(null);
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [intentado, setIntentado] = useState(false);
  const formulario = useRef<HTMLFormElement>(null);

  const aplicar = (config: Configuracion) => {
    const nuevas = filasDe(config);
    setBase(nuevas);
    setFilas(nuevas);
    setIntentado(false);
  };

  useEffect(() => {
    const control = new AbortController();
    pedirJSON<{ configuracion: Configuracion; puedeEditar: boolean }>('/api/catalogo-configuracion', {
      signal: control.signal,
      cache: 'no-store',
    }).then(
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

  const borrador = useMemo(() => (filas ? configuracionDe(filas) : null), [filas]);
  const sucio = !!base && !!borrador && JSON.stringify(borrador) !== JSON.stringify(configuracionDe(base));
  useEffect(() => alCambiar(sucio), [sucio, alCambiar]);
  const errores = useMemo(() => (filas && intentado ? validar(filas) : {}), [filas, intentado]);

  const editar = <G extends Grupo>(grupo: G, indice: number, cambio: Partial<Filas[G][number]>) =>
    setFilas((f) => f && { ...f, [grupo]: f[grupo].map((x, i) => (i === indice ? { ...x, ...cambio } : x)) });
  const agregar = <G extends Grupo>(grupo: G, fila: Filas[G][number]) =>
    setFilas((f) => f && { ...f, [grupo]: [...f[grupo], fila] });

  function quitar<G extends Grupo>(grupo: G, indice: number, nombre: string) {
    if (!filas) return;
    const fila = filas[grupo][indice];
    setFilas((f) => f && { ...f, [grupo]: f[grupo].filter((_, i) => i !== indice) });
    // Una fila nueva y vacía se quita sin más; una con datos se puede recuperar unos segundos.
    if (!Object.values(fila).some((v) => typeof v === 'string' && v.trim())) return;
    const id = avisar('info', `Se quitó ${nombre}. Se aplica al guardar.`, {
      clave: 'config-quitar',
      accion: {
        etiqueta: 'Deshacer',
        fn: () =>
          setFilas((f) => {
            if (!f) return f;
            const lista = [...f[grupo]];
            lista.splice(Math.min(indice, lista.length), 0, fila);
            return { ...f, [grupo]: lista };
          }),
      },
    });
    setTimeout(() => cerrarAviso(id), DURACION_DESHACER);
  }

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (!puedeEditar || ocupado || !filas || !borrador) return;
    setIntentado(true);
    if (!filas.maderas.length) {
      setError('Debe quedar al menos una madera.');
      return;
    }
    if (Object.keys(validar(filas)).length) {
      setError('Corrige las filas marcadas antes de guardar.');
      // El foco va a la primera fila con error, cuando ya está pintada.
      requestAnimationFrame(() => formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setOcupado(true);
    setError('');
    try {
      const data = await pedirJSON<{ configuracion: Configuracion }>('/api/catalogo-configuracion', { json: borrador });
      aplicar(data.configuracion);
      avisar('exito', 'Configuración del catálogo guardada.', { clave: 'config-guardada' });
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado(false);
    }
  }

  if (!filas || !base) return <p className="catalog-modal-intro">{error || 'Cargando configuración…'}</p>;
  const editable = puedeEditar && !ocupado;
  const errorId = (grupo: Grupo, i: number) => `${uid}-${grupo}-${i}-error`;
  const invalida = (grupo: Grupo, i: number) =>
    errores[grupo]?.[i] ? { 'aria-invalid': true as const, 'aria-describedby': errorId(grupo, i) } : {};

  const grupoAlias = (grupo: 'modelos' | 'posibles', titulo: string, ayuda: string) => (
    <fieldset className="config-grupo" disabled={!editable}>
      <legend>{titulo}</legend>
      <p className="catalog-modal-intro">{ayuda}</p>
      {filas[grupo].map((fila, i) => (
        <div className="config-editor-fila" key={i}>
          <label className="ia-field">
            <span>Modelo</span>
            <input value={fila.modelo} onChange={(e) => editar(grupo, i, { modelo: e.target.value })} maxLength={80} {...invalida(grupo, i)} />
          </label>
          <label className="ia-field">
            <span>Alias (separados por coma)</span>
            <input value={fila.aliasTexto} onChange={(e) => editar(grupo, i, { aliasTexto: e.target.value })} maxLength={200} />
          </label>
          <BotonQuitar etiqueta={`alias de ${fila.modelo.trim() || 'modelo nuevo'}`} quitar={() => quitar(grupo, i, `los alias de ${fila.modelo.trim() || 'un modelo'}`)} />
          <ErrorFila id={errorId(grupo, i)} texto={errores[grupo]?.[i]} />
        </div>
      ))}
      <button type="button" className="button secondary small" onClick={() => agregar(grupo, { modelo: '', aliasTexto: '' })}>
        Agregar modelo
      </button>
    </fieldset>
  );

  return (
    <form ref={formulario} className="config-catalogo" onSubmit={guardar} noValidate>
      <p className="catalog-modal-intro">
        Nombres, códigos y alias de maderas y modelos que el asistente usa para reconocer lo que pide el cliente. Los
        cambios se aplican a las cotizaciones nuevas.
      </p>

      <fieldset className="config-grupo" disabled={!editable}>
        <legend>Maderas</legend>
        {filas.maderas.map((madera, i) => (
          <div className="config-editor-fila" key={i}>
            <label className="ia-field">
              <span>Nombre</span>
              <input value={madera.nombre} onChange={(e) => editar('maderas', i, { nombre: e.target.value })} maxLength={80} {...invalida('maderas', i)} />
            </label>
            <label className="ia-field config-campo-corto">
              <span>Código</span>
              <input value={madera.codigo} onChange={(e) => editar('maderas', i, { codigo: e.target.value })} maxLength={10} {...invalida('maderas', i)} />
            </label>
            <label className="ia-field">
              <span>Alias (separados por coma)</span>
              <input value={madera.aliasTexto} onChange={(e) => editar('maderas', i, { aliasTexto: e.target.value })} maxLength={200} placeholder="Ej.: PINO, OREGON" />
            </label>
            <BotonQuitar etiqueta={`madera ${madera.nombre.trim() || 'nueva'}`} quitar={() => quitar('maderas', i, `la madera ${madera.nombre.trim() || 'nueva'}`)} />
            <ErrorFila id={errorId('maderas', i)} texto={errores.maderas?.[i]} />
          </div>
        ))}
        <button type="button" className="button secondary small" onClick={() => agregar('maderas', { nombre: '', codigo: '', aliasTexto: '' })}>
          Agregar madera
        </button>
      </fieldset>

      <fieldset className="config-grupo" disabled={!editable}>
        <legend>Familia por modelo</legend>
        {filas.familias.map((fila, i) => (
          <div className="config-editor-fila" key={i}>
            <label className="ia-field">
              <span>Modelo</span>
              <input value={fila.modelo} onChange={(e) => editar('familias', i, { modelo: e.target.value })} maxLength={80} {...invalida('familias', i)} />
            </label>
            <div className="ia-field">
              <span id={`${uid}-familia-${i}`}>Familia</span>
              <SelectorFamilia
                id={`${uid}-familia-${i}`}
                value={fila.familia}
                opciones={FAMILIAS}
                vacio="Elige una familia"
                disabled={!editable}
                seleccionar={(familia) => editar('familias', i, { familia: familia as Familia })}
              />
            </div>
            <BotonQuitar etiqueta={`familia de ${fila.modelo.trim() || 'modelo nuevo'}`} quitar={() => quitar('familias', i, `la familia de ${fila.modelo.trim() || 'un modelo'}`)} />
            <ErrorFila id={errorId('familias', i)} texto={errores.familias?.[i]} />
          </div>
        ))}
        <button type="button" className="button secondary small" onClick={() => agregar('familias', { modelo: '', familia: 'PUERTA' })}>
          Agregar modelo
        </button>
      </fieldset>

      {grupoAlias('modelos', 'Alias por modelo', 'Se reemplazan por el modelo sin preguntar.')}
      {grupoAlias('posibles', 'Alias posibles por modelo', 'Nunca se reemplazan solos: el ítem queda pendiente hasta que alguien confirme el modelo.')}

      <details className="config-json">
        <summary>Vista técnica (JSON)</summary>
        <pre>{JSON.stringify(borrador, null, 2)}</pre>
      </details>

      {!puedeEditar ? (
        <p className="ia-permiso">Solo quien administra el cotizador puede cambiar esta configuración.</p>
      ) : (
        <div className={`config-barra${sucio ? ' sucia' : ''}`}>
          <p role="status">{error ? '' : sucio ? 'Hay cambios sin guardar.' : 'Sin cambios pendientes.'}</p>
          {error && (
            <p className="catalog-error" role="alert">
              {error}
            </p>
          )}
          <div className="ia-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setFilas(base);
                setIntentado(false);
                setError('');
              }}
              disabled={ocupado || !sucio}
            >
              Descartar cambios
            </button>
            <button type="submit" className="button primary" disabled={ocupado || !sucio}>
              {ocupado ? 'Guardando…' : 'Guardar configuración'}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

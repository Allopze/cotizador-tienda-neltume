'use client';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { etiquetaFamilia } from '@/catalogo/familias';
import { pesos } from '@/negocio/precios';
import type { Avisar } from './avisos';
import { Dialogo } from './dialogo';
import { nombreProducto } from './formato';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

interface ModeloResumen {
  modelo: string;
  familia: 'PUERTA' | 'MARCO' | 'PIEZAS_T' | 'MOLDURA' | 'OTRO';
  filas: number;
  origen: 'planilla' | 'manual' | 'mixto';
  maderas: { madera: string; filas: number; desde: number; hasta: number }[];
}

const ORIGEN: Record<ModeloResumen['origen'], string> = {
  planilla: 'De la planilla',
  manual: 'Agregado aquí',
  mixto: 'Planilla y agregados aquí',
};
const pedir = <T,>(cuerpo: Record<string, unknown>) =>
  pedirJSON<T>('/api/catalogo', { method: 'POST', json: cuerpo, cache: 'no-store' });

/**
 * Vista por modelo: cada puerta con sus maderas y medidas, en vez de cientos de filas sueltas. Desde aquí se crea
 * un modelo nuevo copiando uno parecido (con el costo ajustado) y se renombra uno agregado aquí (auditoría
 * 2026-11, N-06 y N-33).
 */
export function ModelosCatalogo({ avisar }: { avisar: Avisar }) {
  const [modelos, setModelos] = useState<ModeloResumen[] | null>(null);
  const [error, setError] = useState('');
  const [recarga, setRecarga] = useState(0);
  const [filtro, setFiltro] = useState('');
  const [duplicando, setDuplicando] = useState<ModeloResumen | null>(null);
  const [renombrando, setRenombrando] = useState<ModeloResumen | null>(null);
  useEffect(() => {
    let vigente = true;
    pedir<{ modelos: ModeloResumen[] }>({ tipo: 'listar_modelos' })
      .then((d) => vigente && (setModelos(d.modelos), setError('')))
      .catch((e) => vigente && !esSilencioso(e) && setError(mensajeDe(e)));
    return () => {
      vigente = false;
    };
  }, [recarga]);
  const texto = filtro
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();
  const visibles = (modelos ?? []).filter(
    (m) => !texto || m.modelo.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().includes(texto),
  );
  return (
    <div className="modelos-catalogo">
      <p className="catalog-modal-intro">
        Un modelo reúne todas las maderas y medidas de una puerta o accesorio. Para crear uno nuevo parecido a otro,
        usa <strong>Duplicar</strong>: copia sus maderas y medidas, ajusta el costo en un porcentaje y queda listo
        para cotizar. Las medidas sueltas se agregan en «Agregar producto».
      </p>
      <div className="catalogo-filtros">
        <label className="sr-only" htmlFor="modelos-buscar">
          Buscar modelo
        </label>
        <input
          id="modelos-buscar"
          type="search"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar modelo, por ejemplo Ranco"
          maxLength={60}
        />
      </div>
      {error ? (
        <p className="catalog-error" role="alert">
          {error}{' '}
          <button type="button" className="link" onClick={() => setRecarga((n) => n + 1)}>
            Reintentar
          </button>
        </p>
      ) : !modelos ? (
        <p className="muted">Cargando modelos…</p>
      ) : !visibles.length ? (
        <p className="muted">Ningún modelo coincide con «{filtro.trim()}».</p>
      ) : (
        <ul className="modelos-lista">
          {visibles.map((m) => (
            <li key={m.modelo} className="modelo-ficha">
              <div className="modelo-ficha-cabeza">
                <h3>{nombreProducto(m.modelo)}</h3>
                <span className="modelo-ficha-meta">
                  {etiquetaFamilia(m.familia)} · {m.filas} {m.filas === 1 ? 'medida' : 'medidas'} · {ORIGEN[m.origen]}
                </span>
              </div>
              <ul className="modelo-maderas" aria-label={`Maderas de ${nombreProducto(m.modelo)}`}>
                {m.maderas.map((d) => (
                  <li key={d.madera}>
                    <strong>{nombreProducto(d.madera)}</strong>
                    <small>
                      {d.filas} {d.filas === 1 ? 'medida' : 'medidas'} · costo {pesos(d.desde)}
                      {d.hasta !== d.desde ? ` a ${pesos(d.hasta)}` : ''}
                    </small>
                  </li>
                ))}
              </ul>
              <div className="modelo-ficha-acciones">
                <button type="button" className="button secondary small" onClick={() => setDuplicando(m)}>
                  Duplicar
                </button>
                {m.origen === 'manual' && (
                  <button type="button" className="button secondary small" onClick={() => setRenombrando(m)}>
                    Renombrar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {duplicando && (
        <DuplicarModelo
          modelo={duplicando}
          alCerrar={() => setDuplicando(null)}
          alCrear={(nuevo, creados) => {
            setDuplicando(null);
            setRecarga((n) => n + 1);
            setFiltro(nuevo);
            avisar('exito', `Modelo ${nombreProducto(nuevo)} creado con ${creados} ${creados === 1 ? 'medida' : 'medidas'}. Ya se puede cotizar.`);
          }}
        />
      )}
      {renombrando && (
        <RenombrarModelo
          modelo={renombrando}
          alCerrar={() => setRenombrando(null)}
          alRenombrar={(nuevo) => {
            setRenombrando(null);
            setRecarga((n) => n + 1);
            setFiltro(nuevo);
            avisar('exito', `Modelo renombrado a ${nombreProducto(nuevo)}. El nombre anterior se sigue reconociendo.`);
          }}
        />
      )}
    </div>
  );
}

function DuplicarModelo({
  modelo: m,
  alCerrar,
  alCrear,
}: {
  modelo: ModeloResumen;
  alCerrar: () => void;
  alCrear: (modelo: string, creados: number) => void;
}) {
  const uid = useId();
  const [nombre, setNombre] = useState('');
  const [maderas, setMaderas] = useState<string[]>(m.maderas.map((d) => d.madera));
  const [ajuste, setAjuste] = useState('0');
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  const porcentaje = Number(ajuste.replace(',', '.').replace('%', '').trim() || '0');
  const ajusteValido = Number.isFinite(porcentaje) && porcentaje >= -50 && porcentaje <= 200;
  const factor = 1 + (ajusteValido ? porcentaje : 0) / 100;
  const elegidas = m.maderas.filter((d) => maderas.includes(d.madera));
  const medidas = elegidas.reduce((n, d) => n + d.filas, 0);
  const ejemplo = elegidas[0];
  async function crear(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return setError('Escribe el nombre del modelo nuevo.');
    if (!elegidas.length) return setError('Elige al menos una madera.');
    if (!ajusteValido) return setError('El ajuste debe estar entre −50 % y +200 %.');
    setOcupado(true);
    setError('');
    try {
      const r = await pedir<{ modelo: string; creados: number }>({
        tipo: 'duplicar_modelo',
        origen: m.modelo,
        nombre: nombre.trim(),
        maderas: elegidas.length === m.maderas.length ? null : elegidas.map((d) => d.madera),
        factor,
      });
      alCrear(r.modelo, r.creados);
    } catch (causa) {
      setError(mensajeDe(causa));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <Dialogo abierto alCerrar={alCerrar} titulo={`Duplicar ${nombreProducto(m.modelo)}`} cerrable={!ocupado} className="dialogo-alta">
      <form className="duplicar-modelo" onSubmit={crear} noValidate>
        <label className="alta-campo" htmlFor={`${uid}-nombre`}>
          <span>Nombre del modelo nuevo</span>
          <input id={`${uid}-nombre`} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={100} placeholder="Ej.: Roble" autoFocus />
        </label>
        <fieldset className="duplicar-maderas">
          <legend>Maderas que se copian</legend>
          {m.maderas.map((d) => (
            <label key={d.madera}>
              <input
                type="checkbox"
                checked={maderas.includes(d.madera)}
                onChange={(e) =>
                  setMaderas((actual) => (e.target.checked ? [...actual, d.madera] : actual.filter((x) => x !== d.madera)))
                }
              />
              {nombreProducto(d.madera)} <small>({d.filas} {d.filas === 1 ? 'medida' : 'medidas'})</small>
            </label>
          ))}
        </fieldset>
        <label className="alta-campo" htmlFor={`${uid}-ajuste`}>
          <span>Ajuste del costo de fábrica (%)</span>
          <input
            id={`${uid}-ajuste`}
            value={ajuste}
            onChange={(e) => setAjuste(e.target.value)}
            inputMode="decimal"
            maxLength={6}
            aria-invalid={!ajusteValido}
          />
          <small>0 copia los mismos costos; 10 los sube 10 %; −5 los baja 5 %.</small>
        </label>
        <p className="duplicar-resumen" role="status">
          {elegidas.length ? (
            <>
              Se crearán <strong>{medidas}</strong> {medidas === 1 ? 'medida' : 'medidas'}
              {ejemplo && ajusteValido && (
                <>
                  . Por ejemplo, en {nombreProducto(ejemplo.madera)} el costo de {pesos(ejemplo.desde)} queda en{' '}
                  <strong>{pesos(Math.round(ejemplo.desde * factor))}</strong>
                </>
              )}
              . El precio de venta se calcula con la ganancia de cada categoría.
            </>
          ) : (
            'Elige al menos una madera.'
          )}
        </p>
        {error && (
          <p className="catalog-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialogo-acciones">
          <button type="submit" className="button primary" disabled={ocupado}>
            {ocupado ? 'Creando…' : 'Crear modelo'}
          </button>
          <button type="button" className="button secondary antes" onClick={alCerrar} disabled={ocupado}>
            Cancelar
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

function RenombrarModelo({
  modelo: m,
  alCerrar,
  alRenombrar,
}: {
  modelo: ModeloResumen;
  alCerrar: () => void;
  alRenombrar: (modelo: string) => void;
}) {
  const uid = useId();
  const [nombre, setNombre] = useState(nombreProducto(m.modelo));
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');
  async function renombrar(e: FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return setError('Escribe el nombre nuevo.');
    setOcupado(true);
    setError('');
    try {
      const r = await pedir<{ modelo: string }>({ tipo: 'renombrar_modelo', anterior: m.modelo, nombre: nombre.trim() });
      alRenombrar(r.modelo);
    } catch (causa) {
      setError(mensajeDe(causa));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <Dialogo abierto alCerrar={alCerrar} titulo={`Renombrar ${nombreProducto(m.modelo)}`} cerrable={!ocupado} className="dialogo-alta">
      <form className="duplicar-modelo" onSubmit={renombrar} noValidate>
        <label className="alta-campo" htmlFor={`${uid}-nombre`}>
          <span>Nombre nuevo</span>
          <input id={`${uid}-nombre`} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={100} autoFocus />
          <small>Cambia en sus {m.filas} medidas. El nombre anterior se sigue reconociendo en el chat y en los borradores.</small>
        </label>
        {error && (
          <p className="catalog-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialogo-acciones">
          <button type="submit" className="button primary" disabled={ocupado}>
            {ocupado ? 'Guardando…' : 'Renombrar'}
          </button>
          <button type="button" className="button secondary antes" onClick={alCerrar} disabled={ocupado}>
            Cancelar
          </button>
        </div>
      </form>
    </Dialogo>
  );
}

'use client';
import { useEffect, useState, type FormEvent } from 'react';
import {
  ETIQUETA_FAMILIA,
  FAMILIAS_ENVIO,
  leerMedida,
  MAX_ESPESOR_CM,
  MAX_KG_UNIDAD,
  medidaATexto,
  type CiudadStarken,
  type ConfiguracionStarken,
  type EstadoStarken,
} from '@/negocio/starken';
import type { Familia } from '@/catalogo/tipos';
import type { TipoAviso } from '../avisos';
import { esSilencioso, mensajeDe, pedirJSON } from '../solicitud';

type Estado = EstadoStarken & { puedeEditar: boolean };
type Texto = Record<Familia, { kg: string; espesorCm: string }>;

const aTextos = (c: ConfiguracionStarken): Texto =>
  Object.fromEntries(
    FAMILIAS_ENVIO.map((f) => [
      f,
      { kg: medidaATexto(c.paquete[f].kg), espesorCm: medidaATexto(c.paquete[f].espesorCm) },
    ]),
  ) as Texto;

/** Primer problema de los datos de una familia, dicho regla por regla; null si están bien (o ambos vacíos). */
function errorFamilia(familia: string, kg: number | null, espesorCm: number | null) {
  if (Number.isNaN(kg))
    return `${familia}: el peso por unidad debe ser un número mayor que cero (por ejemplo 4,5).`;
  if (kg !== null && kg > MAX_KG_UNIDAD)
    return `${familia}: el peso por unidad no puede superar ${MAX_KG_UNIDAD.toLocaleString('es-CL')} kg.`;
  if (Number.isNaN(espesorCm))
    return `${familia}: el espesor debe ser un número mayor que cero (por ejemplo 4,5).`;
  if (espesorCm !== null && espesorCm > MAX_ESPESOR_CM)
    return `${familia}: el espesor no puede superar ${MAX_ESPESOR_CM} cm.`;
  if ((kg === null) !== (espesorCm === null))
    return `${familia}: completa el peso y el espesor, o deja ambos vacíos.`;
  return null;
}

/**
 * Ajustes de Starken: ciudad de origen y, como el catálogo no trae pesos, el peso por unidad y el grosor de cada
 * familia. Vacíos de fábrica: mientras falten, la cotización de despacho no se puede pedir.
 */
export function ConfiguracionStarkenAjustes({
  avisar,
}: {
  avisar: (tipo: TipoAviso, texto: string, extra?: { clave?: string }) => number;
}) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [origen, setOrigen] = useState('');
  const [textos, setTextos] = useState<Texto | null>(null);
  const [ciudades, setCiudades] = useState<CiudadStarken[] | null>(null);
  const [error, setError] = useState('');
  const [errorCiudades, setErrorCiudades] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const recibir = (e: Estado) => {
    setEstado(e);
    setOrigen(e.configuracion.origen ? String(e.configuracion.origen.codigoCiudad) : '');
    setTextos(aTextos(e.configuracion));
  };

  useEffect(() => {
    const control = new AbortController();
    pedirJSON<Estado>('/api/starken', { signal: control.signal, cache: 'no-store' }).then(
      (e) => {
        recibir(e);
        if (!e.disponible) return;
        pedirJSON<{ ciudades: CiudadStarken[] }>('/api/starken/ciudades?tipo=origen', {
          signal: control.signal,
          cache: 'no-store',
        }).then(
          (d) => setCiudades(d.ciudades),
          (causa) => {
            if (!esSilencioso(causa)) setErrorCiudades(mensajeDe(causa));
          },
        );
      },
      (causa) => {
        if (!esSilencioso(causa)) setError(mensajeDe(causa));
      },
    );
    return () => control.abort();
  }, []);

  if (!estado || !textos)
    return (
      <p className="catalog-modal-intro" role="status">
        {error || 'Cargando la configuración de Starken…'}
      </p>
    );

  const editable = estado.puedeEditar;
  const guardado = estado.configuracion.origen;
  // Las ciudades de Starken; si la guardada ya no figura (o la lista no cargó), se conserva como opción.
  const opciones = [...(ciudades ?? [])];
  if (guardado && !opciones.some((c) => c.codigoCiudad === guardado.codigoCiudad))
    opciones.unshift({ codigoCiudad: guardado.codigoCiudad, nombre: guardado.nombre, comunas: [] });
  const setTexto = (f: Familia, campo: 'kg' | 'espesorCm', valor: string) => {
    setError('');
    setTextos({ ...textos, [f]: { ...textos[f], [campo]: valor } });
  };

  async function guardar(evento: FormEvent) {
    evento.preventDefault();
    if (!editable || ocupado || !estado || !textos) return;
    const paquete = {} as ConfiguracionStarken['paquete'];
    for (const f of FAMILIAS_ENVIO) {
      const kg = leerMedida(textos[f].kg),
        espesorCm = leerMedida(textos[f].espesorCm);
      const problema = errorFamilia(ETIQUETA_FAMILIA[f], kg, espesorCm);
      if (problema) {
        setError(problema);
        return;
      }
      paquete[f] = { kg, espesorCm };
    }
    const ciudad = opciones.find((c) => String(c.codigoCiudad) === origen);
    setOcupado(true);
    setError('');
    try {
      const data = await pedirJSON<Estado>('/api/starken', {
        json: {
          origen: ciudad ? { codigoCiudad: ciudad.codigoCiudad, nombre: ciudad.nombre } : null,
          paquete,
        },
      });
      recibir(data);
      avisar('exito', 'Configuración de Starken guardada.', { clave: 'configuracion-starken' });
    } catch (causa) {
      if (!esSilencioso(causa)) setError(mensajeDe(causa));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={guardar} aria-label="Despacho con Starken">
      <p className="catalog-modal-intro">
        Con Starken se cotiza el despacho desde la cotización, según el bulto que arman las puertas y piezas
        del pedido. El catálogo no trae pesos: indica el peso y el espesor de una unidad de cada familia. Los
        marcos, molduras y piezas T se toman con sección cuadrada del espesor indicado. Mientras falten, el
        botón «Cotizar con Starken» no está disponible.
      </p>
      {!estado.disponible && (
        <p className="catalog-error" role="status">
          {estado.mensaje ?? 'Starken no está configurado'}. Quien administra el servidor debe definir las
          variables STARKEN_* (ver el README). Mientras tanto puedes guardar los pesos.
        </p>
      )}
      <label className="ia-field">
        <span>Ciudad de origen</span>
        <select
          value={origen}
          onChange={(e) => {
            setError('');
            setOrigen(e.target.value);
          }}
          disabled={!editable || ocupado || !estado.disponible || (ciudades === null && !guardado)}
        >
          <option value="">
            {ciudades === null && estado.disponible && !errorCiudades
              ? 'Cargando ciudades…'
              : 'Seleccionar ciudad de origen'}
          </option>
          {opciones.map((c) => (
            <option key={c.codigoCiudad} value={c.codigoCiudad}>
              {c.nombre}
            </option>
          ))}
        </select>
      </label>
      {ciudades === null && estado.disponible && !errorCiudades && (
        <span role="status" className="sr-only">
          Cargando las ciudades de Starken…
        </span>
      )}
      {errorCiudades && (
        <p className="catalog-error" role="alert">
          {errorCiudades}
        </p>
      )}
      <div>
        {FAMILIAS_ENVIO.map((f) => (
          <div className="tramo-descuento" key={f}>
            <label className="ia-field">
              <span>{ETIQUETA_FAMILIA[f]}: peso por unidad (kg)</span>
              <input
                inputMode="decimal"
                maxLength={8}
                aria-label={`${ETIQUETA_FAMILIA[f]}: peso por unidad (kg)`}
                value={textos[f].kg}
                onChange={(e) => setTexto(f, 'kg', e.target.value)}
                disabled={!editable || ocupado}
              />
            </label>
            <label className="ia-field">
              <span>{ETIQUETA_FAMILIA[f]}: espesor (cm)</span>
              <input
                inputMode="decimal"
                maxLength={8}
                aria-label={`${ETIQUETA_FAMILIA[f]}: espesor (cm)`}
                value={textos[f].espesorCm}
                onChange={(e) => setTexto(f, 'espesorCm', e.target.value)}
                disabled={!editable || ocupado}
              />
            </label>
          </div>
        ))}
      </div>
      {error && (
        <p className="catalog-error" role="alert">
          {error}
        </p>
      )}
      {editable && (
        <div className="ia-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => recibir(estado)}
            disabled={ocupado}
          >
            Descartar cambios
          </button>
          <button type="submit" className="button primary" disabled={ocupado}>
            {ocupado ? 'Guardando…' : 'Guardar Starken'}
          </button>
        </div>
      )}
    </form>
  );
}

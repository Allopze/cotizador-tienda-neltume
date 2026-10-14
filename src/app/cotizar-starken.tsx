'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Cotizacion } from '@/negocio/estado';
import { pesos } from '@/negocio/precios';
import {
  buscarCiudades,
  calcularBulto,
  claveTarifas,
  textoBulto,
  textoTarifa,
  type CiudadStarken,
  type EstadoStarken,
  type ResultadoEnvioStarken,
  type TarifaStarkenFirmada,
} from '@/negocio/starken';
import type { CambiosEdicion } from './contrato';
import { esSilencioso, mensajeDe, pedirJSON } from './solicitud';

type Tarifas = Extract<ResultadoEnvioStarken, { estado: 'tarifas' }>;
type Seleccion = Extract<ResultadoEnvioStarken, { estado: 'elegir_ciudad' }>;
interface Props {
  actual: Cotizacion;
  /** Guarda el valor de despacho y la tarifa elegida (acción `editar`). */
  aplicar: (cambios: CambiosEdicion) => Promise<boolean>;
  ocupado: boolean;
  guardando: boolean;
}

/**
 * «Cotizar con Starken» dentro del despacho de una cotización editable: muestra el bulto calculado, consulta las
 * tarifas de agencia y domicilio y, solo si la persona elige una, deja su valor neto como valor de despacho.
 * El valor sigue pudiéndose escribir a mano.
 */
/** «PUERTO MONTT» → «Puerto Montt»: Starken nombra las ciudades en mayúsculas. */
const nombreCiudad = (nombre: string) =>
  nombre
    .toLocaleLowerCase('es-CL')
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, l: string) => sep + l.toLocaleUpperCase('es-CL'));

export function CotizarStarken({ actual, aplicar, ocupado, guardando }: Props) {
  const [estado, setEstado] = useState<EstadoStarken | null>(null);
  const [errorEstado, setErrorEstado] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState<{ tarifas: Tarifas; clave: string } | null>(null);
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null);
  const [ciudades, setCiudades] = useState<CiudadStarken[] | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [aplicada, setAplicada] = useState('');

  useEffect(() => {
    const control = new AbortController();
    pedirJSON<EstadoStarken>('/api/starken', { signal: control.signal, cache: 'no-store' }).then(
      setEstado,
      (e) => {
        if (!esSilencioso(e)) setErrorEstado(mensajeDe(e));
      },
    );
    return () => control.abort();
  }, []);

  const lineas = actual.montos.lineas;
  const bulto = useMemo(() => calcularBulto(lineas, estado?.configuracion.paquete), [lineas, estado]);
  // Las tarifas valen para el pedido, el bulto y el destino con que se pidieron: si algo cambia, hay que volver a
  // cotizar (antes quedaban a la vista tarifas de otra ciudad, o de otro pedido con el mismo bulto).
  const claveBulto = bulto.ok
    ? claveTarifas(lineas, bulto.bulto, actual.despacho?.destino, actual.cliente.comuna)
    : '';
  const vigente = resultado && resultado.clave === claveBulto ? resultado.tarifas : null;

  const bloqueo = !estado
    ? errorEstado || 'Cargando la configuración de Starken…'
    : !estado.disponible
      ? (estado.mensaje ?? 'Starken no está configurado')
      : actual.incompletos.length
        ? 'Completa o quita los ítems pendientes para cotizar el despacho.'
        : !bulto.ok
          ? bulto.motivo === 'sin_productos'
            ? 'Agrega productos para cotizar el despacho.'
            : bulto.mensaje
          : !estado.configuracion.origen
            ? 'Configura la ciudad de origen de Starken en Ajustes'
            : '';
  const puedeCotizar = !bloqueo && !ocupado && !cargando;

  async function cotizar(codigoCiudad?: number) {
    if (!puedeCotizar && codigoCiudad === undefined) return;
    setCargando(true);
    setError('');
    setAplicada('');
    // Las tarifas anteriores no se dejan al lado de una consulta nueva (o de su error).
    setResultado(null);
    try {
      const r = await pedirJSON<ResultadoEnvioStarken>('/api/starken/cotizar', {
        json: { id: actual.id, ...(codigoCiudad === undefined ? {} : { codigoCiudad }) },
      });
      if (r.estado === 'tarifas') {
        setResultado({ tarifas: r, clave: claveBulto });
        setSeleccion(null);
      } else {
        setResultado(null);
        setSeleccion(r);
        setBusqueda('');
        await cargarCiudades();
      }
    } catch (e) {
      if (!esSilencioso(e)) setError(mensajeDe(e));
    } finally {
      setCargando(false);
    }
  }

  async function cargarCiudades() {
    if (ciudades) return;
    try {
      setCiudades(
        (
          await pedirJSON<{ ciudades: CiudadStarken[] }>('/api/starken/ciudades?tipo=destino', {
            cache: 'no-store',
          })
        ).ciudades,
      );
    } catch (e) {
      if (!esSilencioso(e)) setError(mensajeDe(e));
    }
  }

  async function cambiarCiudad() {
    setSeleccion({ estado: 'elegir_ciudad', motivo: 'no_encontrada', candidatas: [] });
    setBusqueda('');
    await cargarCiudades();
  }

  async function usar(t: TarifaStarkenFirmada, r: Tarifas) {
    const ok = await aplicar({
      // Sin destino escrito, se deja el de la tarifa: el resumen decía «Starken» sin ciudad.
      despacho: {
        valor: t.neto,
        ...(actual.despacho?.destino?.trim() ? {} : { destino: nombreCiudad(r.destino.nombre) }),
      },
      tarifaStarken: {
        tipoEntrega: t.tipoEntrega,
        ...(t.servicio ? { servicio: t.servicio } : {}),
        dias: t.dias,
        costoTotal: t.costoTotal,
        ciudadDestino: r.destino.nombre,
        codigoCiudadDestino: r.destino.codigoCiudad,
        // Con la firma, el servidor reconoce que la tarifa salió de él para esta cotización y no venció.
        vence: t.vence,
        firma: t.firma,
        huellaBulto: t.huellaBulto,
      },
    });
    if (ok) {
      setAplicada(`Valor de despacho fijado en ${pesos(t.neto)} sin IVA con la tarifa de Starken.`);
      setResultado(null);
    }
  }

  const lista = seleccion
    ? busqueda.trim() || !seleccion.candidatas.length
      ? buscarCiudades(busqueda, ciudades ?? [])
      : seleccion.candidatas
    : [];

  return (
    <div className="starken-cotizar">
      {/* Región en vivo: anuncia la carga de la configuración y de las tarifas, que el botón solo muestra con texto. */}
      <span role="status" className="sr-only">
        {!estado && !errorEstado
          ? 'Cargando la configuración de Starken…'
          : cargando
            ? 'Consultando las tarifas de Starken…'
            : ''}
      </span>
      <div className="starken-acciones">
        <button
          type="button"
          className="button secondary small"
          onClick={() => void cotizar()}
          disabled={!puedeCotizar}
          aria-describedby="starken-ayuda"
        >
          {cargando ? 'Consultando…' : 'Cotizar con Starken'}
        </button>
        {bloqueo ? (
          <p className="muted starken-ayuda" id="starken-ayuda">
            {bloqueo}
            {estado?.configuracion.origen === null && estado.disponible && (
              <>
                {' '}
                <Link href="/ajustes?seccion=starken">Abrir Ajustes</Link>
              </>
            )}
          </p>
        ) : (
          <p
            className="muted starken-ayuda"
            id="starken-ayuda"
            data-testid="starken-bulto"
            title="Medidas totales: espesor apilado × ancho × largo"
          >
            Bulto: {bulto.ok ? textoBulto(bulto.bulto) : ''}
          </p>
        )}
      </div>
      {error && (
        <p className="catalog-error" role="alert">
          {error}
        </p>
      )}
      {/* Con un bloqueo nuevo (p. ej. un ítem pendiente) la tarifa aplicada ya no describe el pedido: no se
          muestra junto al motivo para que los dos mensajes no se contradigan. */}
      {aplicada && !bloqueo && (
        <p className="starken-aplicada" role="status">
          {aplicada}
        </p>
      )}
      {vigente && resultado && (
        <div className="starken-resultado" aria-label="Tarifas de Starken">
          {vigente.destinoDescartado && (
            <p className="starken-aviso-destino" role="status">
              «{vigente.destinoDescartado}» no coincide con ninguna ciudad de Starken: se cotizó con la comuna
              del cliente. Si no es el destino correcto, usa «Cambiar ciudad».
            </p>
          )}
          <p className="muted">
            Destino: <strong>{vigente.destino.nombre}</strong> ·{' '}
            <button
              type="button"
              className="link"
              onClick={() => void cambiarCiudad()}
              disabled={ocupado || cargando}
            >
              Cambiar ciudad
            </button>
          </p>
          <p className="muted">Bulto cotizado: {vigente.textoBulto}</p>
          <ul className="starken-tarifas">
            {vigente.tarifas.map((t) => (
              <li key={`${t.tipoEntrega}-${t.servicio}-${t.costoTotal}`} className="starken-tarifa">
                <span className="starken-tarifa-texto">{textoTarifa(t)}</span>
                <button
                  type="button"
                  className="button primary small"
                  aria-label={`Usar esta tarifa: ${textoTarifa(t)}`}
                  onClick={() => void usar(t, vigente)}
                  disabled={ocupado || guardando}
                >
                  {guardando ? 'Guardando…' : 'Usar esta tarifa'}
                </button>
              </li>
            ))}
          </ul>
          <p className="muted">
            Starken informa el valor con IVA; en la cotización el despacho se guarda sin IVA.
          </p>
        </div>
      )}
      {seleccion && (
        <div className="starken-ciudad" role="group" aria-label="Elegir ciudad de destino">
          <p className="muted">
            {seleccion.motivo === 'ambigua'
              ? 'El destino coincide con varias ciudades de Starken. Elige la correcta.'
              : 'Elige la ciudad de destino de Starken.'}
          </p>
          <label className="ia-field">
            <span>Buscar ciudad o comuna de destino</span>
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={
                seleccion.candidatas.length
                  ? 'Coincidencias; escribe para buscar en todas'
                  : 'Escribe el nombre de la ciudad o comuna'
              }
              autoComplete="off"
              maxLength={80}
            />
          </label>
          {ciudades === null && !error ? (
            <p className="muted" role="status">
              Cargando ciudades…
            </p>
          ) : lista.length ? (
            <ul className="starken-ciudades" aria-label="Ciudades de destino">
              {lista.map((c) => (
                <li key={c.codigoCiudad}>
                  <button
                    type="button"
                    className="starken-ciudad-opcion"
                    onClick={() => void cotizar(c.codigoCiudad)}
                    disabled={ocupado || cargando}
                  >
                    <strong>{c.nombre}</strong>
                    {c.comunas.length > 0 && (
                      <span className="muted">
                        {' '}
                        · {c.comunas.slice(0, 6).join(', ')}
                        {c.comunas.length > 6 ? '…' : ''}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            ciudades && <p className="muted">Sin coincidencias.</p>
          )}
          <button type="button" className="button secondary small" onClick={() => setSeleccion(null)}>
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}

'use client';
import { useCallback, useEffect, useState } from 'react';
import { esSilencioso, mensajeDe, pedirJSON } from '../solicitud';
import {
  codigoPrueba,
  fechaPrueba,
  textoConfiguracion,
  textoDireccion,
  textoResultadoPrueba,
  type EstadoConexion,
  type FabricaConexion,
  type RespuestaPrueba,
} from './conexion';

/**
 * Ajustes → «Conexión con la fábrica» (solo administración): qué falta de la configuración, el botón que envía un PDF de
 * prueba firmado a la aplicación de la fábrica y las últimas pruebas, enviadas y recibidas. La fábrica tiene el mismo
 * botón: lo que ella envía aparece aquí como «Recibida de la fábrica», con el mismo código de prueba que lleva el PDF.
 */
export function ConexionFabrica() {
  const [estado, setEstado] = useState<EstadoConexion | null>(null);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState('');
  const [actualizando, setActualizando] = useState(false);
  const [ultima, setUltima] = useState<Record<string, RespuestaPrueba['prueba']>>({});
  const [errorEnvio, setErrorEnvio] = useState('');

  const recibir = useCallback((e: EstadoConexion) => {
    setEstado(e);
    setError('');
  }, []);
  const fallar = useCallback((causa: unknown) => {
    if (!esSilencioso(causa)) setError(mensajeDe(causa));
  }, []);

  useEffect(() => {
    const control = new AbortController();
    pedirJSON<EstadoConexion>('/api/ajustes/conexion', { signal: control.signal, cache: 'no-store' }).then(recibir, fallar);
    return () => control.abort();
  }, [recibir, fallar]);

  async function actualizar() {
    setActualizando(true);
    await pedirJSON<EstadoConexion>('/api/ajustes/conexion', { cache: 'no-store' }).then(recibir, fallar);
    setActualizando(false);
  }

  async function enviar(f: FabricaConexion) {
    setEnviando(f.fabrica);
    setErrorEnvio('');
    try {
      const r = await pedirJSON<RespuestaPrueba>('/api/ajustes/conexion', { json: { fabrica: f.fabrica } });
      setUltima((previas) => ({ ...previas, [f.fabrica]: r.prueba }));
      setEstado((actual) =>
        actual && { fabricas: actual.fabricas.map((x) => (x.fabrica === f.fabrica ? { ...x, pruebas: r.pruebas } : x)) },
      );
    } catch (causa) {
      if (!esSilencioso(causa)) setErrorEnvio(mensajeDe(causa));
    } finally {
      setEnviando('');
    }
  }

  if (!estado)
    return (
      <p className="catalog-modal-intro" role="status">
        {error || 'Cargando la conexión con la fábrica…'}
      </p>
    );

  return (
    <div className="conexion-fabrica">
      <p className="catalog-modal-intro">
        Comprueba que la tienda y la fábrica se hablan: envía un PDF de prueba firmado a la fábrica y muestra el resultado
        al instante. La fábrica tiene el mismo botón en sus Ajustes; lo que ella envíe aparece abajo como «Recibida de la
        fábrica», con el mismo código de prueba que lleva el PDF. Una prueba no crea pedidos ni cotizaciones.
      </p>
      {error && (
        <p className="catalog-error" role="alert">
          {error}
        </p>
      )}
      {estado.fabricas.map((f) => {
        const textos = textoConfiguracion(f.configuracion);
        const resultado = ultima[f.fabrica];
        return (
          <section key={f.fabrica} className="sesiones-cuenta" aria-labelledby={`conexion-${f.fabrica}`}>
            <h3 id={`conexion-${f.fabrica}`} className="eyebrow ajustes-subtitulo">
              FÁBRICA {f.nombre.toUpperCase()}
            </h3>
            <dl className="conexion-estado">
              <div>
                <dt>URL de la fábrica</dt>
                <dd className={f.configuracion.urlValida ? undefined : 'falta'}>{textos.url}</dd>
              </div>
              <div>
                <dt>Secreto compartido</dt>
                <dd className={f.configuracion.secretoValido ? undefined : 'falta'}>{textos.secreto}</dd>
              </div>
            </dl>
            {f.configuracion.falta && (
              <p className="catalog-error" role="status">
                {f.configuracion.falta}
              </p>
            )}
            <div className="ia-actions">
              <button type="button" className="button secondary" onClick={() => void actualizar()} disabled={actualizando || !!enviando}>
                {actualizando ? 'Actualizando…' : 'Actualizar lista'}
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => void enviar(f)}
                disabled={!f.configuracion.completa || !!enviando}
                aria-busy={enviando === f.fabrica}
              >
                {enviando === f.fabrica ? 'Enviando…' : 'Enviar PDF de prueba a la fábrica'}
              </button>
            </div>
            <div aria-live="polite">
              {errorEnvio && (
                <p className="catalog-error" role="alert">
                  {errorEnvio}
                </p>
              )}
              {resultado && !errorEnvio && (
                <p className={resultado.resultado === 'aceptada' ? 'notice' : 'catalog-error'}>
                  {resultado.mensaje}.{resultado.aviso ? ` ${resultado.aviso}` : ''}
                </p>
              )}
            </div>
            {f.pruebas.length === 0 ? (
              <p className="muted">Todavía no hay pruebas enviadas ni recibidas.</p>
            ) : (
              <div className="catalogo-lista">
                <table>
                  <thead>
                    <tr>
                      <th>PRUEBA</th>
                      <th>RESULTADO</th>
                      <th>
                        <span className="sr-only">PDF</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.pruebas.map((p) => (
                      <tr key={p.id}>
                        <td data-etiqueta="Prueba">
                          <strong>{fechaPrueba(p.fecha)}</strong>
                          <small>
                            {textoDireccion(p.direccion)} · código {codigoPrueba(p.eventoId)}
                          </small>
                        </td>
                        <td data-etiqueta="Resultado">{textoResultadoPrueba(p)}</td>
                        <td className="celda-acciones">
                          {p.tienePdf ? (
                            <a
                              className="button secondary small"
                              href={`/api/ajustes/conexion/pruebas/${p.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Ver PDF<span className="sr-only"> de la prueba {codigoPrueba(p.eventoId)}</span>
                            </a>
                          ) : (
                            <span className="muted">Sin PDF</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

'use client';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Avisos, useAvisos } from '../avisos';
import { CambiarClave } from '../cambiar-clave';
import { ConfiguracionIA, type EstadoAjustes } from '../configuracion-ia';
import { Encabezado } from '../encabezado';
import { EncabezadoPagina } from '../encabezado-pagina';
import { useEsCliente } from '../memoria-pantalla';
import { useAvisoSalida, useSeccionVisible } from '../secciones-pantalla';
import { esSilencioso, mensajeDe, pedirJSON } from '../solicitud';
import { CrearUsuario } from './crear-usuario';
import { CotizacionesDespacho, DatosEmpresa, PreciosDescuentos, useConfiguracionNegocio } from './configuracion-negocio';
import { seccionesVisibles, type SeccionAjustes } from './secciones';
import { ConfiguracionStarkenAjustes } from './starken';
import { GestionUsuarios } from './usuarios';

const AVISO_SALIDA = 'Hay cambios sin guardar en Ajustes. ¿Salir de todos modos?';

/** Pantalla «Ajustes»: cuenta, asistente, configuración comercial, Starken y, para admin, usuarios. */
export function PantallaAjustes({
  email,
  nombre,
  seccion: inicial,
  puedeCrearUsuarios,
}: {
  email: string;
  nombre: string;
  seccion: SeccionAjustes;
  puedeCrearUsuarios: boolean;
}) {
  const { avisos, avisar, cerrar } = useAvisos();
  const [estado, setEstado] = useState<EstadoAjustes | null>(null);
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);
  const negocio = useConfiguracionNegocio();
  const secciones = useMemo(() => seccionesVisibles(puedeCrearUsuarios), [puedeCrearUsuarios]);

  useEffect(() => {
    const control = new AbortController();
    pedirJSON<EstadoAjustes>('/api/ajustes', { signal: control.signal, cache: 'no-store' }).then(
      (d) => {
        setEstado(d);
        setError('');
      },
      (e) => {
        if (!esSilencioso(e)) setError(mensajeDe(e));
      },
    );
    return () => control.abort();
  }, [intento]);

  // Cambiar de sección no es una navegación de Next (igual que en Catálogo): la URL se actualiza con pushState
  // y las secciones visitadas quedan montadas, así lo escrito en una no se pierde al pasar a otra.
  const [seccion, setSeccion] = useState<SeccionAjustes>(inicial);
  useEffect(() => {
    const alVolver = () => {
      const pedida = new URLSearchParams(location.search).get('seccion');
      setSeccion(secciones.find((s) => s.id === pedida)?.id ?? 'cuenta');
    };
    window.addEventListener('popstate', alVolver);
    return () => window.removeEventListener('popstate', alVolver);
  }, [secciones]);
  const irA = (e: MouseEvent<HTMLAnchorElement>, s: SeccionAjustes) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (s === seccion) return;
    window.history.pushState(null, '', e.currentTarget.href);
    setSeccion(s);
  };
  const cliente = useEsCliente();
  const [visitadas, setVisitadas] = useState<SeccionAjustes[]>([seccion]);
  if (!visitadas.includes(seccion)) setVisitadas([...visitadas, seccion]);
  const montada = (s: SeccionAjustes) => cliente && visitadas.includes(s);
  const actual = secciones.find((s) => s.id === seccion)!;

  // Secciones con cambios sin guardar: se marcan en la navegación y se pide confirmar antes de salir.
  const [sucias, setSucias] = useState<ReadonlySet<SeccionAjustes>>(new Set());
  const alCambiar = useMemo(
    () =>
      Object.fromEntries(
        secciones.map((s) => [
          s.id,
          (sucio: boolean) =>
            setSucias((previas) => {
              if (previas.has(s.id) === sucio) return previas;
              const siguientes = new Set(previas);
              if (sucio) siguientes.add(s.id);
              else siguientes.delete(s.id);
              return siguientes;
            }),
        ]),
      ) as Record<SeccionAjustes, (sucio: boolean) => void>,
    [secciones],
  );
  const hayCambios = sucias.size > 0;
  useAvisoSalida(hayCambios, AVISO_SALIDA);
  useSeccionVisible('Ajustes', actual.titulo);

  return (
    <div className="app-shell">
      <Encabezado email={email} nombre={nombre} pantalla="ajustes" />
      <EncabezadoPagina titulo="Ajustes" />
      <div className="con-secciones superficie">
        <nav className="secciones-nav" aria-label="Secciones de ajustes">
          <ul>
            {secciones.map((s) => (
              <li key={s.id}>
                <a
                  href={s.id === 'cuenta' ? '/ajustes' : `/ajustes?seccion=${s.id}`}
                  onClick={(e) => irA(e, s.id)}
                  aria-current={s.id === seccion ? 'page' : undefined}
                >
                  {s.titulo}
                  {sucias.has(s.id) && (
                    <span className="seccion-sucia" title="Cambios sin guardar">
                      <span className="sr-only"> (cambios sin guardar)</span>
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main className="secciones-contenido ajustes-pagina" aria-labelledby="seccion-titulo">
          <h2 id="seccion-titulo" tabIndex={-1}>
            {actual.encabezado}
          </h2>
          {montada('cuenta') && (
            <div hidden={seccion !== 'cuenta'}>
              <CambiarClave avisar={avisar} alCambiar={alCambiar.cuenta} />
            </div>
          )}
          {montada('asistente') && (
            <div hidden={seccion !== 'asistente'}>
              <ConfiguracionIA
                estado={estado}
                errorCarga={error}
                reintentar={() => {
                  setError('');
                  setIntento((n) => n + 1);
                }}
                guardado={setEstado}
                avisar={avisar}
                alCambiar={alCambiar.asistente}
              />
            </div>
          )}
          {montada('empresa') && (
            <div hidden={seccion !== 'empresa'}>
              <DatosEmpresa negocio={negocio} avisar={avisar} alCambiar={alCambiar.empresa} />
            </div>
          )}
          {montada('precios') && (
            <div hidden={seccion !== 'precios'}>
              <PreciosDescuentos negocio={negocio} avisar={avisar} alCambiar={alCambiar.precios} />
            </div>
          )}
          {montada('cotizaciones') && (
            <div hidden={seccion !== 'cotizaciones'}>
              <CotizacionesDespacho negocio={negocio} avisar={avisar} alCambiar={alCambiar.cotizaciones} />
            </div>
          )}
          {montada('starken') && (
            <div hidden={seccion !== 'starken'}>
              <ConfiguracionStarkenAjustes avisar={avisar} alCambiar={alCambiar.starken} />
            </div>
          )}
          {puedeCrearUsuarios && montada('usuarios') && (
            <div hidden={seccion !== 'usuarios'}>
              <GestionUsuarios avisar={avisar} />
              <CrearUsuario avisar={avisar} />
            </div>
          )}
        </main>
      </div>
      <footer className="site-footer">
        <span>
          NELTUME <span className="muted">/ Hecho en madera.</span>
        </span>
        <span>Asistente de cotizaciones · Uso interno</span>
      </footer>
      <Avisos avisos={avisos} cerrar={cerrar} />
    </div>
  );
}

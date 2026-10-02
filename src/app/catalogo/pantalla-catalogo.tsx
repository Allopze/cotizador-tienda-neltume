'use client';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { AltaProducto } from '../alta-producto';
import { Avisos, useAvisos } from '../avisos';
import { CatalogoConsulta } from '../catalogo-consulta';
import { GestionManuales } from '../gestion-manuales';
import { ConfiguracionCatalogo } from '../configuracion-catalogo';
import { ImportarCatalogo } from './importar-catalogo';
import { Encabezado } from '../encabezado';
import { EncabezadoPagina } from '../encabezado-pagina';
import { useEsCliente, useScrollRecordado } from '../memoria-pantalla';
import { useAvisoSalida, useSeccionVisible } from '../secciones-pantalla';
import { pedirJSON } from '../solicitud';
import { SECCIONES, type Seccion } from './secciones';

const AVISO_SALIDA = 'Hay cambios sin guardar en la configuración del catálogo. ¿Salir de todos modos?';

/** Pantalla «Catálogo»: consultar productos y agregar uno (a mano o con el asistente). */
export function PantallaCatalogo({
  email,
  nombre,
  seccion: inicial,
  puedeAdministrar,
}: {
  email: string;
  nombre: string;
  seccion: Seccion;
  puedeAdministrar: boolean;
}) {
  const seccionesVisibles = puedeAdministrar ? SECCIONES : SECCIONES.filter((s) => s.id === 'consultar' || s.id === 'agregar');
  // Cambiar de sección no es una navegación de Next: cada `?seccion=` sería otra página (se montaría otra
  // instancia y se perdería el scroll). Se actualiza la URL con pushState, así el enlace directo y
  // Atrás/Adelante siguen funcionando, y la sección vive en el estado de esta pantalla.
  const [seccion, setSeccion] = useState<Seccion>(inicial);
  // Si se pidió una sección que no corresponde (o no existe), la URL pasa a nombrar la que se muestra.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('seccion') !== (inicial === 'consultar' ? null : inicial))
      window.history.replaceState(null, '', inicial === 'consultar' ? '/catalogo' : `/catalogo?seccion=${inicial}`);
  }, [inicial]);
  useEffect(() => {
    const alVolver = () => {
      const pedida = new URLSearchParams(location.search).get('seccion');
      setSeccion(seccionesVisibles.find((s) => s.id === pedida)?.id ?? 'consultar');
    };
    window.addEventListener('popstate', alVolver);
    return () => window.removeEventListener('popstate', alVolver);
  }, [seccionesVisibles]);
  const irA = (e: MouseEvent<HTMLAnchorElement>, s: Seccion) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (s === seccion) return;
    window.history.pushState(null, '', e.currentTarget.href);
    setSeccion(s);
  };
  // El alta asistida necesita saber si hay asistente; sin él, el formulario manual sigue disponible.
  const [asistente, setAsistente] = useState(true);
  useEffect(() => {
    const control = new AbortController();
    pedirJSON<{ asistenteConfigurado: boolean }>('/api/ajustes', {
      signal: control.signal,
      cache: 'no-store',
    })
      .then((d) => setAsistente(d.asistenteConfigurado))
      .catch(() => {});
    return () => control.abort();
  }, []);

  const cliente = useEsCliente();
  useScrollRecordado('catalogo', cliente);
  // Las secciones visitadas quedan montadas (ocultas): al volver a una, la búsqueda o el alta a medias
  // siguen donde estaban.
  const [visitadas, setVisitadas] = useState<Seccion[]>([seccion]);
  if (!visitadas.includes(seccion)) setVisitadas([...visitadas, seccion]);
  const montada = (s: Seccion) => cliente && (s === seccion || visitadas.includes(s));
  const actual = seccionesVisibles.find((s) => s.id === seccion)!;
  useSeccionVisible('Catálogo', actual.titulo);
  const { avisos, avisar, cerrar } = useAvisos();
  // La configuración es la única sección con un borrador largo que se guarda aparte.
  const [configuracionSucia, setConfiguracionSucia] = useState(false);
  useAvisoSalida(configuracionSucia, AVISO_SALIDA);
  // En móvil las pestañas se desplazan en horizontal: la activa se trae entera a la vista.
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const barra = nav.current;
    const activa = barra?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!barra || !activa || barra.scrollWidth <= barra.clientWidth) return;
    const caja = barra.getBoundingClientRect();
    const pestaña = activa.getBoundingClientRect();
    // El borde derecho se desvanece (26 px): la pestaña activa queda fuera de ese borde.
    const sobraDerecha = pestaña.right - (caja.right - 26);
    if (sobraDerecha > 0) barra.scrollLeft += Math.ceil(sobraDerecha);
    else if (pestaña.left < caja.left) barra.scrollLeft -= Math.ceil(caja.left - pestaña.left);
  }, [seccion, cliente]);

  return (
    <div className="app-shell pantalla-catalogo">
      <Encabezado email={email} nombre={nombre} pantalla="catalogo" />
      <EncabezadoPagina titulo="Catálogo" />
      <div className="con-secciones superficie">
        <nav ref={nav} className="secciones-nav" aria-label="Secciones del catálogo">
          <ul>
            {seccionesVisibles.map((s) => (
              <li key={s.id}>
                <a
                  href={s.id === 'consultar' ? '/catalogo' : `/catalogo?seccion=${s.id}`}
                  onClick={(e) => irA(e, s.id)}
                  aria-current={s.id === seccion ? 'page' : undefined}
                >
                  {s.titulo}
                  {s.id === 'configuracion' && configuracionSucia && (
                    <span className="seccion-sucia" title="Cambios sin guardar">
                      <span className="sr-only"> (cambios sin guardar)</span>
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main className="secciones-contenido" aria-labelledby="seccion-titulo">
          <h2 id="seccion-titulo" tabIndex={-1}>
            {actual.encabezado}
          </h2>
          {montada('consultar') && (
            <div hidden={seccion !== 'consultar'}>
              <CatalogoConsulta activa={seccion === 'consultar'} />
            </div>
          )}
          {montada('importar') && (
            <div hidden={seccion !== 'importar'}>
              <ImportarCatalogo />
            </div>
          )}
          {montada('agregar') && (
            <div hidden={seccion !== 'agregar'}>
              <AltaProducto asistente={asistente} />
            </div>
          )}
          {montada('manuales') && (
            <div hidden={seccion !== 'manuales'}>
              <GestionManuales avisar={avisar} />
            </div>
          )}
          {montada('configuracion') && (
            <div hidden={seccion !== 'configuracion'}>
              <ConfiguracionCatalogo avisar={avisar} cerrarAviso={cerrar} alCambiar={setConfiguracionSucia} />
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
